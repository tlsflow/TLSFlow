import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import type { SecurityServices } from '../security/security.controller.js';
import { securityErrors } from '../../shared/security-error.js';
import { PluginsController } from './controller/plugins.controller.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('插件路由没有认证上下文时失败关闭', async () => {
  const app = createApp([version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1')], routeSecurity(), {}, undefined, false);
  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-versions',
    headers: { 'x-tenant-id': 'tenant-1' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal((response.body as { errorCode: string }).errorCode, 'AUTH_UNAUTHENTICATED');
});

test('插件路由先校验 RBAC action，缺少 plugin.read 时拒绝', async () => {
  const app = createApp([version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1')], routeSecurity({
    denyActions: ['plugin.read'],
  }));
  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-versions',
    headers: actorHeaders(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal((response.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
});

test('应用资产部署投影直接转发插件声明的默认值', async () => {
  const pluginVersion = version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1');
  let captured: Record<string, unknown> | undefined;
  const app = new App();
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  const service = new UnifiedPluginsApplicationService(memoryRepository([pluginVersion]));
  const managedTargetPlugins = {
    projectApplicationOnboardingDefaults: async (input: Record<string, unknown>) => {
      captured = input;
      return {
        contractVersion: 'gcac.deployment-input/v1',
        requiredVariables: [],
        advancedVariables: [],
        connections: [],
        credentials: [],
        artifacts: [],
        fixedValues: [],
        runtimeValues: [],
        issues: [],
        saveable: true,
      };
    },
  };
  new PluginsController(service, undefined, undefined, managedTargetPlugins as never, undefined, undefined, routeSecurity({
    allowedObjectIds: {
      plugin_version: [pluginVersion.id],
      managed_target: ['target-1'],
    },
  })).register(app.router);

  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets/target-1/deployment-input-projection',
    headers: actorHeaders(),
    body: {
      pluginVersionId: pluginVersion.id,
      deploymentDefaults: {
        capabilityKey: 'certificate.deploy',
        variables: { allowInsecureTls: true },
        certificateFormat: { format: 'PEM', configName: '宿主默认 PEM Bundle' },
      },
      applicationAsset: {
        id: 'draft',
        address: 'app.example.test',
        port: 443,
        protocol: 'HTTPS',
      },
    },
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(captured?.tenantId, 'tenant-1');
  assert.equal(captured?.managedTargetId, 'target-1');
  assert.equal(captured?.pluginVersionId, pluginVersion.id);
  assert.deepEqual(captured?.defaults, {
    capabilityKey: 'certificate.deploy',
    variables: { allowInsecureTls: true },
    certificateFormat: { format: 'PEM', configName: '宿主默认 PEM Bundle' },
  });
  assert.deepEqual(captured?.applicationAsset, {
    id: 'draft',
    address: 'app.example.test',
    sniName: undefined,
    verifyUrl: undefined,
    port: 443,
    protocol: 'HTTPS',
    displayName: undefined,
  });
  assert.equal(captured?.inputBindings, undefined);
});

test('插件版本列表和分组只返回有对象权限的版本', async () => {
  const records = [
    version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1'),
    version('plugin-hidden', 'fixture.hidden', '1.0.0', 'USER', 'tenant-1'),
  ];
  const app = createApp(records, routeSecurity({
    allowedObjectIds: { plugin_version: ['plugin-visible'] },
  }));

  const versions = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-versions',
    headers: actorHeaders(),
  });
  assert.equal(versions.statusCode, 200);
  assert.deepEqual((versions.body as { items: Array<{ id: string }> }).items.map((item) => item.id), ['plugin-visible']);

  const groups = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-version-groups',
    headers: actorHeaders(),
  });
  assert.equal(groups.statusCode, 200);
  assert.deepEqual(
    (groups.body as Array<{ versions: Array<{ id: string }> }>).flatMap((group) => group.versions.map((item) => item.id)),
    ['plugin-visible'],
  );
});

test('插件版本详情在对象权限拒绝时不可见', async () => {
  const app = createApp([version('plugin-hidden', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1')], routeSecurity({
    allowedObjectIds: { plugin_version: [] },
  }));
  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-version-management/plugin-hidden',
    headers: actorHeaders(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal((response.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
});

test('系统内置插件版本在租户上下文下可以按对象授权读取详情', async () => {
  const capturedObjects: Array<{ objectType: string; objectId: string; tenantId?: string; ownerType?: string }> = [];
  const app = createApp([version('plugin-builtin', 'fixture.plugin', '1.0.0', 'BUILTIN', 'SYSTEM')], routeSecurity({
    allowedObjectIds: { plugin_version: ['plugin-builtin'] },
    captureObjects: capturedObjects,
  }));
  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/plugin-version-management/plugin-builtin',
    headers: actorHeaders(),
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.body as { id: string }).id, 'plugin-builtin');
  assert.deepEqual(capturedObjects.at(-1), {
    objectType: 'plugin_version',
    objectId: 'plugin-builtin',
    ownerType: 'SYSTEM',
    tenantId: undefined,
  });
});

test('Binding 查询同时校验 Binding 和关联插件版本', async () => {
  const pluginVersion = version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1');
  const binding = {
    id: 'binding-hidden',
    tenantId: 'tenant-1',
    pluginVersionId: pluginVersion.id,
    mode: 'STANDALONE',
    inputBindings: { credentials: {}, parameters: {}, artifacts: {} },
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
  const app = createApp([pluginVersion], routeSecurity({
    allowedObjectIds: { plugin_binding: [binding.id], plugin_version: [] },
  }), {
    getTenantBinding: async () => binding,
  });
  const response = await app.inject({
    method: 'GET',
    path: `/api/v1/plugin-bindings?bindingId=${binding.id}`,
    headers: actorHeaders(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal((response.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
});

test('能力指派必须同时拥有 Binding、插件版本和所有者对象权限', async () => {
  const pluginVersion = version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1');
  const binding = {
    id: 'binding-visible',
    tenantId: 'tenant-1',
    pluginVersionId: pluginVersion.id,
    mode: 'MANAGED',
    inputBindings: { credentials: {}, parameters: {}, artifacts: {} },
    managedContext: { managedTargetId: 'target-visible' },
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
  const app = createApp([pluginVersion], routeSecurity({
    allowedObjectIds: {
      plugin_binding: [binding.id],
      plugin_version: [pluginVersion.id],
      managed_target: [],
    },
  }), {
    getTenantBinding: async () => binding,
    assignCapability: async () => {
      throw new Error('不应执行未授权写操作');
    },
  });
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/capability-assignments',
    headers: actorHeaders(),
    body: {
      ownerType: 'MANAGED_TARGET',
      ownerId: 'target-visible',
      capabilityKey: 'certificate.deploy',
      pluginVersionId: pluginVersion.id,
      pluginBindingId: binding.id,
      precedence: 'TARGET_OVERRIDE',
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal((response.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
});

test('Promotion 预览必须校验源 Binding 和关联 Gateway/资产对象', async () => {
  const pluginVersion = version('plugin-visible', 'fixture.plugin', '1.0.0', 'USER', 'tenant-1');
  const binding = {
    id: 'binding-visible',
    tenantId: 'tenant-1',
    pluginVersionId: pluginVersion.id,
    mode: 'STANDALONE',
    inputBindings: { credentials: {}, parameters: {}, artifacts: {} },
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
  const app = createApp([pluginVersion], routeSecurity({
    allowedObjectIds: {
      plugin_binding: [binding.id],
      plugin_version: [pluginVersion.id],
      gateway: [],
      application_asset: ['asset-visible'],
    },
  }), {
    getTenantBinding: async () => binding,
  }, {
    preview: async () => {
      throw new Error('不应执行未授权 Promotion');
    },
  });
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/plugin-promotions/preview',
    headers: actorHeaders(),
    body: {
      sourcePluginBindingId: binding.id,
      displayName: '测试归集',
      deviceFamily: 'NETWORK_DEVICE',
      managementAddress: '10.0.0.10',
      managementPort: 443,
      authMode: 'AUTO',
      tlsVerify: true,
      gatewayId: 'gateway-hidden',
      applicationAssetId: 'asset-visible',
      discovery: {},
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal((response.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
});

function createApp(
  records: UnifiedPluginVersionRecord[],
  security: SecurityServices,
  pluginBindings: Record<string, unknown> = {},
  promotions?: Record<string, unknown>,
  authenticated = true,
): App {
  const app = new App();
  if (authenticated) app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-1' }));
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  new PluginsController(service, pluginBindings as never, promotions as never, undefined, undefined, undefined, security).register(app.router);
  return app;
}

function actorHeaders(): Record<string, string> {
  return { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user_admin' };
}

function routeSecurity(options: {
  denyActions?: string[];
  allowedObjectIds?: Record<string, string[]>;
  captureObjects?: Array<{ objectType: string; objectId: string; tenantId?: string; ownerType?: string }>;
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
        options.captureObjects?.push(object as { objectType: string; objectId: string; tenantId?: string; ownerType?: string });
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

function version(
  id: string,
  pluginId: string,
  pluginVersion: string,
  source: 'BUILTIN' | 'USER',
  tenantId: string,
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
    status: 'ENABLED',
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: `sha256:manifest:${id}`, resourceSha256: {} },
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}
