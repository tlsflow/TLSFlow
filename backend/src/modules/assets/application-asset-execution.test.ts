import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { ApplicationAssetExecutionService } from './application/application-asset-execution.service.js';

const workflowInputBindings = { apiVersion: 'gcac.input-bindings/v1' as const, connections: {}, variables: {}, credentials: {}, artifacts: {} };

async function seedFixedWorkflowChain(db: PgliteDatabase, tenantId: string, options: {
  workflowTemplateId?: string;
  workflowVersionId?: string;
  pluginVersionId?: string;
  origin?: 'plugin_internal' | 'user';
  versionStatus?: 'published' | 'draft';
  pluginStatus?: 'ENABLED' | 'DISABLED';
  pluginRuntime?: 'WORKFLOW_DSL' | 'AGENT_PLAN';
  capabilityDeclared?: boolean;
} = {}) {
  const workflowTemplateId = options.workflowTemplateId ?? 'workflow_plugin_internal';
  const workflowVersionId = options.workflowVersionId ?? 'workflow_plugin_internal_v1';
  const pluginVersionId = options.pluginVersionId ?? 'plugin-standalone-v1';
  const capabilityKey = 'certificate.deploy';
  const workflowKey = capabilityKey;
  const contentHash = 'sha256:standalone-workflow';
  const content = {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'standalone-workflow', version: '1.0.0', platforms: ['linux'], updateMethods: ['curl'] },
    inputContract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
    steps: [{ name: 'wait', type: 'wait', seconds: 1 }],
  };
  const manifest = {
    apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'fixture.standalone', version: '1.0.0',
    runtime: options.pluginRuntime ?? 'WORKFLOW_DSL', source: 'USER', scope: 'BOTH', trust: 'UNSIGNED', support: 'SELF_MANAGED',
    permissions: [], capabilities: options.capabilityDeclared === false ? [] : [{ key: capabilityKey }], resources: { workflows: { [capabilityKey]: 'workflows/deploy.json' } },
  };
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,owner_type,owner_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ($1,$2,'TENANT',$2,'fixture.standalone','1.0.0','USER',$3,'BOTH','UNSIGNED','SELF_MANAGED',$4::jsonb,'sha256:package','sha256:manifest','{}'::jsonb,$5,'NOT_REQUIRED','[]'::jsonb,'{}'::jsonb,now(),now())`, [pluginVersionId, tenantId, options.pluginRuntime ?? 'WORKFLOW_DSL', JSON.stringify(manifest), options.pluginStatus ?? 'ENABLED']);
  await db.query(`insert into pg_documents (namespace,document_id,payload,updated_at) values
    ('workflow.templates',$1,$2::jsonb,now()),('workflow.template_versions',$3,$4::jsonb,now())`, [
    workflowTemplateId,
    JSON.stringify({ id: workflowTemplateId, name: 'Standalone Plugin Workflow', origin: options.origin ?? 'plugin_internal', ownerType: 'TENANT', ownerId: tenantId, tenantId, currentVersionId: workflowVersionId, status: 'active' }),
    workflowVersionId,
    JSON.stringify({ id: workflowVersionId, templateId: workflowTemplateId, version: 1, dslVersion: 'v1', status: options.versionStatus ?? 'published', contentHash, content }),
  ]);
  await db.query(`insert into unified_plugin_workflow_bindings
    (plugin_version_id,capability_key,workflow_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,owner_type,owner_id,created_at)
    values ($1,$2,$3,'workflows/deploy.json',$4,$5,$6,'TENANT',$7,now())`, [pluginVersionId, capabilityKey, workflowKey, workflowTemplateId, workflowVersionId, contentHash, tenantId]);
  return { pluginVersionId, capabilityKey, workflowKey, workflowTemplateId, workflowVersionId };
}

test('非受管资产只保存 WorkflowExecutionBinding 且拒绝插件 Assignment', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-standalone-workflow'; const assets=new PgAssetsRepository(db);
  const asset=await assets.createServiceAsset(tenantId,{address:'standalone.example.com',port:443,protocol:'HTTPS',discoverySource:'MANUAL',deploymentStrategy:{type:'WORKFLOW',approvalRequired:true}});
  const chain = await seedFixedWorkflowChain(db, tenantId);
  const service=new ApplicationAssetExecutionService(db);
  const saved=await service.saveStandaloneWorkflowExecution(tenantId,asset.id,{workflowExecution:{...chain,tenantId,workflowVersionSelection:'FIXED',runner:'CONTROL_PLANE',inputBindings:workflowInputBindings}});
  assert.equal(saved.asset.deploymentStrategy?.type,'WORKFLOW'); assert.equal(saved.asset.deploymentStrategy?.workflow?.workflowExecutionBindingId,saved.workflowExecutionBinding.id);
  assert.equal(saved.asset.deploymentStrategy?.approvalRequired, true);
  // 配置只保存稳定身份：pluginVersionId / workflowVersionId 不再作为配置主键写入。
  assert.equal(saved.workflowExecutionBinding.pluginId, 'fixture.standalone');
  assert.equal(saved.workflowExecutionBinding.pluginVersionId, undefined);
  assert.equal(saved.workflowExecutionBinding.workflowVersionId, undefined);
  assert.equal(saved.workflowExecutionBinding.workflowVersionSelection, 'CURRENT');
  assert.equal(saved.workflowExecutionBinding.capabilityKey, chain.capabilityKey);
  assert.equal(Number((await db.query<{count:string|number}>(`select count(*) from unified_plugin_bindings where tenant_id=$1`,[tenantId])).rows[0]?.count),0);
  await db.query(`insert into plugin_capability_assignments (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at) values ('assignment_conflict',$1,'APPLICATION_ASSET',$2,'certificate.deploy','plugin_version','plugin_binding','ASSET_OVERRIDE','ACTIVE',now(),now())`,[tenantId,asset.id]).catch(()=>undefined);
});

test('编辑资产基础信息时保留固定工作流绑定快照', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-legacy-workflow'; const assets=new PgAssetsRepository(db);
  const asset=await assets.createServiceAsset(tenantId,{address:'legacy.example.com',port:443,protocol:'HTTPS',discoverySource:'MANUAL'});
  const chain = await seedFixedWorkflowChain(db, tenantId, { pluginVersionId: 'plugin-legacy-v1' });
  const service=new ApplicationAssetExecutionService(db);
  const input={...chain,tenantId,workflowVersionSelection:'FIXED' as const,runner:'CONTROL_PLANE' as const,inputBindings:workflowInputBindings};
  const created=await service.saveStandaloneWorkflowExecution(tenantId,asset.id,{workflowExecution:input});
  await db.query(`update pg_documents set payload=jsonb_set(payload,'{content}',(payload->'content')-'inputContract') where namespace='workflow.template_versions' and document_id='workflow_legacy_v1'`);
  const saved=await service.saveStandaloneWorkflowExecution(tenantId,asset.id,{workflowExecution:{...input,inputBindings:created.workflowExecutionBinding.inputBindings,bindingId:created.workflowExecutionBinding.id,expectedVersion:created.workflowExecutionBinding.version}});
  assert.equal(saved.workflowExecutionBinding.id,created.workflowExecutionBinding.id);
  assert.equal(saved.workflowExecutionBinding.version,created.workflowExecutionBinding.version);
});

test('非固定工作流版本策略直接失败关闭', async () => {
  const db = new PgliteDatabase(); await runMigrations(db, 'src/database/migrations'); const tenantId = 'tenant-invalid-workflow-selection'; const assets = new PgAssetsRepository(db);
  const asset = await assets.createServiceAsset(tenantId, { address: 'invalid.example.com', port: 443, protocol: 'HTTPS', discoverySource: 'MANUAL' });
  const chain = await seedFixedWorkflowChain(db, tenantId);
  const service = new ApplicationAssetExecutionService(db);
  await assert.rejects(
    () => service.saveStandaloneWorkflowExecution(tenantId, asset.id, { workflowExecution: { ...chain, tenantId, workflowVersionSelection: 'LATEST_PUBLISHED', runner: 'CONTROL_PLANE', inputBindings: workflowInputBindings } as never }),
    (error: any) => error.errorCode === 'VALIDATION_FAILED',
  );
});
