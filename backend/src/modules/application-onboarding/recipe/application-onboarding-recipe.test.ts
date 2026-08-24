import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateUnifiedPluginManifest } from '../../plugins/schema/unified-plugins.schema.js';
import type { UnifiedPluginManifestV1 } from '../../plugins/dto/unified-plugins.dto.js';
import { ApplicationOnboardingRecipeLoader } from './application-onboarding-recipe.loader.js';
import { validateApplicationOnboardingRecipe } from './application-onboarding-recipe.schema.js';

test('接入配方校验受管设备路径、Form 引用和稳定目标身份', () => {
  const manifest = manifestForRecipe();
  const recipe = validateApplicationOnboardingRecipe(managedRecipe(), { manifest });
  assert.equal(recipe.protocol, 'gcac.application-onboarding/v1');
  assert.equal(recipe.forms.device, 'forms/device.json');
  assert.deepEqual(recipe.targetProjection.identityFields, ['managedTargetId', 'configFingerprint']);
});

test('接入配方拒绝未知字段、重复稳定字段和脚本条件', () => {
  const manifest = manifestForRecipe();
  const base = managedRecipe();
  const projection = base.targetProjection as Record<string, unknown>;
  assert.throws(() => validateApplicationOnboardingRecipe({ ...managedRecipe(), extra: true }, { manifest }), /未知字段/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    targetProjection: { ...projection, identityFields: ['managedTargetId', 'managedTargetId', 'configFingerprint'] },
  }, { manifest }), /重复字段/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    targetProjection: { ...projection, selectableWhen: 'target.ready === true; fetch("https://evil")' },
  }, { manifest }), /脚本或 URL/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    targetProjection: { ...projection, identityFields: ['managedTargetId'] },
  }, { manifest }), /configFingerprint/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    platformMetadata: { capabilityVersion: 'v1', compatibilityKeys: ['plugin.test.compatibility', 'plugin.test.compatibility'], requiredInformationKeys: ['plugin.test.requiredInformation'] },
  }, { manifest }), /重复字段/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'PLUGIN_MANAGED', pluginId: 'device.test-platform', platformKey: 'linux' },
  }, { manifest }), /未知字段/);
});

test('接入配方只接受宿主标准证书格式码，拒绝宿主不提供的格式', () => {
  const manifest = manifestForRecipe();
  assert.equal(validateApplicationOnboardingRecipe(managedRecipe(), { manifest }).certificate.acceptedFormats.join(','), 'PEM');
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    certificate: { acceptedFormats: ['P12'], requiredArtifacts: ['certificate', 'privateKey'], defaultVersion: 'LATEST_VALID' },
  }, { manifest }), /标准格式码：PEM \/ PFX \/ JKS \/ DER \/ P7B/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    certificate: { acceptedFormats: ['pem'], requiredArtifacts: ['certificate', 'privateKey'], defaultVersion: 'LATEST_VALID' },
  }, { manifest }), /标准格式码/);
});

test('新增设备入口只能由允许新建设备的配方以受限声明提供', () => {
  const manifest = manifestForRecipe();
  const pluginManaged = validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'PLUGIN_MANAGED', pluginId: 'device.test-platform' },
  }, { manifest });
  assert.deepEqual(pluginManaged.newDeviceOnboarding, { kind: 'PLUGIN_MANAGED', pluginId: 'device.test-platform' });

  const directManifest = manifestForRecipe({ capabilities: ['application.discover', 'certificate.deploy'] });
  const agentInstall = validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    deploymentMode: 'DIRECT_WORKFLOW',
    deviceResourceType: undefined,
    forms: {},
    capabilities: { connectionTest: 'application.discover', discovery: 'application.discover', workflowExecution: 'certificate.deploy' },
    commit: { executionSource: 'WORKFLOW', inputContract: 'gcac.certificate-deploy-input/v1' },
    newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKey: 'linux' },
  }, { manifest: directManifest });
  assert.deepEqual(agentInstall.newDeviceOnboarding, { kind: 'AGENT_INSTALL', platformKey: 'linux' });

  const multiPlatform = validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKeys: ['linux', 'windows-server-2016-plus'] },
  }, { manifest });
  assert.deepEqual(multiPlatform.newDeviceOnboarding, {
    kind: 'AGENT_INSTALL',
    platformKeys: ['linux', 'windows-server-2016-plus'],
  });
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKeys: [] },
  }, { manifest }), /至少声明一个 Agent 平台/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKeys: ['linux', 'linux'] },
  }, { manifest }), /重复字段/);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKey: 'linux', platformKeys: ['windows-server-2016-plus'] },
  }, { manifest }), /不能同时声明/);

  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    deviceSelection: 'EXISTING_ONLY',
    newDeviceOnboarding: { kind: 'PLUGIN_MANAGED', pluginId: 'device.test-platform' },
  }, { manifest }), /只有允许选择已有或新增设备/);
});

test('平台业务元数据只允许安全版本和插件 Locale key，Loader 会校验其默认语言文案', () => {
  const manifest = validateUnifiedPluginManifest({
    ...manifestForRecipe(),
    resources: { ...manifestForRecipe().resources, onboarding: { applicationAsset: 'onboarding/application-asset.json' } },
  });
  const withMetadata = {
    ...managedRecipe(),
    platformMetadata: {
      capabilityVersion: 'v1.2',
      compatibilityKeys: ['plugin.test.compatibility'],
      requiredInformationKeys: ['plugin.test.requiredInformation'],
    },
  };
  const parsed = validateApplicationOnboardingRecipe(withMetadata, { manifest });
  assert.deepEqual(parsed.platformMetadata, withMetadata.platformMetadata);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...withMetadata,
    platformMetadata: { ...(withMetadata.platformMetadata as Record<string, unknown>), capabilityVersion: 'v1 release' },
  }, { manifest }), /安全的能力版本标识/);

  assert.throws(() => new ApplicationOnboardingRecipeLoader().load({
    id: 'plugin-version-1', pluginId: manifest.pluginId, version: manifest.version, manifest,
    resources: {
      'forms/device.json': '{}',
      'locales/zh-CN.json': JSON.stringify({ [manifest.displayNameKey]: '测试平台', 'plugin.test.recipe': '测试平台' }),
      'workflows/discover.json': '{}',
      'onboarding/application-asset.json': JSON.stringify(withMetadata),
    },
  }), /默认语言缺少插件引用的 key/);
});

test('直接工作流配方必须声明工作流能力和工作流执行来源', () => {
  const manifest = manifestForRecipe({ capabilities: ['device.connection.test', 'application.discover'] });
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    deploymentMode: 'DIRECT_WORKFLOW',
    deviceSelection: 'NONE',
    deviceResourceType: undefined,
    forms: {},
    capabilities: { connectionTest: 'device.connection.test', discovery: 'application.discover' },
    commit: { executionSource: 'WORKFLOW', inputContract: 'gcac.certificate-deploy-input/v1' },
  }, { manifest }), /工作流执行能力/);

  const directManifest = manifestForRecipe({ capabilities: ['application.discover', 'certificate.deploy', 'device.connection.test'] });
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    deploymentMode: 'DIRECT_WORKFLOW',
    deviceSelection: 'NONE',
    deviceResourceType: undefined,
    forms: {},
    capabilities: { connectionTest: 'device.connection.test', discovery: 'application.discover' },
    commit: { executionSource: 'WORKFLOW', inputContract: 'gcac.certificate-deploy-input/v1' },
  }, { manifest: directManifest }), /工作流执行能力/);
});

test('直接工作流可要求选择真实设备，但不能携带伪造的插件设备表单', () => {
  const manifest = manifestForRecipe({ capabilities: ['application.discover', 'certificate.deploy'] });
  const direct = validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    deploymentMode: 'DIRECT_WORKFLOW',
    deviceResourceType: undefined,
    deviceSelection: 'EXISTING_OR_NEW',
    forms: {},
    capabilities: { connectionTest: 'application.discover', discovery: 'application.discover', workflowExecution: 'certificate.deploy' },
    commit: { executionSource: 'WORKFLOW', inputContract: 'gcac.certificate-deploy-input/v1' },
  }, { manifest });
  assert.equal(direct.deviceSelection, 'EXISTING_OR_NEW');
  assert.equal(direct.forms.device, undefined);
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...direct,
    forms: { device: 'forms/device.json' },
  }, { manifest }), /不能引用设备表单/);
});

test('受管设备配方不能伪装成工作流执行来源', () => {
  const manifest = manifestForRecipe();
  assert.throws(() => validateApplicationOnboardingRecipe({
    ...managedRecipe(),
    commit: { executionSource: 'WORKFLOW', inputContract: 'gcac.certificate-deploy-input/v1' },
  }, { manifest }), /PLUGIN 执行来源/);
});

test('Manifest 扩展接入配方资源，Loader 固定 PluginVersion 和资源哈希', () => {
  const manifest = validateUnifiedPluginManifest({
    ...manifestForRecipe(),
    resources: {
      ...manifestForRecipe().resources,
      onboarding: { applicationAsset: 'onboarding/application-asset.json' },
    },
  });
  const content = JSON.stringify(managedRecipe());
  const loaded = new ApplicationOnboardingRecipeLoader().load({
    id: 'plugin-version-1',
    pluginId: manifest.pluginId,
    version: manifest.version,
    manifest,
    resources: {
      'forms/device.json': '{}',
      'locales/zh-CN.json': JSON.stringify({ [manifest.displayNameKey]: '测试平台', 'plugin.test.recipe': '测试平台' }),
      'workflows/discover.json': '{}',
      'onboarding/application-asset.json': content,
    },
  });
  assert.equal(loaded.pluginVersionId, 'plugin-version-1');
  assert.equal(loaded.recipeHash, `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`);
  assert.equal(loaded.recipe.platformKey, 'vendor.test-platform');
  assert.throws(() => new ApplicationOnboardingRecipeLoader().load({
    id: 'plugin-version-2', pluginId: manifest.pluginId, version: manifest.version, manifest,
    resources: {},
  }), /配方资源不存在/);
});

test('一个插件版本可声明多个独立接入配方，但平台键不能重复', () => {
  const manifest = validateUnifiedPluginManifest({
    ...manifestForRecipe(),
    resources: {
      ...manifestForRecipe().resources,
      onboarding: {
        applicationAsset: 'onboarding/application-asset.json',
        applicationAssets: { vpnServer: 'onboarding/vpn-server-application-asset.json' },
      },
    },
  });
  const primary = managedRecipe();
  const vpnServer = { ...managedRecipe(), platformKey: 'vendor.vpn-server' };
  const source = {
    id: 'plugin-version-1', pluginId: manifest.pluginId, version: manifest.version, manifest,
    resources: {
      'forms/device.json': '{}',
      'locales/zh-CN.json': JSON.stringify({ [manifest.displayNameKey]: '测试平台', 'plugin.test.recipe': '测试平台' }),
      'workflows/discover.json': '{}',
      'onboarding/application-asset.json': JSON.stringify(primary),
      'onboarding/vpn-server-application-asset.json': JSON.stringify(vpnServer),
    },
  };
  const loader = new ApplicationOnboardingRecipeLoader();
  assert.deepEqual(loader.loadAll(source).map((item) => item.recipe.platformKey), ['vendor.test-platform', 'vendor.vpn-server']);
  assert.throws(() => loader.load(source), /多个接入配方/);
  assert.throws(() => loader.loadAll({
    ...source,
    resources: { ...source.resources, 'onboarding/vpn-server-application-asset.json': JSON.stringify(primary) },
  }), /重复的平台键/);
});

function manifestForRecipe(options: { capabilities?: string[] } = {}): UnifiedPluginManifestV1 {
  const capabilityMap: Record<string, UnifiedPluginManifestV1['capabilities'][number]> = {
    'device.connection.test': { key: 'device.connection.test', contractVersion: 'v1', actionContractId: 'device.connection.test.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
    'device.discover': { key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
    'application.discover': { key: 'application.discover', contractVersion: 'v1', actionContractId: 'application.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
    'certificate.deploy': { key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] },
  };
  const capabilities = options.capabilities ?? ['device.connection.test', 'device.discover', 'certificate.deploy'];
  return {
    apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'device.test-platform', version: '1.0.0',
    displayNameKey: 'plugin.test.platform', publisher: 'test', runtime: 'WORKFLOW_DSL', source: 'BUILTIN', scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL', capabilities: capabilities.map((key) => capabilityMap[key]!), permissions: [],
    resources: {
      forms: { device: 'forms/device.json' },
      workflows: { discover: 'workflows/discover.json' },
      locales: { 'zh-CN': 'locales/zh-CN.json' },
    },
  };
}

function managedRecipe(): Record<string, unknown> {
  return {
    protocol: 'gcac.application-onboarding/v1', platformKey: 'vendor.test-platform', displayNameKey: 'plugin.test.recipe',
    deploymentMode: 'MANAGED_TARGET', deviceResourceType: 'device.test-platform', deviceSelection: 'EXISTING_OR_NEW',
    forms: { device: 'forms/device.json' },
    capabilities: { connectionTest: 'device.connection.test', discovery: 'device.discover' },
    targetProjection: {
      targetType: 'tls.binding', displayFields: ['displayName', 'endpoint.host', 'endpoint.port'],
      identityFields: ['managedTargetId', 'configFingerprint'], selectableWhen: 'always',
    },
    certificate: { acceptedFormats: ['PEM'], requiredArtifacts: ['certificate', 'privateKey'], defaultVersion: 'LATEST_VALID' },
    commit: { executionSource: 'PLUGIN', inputContract: 'gcac.certificate-deploy-input/v1' },
  };
}
