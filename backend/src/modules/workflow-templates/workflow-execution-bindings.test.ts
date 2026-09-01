import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { WorkflowExecutionBindingsService } from './application/workflow-execution-bindings.service.js';
import { WorkflowExecutionBindingsRepository } from './repository/workflow-execution-bindings.repository.js';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';
import type { CreateWorkflowExecutionBindingInput } from './dto/workflow-execution-bindings.dto.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { PluginWorkflowBindingsRepository } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import { insertCanonicalPluginVersion } from '../plugins/plugin-test-fixtures.js';
import { canonicalPluginId } from '../plugins/plugin-test-fixtures.js';

const tenantId = 'tenant_workflow_binding_test';
const pluginVersionId = 'plugin-version-workflow-binding';

type WorkflowExecutionBindingFixture = {
  db: PgliteDatabase;
  target: WorkflowExecutionBindingsService;
  base: CreateWorkflowExecutionBindingInput;
  pluginVersionId: string;
  workflowTemplateId: string;
  workflowVersionId: string;
};

async function createFixture(): Promise<WorkflowExecutionBindingFixture> {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations', {
    checksum: (content) => createHash('sha256').update(content, 'utf8').digest('hex'),
  });
  await insertCanonicalPluginVersion(db, pluginVersionId, tenantId);

  const workflows = new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(
      new PgDocumentRepository(db, 'workflow.templates'),
      new PgDocumentRepository(db, 'workflow.template_versions'),
    ),
  );
  const content = {
    apiVersion: 'gcac.workflow/v1' as const,
    kind: 'CurlSshWorkflow' as const,
    metadata: { name: 'certificate-deploy-fixture', version: '1.0.0' },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1' as const,
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    },
    steps: [{ name: 'wait', type: 'wait' as const, seconds: 1 }],
  };
  const internal = await workflows.createPluginTemplate({ content });
  const published = await workflows.publishPluginVersion(internal.version.id);

  await new PluginWorkflowBindingsRepository(db).save({
    pluginVersionId,
    capabilityKey: 'certificate.deploy',
    workflowKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
    workflowContentSha256: published.contentHash,
    createdAt: new Date().toISOString(),
  });

  const base: CreateWorkflowExecutionBindingInput = {
    tenantId,
    pluginId: canonicalPluginId,
    pluginVersionId,
    capabilityKey: 'certificate.deploy',
    workflowKey: 'certificate.deploy',
    workflowTemplateId: internal.template.id,
    workflowVersionSelection: 'FIXED',
    workflowVersionId: published.id,
    runner: 'CONTROL_PLANE',
    inputBindings: emptyInputBindingsV1(),
  };
  return {
    db,
    target: new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(db)),
    base,
    pluginVersionId,
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
  };
}

async function assertRejectedWithCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    const typed = error as { errorCode?: string; details?: { code?: string } };
    return typed.errorCode === code || typed.details?.code === code;
  });
}

test('工作流执行绑定保存稳定身份、乐观锁更新和停用', async () => {
  const fixture = await createFixture();
  const created = await fixture.target.create(fixture.base);

  assert.equal(created.version, 1);
  assert.equal(created.workflowVersionSelection, 'CURRENT');
  assert.equal(created.pluginId, canonicalPluginId);
  assert.equal(created.pluginVersionId, undefined);
  assert.equal(created.capabilityKey, 'certificate.deploy');
  assert.equal(created.workflowTemplateId, fixture.workflowTemplateId);
  assert.equal(created.workflowVersionId, undefined);

  const updated = await fixture.target.update(fixture.base.tenantId, created.id, {
    expectedVersion: 1,
    inputBindings: { ...emptyInputBindingsV1(), variables: { path: '/etc/cert' } },
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.pluginId, canonicalPluginId);
  assert.equal(updated.workflowVersionId, undefined);
  await assertRejectedWithCode(
    () => fixture.target.update(fixture.base.tenantId, created.id, { expectedVersion: 1, inputBindings: emptyInputBindingsV1() }),
    'RESOURCE_VERSION_CONFLICT',
  );

  const disabled = await fixture.target.disable(fixture.base.tenantId, created.id, 2);
  assert.equal(disabled.status, 'DISABLED');
  assert.equal(disabled.version, 3);
});

test('缺少当前发布链时失败关闭', async () => {
  const fixture = await createFixture();
  await fixture.db.query('delete from unified_plugin_workflow_bindings where plugin_version_id=$1', [fixture.pluginVersionId]);

  await assertRejectedWithCode(
    () => fixture.target.create(fixture.base),
    'WORKFLOW_EXECUTION_BINDING_CURRENT_CHAIN_MISSING',
  );
});

test('旧 FIXED 输入会被转换为 CURRENT，非法策略仍失败关闭', async () => {
  const fixture = await createFixture();

  const created = await fixture.target.create(fixture.base);
  assert.equal(created.workflowVersionSelection, 'CURRENT');

  await assertRejectedWithCode(
    () => fixture.target.create({ ...fixture.base, workflowVersionSelection: 'PINNED' as never }),
    'WORKFLOW_VERSION_SELECTION_INVALID',
  );
  await assertRejectedWithCode(
    () => fixture.target.create({ ...fixture.base, workflowVersionSelection: 'LATEST_PUBLISHED' as never }),
    'WORKFLOW_VERSION_SELECTION_INVALID',
  );
});

test('启用新插件版本后，同一稳定绑定解析新版本并保留历史绑定不变', async () => {
  const fixture = await createFixture();
  const created = await fixture.target.create(fixture.base);
  // 同一 pluginId 在 ENABLED 状态下唯一，必须先退休旧当前版本再启用新版本。
  await fixture.db.query("update unified_plugin_versions set status='RETIRED' where id=$1", [fixture.pluginVersionId]);
  await fixture.db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    select 'plugin-version-workflow-binding-v2',tenant_id,plugin_id,'2.0.0',source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,'ENABLED',permission_approval_status,approved_permissions,validation_report,now(),now()
      from unified_plugin_versions where id=$1`, [fixture.pluginVersionId]);
  await fixture.db.query(`insert into unified_plugin_workflow_bindings
    (plugin_version_id,owner_type,owner_id,capability_key,workflow_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at)
    select 'plugin-version-workflow-binding-v2',owner_type,owner_id,capability_key,workflow_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,now()
      from unified_plugin_workflow_bindings where plugin_version_id=$1`, [fixture.pluginVersionId]);

  const identity = await fixture.target.getExecutionIdentity(tenantId, created.id);
  assert.equal(identity.chain.pluginVersionId, 'plugin-version-workflow-binding-v2');
  assert.equal(identity.chain.workflowVersionId, fixture.workflowVersionId);
  assert.equal((await fixture.target.get(tenantId, created.id)).pluginId, canonicalPluginId);
});

test('PluginVersion 未启用或运行时错误时失败关闭', async () => {
  const disabled = await createFixture();
  await disabled.db.query("update unified_plugin_versions set status='DISABLED' where id=$1", [disabled.pluginVersionId]);
  await assertRejectedWithCode(
    () => disabled.target.create(disabled.base),
    'WORKFLOW_EXECUTION_BINDING_PLUGIN_UNAVAILABLE',
  );

  const wrongRuntime = await createFixture();
  await wrongRuntime.db.query("update unified_plugin_versions set runtime='AGENT_PLAN' where id=$1", [wrongRuntime.pluginVersionId]);
  await assertRejectedWithCode(
    () => wrongRuntime.target.create(wrongRuntime.base),
    'WORKFLOW_EXECUTION_BINDING_PLUGIN_UNAVAILABLE',
  );
});

test('Capability 未由 PluginVersion Manifest 声明时失败关闭', async () => {
  const fixture = await createFixture();
  const unknownCapability = 'certificate.unknown';
  await fixture.db.query(`insert into unified_plugin_workflow_bindings
    (plugin_version_id,owner_type,owner_id,capability_key,workflow_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at)
    select plugin_version_id,owner_type,owner_id,$2,$2,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at
      from unified_plugin_workflow_bindings
     where plugin_version_id=$1 and capability_key='certificate.deploy'`, [fixture.pluginVersionId, unknownCapability]);

  await assertRejectedWithCode(
    () => fixture.target.create({ ...fixture.base, capabilityKey: unknownCapability, workflowKey: unknownCapability }),
    'WORKFLOW_EXECUTION_BINDING_CAPABILITY_MISSING',
  );
});

test('插件工作流来源不是 plugin_internal 时失败关闭', async () => {
  const fixture = await createFixture();
  await fixture.db.query(`update pg_documents
    set payload=jsonb_set(payload,'{origin}','"user"'::jsonb,true)
    where namespace='workflow.templates' and document_id=$1`, [fixture.workflowTemplateId]);

  await assertRejectedWithCode(
    () => fixture.target.create(fixture.base),
    'WORKFLOW_EXECUTION_BINDING_ORIGIN_INVALID',
  );
});

test('WorkflowVersion 未发布时失败关闭', async () => {
  const fixture = await createFixture();
  await fixture.db.query(`update pg_documents
    set payload=jsonb_set(payload,'{status}','"draft"'::jsonb,true)
    where namespace='workflow.template_versions' and document_id=$1`, [fixture.workflowVersionId]);

  await assertRejectedWithCode(
    () => fixture.target.create(fixture.base),
    'WORKFLOW_EXECUTION_BINDING_HASH_MISMATCH',
  );
});

test('WorkflowVersion 内容摘要不匹配时失败关闭', async () => {
  const fixture = await createFixture();
  await fixture.db.query(`update unified_plugin_workflow_bindings
    set workflow_content_sha256='sha256:故意不匹配'
    where plugin_version_id=$1 and capability_key='certificate.deploy'`, [fixture.pluginVersionId]);

  await assertRejectedWithCode(
    () => fixture.target.create(fixture.base),
    'WORKFLOW_EXECUTION_BINDING_HASH_MISMATCH',
  );
});
