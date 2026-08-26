import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CloudAccountOnboardingRecipeLoader } from './onboarding/cloud-account-onboarding-recipe.loader.js';
import { validateUnifiedPluginManifest } from './schema/unified-plugins.schema.js';

const root = join(process.cwd(), 'src/modules/plugins/builtin-plugins/cloud-aliyun');

test('阿里云插件提供通用 Cloud Account Onboarding 配方和凭据合同', () => {
  const manifest = validateUnifiedPluginManifest(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')));
  const resources: Record<string, string> = {};
  for (const path of [
    ...Object.values(manifest.resources.forms ?? {}),
    ...Object.values(manifest.resources.credentialContracts ?? {}),
    ...Object.values(manifest.resources.locales ?? {}),
    manifest.resources.onboarding?.cloudAccount,
  ]) {
    if (path) resources[path] = readFileSync(join(root, path), 'utf8');
  }
  const loaded = new CloudAccountOnboardingRecipeLoader().load({
    id: 'cloud.aliyun:2.0.19',
    pluginId: manifest.pluginId,
    version: manifest.version,
    manifest,
    resources,
    status: 'ENABLED',
  });
  assert.equal(loaded.recipe.assetKind, 'CLOUD_ACCOUNT');
  assert.equal(loaded.recipe.providerKey, 'cloud.aliyun');
  assert.equal(loaded.recipe.submit.target, 'CLOUD_ACCOUNT_ASSET');
});

test('Cloud Account 配方拒绝未在 Manifest 声明的凭据资源', () => {
  const manifest = validateUnifiedPluginManifest({
    apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'cloud.example', version: '1.0.0',
    displayNameKey: 'plugin.cloud.example.name', publisher: 'test', runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'BOTH', trust: 'UNSIGNED', support: 'COMMUNITY',
    capabilities: [
      { key: 'cloud.service.connection-test', contractVersion: 'v1', actionContractId: 'cloud.service.connection-test.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
      { key: 'cloud.service.discover', contractVersion: 'v1', actionContractId: 'cloud.service.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
    ],
    permissions: [],
    resources: { workflows: { connection: 'workflows/connection.json' }, forms: { account: 'forms/account.json' }, onboarding: { cloudAccount: 'onboarding/cloud-account.json' } },
  });
  const badRecipe = JSON.stringify({
    protocol: 'gcac.cloud-account-onboarding/v1', assetKind: 'CLOUD_ACCOUNT', providerKey: 'cloud.example',
    display: { nameKey: 'plugin.cloud.example.name' }, formResource: 'forms/account.json', credentialContractResource: 'credentials/account.json',
    capabilities: { connectionTest: 'cloud.service.connection-test', discover: 'cloud.service.discover' }, submit: { target: 'CLOUD_ACCOUNT_ASSET', scopeSchema: 'scope/v1' }, projection: { apiVersion: 'gcac.cloud-service/v1', resourceMapping: 'mapping/v1' },
  });
  assert.throws(() => new CloudAccountOnboardingRecipeLoader().load({
    id: 'example:1', pluginId: manifest.pluginId, version: manifest.version, manifest, status: 'ENABLED',
    resources: { 'onboarding/cloud-account.json': badRecipe, 'forms/account.json': JSON.stringify({ schemaVersion: 'gcac.plugin-form/v1', mode: 'BOTH', sections: [] }) },
  }), /凭据合同资源未在 Manifest 声明/);
});
