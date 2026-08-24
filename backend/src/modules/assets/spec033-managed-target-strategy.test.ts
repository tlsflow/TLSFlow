import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDeploymentStrategy, normalizeManagedDeploymentIntent } from './application/deployment-strategy.service.js';

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
  assert.deepEqual(strategy.managedTarget, { managedTargetId: 'target_spec033_strategy', certificateFormatId: undefined, deploymentMode: undefined });
  assert.equal(strategy.agent, undefined);
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
