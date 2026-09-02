import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { CreateServiceAssetDto, DeploymentStrategyDto } from '../../assets/dto/assets.dto.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { ApplicationOnboardingSessionDto } from '../dto/application-onboarding.dto.js';
import type { LoadedApplicationOnboardingRecipe } from '../recipe/index.js';
import { OnboardingCommitService } from './onboarding-commit.service.js';

test('受管设备接入只通过既有应用服务写入目标策略和部署计划', async () => {
  const fixture = createFixture();
  const service = new OnboardingCommitService(fixture.assets, fixture.deploymentPlans);

  const result = await service.commit('tenant-1', 'actor-1', session(), recipe('MANAGED_TARGET'));

  assert.deepEqual(result, {
    applicationAssetId: 'asset-1', deploymentPlanId: 'plan-1', pluginVersionId: 'plugin-version-1', recipeHash: 'sha256:recipe',
  });
  assert.equal(fixture.created[0]?.deploymentStrategy, undefined);
  assert.equal(fixture.created[0]?.address, 'ikuai.jacksonz.cn');
  assert.equal(fixture.created[0]?.sniName, 'ikuai.jacksonz.cn');
  assert.equal(fixture.created[0]?.verifyUrl, 'https://ikuai.jacksonz.cn:443');
  assert.deepEqual(fixture.targets, [{ applicationAssetId: 'asset-1', managedTargetId: 'target-1', metadata: { configFingerprint: 'fingerprint-1' } }]);
  assert.deepEqual(fixture.strategies, [{
    assetId: 'asset-1', actorId: 'actor-1', strategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target-1', executionMode: 'PLUGIN' } },
  }]);
  assert.equal(fixture.plans[0]?.targetCertificateVersionId, 'cert-version-1');
  assert.equal(fixture.plans[0]?.selectionMode, 'EXPLICIT');
});

test('受管设备接入默认创建 EXPLICIT 计划，LATEST_AUTO 输入快照创建自动跟踪最新版本的计划', async () => {
  const fixture = createFixture();
  const service = new OnboardingCommitService(fixture.assets, fixture.deploymentPlans);

  await service.commit('tenant-1', 'actor-1', {
    ...session(),
    inputSnapshot: { ...session().inputSnapshot, certificateSelectionMode: 'LATEST_AUTO' },
  }, recipe('MANAGED_TARGET'));

  assert.equal(fixture.plans[0]?.selectionMode, 'LATEST_AUTO');
  assert.equal(fixture.plans[0]?.targetCertificateVersionId, 'cert-version-1');
});

test('插件配方声明默认值时，向导提交通过宿主能力写入应用级 Plugin Binding', async () => {
  const fixture = createFixture();
  const defaults: NonNullable<LoadedApplicationOnboardingRecipe['recipe']['deploymentDefaults']> = {
    capabilityKey: 'certificate.deploy',
    variables: { allowInsecureTls: true },
    certificateFormat: { format: 'PEM', configName: '宿主默认 PEM Bundle' },
  };
  const applied: Array<Record<string, unknown>> = [];
  const service = new OnboardingCommitService(fixture.assets, fixture.deploymentPlans, undefined, undefined, {
    projectApplicationOnboardingDefaults: async () => ({ saveable: true, issues: [] } as never),
    applyApplicationOnboardingDefaults: async (input) => {
      applied.push(input);
      return undefined as never;
    },
  });

  await service.commit('tenant-1', 'actor-1', session(), {
    ...recipe('MANAGED_TARGET'),
    recipe: { ...recipe('MANAGED_TARGET').recipe, deploymentDefaults: defaults },
  });

  assert.deepEqual(applied, [{
    tenantId: 'tenant-1',
    applicationAssetId: 'asset-1',
    managedTargetId: 'target-1',
    metadata: { configFingerprint: 'fingerprint-1' },
    pluginVersionId: 'plugin-version-1',
    defaults,
    inputBindings: {
      apiVersion: 'gcac.input-bindings/v1',
      variables: { manualOverride: 'from-onboarding' },
      connections: {},
      credentials: {},
      artifacts: {},
    },
  }]);
  assert.deepEqual(fixture.targets, []);
  assert.deepEqual(fixture.strategies, []);
});

test('直接工作流接入固定插件发布的工作流版本，缺失发布绑定即失败关闭', async () => {
  const fixture = createFixture();
  const publisher = {
    require: async () => ({
      pluginVersionId: 'plugin-version-1', capabilityKey: 'certificate.deploy', workflowKey: 'certificate.deploy', workflowResourcePath: 'workflows/deploy.json',
      workflowTemplateId: 'workflow-template-1', workflowVersionId: 'workflow-version-1', workflowContentSha256: 'sha256:workflow', createdAt: '2026-08-14T00:00:00.000Z',
    }),
  } as Pick<PluginWorkflowPublisherService, 'require'>;
  const service = new OnboardingCommitService(fixture.assets, fixture.deploymentPlans, publisher);

  await service.commit('tenant-1', 'actor-1', session(), recipe('DIRECT_WORKFLOW'));

  const strategy = fixture.created[0]?.deploymentStrategy;
  assert.deepEqual(strategy, {
    type: 'WORKFLOW',
    workflow: {
      pluginVersionId: 'plugin-version-1', capabilityKey: 'certificate.deploy', workflowId: 'workflow-template-1',
      workflowVersionSelection: 'FIXED', workflowVersionId: 'workflow-version-1', runner: 'CONTROL_PLANE',
      target: { port: 443, protocol: 'HTTPS' },
    },
  });
  assert.equal(fixture.strategies.length, 0);

  const unavailable = new OnboardingCommitService(createFixture().assets, createFixture().deploymentPlans);
  await assert.rejects(unavailable.commit('tenant-1', 'actor-1', session(), recipe('DIRECT_WORKFLOW')), /发布服务未接入/);
});

function createFixture(): {
  assets: AssetsApplicationService;
  deploymentPlans: DeploymentPlansApplicationService;
  created: CreateServiceAssetDto[];
  targets: Array<Record<string, unknown>>;
  strategies: Array<{ assetId: string; strategy: DeploymentStrategyDto; actorId?: string }>;
  plans: Array<Record<string, unknown>>;
} {
  const created: CreateServiceAssetDto[] = [];
  const targets: Array<Record<string, unknown>> = [];
  const strategies: Array<{ assetId: string; strategy: DeploymentStrategyDto; actorId?: string }> = [];
  const plans: Array<Record<string, unknown>> = [];
  return {
    assets: {
      createServiceAsset: async (_tenantId: string, input: CreateServiceAssetDto) => {
        created.push(input);
        return { id: 'asset-1' };
      },
      getRepository: () => ({ createApplicationAssetTarget: async (_tenantId: string, input: Record<string, unknown>) => { targets.push(input); } }),
      updateServiceAssetDeploymentStrategy: async (_tenantId: string, assetId: string, strategy: DeploymentStrategyDto, actorId?: string) => {
        strategies.push({ assetId, strategy, actorId });
        return { id: assetId };
      },
    } as unknown as AssetsApplicationService,
    deploymentPlans: {
      createFromApplicationAsset: async (input: Record<string, unknown>) => {
        plans.push(input);
        return { id: 'plan-1' };
      },
    } as unknown as DeploymentPlansApplicationService,
    created, targets, strategies, plans,
  };
}

function recipe(mode: 'MANAGED_TARGET' | 'DIRECT_WORKFLOW'): LoadedApplicationOnboardingRecipe {
  return {
    pluginVersionId: 'plugin-version-1', pluginId: 'plugin.test', pluginVersion: '1.0.0', resourcePath: 'onboarding/application-asset.json', recipeHash: 'sha256:recipe',
    recipe: {
      protocol: 'gcac.application-onboarding/v1', platformKey: 'vendor.test', displayNameKey: 'plugin.test.name', supportStatus: 'SUPPORTED', deploymentMode: mode,
      ...(mode === 'MANAGED_TARGET' ? { deviceResourceType: 'device.test' } : {}),
      deviceSelection: mode === 'MANAGED_TARGET' ? 'EXISTING_OR_NEW' : 'NONE', forms: {},
      capabilities: { connectionTest: 'device.connection.test', discovery: 'device.discover', ...(mode === 'DIRECT_WORKFLOW' ? { workflowExecution: 'certificate.deploy' } : {}) },
      targetProjection: { targetType: 'tls.binding', displayFields: ['displayName'], identityFields: ['managedTargetId', 'configFingerprint'], selectableWhen: 'always' },
      certificate: { acceptedFormats: ['PEM'], requiredArtifacts: ['leaf', 'privateKey'], defaultVersion: 'LATEST_VALID' },
      commit: { executionSource: mode === 'MANAGED_TARGET' ? 'PLUGIN' : 'WORKFLOW', inputContract: 'certificate.deploy.v1' },
    },
  };
}

function session(): ApplicationOnboardingSessionDto {
  return {
    id: 'session-1', tenantId: 'tenant-1', actorId: 'actor-1', platformKey: 'vendor.test', pluginVersionId: 'plugin-version-1', recipeHash: 'sha256:recipe',
    state: 'COMMITTING', stateVersion: 1, deploymentMode: 'MANAGED_TARGET', targetId: 'target-1', targetFingerprint: 'fingerprint-1', certificateId: 'cert-1', certificateVersionId: 'cert-version-1',
    inputSnapshot: {
      endpoint: { host: '10.255.0.215', port: 443, protocol: 'HTTPS' },
      accessDomain: 'ikuai.jacksonz.cn',
      verifyUrl: 'https://ikuai.jacksonz.cn:443',
      deploymentInputBindings: {
        apiVersion: 'gcac.input-bindings/v1',
        variables: { manualOverride: 'from-onboarding' },
        connections: {},
        credentials: {},
        artifacts: {},
      },
    }, targets: [], idempotencyKey: 'session-idempotency',
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', expiresAt: '2026-08-14T01:00:00.000Z',
  };
}
