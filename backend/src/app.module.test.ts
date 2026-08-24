import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger, type LogEvent } from './common/logging/structured-logger.js';
import { AppError } from './common/errors/app-error.js';
import { initializeBuiltinPlugins } from './app.module.js';
import { createAppAsync } from './app.module.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import type { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
import { createHash } from 'node:crypto';
import { PgliteDatabase } from './database/pglite-database.js';
import { runMigrations } from './database/migration-runner.js';
import { createApp } from './app.module.js';

test('公开 HTTP-01 路由返回共享存储中的 key authorization', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const token = 'route-test-token';
  await db.query(
    `insert into pg_acme_http01_presentations (
       token_sha256, tenant_id, identifier, key_authorization, presentation_id, expires_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, now() + interval '5 minutes', now(), now())`,
    [
      createHash('sha256').update(token).digest('hex'),
      'tenant-route-test',
      'example.com',
      'route-test-token.thumbprint',
      'presentation-route-test',
    ],
  );

  const app = createApp({ db, corePersistence: { mode: 'memory' } });
  const response = await app.inject({
    method: 'GET',
    path: `/.well-known/acme-challenge/${token}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'route-test-token.thumbprint');
});

test('应用启动初始化后，插件目录会包含四个内置云 Provider 插件', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = await createAppAsync({ db, corePersistence: { mode: 'memory' } });
  const plugins = app.getResource<UnifiedPluginsApplicationService>('unifiedPluginsService');
  assert.ok(plugins);
  const catalog = await plugins.listCatalog('tenant-cloud-test', 'zh-CN');
  const cloudPluginIds = catalog
    .filter((item) => item.runtime === 'TRUSTED_JS' && item.providerKey?.startsWith('cloud.'))
    .map((item) => item.pluginId)
    .sort();

  assert.deepEqual(cloudPluginIds, [
    'builtin.cloud.aliyun.provider',
    'builtin.cloud.huawei.provider',
    'builtin.cloud.tencent.provider',
    'builtin.cloud.volcengine.provider',
  ]);
});

test('内置插件 Workflow 发布和兼容升级失败时启动初始化仍继续', async () => {
  const plugins = [
    pluginRecord('plugin.publish-failure', '1.0.0'),
    pluginRecord('plugin.upgrade-failure', '1.0.1'),
  ];
  const published: string[] = [];
  const disabled: string[] = [];
  const upgraded: string[] = [];
  const warnings: LogEvent[] = [];
  const logger = new StructuredLogger((event) => warnings.push(event));
  const loader = {
    installAll: async () => plugins,
  } as unknown as BuiltinUnifiedPluginLoader;
  const publisher = {
    publishPlugin: async (plugin: UnifiedPluginVersionRecord) => {
      published.push(plugin.pluginId);
      if (plugin.pluginId === 'plugin.publish-failure') {
        throw new AppError('VALIDATION_FAILED', '模拟 Workflow 发布失败');
      }
      return [];
    },
  } as unknown as PluginWorkflowPublisherService;
  const unifiedPlugins = {
    disableVersion: async (id: string) => {
      disabled.push(id);
      const plugin = plugins.find((item) => item.id === id)!;
      return { ...plugin, status: 'DISABLED' as const };
    },
  } as unknown as UnifiedPluginsApplicationService;
  const compatibilityUpgrader = {
    upgradePatchLine: async (_tenantId: string, pluginVersionId: string) => {
      upgraded.push(pluginVersionId);
      if (pluginVersionId === 'plugin-version-2') {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '模拟兼容引用升级失败');
      }
    },
  };

  await initializeBuiltinPlugins(
    unifiedPlugins,
    publisher,
    {} as never,
    { loader, compatibilityUpgrader, logger },
  );

  assert.deepEqual(published, ['plugin.publish-failure', 'plugin.upgrade-failure']);
  assert.deepEqual(disabled, ['plugin-version-1']);
  assert.deepEqual(upgraded, ['plugin-version-1', 'plugin-version-2']);
  assert.deepEqual(
    warnings.map((event) => {
      const details = event.details as { phase: string; pluginId: string; version: string; errorCode: string };
      return {
        phase: details.phase,
        pluginId: details.pluginId,
        version: details.version,
        errorCode: details.errorCode,
      };
    }),
    [
      { phase: 'publishWorkflow', pluginId: 'plugin.publish-failure', version: '1.0.0', errorCode: 'VALIDATION_FAILED' },
      { phase: 'upgradeCompatibility', pluginId: 'plugin.upgrade-failure', version: '1.0.1', errorCode: 'RESOURCE_VERSION_CONFLICT' },
    ],
  );
});

function pluginRecord(pluginId: string, version: string): UnifiedPluginVersionRecord {
  return {
    id: pluginId === 'plugin.publish-failure' ? 'plugin-version-1' : 'plugin-version-2',
    tenantId: 'SYSTEM',
    ownerType: 'SYSTEM',
    pluginId,
    version,
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId,
      version,
      displayNameKey: 'plugin.test.name',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      capabilities: [],
      permissions: [],
      resources: {},
    },
    packageSha256: 'sha256:package',
    manifestSha256: 'sha256:manifest',
    resourceSha256: {},
    resources: {},
    status: 'ENABLED',
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: {
      valid: true,
      errors: [],
      warnings: [],
      manifestSha256: 'sha256:manifest',
      resourceSha256: {},
    },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}
