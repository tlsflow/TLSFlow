import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationOnboardingRecipeLoader } from '../application-onboarding/recipe/application-onboarding-recipe.loader.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';

const expected = {
  'web.iis': {
    version: '1.0.23',
    platformKey: 'iis',
    displayName: 'Windows IIS站点',
    framework: 'web.iis',
    format: 'PFX',
  },
  'web.apache.windows': {
    version: '1.0.5',
    platformKey: 'web.apache.windows',
    displayName: 'Windows Apache站点',
    framework: 'web.apache',
    format: 'PEM',
  },
  'web.apache.linux': {
    version: '1.0.4',
    platformKey: 'web.apache.linux',
    displayName: 'Linux Apache站点',
    framework: 'web.apache',
    format: 'PEM',
  },
} as const;

test('IIS 与 Windows/Linux Apache 都提供统一应用向导配方', async () => {
  const packages = await new BuiltinUnifiedPluginLoader().loadPackages();
  const loader = new ApplicationOnboardingRecipeLoader();

  for (const [pluginId, expectation] of Object.entries(expected)) {
    const plugin = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === pluginId);
    assert.ok(plugin, `${pluginId} 内置插件包缺失`);
    const manifest = plugin.manifest as Parameters<typeof loader.load>[0]['manifest'];
    const recipe = loader.load({
      id: `${pluginId}-test-version`,
      pluginId,
      version: expectation.version,
      manifest,
      resources: plugin.resources,
      status: 'ENABLED',
    }).recipe;

    assert.equal(manifest.version, expectation.version);
    assert.equal(recipe.platformKey, expectation.platformKey);
    assert.equal(recipe.targetProjection.frameworkTypes?.[0], expectation.framework);
    assert.deepEqual(recipe.certificate.acceptedFormats, [expectation.format]);
    const onboarding = manifest.resources.onboarding;
    assert.ok(onboarding?.applicationAsset);
    assert.ok(plugin.resources[onboarding.applicationAsset]);

    const zhCn = JSON.parse(plugin.resources[manifest.resources.locales?.['zh-CN'] ?? ''] ?? '{}') as Record<string, unknown>;
    const nameKey = pluginId === 'web.iis'
      ? 'plugin.webIis.name'
      : pluginId === 'web.apache.windows' ? 'plugin.webApacheWindows.name' : 'plugin.webApacheLinux.name';
    assert.equal(zhCn[nameKey], expectation.displayName);
  }
});
