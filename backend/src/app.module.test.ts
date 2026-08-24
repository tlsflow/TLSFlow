import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger, type LogEvent } from './common/logging/structured-logger.js';
import { AppError } from './common/errors/app-error.js';
import { initializeBuiltinPlugins } from './app.module.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import type { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';

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
