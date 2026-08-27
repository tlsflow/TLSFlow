import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationOnboardingRecipeLoader } from '../application-onboarding/recipe/application-onboarding-recipe.loader.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { hostLocales } from './locales/plugin-locale.service.js';

const expected = {
  'web.iis': {
    version: '1.0.23',
    platformKey: 'iis',
    displayName: 'Windows IIS站点',
    englishDisplayName: 'Windows IIS Site',
    framework: 'web.iis',
    format: 'PFX',
  },
  'web.apache.windows': {
    version: '1.0.6',
    platformKey: 'web.apache.windows',
    displayName: 'Windows Apache站点',
    englishDisplayName: 'Windows Apache Site',
    framework: 'web.apache',
    format: 'PEM',
  },
  'web.nginx.windows': {
    version: '1.0.9',
    platformKey: 'web.nginx.windows',
    displayName: 'Windows Nginx站点',
    englishDisplayName: 'Windows Nginx Site',
    framework: 'web.nginx',
    format: 'PEM',
  },
  'web.apache.linux': {
    version: '1.0.5',
    platformKey: 'web.apache.linux',
    displayName: 'Linux Apache站点',
    englishDisplayName: 'Linux Apache Site',
    framework: 'web.apache',
    format: 'PEM',
  },
  'web.nginx.linux': {
    version: '1.0.7',
    platformKey: 'web.nginx.linux',
    displayName: 'Linux Nginx站点',
    englishDisplayName: 'Linux Nginx Site',
    framework: 'web.nginx',
    format: 'PEM',
  },
  'app.tomcat.linux': {
    version: '1.0.8',
    platformKey: 'app.tomcat.linux',
    displayName: 'Linux Tomcat 应用',
    englishDisplayName: 'Linux Tomcat Site',
    framework: 'app.tomcat',
    formats: ['PFX', 'JKS'],
  },
  'app.tomcat.windows': {
    version: '1.0.9',
    platformKey: 'app.tomcat.windows',
    displayName: 'Windows Tomcat 应用',
    englishDisplayName: 'Windows Tomcat Site',
    framework: 'app.tomcat',
    formats: ['PFX', 'JKS'],
  },
} as const;

test('IIS、Windows/Linux Apache/Nginx 与 Tomcat 都提供统一应用向导配方', async () => {
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
    assert.deepEqual(recipe.certificate.acceptedFormats, 'formats' in expectation ? expectation.formats : [expectation.format]);
    if (pluginId.startsWith('app.tomcat.')) {
      assert.equal(recipe.deploymentDefaults?.capabilityKey, 'certificate.deploy');
      assert.deepEqual(recipe.deploymentDefaults?.variables, {});
      assert.equal(recipe.deploymentDefaults?.certificateFormat, undefined);
      assert.deepEqual(recipe.certificate.requiredArtifacts, ['keystore']);
    }
    const onboarding = manifest.resources.onboarding;
    assert.ok(onboarding?.applicationAsset);
    assert.ok(plugin.resources[onboarding.applicationAsset]);

    assert.deepEqual(Object.keys(manifest.resources.locales ?? {}).sort(), [...hostLocales].sort());

    const zhCn = JSON.parse(plugin.resources[manifest.resources.locales?.['zh-CN'] ?? ''] ?? '{}') as Record<string, unknown>;
    const nameKey = pluginId === 'web.iis'
      ? 'plugin.webIis.name'
      : pluginId === 'web.apache.windows' ? 'plugin.webApacheWindows.name'
        : pluginId === 'web.apache.linux' ? 'plugin.webApacheLinux.name'
          : pluginId === 'web.nginx.windows' ? 'plugin.webNginxWindows.name'
            : pluginId === 'web.nginx.linux' ? 'plugin.webNginxLinux.name'
              : pluginId === 'app.tomcat.linux' ? 'plugin.appTomcatLinux.name' : 'plugin.appTomcatWindows.name';
    assert.equal(zhCn[nameKey], expectation.displayName);
    for (const locale of hostLocales) {
      const messages = JSON.parse(plugin.resources[manifest.resources.locales?.[locale] ?? ''] ?? '{}') as Record<string, unknown>;
      const onboardingKeys = [
        nameKey,
        ...(recipe.platformMetadata?.compatibilityKeys ?? []),
        ...(recipe.platformMetadata?.requiredInformationKeys ?? []),
      ];
      for (const key of onboardingKeys) assert.equal(typeof messages[key], 'string', `${pluginId} 缺少 ${locale} 的 ${key} 翻译`);
      if (locale === 'en-US') assert.equal(messages[nameKey], expectation.englishDisplayName);
      if (locale !== 'zh-CN') assert.notEqual(messages[nameKey], expectation.displayName, `${pluginId} 的 ${locale} 仍回退为中文名称`);
    }
  }
});
