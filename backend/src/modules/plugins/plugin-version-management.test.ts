import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PluginsController } from './controller/plugins.controller.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { PluginWorkflowBindingsRepository } from './repository/plugin-workflow-bindings.repository.js';
import type { DatabasePort } from '../../database/database-port.js';
import type { SecurityServices } from '../security/security.controller.js';
import { securityErrors } from '../../shared/security-error.js';

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
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  new PluginsController(service, undefined, undefined, undefined, undefined, undefined, routeSecurity()).register(app.router);

  const groups = await app.inject({ method: 'GET', path: '/api/v1/plugin-version-groups', headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' } });
  assert.equal(groups.statusCode, 200);
  assert.equal((groups.body as Array<{ pluginId: string }>)[0]?.pluginId, 'fixture.plugin');

  const detail = await app.inject({ method: 'GET', path: '/api/v1/plugin-version-management/builtin-version-1', headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' } });
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.body as { id: string }).id, 'builtin-version-1');
});

test('插件 Logo 路由只读取当前版本包内资源并返回不可变缓存摘要', async () => {
  const record = version('builtin-logo-1', 'fixture.logo', '1.0.0', 'BUILTIN', 'SYSTEM', 'ENABLED');
  record.manifest.resources = { logos: { horizontal: 'logos/logo.svg', square: 'logos/logo-square.svg' } };
  record.resources = {
    'logos/logo.svg': '<svg viewBox="0 0 72 48"><rect width="72" height="48" fill="#1f6feb"/></svg>',
    'logos/logo-square.svg': '<svg viewBox="0 0 72 72"><rect width="72" height="72" fill="#1f6feb"/></svg>',
  };
  record.resourceSha256 = {
    'logos/logo.svg': `sha256:${createHash('sha256').update(record.resources['logos/logo.svg']!).digest('hex')}`,
    'logos/logo-square.svg': `sha256:${createHash('sha256').update(record.resources['logos/logo-square.svg']!).digest('hex')}`,
  };
  const service = new UnifiedPluginsApplicationService(memoryRepository([record]));
  const app = new App();
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  new PluginsController(service, undefined, undefined, undefined, undefined, undefined, routeSecurity()).register(app.router);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-versions/builtin-logo-1/resources/logos/square',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/svg+xml; charset=utf-8');
  assert.equal(response.headers.etag, record.resourceSha256['logos/logo-square.svg']);
  assert.match(String(response.body), /0 0 72 72/);

  const missing = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-versions/builtin-logo-1/resources/logos/unknown',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' },
  });
  assert.equal(missing.statusCode, 404);
});

test('统一插件导入路由会为 Workflow DSL 发布派生绑定', async () => {
  const imported = version('user-version-workflow', 'fixture.workflow', '1.0.0', 'USER', 'tenant-1', 'DISABLED');
  imported.runtime = 'WORKFLOW_DSL';
  let publishedPluginVersionId: string | undefined;
  const service = {
    importVersion: async () => imported,
  };
  const publisher = {
    publishPlugin: async (record: UnifiedPluginVersionRecord) => {
      publishedPluginVersionId = record.id;
      return [];
    },
  };
  const app = new App();
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  new PluginsController(
    service as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    routeSecurity(),
    undefined,
    publisher,
  ).register(app.router);

  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/plugin-packages/import',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' },
    body: { manifest: {}, resources: {} },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(publishedPluginVersionId, imported.id);
});

test('刷新内置插件注册表路由调用运行期扫描服务', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository([]));
  let refreshCount = 0;
  const app = new App();
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  new PluginsController(
    service,
    undefined as never,
    undefined,
    undefined,
    {
      refresh: async () => {
        refreshCount += 1;
        return {
          refreshedAt: '2026-08-02T00:00:00.000Z',
          versions: [{ id: 'builtin-version-25', pluginId: 'fixture.plugin', version: '1.1.25', status: 'ENABLED' }],
        };
      },
    },
    undefined,
    routeSecurity(),
  ).register(app.router);

  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/plugin-catalog/refresh-builtins',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' },
    body: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(refreshCount, 1);
  assert.equal((response.body as { versions: Array<{ version: string }> }).versions[0]?.version, '1.1.25');
});

test('旧插件版本切换路由不再注册', async () => {
  const app = new App();
  new PluginsController().register(app.router);

  const response = await app.inject({ method: 'POST', path: '/api/v1/plugin-version-management/switch', body: {} });

  assert.equal(response.statusCode, 404);
});

test('版本管理查询统计五类运行引用', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, fileURLToPath(new URL('../../database/migrations/', import.meta.url)), {
    appliedBy: 'test',
    checksum: (value) => createHash('sha256').update(value).digest('hex'),
  });
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ('version-count','tenant-1','web.nginx','1.0.0','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED',
      '{"pluginId":"web.nginx","canonicalPluginId":"web.nginx","executionMode":"isolated_process","version":"1.0.0"}',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      '{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`);
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

test('插件 Workflow 绑定表缺失时必须显式失败', async () => {
  const missingTable = Object.assign(new Error('relation "unified_plugin_workflow_bindings" does not exist'), { code: '42P01' });
  const db = {
    exec: async () => undefined,
    query: async () => { throw missingTable; },
    transaction: async () => { throw missingTable; },
  } as unknown as DatabasePort;

  await assert.rejects(
    () => new PluginWorkflowBindingsRepository(db).listAll(),
    (error: unknown) => error === missingTable,
  );
});

function memoryRepository(records: UnifiedPluginVersionRecord[]): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => record,
    findVersion: async (id) => records.find((record) => record.id === id),
    findByIdentity: async (tenantId, pluginId, version) => records.find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version),
    listVersions: async (tenantId) => records.filter((record) => record.tenantId === tenantId),
    listVersionsBySource: async (source) => records.filter((record) => record.source === source),
    listAccessibleVersions: async (tenantId) => records.filter((record) => record.tenantId === tenantId || record.source === 'BUILTIN'),
    countReferences: async () => ({ bindings: 0, assignments: 0, hosts: 0, serviceAssets: 0, deviceAssets: 0, total: 0 }),
  };
}

function routeSecurity(options: {
  denyActions?: string[];
  allowedObjectIds?: Record<string, string[]>;
} = {}): SecurityServices {
  const deniedActions = new Set(options.denyActions ?? []);
  return {
    rbac: {
      assertCan: async (_subject: unknown, action: string) => {
        if (deniedActions.has(action)) throw securityErrors.permissionDenied({ action });
      },
    } as never,
    objectPermissions: {
      assertCan: async (subject: { id: string }, _accessLevel: string, object: { objectType: string; objectId: string }) => {
        const allowed = options.allowedObjectIds?.[object.objectType];
        if (allowed && !allowed.includes(object.objectId)) {
          throw securityErrors.permissionDenied({ actorId: subject.id, object });
        }
      },
      buildAuthorizedQuery: async (_subject: unknown, objectType: string) => {
        const allowed = options.allowedObjectIds?.[objectType];
        return allowed
          ? { objectIds: allowed, dynamicConditions: [], empty: allowed.length === 0, unrestricted: false }
          : { dynamicConditions: [], empty: false, unrestricted: true };
      },
    } as never,
  } as unknown as SecurityServices;
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
