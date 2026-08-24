import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger, type LogEvent } from './common/logging/structured-logger.js';
import { AppError } from './common/errors/app-error.js';
import { initializeBuiltinPlugins } from './app.module.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import type { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
import { PgliteDatabase } from './database/pglite-database.js';
import { runMigrations } from './database/migration-runner.js';
import { createApp } from './app.module.js';
import { App } from './common/http/app.js';
import { registerPolicyAuthorityServices } from './app.module.js';
import type { ProductionPolicyAuthorityServicesV1 } from './modules/agents/security/policy-authority.service.js';
import type { TaskExecutorRegistry } from './modules/tasks/task-worker-supervisor.js';

test('非生产 App 只注册显式注入的 Policy Authority 资源', () => {
  const app = new App();
  const services = {
    service: {},
    trustRoot: {},
    keySet: {},
    signingKeys: {},
    policy: {},
    state: {},
  } as unknown as ProductionPolicyAuthorityServicesV1;

  assert.equal(registerPolicyAuthorityServices(app, services, { NODE_ENV: 'test' }), services);
  assert.equal(app.getResource('policyAuthorityService'), services.service);
  assert.equal(app.getResource('policyAuthorityTrustRootService'), services.trustRoot);
  assert.equal(app.getResource('policyAuthorityKeySetService'), services.keySet);
  assert.equal(app.getResource('policyAuthoritySigningKeySource'), services.signingKeys);
});

test('生产 App 缺少 Policy Authority 配置时失败关闭', () => {
  assert.throws(
    () => registerPolicyAuthorityServices(new App(), undefined, { NODE_ENV: 'production' }),
    /失败关闭/,
  );
});

test('主装配移除 ACME HTTP-01 和旧 Provider 资源，同时保留通用 CA 与统一任务 Worker', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' } });
  const response = await app.inject({
    method: 'GET',
    path: '/.well-known/acme-challenge/retired-route',
  });

  assert.equal(response.statusCode, 404);
  assert.ok(app.getResource('certificateServices'));
  assert.ok(app.getResource('taskWorkerSupervisor'));
  assert.ok(app.getResource('cloudAccountAssetsService'));
  assert.ok(app.getResource('internalCaService'));
  assert.ok(app.getResource('caSyncWorker'));
  assert.ok(app.getResource('caAutoSyncScheduler'));
  const taskExecutorRegistry = app.getResource<TaskExecutorRegistry>('taskExecutorRegistry');
  assert.ok(taskExecutorRegistry?.keys().includes('ca.sync'));
  assert.ok(taskExecutorRegistry?.keys().includes('ca.node-task'));
  assert.ok(app.router.match('GET', '/api/v1/ca-operations/tree'));
  assert.ok(app.router.match('GET', '/api/v1/ca-providers'));
  assert.ok(app.router.match('GET', '/api/v1/ca-trust-domains'));
  assert.ok(app.router.match('GET', '/api/v1/certificate-authorities'));
  assert.ok(app.router.match('GET', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('POST', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('PATCH', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('POST', '/api/v1/cloud-account-assets/delete'));
  assert.equal(app.getResource('acmeRepository'), undefined);
  assert.equal(app.getResource('providerOperationLedgerService'), undefined);
  assert.equal(app.getResource('cloudProviderDiscoveryService'), undefined);
  assert.equal(app.getResource('providerCatalogService'), undefined);
  assert.equal(app.getResource('trustedJsProviderRuntime'), undefined);
});

test('内置插件 Workflow 发布失败时启动初始化仍继续', async () => {
  const plugins = [
    pluginRecord('plugin.publish-failure', '1.0.0'),
    pluginRecord('plugin.continues', '1.0.1'),
  ];
  const published: string[] = [];
  const disabled: string[] = [];
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
  await initializeBuiltinPlugins(
    unifiedPlugins,
    publisher,
    { loader, logger },
  );

  assert.deepEqual(published, ['plugin.publish-failure', 'plugin.continues']);
  assert.deepEqual(disabled, ['plugin-version-1']);
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
