import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  sha256Digest,
  type AgentLocalPolicyV1,
  type AgentPlanV1,
} from './agent-security.contract.js';
import {
  type PolicyAuthorityProvisioningResultV1,
  type PolicyAuthorityProvisioningReceiptV1,
  type SignedAgentLocalPolicyMaterialV1,
  type SignedPolicyAuthorityProvisioningRuleV1,
  policyAuthorityProvisioningReceiptVersion,
  policyAuthorityProvisioningVersion,
} from './policy-authority.service.js';
import {
  AgentPlanPolicyProvisioningServiceV1,
  type AgentPlanPolicyProvisioningInputV1,
} from './policy-authority-provisioning.service.js';

test('宿主 provisioning 从受信任 localPolicy 读取上限，并隔离 Artifact 摘要', async () => {
  const plan = readFixturePlan();
  const artifactDigest = 'a'.repeat(64);
  const localPolicy: AgentLocalPolicyV1 = {
    policyVersion: 'gcac.agent-security/v1',
    agentId: plan.agentId,
    authorityKeyIds: ['authority-key-1'],
    allowedActions: ['filesystem.read'],
    pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read'] }],
    serviceRules: [],
    commandRules: [],
    disabled: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  let received: Record<string, unknown> | undefined;
  const result = createResult(plan, localPolicy, artifactDigest);
  const service = new AgentPlanPolicyProvisioningServiceV1(
    {
      assertReady: () => undefined,
      issueAuthorization: () => { throw new Error('provisioning 不得走 issueAuthorization'); },
      provisionAgentPlan: (request) => {
        received = request as unknown as Record<string, unknown>;
        return result;
      },
    },
    { resolve: async () => structuredClone(localPolicy) },
  );

  const response = await service.provision({
    tenantId: plan.tenantId,
    agentId: plan.agentId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    planDigest: plan.planDigest,
    policyRef: 'certificate-update-policy',
    policyVersion: 'v1',
    actions: ['filesystem.read'],
    allowedPaths: ['/var/lib/gcac'],
    allowedServices: [],
    commandRules: [],
    artifactDigests: [artifactDigest],
    lifetimeSeconds: 300,
    compiledPlan: plan,
  });

  assert.equal(response.revision, result.revision);
  assert.deepEqual(received?.currentLocalPolicy, localPolicy);
  assert.equal(JSON.stringify(response.localPolicyMaterial.localPolicy).includes(artifactDigest), false);
});

test('宿主 provisioning 拒绝已编译 Plan 身份漂移', async () => {
  const plan = readFixturePlan();
  const service = new AgentPlanPolicyProvisioningServiceV1(
    {
      assertReady: () => undefined,
      issueAuthorization: () => { throw new Error('不得调用'); },
      provisionAgentPlan: () => { throw new Error('不得调用'); },
    },
    { resolve: async () => createLocalPolicy(plan) },
  );
  await assert.rejects(
    service.provision({
      tenantId: plan.tenantId,
      agentId: 'agent-other',
      pluginId: plan.pluginId,
      pluginVersionId: plan.pluginVersionId,
      capability: plan.capability,
      planDigest: plan.planDigest,
      policyRef: 'certificate-update-policy',
      policyVersion: 'v1',
      actions: ['filesystem.read'],
      allowedPaths: ['/var/lib/gcac'],
      allowedServices: [],
      commandRules: [],
      artifactDigests: ['a'.repeat(64)],
      lifetimeSeconds: 300,
      compiledPlan: plan,
    }),
    /身份不匹配/,
  );
});

test('开发 Authority 没有 provisioning 方法时失败关闭', async () => {
  const plan = readFixturePlan();
  const service = new AgentPlanPolicyProvisioningServiceV1(
    { assertReady: () => undefined, issueAuthorization: () => { throw new Error('不得调用'); } },
    { resolve: async () => createLocalPolicy(plan) },
  );
  await assert.rejects(
    service.provision(createInput(plan)),
    /provisioning 已失败关闭/,
  );
});

function createInput(plan: AgentPlanV1): AgentPlanPolicyProvisioningInputV1 {
  return {
    tenantId: plan.tenantId,
    agentId: plan.agentId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    planDigest: plan.planDigest,
    policyRef: 'certificate-update-policy',
    policyVersion: 'v1',
    actions: ['filesystem.read'],
    allowedPaths: ['/var/lib/gcac'],
    allowedServices: [],
    commandRules: [],
    artifactDigests: ['a'.repeat(64)],
    lifetimeSeconds: 300,
    compiledPlan: plan,
  };
}

function createLocalPolicy(plan: AgentPlanV1): AgentLocalPolicyV1 {
  return {
    policyVersion: 'gcac.agent-security/v1',
    agentId: plan.agentId,
    authorityKeyIds: ['authority-key-1'],
    allowedActions: ['filesystem.read'],
    pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read'] }],
    serviceRules: [],
    commandRules: [],
    disabled: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

function createResult(plan: AgentPlanV1, localPolicy: AgentLocalPolicyV1, artifactDigest: string): PolicyAuthorityProvisioningResultV1 {
  const rule: SignedPolicyAuthorityProvisioningRuleV1 = {
    provisioningVersion: policyAuthorityProvisioningVersion,
    policyRef: 'certificate-update-policy',
    policyVersion: 'v1',
    agentId: plan.agentId,
    tenantId: plan.tenantId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    planDigest: plan.planDigest,
    actions: ['filesystem.read'],
    allowedPaths: ['/var/lib/gcac'],
    allowedServices: [],
    artifactDigests: [artifactDigest],
    commandRules: [],
    authorityKeyId: 'authority-key-1',
    issuedAt: '2026-08-08T00:00:00.000Z',
    validUntil: '2026-08-08T00:05:00.000Z',
    signature: 'signature',
  };
  const localUnsigned: Omit<SignedAgentLocalPolicyMaterialV1, 'signature'> = {
    materialVersion: policyAuthorityProvisioningVersion,
    tenantId: plan.tenantId,
    agentId: plan.agentId,
    localPolicy,
    authorityKeyId: 'authority-key-1',
  };
  const localPolicyMaterial: SignedAgentLocalPolicyMaterialV1 = { ...localUnsigned, signature: 'signature' };
  const receiptUnsigned: Omit<PolicyAuthorityProvisioningReceiptV1, 'signature'> = {
    receiptVersion: policyAuthorityProvisioningReceiptVersion,
    revision: 'provisioning-test',
    requestDigest: 'b'.repeat(64),
    ruleDigest: sha256Digest(rule),
    localPolicyDigest: sha256Digest(localUnsigned),
    issuedAt: '2026-08-08T00:00:00.000Z',
  };
  return {
    provisioningVersion: policyAuthorityProvisioningVersion,
    revision: receiptUnsigned.revision,
    requestDigest: receiptUnsigned.requestDigest,
    rule,
    localPolicyMaterial,
    receipt: { ...receiptUnsigned, signature: 'signature' },
  };
}

function readFixturePlan(): AgentPlanV1 {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/agents/security/fixtures/agent-security.valid.json'), 'utf8');
  return JSON.parse(source).contracts.AgentPlanV1 as AgentPlanV1;
}
