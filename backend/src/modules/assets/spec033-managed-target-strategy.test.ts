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
  });
  assert.equal(strategy.compatibilityMode, 'UNIFIED');
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
