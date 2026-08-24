import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import {
  normalizeDeploymentStrategy,
  normalizeManagedDeploymentIntent,
  validateDeploymentStrategyPluginBinding,
} from './application/deployment-strategy.service.js';
import { AssetsApplicationService } from './application/assets.application-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import type { PluginBindingV1 } from '../plugins/dto/plugin-bindings.dto.js';

const context = {
  asset: { id: 'asset_spec033_strategy', agentId: 'agent_spec033_strategy', metadata: {} },
  targetBinding: {
    agentId: 'agent_spec033_strategy',
    siteAssetId: 'site_spec033_strategy',
    managedTargetId: 'target_spec033_strategy',
  },
  actorId: 'user_spec033_strategy',
  now: '2026-07-22T00:00:00.000Z',
};

test('Spec033 新 MANAGED_TARGET 策略只要求目标 ID', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: { managedTargetId: 'target_spec033_strategy' },
  }, context);
  assert.deepEqual(strategy.managedTarget, {
    managedTargetId: 'target_spec033_strategy',
    executionMode: 'PLUGIN',
  });
  assert.equal(strategy.compatibilityMode, 'UNIFIED');
});

test('Spec033 MANAGED_TARGET 策略保留证书产物配置', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: {
      managedTargetId: 'target_spec033_strategy',
      certificateFormatId: 'format_spec033_strategy',
    },
  }, context);
  assert.deepEqual(strategy.managedTarget, {
    managedTargetId: 'target_spec033_strategy',
    certificateFormatId: 'format_spec033_strategy',
    executionMode: 'PLUGIN',
  });
});

test('Spec033.5 受管工作流覆盖必须且只能引用 WorkflowExecutionBinding', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: { managedTargetId: 'target_spec033_strategy', executionMode: 'WORKFLOW_OVERRIDE', workflowExecutionBindingId: 'wfeb_1' },
  }, context);
  assert.equal(strategy.managedTarget?.workflowExecutionBindingId, 'wfeb_1');
  assert.throws(() => normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: { managedTargetId: 'target_spec033_strategy', executionMode: 'PLUGIN', workflowExecutionBindingId: 'wfeb_1' },
  }, context), /PLUGIN 模式不得引用/);
});

test('Spec033 应用资产保存后可回读 ManagedTarget 证书产物配置', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const service = new AssetsApplicationService(new PgAssetsRepository(database));
  const created = await service.createServiceAsset('tenant_spec033_strategy_persist', {
    address: 'strategy-persist.example.com',
    port: 443,
    protocol: 'HTTPS',
    platform: 'LINUX',
    discoverySource: 'MANUAL',
    deploymentStrategy: {
      type: 'MANAGED_TARGET',
      managedTarget: {
        managedTargetId: 'target_spec033_strategy_persist',
        certificateFormatId: 'format_spec033_strategy_persist',
      },
    },
  });

  assert.equal(created.deploymentStrategy?.managedTarget?.certificateFormatId, 'format_spec033_strategy_persist');
  const detail = await service.getServiceAssetDetail('tenant_spec033_strategy_persist', created.id);
  assert.equal(detail?.deploymentStrategy?.managedTarget?.certificateFormatId, 'format_spec033_strategy_persist');
});

test('Spec033.4 ManagedTarget 策略不保存 PluginBinding', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: { managedTargetId: 'target_spec033_strategy' },
  }, context);
  assert.equal(strategy.compatibilityMode, 'UNIFIED');
});

test('Spec033.4 ManagedTarget 意图只保留目标 ID', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: { managedTargetId: 'target_spec033_strategy' },
  }, context);
  assert.deepEqual(normalizeManagedDeploymentIntent(strategy, context), { type: 'MANAGED_TARGET', managedTargetId: 'target_spec033_strategy' });
});

test('Spec033.2 Workflow 的变量和产物只从统一 Binding 投影', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'WORKFLOW',
    workflow: {
      pluginBindingId: 'plgb_spec033_strategy',
      runner: 'CONTROL_PLANE',
      parameterBindings: { legacyParameter: 'legacy' },
      variableBindings: { legacyVariable: 'legacy' },
      certificateArtifactBindings: {
        legacyCertificate: {
          certificateFormatId: 'format_legacy',
          outputBindings: { certificatePem: 'legacy' },
        },
      },
    },
  }, context);
  const validated = validateDeploymentStrategyPluginBinding(strategy, pluginBinding({
    variableBindings: { bindingVariable: 'binding' },
    credentialBindings: { credential: { credentialId: 'cred_spec033' } },
    connectionBindings: { target: { host: '192.0.2.10' } },
    certificateArtifactBindings: {
      certificate: {
        certificateFormatId: 'format_unified',
        outputBindings: { certificatePem: 'certificatePem' },
      },
    },
  }));

  assert.equal(validated.compatibilityMode, 'UNIFIED');
  assert.equal(validated.workflow?.parameterBindings, undefined);
  assert.deepEqual(validated.workflow?.variableBindings, { bindingVariable: 'binding' });
  assert.deepEqual(validated.workflow?.credentialBindings, { credential: { credentialId: 'cred_spec033' } });
  assert.deepEqual(validated.workflow?.connectionBindings, { target: { host: '192.0.2.10' } });
  assert.deepEqual(validated.workflow?.certificateArtifactBindings, {
    certificate: {
      certificateFormatId: 'format_unified',
      outputBindings: { certificatePem: 'certificatePem' },
    },
  });
});

function pluginBinding(patch: Partial<PluginBindingV1> = {}): PluginBindingV1 {
  return {
    id: 'plgb_spec033_strategy',
    tenantId: 'tenant_spec033_strategy',
    pluginVersionId: 'version_spec033_strategy',
    mode: 'MANAGED',
    variableBindings: {},
    credentialBindings: {},
    secretBindings: {},
    certificateArtifactBindings: {},
    connectionBindings: {},
    managedContext: {
      hostId: 'host_spec033_strategy',
      managedTargetId: 'target_spec033_strategy',
    },
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...patch,
  };
}
