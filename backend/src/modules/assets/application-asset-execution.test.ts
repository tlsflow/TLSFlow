import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { ApplicationAssetExecutionService } from './application/application-asset-execution.service.js';

test('非受管资产只保存 WorkflowExecutionBinding 且拒绝插件 Assignment', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-standalone-workflow'; const assets=new PgAssetsRepository(db);
  const asset=await assets.createServiceAsset(tenantId,{address:'standalone.example.com',port:443,protocol:'HTTPS',discoverySource:'MANUAL'});
  await db.query(`insert into pg_documents (namespace,document_id,payload,updated_at) values
    ('workflow.templates','workflow_user',$1::jsonb,now()),('workflow.template_versions','workflow_user_v1',$2::jsonb,now())`, [
    JSON.stringify({ id: 'workflow_user', name: 'Fixture Workflow', currentVersionId: 'workflow_user_v1', status: 'active' }),
    JSON.stringify({ id: 'workflow_user_v1', templateId: 'workflow_user', version: 1, dslVersion: 'v1', status: 'published', contentHash: 'hash', content: { inputContract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} } } }),
  ]);
  const service=new ApplicationAssetExecutionService(db);
  const saved=await service.saveStandaloneWorkflowExecution(tenantId,asset.id,{workflowExecution:{tenantId,workflowTemplateId:'workflow_user',workflowVersionSelection:'LATEST_PUBLISHED',runner:'CONTROL_PLANE',inputBindings:{apiVersion:'gcac.input-bindings/v1',connections:{},variables:{},credentials:{},artifacts:{}}}});
  assert.equal(saved.asset.deploymentStrategy?.type,'WORKFLOW'); assert.equal(saved.asset.deploymentStrategy?.workflow?.workflowExecutionBindingId,saved.workflowExecutionBinding.id);
  assert.equal(Number((await db.query<{count:string|number}>(`select count(*) from unified_plugin_bindings where tenant_id=$1`,[tenantId])).rows[0]?.count),0);
  await db.query(`insert into plugin_capability_assignments (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at) values ('assignment_conflict',$1,'APPLICATION_ASSET',$2,'certificate.deploy','plugin_version','plugin_binding','ASSET_OVERRIDE','ACTIVE',now(),now())`,[tenantId,asset.id]).catch(()=>undefined);
});
