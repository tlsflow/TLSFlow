import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationOnboardingService } from '../application-onboarding/application/application-onboarding.service.js';
import { ApplicationOnboardingRecipeLoader } from '../application-onboarding/recipe/application-onboarding-recipe.loader.js';
import { BuiltinPluginRegistry } from './builtin-plugins/builtin-plugin-registry.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import { hostLocales } from './locales/plugin-locale.service.js';

test('独立 web.nginx 发现包注册统一向导，不携带证书更新能力', async () => {
  const loader = new BuiltinUnifiedPluginLoader();
  const pluginPackage = (await loader.loadPackages()).find((item) => (
    (item.manifest as { pluginId?: string }).pluginId === 'web.nginx'
  ));
  assert.ok(pluginPackage, '内置扫描必须找到 web.nginx 发现包');

  const manifest = pluginPackage.manifest as {
    pluginId: string;
    version: string;
    capabilities: Array<{ key: string }>;
    resources: {
      actionContracts?: Record<string, string>;
      workflows?: Record<string, string>;
      locales?: Record<string, string>;
      discoveryMappings?: Record<string, string>;
      onboarding?: { applicationAsset?: string };
      presentations?: Record<string, string>;
    };
  };
  assert.equal(manifest.pluginId, 'web.nginx');
  assert.equal(manifest.version, '1.0.17');
  assert.deepEqual(manifest.capabilities.map((item) => item.key), ['application.discover']);
  assert.equal(manifest.resources.actionContracts?.['application.discover.v1'], 'action-contracts/application-discover.json');
  assert.equal(manifest.resources.workflows?.['application.discover'], 'workflows/discover.json');
  assert.equal(manifest.resources.onboarding?.applicationAsset, 'onboarding/application-asset.json');
  assert.ok(manifest.resources.discoveryMappings?.profiles);
  assert.ok(manifest.resources.presentations?.application);
  assert.equal(Object.keys(manifest.resources.locales ?? {}).length, hostLocales.length);
  for (const locale of hostLocales) {
    const path = manifest.resources.locales?.[locale];
    assert.ok(path && pluginPackage.resources[path], `缺少 ${locale} Locale`);
  }

  const recipe = new ApplicationOnboardingRecipeLoader().load({
    id: 'web-nginx-fixture-version',
    pluginId: manifest.pluginId,
    version: manifest.version,
    manifest: manifest as never,
    resources: pluginPackage.resources,
  });
  assert.equal(recipe.recipe.platformKey, 'nginx');
  assert.equal(recipe.recipe.deploymentMode, 'MANAGED_TARGET');
  assert.equal(recipe.recipe.deviceResourceType, 'agent.host');
  assert.deepEqual(recipe.recipe.targetProjection.frameworkTypes, ['web.nginx']);
  assert.deepEqual(recipe.recipe.newDeviceOnboarding, {
    kind: 'AGENT_INSTALL',
    platformKeys: ['linux', 'windows-server-2016-plus'],
  });

  const registry = new BuiltinPluginRegistry(loader);
  const entry = (await registry.refresh()).find((item) => item.pluginId === 'web.nginx');
  assert.ok(entry, 'web.nginx 必须进入内置 Registry');
  assert.equal(entry.executionMode, 'DSL_STEP_ACTION');
  assert.deepEqual(entry.capabilities.map((item) => item.key), ['application.discover']);
  assert.equal(entry.manifest.capabilities.some((item) => item.key.startsWith('certificate.')), false);

  const version = {
    id: recipe.pluginVersionId,
    tenantId: 'SYSTEM',
    pluginId: recipe.pluginId,
    version: recipe.pluginVersion,
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'MANAGED',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: manifest as never,
    packageSha256: 'sha256:' + 'a'.repeat(64),
    manifestSha256: 'sha256:' + 'b'.repeat(64),
    resourceSha256: {},
    resources: pluginPackage.resources,
    status: 'ENABLED',
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'sha256:' + 'b'.repeat(64), resourceSha256: {} },
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  } as unknown as UnifiedPluginVersionRecord;
  const plugins = {
    listAccessibleVersions: async () => [version],
    getVersionForTenant: async () => version,
  } as never;
  const onboarding = new ApplicationOnboardingService({} as never, plugins);
  const platform = (await onboarding.listPlatforms('tenant-1', 'zh-CN')).find((item) => item.platformKey === 'nginx');
  assert.ok(platform, '统一应用向导平台目录必须返回 nginx');
  assert.equal(platform.source, 'PLUGIN');
  assert.equal(platform.pluginId, 'web.nginx');
  assert.equal(platform.supportStatus, 'SUPPORTED');
  assert.equal(platform.displayName, 'Nginx 应用发现');
});
