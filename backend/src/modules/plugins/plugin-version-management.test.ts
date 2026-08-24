import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PluginsController } from './controller/plugins.controller.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('插件版本管理查询按插件分组并对租户公开内置版本', async () => {
  const records = [
    version('builtin-version-1', 'fixture.plugin', '1.0.0', 'BUILTIN', 'SYSTEM', 'DISABLED'),
    version('builtin-version-2', 'fixture.plugin', '1.1.0', 'BUILTIN', 'SYSTEM', 'ENABLED'),
    version('user-version-1', 'fixture.plugin', '2.0.0', 'USER', 'tenant-1', 'RETIRED'),
    version('hidden-version', 'fixture.hidden', '1.0.0', 'USER', 'tenant-2', 'ENABLED'),
  ];
  const workflows = {
    list: async (pluginVersionId: string) => pluginVersionId === 'builtin-version-2' ? [{
      pluginVersionId,
      capabilityKey: 'certificate.deploy',
      workflowResourcePath: 'workflows/deploy.json',
      workflowTemplateId: 'workflow-template-1',
      workflowVersionId: 'workflow-version-1',
      workflowContentSha256: 'sha256:workflow',
      createdAt: '2026-08-02T00:00:00.000Z',
    }] : [],
  };
  const service = new UnifiedPluginsApplicationService(memoryRepository(records), undefined, undefined, workflows as never);
  const groups = await service.listVersionGroups('tenant-1');
  assert.deepEqual(groups.map((group) => group.pluginId), ['fixture.plugin']);
  assert.equal(groups[0]?.source, 'MIXED');
  assert.deepEqual(groups[0]?.versions.map((item) => item.version), ['2.0.0', '1.1.0', '1.0.0']);
  assert.equal(groups[0]?.versions[1]?.workflowVersions[0]?.workflowVersionId, 'workflow-version-1');
  assert.equal(groups[0]?.versions[2]?.switchable, false);

  const detail = await service.getVersionManagementDetail('tenant-1', 'builtin-version-2');
  assert.equal(detail.visibleToTenant, true);
  assert.equal(detail.packageSha256, 'sha256:package:builtin-version-2');
  assert.equal(detail.workflowVersions[0]?.workflowContentSha256, 'sha256:workflow');
  await assert.rejects(
    () => service.getVersionManagementDetail('tenant-1', 'hidden-version'),
    (error: any) => error.errorCode === 'RESOURCE_NOT_FOUND',
  );
});

test('插件版本管理查询路由返回版本分组和详情', async () => {
  const record = version('builtin-version-1', 'fixture.plugin', '1.0.0', 'BUILTIN', 'SYSTEM', 'ENABLED');
  const service = new UnifiedPluginsApplicationService(memoryRepository([record]));
  const app = new App();
  new PluginsController(service).register(app.router);

  const groups = await app.inject({ method: 'GET', path: '/api/v1/plugin-version-groups', headers: { 'x-tenant-id': 'tenant-1' } });
  assert.equal(groups.statusCode, 200);
  assert.equal((groups.body as Array<{ pluginId: string }>)[0]?.pluginId, 'fixture.plugin');

  const detail = await app.inject({ method: 'GET', path: '/api/v1/plugin-version-management/builtin-version-1', headers: { 'x-tenant-id': 'tenant-1' } });
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.body as { id: string }).id, 'builtin-version-1');
});

test('版本管理查询统计五类运行引用', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, resolve(process.cwd(), 'backend/src/database/migrations'), {
    appliedBy: 'test',
    checksum: (value) => createHash('sha256').update(value).digest('hex'),
  });
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ('version-count','tenant-1','fixture.count','1.0.0','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED','{}','p','m','{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`);
  await db.query(`insert into pg_hosts
    (id,tenant_id,hostname,os_type,discovery_source,compatibility_level,management_mode,status,management_channels)
    values ('host-count','tenant-1','count-host','NETWORK_DEVICE','MANUAL','L1','PLUGIN','ACTIVE',$1::jsonb)`, [
    JSON.stringify([{ type: 'PLUGIN', metadata: { pluginVersionId: 'version-count' } }]),
  ]);
  await db.query(`insert into pg_service_assets
    (id,tenant_id,address,address_type,port,protocol,discovery_source,status,asset_kind,metadata)
    values ('service-count','tenant-1','count.example.com','HOSTNAME',443,'HTTPS','MANUAL','ACTIVE','APPLICATION',$1::jsonb)`, [
    JSON.stringify({ pluginVersionId: 'version-count' }),
  ]);
  await db.query(`insert into pg_device_assets
    (service_asset_id,tenant_id,device_family,management_port,auth_mode,tls_verify,plugin_version_id)
    values ('service-count','tenant-1','NETSCALER_ADC',443,'AUTO',true,'version-count')`);
  await db.query(`insert into unified_plugin_bindings
    (id,tenant_id,plugin_version_id,mode,input_bindings,managed_context,status,version,created_at,updated_at)
    values ('binding-count','tenant-1','version-count','STANDALONE','{}',null,'ACTIVE',1,now(),now())`);
  await db.query(`insert into plugin_capability_assignments
    (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at)
    values ('assignment-count','tenant-1','DEVICE','host-count','certificate.deploy','version-count','binding-count','DEVICE_DEFAULT','ACTIVE',now(),now())`);

  const counts = await new PgUnifiedPluginsRepository(db).countReferences('tenant-1', 'version-count');
  assert.deepEqual(counts, { bindings: 1, assignments: 1, hosts: 1, serviceAssets: 1, deviceAssets: 1, total: 5 });
});

function memoryRepository(records: UnifiedPluginVersionRecord[]): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => record,
    findVersion: async (id) => records.find((record) => record.id === id),
    findByIdentity: async (tenantId, pluginId, version) => records.find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version),
    listVersions: async (tenantId) => records.filter((record) => record.tenantId === tenantId),
    listVersionsBySource: async (source) => records.filter((record) => record.source === source),
  };
}

function version(
  id: string,
  pluginId: string,
  pluginVersion: string,
  source: 'BUILTIN' | 'USER',
  tenantId: string,
  status: UnifiedPluginVersionRecord['status'],
): UnifiedPluginVersionRecord {
  return {
    id,
    tenantId,
    ownerType: source === 'BUILTIN' ? 'SYSTEM' : 'TENANT',
    ...(source === 'USER' ? { ownerId: tenantId } : {}),
    pluginId,
    version: pluginVersion,
    source,
    runtime: 'WORKFLOW_DSL',
    scope: 'BOTH',
    trust: source === 'BUILTIN' ? 'OFFICIAL_SIGNED' : 'UNSIGNED',
    support: source === 'BUILTIN' ? 'OFFICIAL' : 'SELF_MANAGED',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId,
      version: pluginVersion,
      displayNameKey: 'plugin.fixture.name',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source,
      scope: 'BOTH',
      trust: source === 'BUILTIN' ? 'OFFICIAL_SIGNED' : 'UNSIGNED',
      support: source === 'BUILTIN' ? 'OFFICIAL' : 'SELF_MANAGED',
      capabilities: [],
      permissions: [],
      resources: {},
    },
    packageSha256: `sha256:package:${id}`,
    manifestSha256: `sha256:manifest:${id}`,
    resourceSha256: {},
    resources: {},
    status,
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: `sha256:manifest:${id}`, resourceSha256: {} },
    createdAt: `2026-08-02T00:00:0${id.endsWith('1') ? '1' : '2'}.000Z`,
    updatedAt: `2026-08-02T00:00:0${id.endsWith('1') ? '1' : '2'}.000Z`,
  };
}
