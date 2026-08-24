import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDeploymentStrategy,
  normalizeManagedDeploymentIntent,
  validateDeploymentStrategyPluginBinding,
} from './application/deployment-strategy.service.js';
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
    pluginBindingId: undefined,
    certificateFormatId: undefined,
    deploymentMode: undefined,
  });
  assert.equal(strategy.compatibilityMode, 'LEGACY');
  assert.equal(strategy.agent, undefined);
});

test('Spec033.2 统一 PluginBinding 策略标记为 UNIFIED', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: {
      managedTargetId: 'target_spec033_strategy',
      pluginBindingId: 'plgb_spec033_strategy',
    },
  }, context);

  const validated = validateDeploymentStrategyPluginBinding(strategy, pluginBinding());
  assert.equal(validated.compatibilityMode, 'UNIFIED');
});

test('Spec033.2 ManagedTarget 引用统一 Binding 后移除宿主证书格式副本', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'MANAGED_TARGET',
    managedTarget: {
      managedTargetId: 'target_spec033_strategy',
      pluginBindingId: 'plgb_spec033_strategy',
      certificateFormatId: 'format_spec033_strategy',
    },
  }, context);

  const validated = validateDeploymentStrategyPluginBinding(strategy, pluginBinding({
    certificateArtifactBindings: {
      certificate: {
        certificateFormatId: 'format_spec033_strategy',
        outputBindings: { certificatePem: 'certificatePem' },
      },
    },
  }));
  assert.equal(validated.compatibilityMode, 'UNIFIED');
  assert.equal(validated.managedTarget?.certificateFormatId, undefined);
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

test('Spec033.2 Agent Plugin 只保留统一 PluginBinding 引用', () => {
  const strategy = normalizeDeploymentStrategy({
    type: 'AGENT',
    agent: {
      mode: 'PLUGIN',
      pluginBindingId: 'plgb_spec033_strategy',
      agentId: 'agent_spec033_strategy',
    },
  }, context);

  assert.equal(strategy.agent?.pluginBindingId, 'plgb_spec033_strategy');
  assert.equal(validateDeploymentStrategyPluginBinding(strategy, pluginBinding()).compatibilityMode, 'UNIFIED');
});

test('Spec033 旧 AGENT 策略归一为统一受管意图且保持原策略兼容', () => {
  const strategy = { type: 'AGENT', agent: { agentId: 'agent_spec033_strategy', siteAssetId: 'site_spec033_strategy', managedTargetId: 'target_spec033_strategy' } } as const;
  assert.equal(normalizeDeploymentStrategy(strategy, context).type, 'AGENT');
  assert.deepEqual(normalizeManagedDeploymentIntent(strategy, context), {
    type: 'MANAGED_TARGET',
    managedTargetId: 'target_spec033_strategy',
    certificateFormatId: undefined,
    deploymentMode: undefined,
    legacyAgent: { agentId: 'agent_spec033_strategy', siteAssetId: 'site_spec033_strategy' },
  });
});

test('Spec033 拒绝旧 AGENT 冗余关系与真实目标冲突', () => {
  assert.throws(() => normalizeManagedDeploymentIntent({
    type: 'AGENT',
    agent: { agentId: 'agent_wrong', siteAssetId: 'site_spec033_strategy', managedTargetId: 'target_spec033_strategy' },
  }, context), (error: unknown) => {
    return typeof error === 'object' && error !== null
      && (error as { details?: { code?: string } }).details?.code === 'LEGACY_TARGET_RELATION_CONFLICT';
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
      agentId: 'agent_spec033_strategy',
      managedTargetId: 'target_spec033_strategy',
    },
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...patch,
  };
}
