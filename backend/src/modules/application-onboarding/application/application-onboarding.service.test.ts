import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { LoadedApplicationOnboardingRecipe } from '../recipe/index.js';
import type { ApplicationOnboardingSessionDto, OnboardingTargetOptionDto } from '../dto/application-onboarding.dto.js';
import { ApplicationOnboardingService, type OnboardingExecutionPort } from './application-onboarding.service.js';

test('已有设备必须提供设备 ID 并经过可注入校验端口', async () => {
  const calls: string[] = [];
  const { service, repository } = fixture({
    execution: {
      validateExistingDevice: async () => { calls.push('validate'); },
      testConnection: async () => { calls.push('test'); },
      discover: async () => [target()],
    },
  });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-1' });

  await assert.rejects(
    service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE' }),
    (error: unknown) => error instanceof AppError && error.details && (error.details as { code?: string }).code === 'ONBOARDING_DEVICE_REQUIRED',
  );
  assert.equal(repository.getStored(session.id)?.state, 'PLATFORM_SELECTED');
  const selected = await service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  assert.equal(selected.state, 'CONNECTION_TESTING');
  assert.deepEqual(calls, ['validate']);
});

test('相同已有设备重复提交保持幂等并返回当前会话', async () => {
  const calls: string[] = [];
  const { service } = fixture({
    execution: { validateExistingDevice: async () => { calls.push('validate'); } },
  });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-duplicate-device' });
  const selected = await service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });

  const duplicated = await service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });

  assert.equal(duplicated.state, 'CONNECTION_TESTING');
  assert.equal(duplicated.stateVersion, selected.stateVersion);
  assert.equal(duplicated.deviceId, 'device-1');
  assert.deepEqual(calls, ['validate']);
});

test('已选择设备后切换到另一台设备必须重新开始会话', async () => {
  const { service } = fixture({
    execution: { validateExistingDevice: async () => undefined },
  });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-switch-device' });
  await service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });

  await assert.rejects(
    service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-2' }),
    (error: unknown) => error instanceof AppError && error.details && (error.details as { code?: string }).code === 'ONBOARDING_INVALID_STATE',
  );
});

test('过期会话只进入一次失败终态，重复查询不得继续递增状态版本', async () => {
  const { service, repository } = fixture({ execution: {} });
  const created = await service.createSession('tenant-1', 'actor-1', {
    platformKey: 'vendor.test-platform',
    idempotencyKey: 'create-expired-session',
  });
  const expired = await repository.update('tenant-1', created.id, created.stateVersion, {
    expiresAt: '2026-08-13T00:00:00.000Z',
  });
  assert.ok(expired);

  const failed = await service.getSession('tenant-1', created.id);
  const repeated = await service.getSession('tenant-1', created.id);

  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.lastErrorCode, 'ONBOARDING_SESSION_EXPIRED');
  assert.equal(repeated.stateVersion, failed.stateVersion);
  assert.equal(repository.getStored(created.id)?.stateVersion, failed.stateVersion);
});

test('平台目录解析插件 Locale，不把插件翻译 key 交给前端显示', async () => {
  const { service } = fixture({ execution: {} });
  const platform = (await service.listPlatforms('tenant-1', 'zh-CN')).find((item) => item.platformKey === 'vendor.test-platform');
  assert.equal(platform?.displayName, '测试平台');
  assert.equal(platform?.logoUrl, '/plugin-logos/test-platform.svg');
  assert.equal(platform?.logoSquareUrl, '/plugin-logos/test-platform-square.svg');
  assert.deepEqual(platform?.acceptedCertificateFormats, ['PEM']);
});

test('证书选项只通过宿主端口提供，并携带插件声明的证书格式', async () => {
  const calls: string[] = [];
  const { service } = fixture({
    execution: {
      listCertificateOptions: async (tenantId, _session, recipe, certificateAssetId) => {
        calls.push(`${tenantId}:${certificateAssetId ?? ''}:${recipe.recipe.certificate.acceptedFormats.join(',')}`);
        return {
          assets: [{ id: 'cert-1', primaryDomain: '*.example.test' }],
          versions: certificateAssetId ? [{ id: 'version-1', certificateAssetId }] : [],
        } as never;
      },
    },
  });
  const created = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-cert-options' });
  const options = await service.certificateOptions('tenant-1', created.id, 'cert-1');
  assert.deepEqual(options.assets, [{ id: 'cert-1', primaryDomain: '*.example.test' }]);
  assert.deepEqual(options.versions, [{ id: 'version-1', certificateAssetId: 'cert-1' }]);
  assert.deepEqual(calls, ['tenant-1:cert-1:PEM']);
});

test('平台目录返回插件声明的业务接入信息，不返回 Locale key', async () => {
  const selectedRecipe = recipe('MANAGED_TARGET');
  selectedRecipe.recipe.platformMetadata = {
    capabilityVersion: 'v1',
    compatibilityKeys: ['plugin.test.compatibility'],
    requiredInformationKeys: ['plugin.test.requiredInformation'],
  };
  const { service } = fixture({ recipe: selectedRecipe, execution: {} });
  const platform = (await service.listPlatforms('tenant-1', 'zh-CN')).find((item) => item.platformKey === 'vendor.test-platform');
  assert.deepEqual(platform?.businessMetadata, {
    capabilityVersion: '1.0.0',
    compatibleVersions: ['测试平台 1.0'],
    requiredInformation: ['管理地址和管理员凭据'],
  });
});

test('平台目录返回插件声明的新建设备入口，不由宿主猜测平台类型', async () => {
  const selectedRecipe = recipe('DIRECT_WORKFLOW');
  selectedRecipe.recipe.newDeviceOnboarding = { kind: 'AGENT_INSTALL', platformKey: 'linux' };
  const { service } = fixture({ recipe: selectedRecipe, execution: { supportsDirectWorkflow: () => true } });

  const platform = (await service.listPlatforms('tenant-1')).find((item) => item.platformKey === selectedRecipe.recipe.platformKey);

  assert.deepEqual(platform?.newDeviceOnboarding, { kind: 'AGENT_INSTALL', platformKey: 'linux' });
});

test('平台目录保留插件声明的 Linux 和 Windows Agent 入口', async () => {
  const selectedRecipe = recipe('DIRECT_WORKFLOW');
  selectedRecipe.recipe.newDeviceOnboarding = { kind: 'AGENT_INSTALL', platformKeys: ['linux', 'windows-server-2016-plus'] };
  const { service } = fixture({ recipe: selectedRecipe, execution: { supportsDirectWorkflow: () => true } });

  const platform = (await service.listPlatforms('tenant-1')).find((item) => item.platformKey === selectedRecipe.recipe.platformKey);

  assert.deepEqual(platform?.newDeviceOnboarding, {
    kind: 'AGENT_INSTALL',
    platformKeys: ['linux', 'windows-server-2016-plus'],
  });
});

test('平台目录按语义版本选择配方，旧版本更新更晚也不能覆盖新版本', async () => {
  const older = recipe('MANAGED_TARGET');
  const newer: LoadedApplicationOnboardingRecipe = {
    ...older,
    pluginVersionId: 'plugin-version-2',
    pluginVersion: '1.0.5',
    recipeHash: 'sha256:newer',
  };
  const olderVersion = pluginVersionRecord(older, '2026-08-14T09:00:00.000Z');
  const newerVersion = pluginVersionRecord(newer, '2026-08-14T08:00:00.000Z');
  const plugins = {
    listAccessibleVersions: async () => [olderVersion, newerVersion],
    getVersionForTenant: async (_tenantId: string, id: string) => id === olderVersion.id ? olderVersion : newerVersion,
  } as unknown as UnifiedPluginsApplicationService;
  const loader = {
    loadAll: (version: UnifiedPluginVersionRecord) => version.id === olderVersion.id ? [older] : [newer],
  } as never;
  const service = new ApplicationOnboardingService(new MemoryRepository() as never, plugins, loader, {});

  const platform = (await service.listPlatforms('tenant-1')).find((item) => item.platformKey === older.recipe.platformKey);

  assert.equal(platform?.pluginVersionId, newer.pluginVersionId);
  assert.equal(platform?.pluginVersion, '1.0.5');
});

test('新版本移除的平台不得从旧版本继续出现在目录', async () => {
  const older = recipe('MANAGED_TARGET');
  const olderRemoved = {
    ...older,
    pluginVersionId: 'plugin-version-removed',
    pluginVersion: '1.0.4',
    recipeHash: 'sha256:removed',
  } as LoadedApplicationOnboardingRecipe;
  olderRemoved.recipe = {
    ...older.recipe,
    platformKey: 'vendor.removed-platform',
    displayNameKey: 'plugin.test.recipe.removed',
  };
  const newer = {
    ...older,
    pluginVersionId: 'plugin-version-kept',
    pluginVersion: '1.0.5',
    recipeHash: 'sha256:kept',
  } as LoadedApplicationOnboardingRecipe;
  const olderVersion = pluginVersionRecord(olderRemoved, '2026-08-14T08:00:00.000Z');
  const newerVersion = pluginVersionRecord(newer, '2026-08-14T09:00:00.000Z');
  const plugins = {
    listAccessibleVersions: async () => [olderVersion, newerVersion],
    getVersionForTenant: async (_tenantId: string, id: string) => id === olderVersion.id ? olderVersion : newerVersion,
  } as unknown as UnifiedPluginsApplicationService;
  const loader = {
    loadAll: (version: UnifiedPluginVersionRecord) => version.id === olderVersion.id ? [olderRemoved] : [newer],
  } as never;
  const service = new ApplicationOnboardingService(new MemoryRepository() as never, plugins, loader, {});

  const platforms = await service.listPlatforms('tenant-1');
  const removed = platforms.find((item) => item.platformKey === 'vendor.removed-platform');
  const kept = platforms.find((item) => item.platformKey === newer.recipe.platformKey);

  assert.equal(removed, undefined, '被新版本移除的平台键不得由旧版本继续提供');
  assert.equal(kept?.pluginVersionId, newer.pluginVersionId);
  assert.equal(kept?.pluginVersion, '1.0.5');
});

test('新增设备缺少接入端口时失败关闭，不会伪造连接测试状态', async () => {
  const { service, repository } = fixture({ execution: {} });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-2' });

  await assert.rejects(
    service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'NEW_DEVICE', values: { address: '10.0.0.1' } }),
    (error: unknown) => error instanceof AppError && error.details && (error.details as { code?: string }).code === 'ONBOARDING_DEVICE_ONBOARDING_UNAVAILABLE',
  );
  assert.equal(repository.getStored(session.id)?.state, 'PLATFORM_SELECTED');
});

test('DIRECT_WORKFLOW 也必须先选择真实设备，缺少连接测试端口时不得推进', async () => {
  const directRecipe = recipe('DIRECT_WORKFLOW');
  const { service, repository } = fixture({
    recipe: directRecipe,
    execution: { supportsDirectWorkflow: () => true, validateExistingDevice: async () => undefined },
  });
  const platform = (await service.listPlatforms('tenant-1')).find((item) => item.source === 'PLUGIN');
  assert.equal(platform?.platformKey, directRecipe.recipe.platformKey);
  assert.equal(platform?.supportStatus, 'SUPPORTED');
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: directRecipe.recipe.platformKey, idempotencyKey: 'create-3' });
  assert.equal(session.state, 'PLATFORM_SELECTED');

  await assert.rejects(
    service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE' }),
    (error: unknown) => error instanceof AppError && error.details && (error.details as { code?: string }).code === 'ONBOARDING_DEVICE_REQUIRED',
  );
  const selected = await service.selectResource('tenant-1', session.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  assert.equal(selected.state, 'CONNECTION_TESTING');
  await assert.rejects(
    service.test('tenant-1', session.id, { expectedStateVersion: selected.stateVersion }),
    (error: unknown) => error instanceof AppError && error.details && (error.details as { code?: string }).code === 'ONBOARDING_CONNECTION_TEST_UNAVAILABLE',
  );
  assert.equal(repository.getStored(session.id)?.state, 'CONNECTION_TESTING');
});

test('待验收平台不能创建接入会话', async () => {
  const directRecipe = recipe('DIRECT_WORKFLOW');
  const { service } = fixture({ recipe: directRecipe, execution: { supportsDirectWorkflow: () => false } });
  const platforms = await service.listPlatforms('tenant-1');
  assert.equal(platforms.find((item) => item.platformKey === directRecipe.recipe.platformKey)?.supportStatus, 'IN_REVIEW');
  await assert.rejects(
    service.createSession('tenant-1', 'actor-1', { platformKey: directRecipe.recipe.platformKey, idempotencyKey: 'create-review' }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED',
  );
});

test('会话快照只保留非敏感设备输入', async () => {
  const { service, repository } = fixture({
    execution: { validateExistingDevice: async () => undefined },
  });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-redacted' });
  await service.selectResource('tenant-1', session.id, {
    expectedStateVersion: session.stateVersion,
    mode: 'EXISTING_DEVICE',
    deviceId: 'device-1',
    values: { address: '10.0.0.1', username: 'admin', password: 'secret-value', accessToken: 'token-value' },
  });
  assert.deepEqual(repository.getStored(session.id)?.inputSnapshot, { address: '10.0.0.1', username: 'admin' });
});

test('已有设备选项只能由宿主兼容性端口提供', async () => {
  const expected = [{ deviceId: 'device-compatible', displayName: '受管设备', address: '10.0.0.1', health: 'HEALTHY', selectable: true }];
  const { service } = fixture({ execution: { listExistingDevices: async () => expected } });
  const session = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-devices' });
  assert.deepEqual(await service.devices('tenant-1', session.id), expected);
});

test('发现没有业务目标时只能停留在目标选择阶段，不能直接选择证书', async () => {
  const { service, repository } = fixture({
    execution: {
      validateExistingDevice: async () => undefined,
      testConnection: async () => undefined,
      discover: async () => [],
    },
  });
  const created = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-4' });
  const selected = await service.selectResource('tenant-1', created.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  const tested = await service.test('tenant-1', created.id, { expectedStateVersion: selected.stateVersion });
  const discovered = await service.discover('tenant-1', created.id, { expectedStateVersion: tested.stateVersion });
  assert.equal(discovered.state, 'TARGET_SELECTION_REQUIRED');
  assert.deepEqual(discovered.targets, []);
  await assert.rejects(
    service.selectCertificate('tenant-1', created.id, { expectedStateVersion: discovered.stateVersion, certificateId: 'cert-1', certificateVersionId: 'version-1' }),
    /当前阶段不能选择证书/,
  );
  assert.equal(repository.getStored(created.id)?.state, 'TARGET_SELECTION_REQUIRED');
});

test('选择证书版本时按输入快照记录始终使用最新版本模式，默认使用显式版本', async () => {
  const { service, repository } = fixture({
    execution: {
      validateExistingDevice: async () => undefined,
      testConnection: async () => undefined,
      discover: async () => [target()],
    },
  });
  const created = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-cert-mode' });
  const selected = await service.selectResource('tenant-1', created.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  const tested = await service.test('tenant-1', created.id, { expectedStateVersion: selected.stateVersion });
  const discovered = await service.discover('tenant-1', created.id, { expectedStateVersion: tested.stateVersion });
  const targetSelected = await service.selectTarget('tenant-1', created.id, {
    expectedStateVersion: discovered.stateVersion,
    managedTargetId: 'target-1',
    configFingerprint: 'fingerprint-1',
    accessDomain: 'ikuai.jacksonz.cn',
    verifyUrl: 'https://ikuai.jacksonz.cn:443',
  });
  assert.equal(targetSelected.state, 'CERTIFICATE_SELECTION_REQUIRED');
  assert.equal(targetSelected.inputSnapshot.accessDomain, 'ikuai.jacksonz.cn');
  assert.equal(targetSelected.inputSnapshot.verifyUrl, 'https://ikuai.jacksonz.cn:443');

  const explicit = await service.selectCertificate('tenant-1', created.id, { expectedStateVersion: targetSelected.stateVersion, certificateId: 'cert-1', certificateVersionId: 'version-1' });
  assert.equal(explicit.state, 'READY_TO_COMMIT');
  assert.equal(repository.getStored(created.id)?.inputSnapshot.certificateSelectionMode, 'EXPLICIT');

  await repository.update('tenant-1', created.id, explicit.stateVersion, { state: 'CERTIFICATE_SELECTION_REQUIRED' });
  const latestAuto = await service.selectCertificate('tenant-1', created.id, { expectedStateVersion: explicit.stateVersion + 1, certificateId: 'cert-1', certificateVersionId: 'version-2', selectionMode: 'LATEST_AUTO' });
  assert.equal(latestAuto.state, 'READY_TO_COMMIT');
  assert.equal(repository.getStored(created.id)?.inputSnapshot.certificateSelectionMode, 'LATEST_AUTO');
  assert.equal(repository.getStored(created.id)?.certificateVersionId, 'version-2');
});

test('选择站点时拒绝将管理 VIP 写入访问域名或验证 URL', async () => {
  const { service } = fixture({
    execution: {
      validateExistingDevice: async () => undefined,
      testConnection: async () => undefined,
      discover: async () => [{ ...target(), displayName: 'ikuai.jacksonz.cn', endpoint: { host: '10.255.0.215', port: 443, protocol: 'HTTPS' } }],
    },
  });
  const created = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-ip-domain-rejected' });
  const selected = await service.selectResource('tenant-1', created.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  const tested = await service.test('tenant-1', created.id, { expectedStateVersion: selected.stateVersion });
  const discovered = await service.discover('tenant-1', created.id, { expectedStateVersion: tested.stateVersion });

  await assert.rejects(
    service.selectTarget('tenant-1', created.id, {
      expectedStateVersion: discovered.stateVersion,
      managedTargetId: 'target-1',
      configFingerprint: 'fingerprint-1',
      accessDomain: '10.255.0.215',
      verifyUrl: 'https://10.255.0.215:443',
    }),
    (error: unknown) => error instanceof AppError && (error.details as { code?: string })?.code === 'ONBOARDING_ACCESS_DOMAIN_IP_FORBIDDEN',
  );
});

test('连接测试失败时不得调用站点发现，会话进入失败终态并保留错误详情', async () => {
  const calls: string[] = [];
  const { service, repository } = fixture({
    execution: {
      validateExistingDevice: async () => { calls.push('validate'); },
      testConnection: async () => {
        calls.push('test');
        throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '设备插件能力执行失败', { capabilityKey: 'device.connection.test', failedStepName: 'readVersion', errorCode: 'HTTP_NON_SUCCESS_STATUS' });
      },
      discover: async () => { calls.push('discover'); return [target()]; },
    },
  });
  const created = await service.createSession('tenant-1', 'actor-1', { platformKey: 'vendor.test-platform', idempotencyKey: 'create-connection-failure' });
  const selected = await service.selectResource('tenant-1', created.id, { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-1' });
  assert.equal(selected.state, 'CONNECTION_TESTING');

  await assert.rejects(
    service.test('tenant-1', created.id, { expectedStateVersion: selected.stateVersion }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PLUGIN_CAPABILITY_EXECUTION_FAILED',
  );

  const failed = repository.getStored(created.id);
  assert.equal(failed?.state, 'FAILED');
  assert.equal(failed?.lastErrorCode, 'ONBOARDING_CONNECTION_FAILED');
  assert.deepEqual(failed?.lastErrorDetail, { code: 'PLUGIN_CAPABILITY_EXECUTION_FAILED' });
  assert.deepEqual(calls, ['validate', 'test'], '连接测试失败后不得调用站点发现');
});

function fixture(options: { recipe?: LoadedApplicationOnboardingRecipe; execution: OnboardingExecutionPort }): {
  service: ApplicationOnboardingService;
  repository: MemoryRepository;
} {
  const selectedRecipe = options.recipe ?? recipe('MANAGED_TARGET');
  const pluginVersion = pluginVersionRecord(selectedRecipe);
  const repository = new MemoryRepository();
  const plugins = {
    listAccessibleVersions: async () => [pluginVersion],
    getVersionForTenant: async () => pluginVersion,
  } as unknown as UnifiedPluginsApplicationService;
  const loader = { loadAll: () => [selectedRecipe] } as never;
  return {
    service: new ApplicationOnboardingService(repository as never, plugins, loader, options.execution),
    repository,
  };
}

function pluginVersionRecord(
  selectedRecipe: LoadedApplicationOnboardingRecipe,
  updatedAt = '2026-08-14T00:00:00.000Z',
): UnifiedPluginVersionRecord {
  const metadataMessages = Object.fromEntries([
    ...(selectedRecipe.recipe.platformMetadata?.compatibilityKeys ?? []).map((key) => [key, '测试平台 1.0']),
    ...(selectedRecipe.recipe.platformMetadata?.requiredInformationKeys ?? []).map((key) => [key, '管理地址和管理员凭据']),
  ]);
  const pluginVersion = {
    id: selectedRecipe.pluginVersionId,
    pluginId: selectedRecipe.pluginId,
    version: selectedRecipe.pluginVersion,
    status: 'ENABLED',
    manifest: {
      defaultLocale: 'zh-CN',
      logoUrl: '/plugin-logos/test-platform.svg',
      logoSquareUrl: '/plugin-logos/test-platform-square.svg',
      resources: {
        onboarding: { applicationAsset: selectedRecipe.resourcePath },
        locales: { 'zh-CN': 'locales/zh-CN.json' },
      },
    },
    resources: {
      [selectedRecipe.resourcePath]: '{}',
      'locales/zh-CN.json': JSON.stringify({ [selectedRecipe.recipe.displayNameKey]: '测试平台', ...metadataMessages }),
    },
    createdAt: updatedAt,
    updatedAt,
  } as unknown as UnifiedPluginVersionRecord;
  return pluginVersion;
}

function recipe(mode: 'MANAGED_TARGET' | 'DIRECT_WORKFLOW'): LoadedApplicationOnboardingRecipe {
  return {
    pluginVersionId: 'plugin-version-1', pluginId: 'device.test-platform', pluginVersion: '1.0.0',
    resourcePath: 'onboarding/application-asset.json', recipeHash: 'sha256:test',
    recipe: {
      protocol: 'gcac.application-onboarding/v1', platformKey: mode === 'DIRECT_WORKFLOW' ? 'vendor.direct-platform' : 'vendor.test-platform',
      displayNameKey: 'plugin.test.recipe', supportStatus: 'SUPPORTED', deploymentMode: mode,
      ...(mode === 'MANAGED_TARGET' ? { deviceResourceType: 'device.test-platform' } : {}),
      deviceSelection: 'EXISTING_OR_NEW',
      forms: mode === 'MANAGED_TARGET' ? { device: 'forms/device.json' } : {},
      capabilities: {
        connectionTest: 'device.connection.test', discovery: 'application.discover',
        ...(mode === 'DIRECT_WORKFLOW' ? { workflowExecution: 'certificate.deploy' } : {}),
      },
      targetProjection: { targetType: 'tls.binding', displayFields: ['displayName'], identityFields: ['managedTargetId', 'configFingerprint'], selectableWhen: 'always' },
      certificate: { acceptedFormats: ['PEM'], requiredArtifacts: ['certificate', 'privateKey'], defaultVersion: 'LATEST_VALID' },
      commit: { executionSource: mode === 'DIRECT_WORKFLOW' ? 'WORKFLOW' : 'PLUGIN', inputContract: 'gcac.certificate-deploy-input/v1' },
    },
  };
}

function target(): OnboardingTargetOptionDto {
  return { managedTargetId: 'target-1', targetType: 'tls.binding', displayName: '站点', configFingerprint: 'fingerprint-1', selectable: true };
}

class MemoryRepository {
  private readonly sessions = new Map<string, ApplicationOnboardingSessionDto>();

  async findByIdempotencyKey(tenantId: string, key: string): Promise<ApplicationOnboardingSessionDto | undefined> {
    return [...this.sessions.values()].find((item) => item.tenantId === tenantId && item.idempotencyKey === key);
  }

  async create(input: ApplicationOnboardingSessionDto): Promise<ApplicationOnboardingSessionDto> {
    this.sessions.set(input.id, input);
    return input;
  }

  async get(tenantId: string, id: string): Promise<ApplicationOnboardingSessionDto | undefined> {
    const session = this.sessions.get(id);
    return session?.tenantId === tenantId ? session : undefined;
  }

  async update(tenantId: string, id: string, expectedStateVersion: number, patch: Record<string, unknown>): Promise<ApplicationOnboardingSessionDto | undefined> {
    const current = await this.get(tenantId, id);
    if (!current || current.stateVersion !== expectedStateVersion) return undefined;
    const updated = { ...current, ...patch, stateVersion: current.stateVersion + 1, updatedAt: new Date().toISOString() } as ApplicationOnboardingSessionDto;
    this.sessions.set(id, updated);
    return updated;
  }

  getStored(id: string): ApplicationOnboardingSessionDto | undefined {
    return this.sessions.get(id);
  }
}
