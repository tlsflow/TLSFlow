import { generateKeyPairSync, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import { computeAgentPlanDigest, NonceStoreV1, signPolicyPayload, type AgentLocalPolicyV1, type AgentPlanV1, type PolicyAuthorityKeySetV1 } from '../agents/security/agent-security.contract.js';
import { InMemoryPolicyAuthorityRevocationStoreV1, PolicyAuthorityServiceV1, type PolicyAuthorityAuthorizationRequestV1, type PolicyAuthorityTrustRootV1, type SignedPolicyAuthorityKeySetV1 } from '../agents/security/policy-authority.service.js';
import { UnifiedAgentPlanCompilerService } from './application/unified-agent-plan-compiler.service.js';
import type { UnifiedAgentPlanAuthorizationDependenciesV1 } from './application/unified-agent-plan-authorization.port.js';

test('Agent v2 编译缺少完整授权请求时失败关闭', async () => {
  const compiler = new UnifiedAgentPlanCompilerService({} as never);

  await assert.rejects(
    compiler.compile({
      tenantId: 'tenant_fixture',
      agentId: 'agent_fixture',
      executionRunId: 'run_fixture',
      executionStepId: 'step_fixture',
      pluginVersionId: 'plugin_version_fixture',
      pluginBindingId: 'plugin_binding_fixture',
      resolvedInput: {} as never,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
});

test('Agent v2 编译通过窄注入端口真实签发并一次性绑定 Token 和 Decision', async () => {
  const plan = createPlan();
  let issueCount = 0;
  const authority = createAuthority();
  const dependencies = createDependencies({
    issueAuthorization: (request) => {
      issueCount += 1;
      return authority.issueAuthorization(request);
    },
  });
  const compiler = new UnifiedAgentPlanCompilerService(pluginService(), dependencies);
  const input = compileInput(plan);
  const first = await compiler.compile(input);
  const second = await compiler.compile(input);

  assert.equal(issueCount, 1);
  assert.equal(first.plan.planDigest, plan.planDigest);
  assert.equal(first.plan.tokenId, first.token.tokenId);
  assert.equal(first.plan.policyDecisionId, first.policyDecision.decisionId);
  assert.deepEqual(second, first);
});

test('缺少生产授权端口、Grant 或本地策略时失败关闭且不签发', async () => {
  const plan = createPlan();
  const base = compileInput(plan);
  await assert.rejects(
    new UnifiedAgentPlanCompilerService(pluginService()).compile(base),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );

  let issueCount = 0;
  const authority = createAuthority();
  const dependencies = createDependencies({ issueAuthorization: (request) => { issueCount += 1; return authority.issueAuthorization(request); } });
  const missingGrant = { ...dependencies, grants: { validate: async () => { throw new Error('grant missing'); } } };
  await assert.rejects(new UnifiedAgentPlanCompilerService(pluginService(), missingGrant).compile(base), /生产授权签发或绑定失败|grant missing/);
  const missingPolicy = { ...dependencies, localPolicy: { resolve: async () => undefined } };
  await assert.rejects(new UnifiedAgentPlanCompilerService(pluginService(), missingPolicy).compile(base), /生产授权签发或绑定失败|AgentLocalPolicyV1/);
  assert.equal(issueCount, 0);
});

test('调用方携带伪造或外部签发材料时直接失败关闭', async () => {
  const plan = createPlan();
  const input = compileInput(plan);
  await assert.rejects(
    new UnifiedAgentPlanCompilerService(pluginService(), createDependencies({ issueAuthorization: () => { throw new Error('不得调用'); } })).compile({
      ...input,
      v2Request: { ...input.v2Request!, token: { fake: true } },
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
});

function pluginService() {
  return { getVersion: async () => ({
    id: 'plugin-version-1', tenantId: 'tenant-1', pluginId: 'web.nginx', version: '1.0.0', source: 'BUILTIN', runtime: 'WORKFLOW', scope: 'BOTH', trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL',
    manifest: { pluginId: 'web.nginx' }, status: 'ENABLED',
  }) } as never;
}

function createPlan(): AgentPlanV1 {
  const plan = {
    planVersion: 'gcac.agent-security/v1', planId: 'plan-1', agentId: 'agent-1', tenantId: 'tenant-1', pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', capability: 'filesystem.read',
    operations: [{ operationId: 'op-1', operationType: 'filesystem.read', stage: 'prepare', input: { path: '/var/lib/gcac/config.json' }, dependsOn: [], idempotencyKey: 'idem-1', timeoutSeconds: 30 }],
    planDigest: '', tokenId: 'draft-token', policyDecisionId: 'draft-decision', nonce: 'draft-nonce', expiresAt: '2026-08-08T00:10:00.000Z', writeEffect: false,
  } as AgentPlanV1;
  plan.planDigest = computeAgentPlanDigest(plan);
  return plan;
}

function compileInput(plan: AgentPlanV1) {
  return {
    tenantId: 'tenant-1', agentId: 'agent-1', executionRunId: 'run-1', executionStepId: 'step-1', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1',
    resolvedInput: {} as never,
    v2Request: {
      actionType: 'agent.plan.execute', plan,
      authorization: { grantId: 'grant-1', policyRef: 'policy-1', policyVersion: '1', actions: ['filesystem.read'], allowedPaths: ['/var/lib/gcac'], allowedServices: ['service-1'], artifactDigests: ['a'.repeat(64)], lifetimeSeconds: 300 },
    },
  };
}

function createDependencies(overrides: Partial<UnifiedAgentPlanAuthorizationDependenciesV1> & { issueAuthorization?: (request: PolicyAuthorityAuthorizationRequestV1) => ReturnType<PolicyAuthorityServiceV1['issueAuthorization']> } = {}): UnifiedAgentPlanAuthorizationDependenciesV1 {
  const authority = createAuthority();
  const issueAuthorization = overrides.issueAuthorization ?? ((request) => authority.issueAuthorization(request));
  return {
    policyAuthority: { assertReady: () => undefined, issueAuthorization },
    grants: { validate: async () => ({ id: 'grant-1', tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'AGENT', allowedActions: ['filesystem.read'], status: 'active', expiresAt: '2026-08-08T00:10:00.000Z', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', allowedSecretRefs: [], allowedArtifactRefs: [] }) },
    localPolicy: { resolve: async () => ({ policyVersion: 'gcac.agent-security/v1', agentId: 'agent-1', authorityKeyIds: ['authority-key-1'], allowedActions: ['filesystem.read'], pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read'] }], serviceRules: ['service-1'], commandRules: [], disabled: false, updatedAt: '2026-08-08T00:00:00.000Z' } satisfies AgentLocalPolicyV1) },
    ...overrides,
  };
}

function createAuthority(): PolicyAuthorityServiceV1 {
  const root = generateKeyPairSync('ed25519');
  const signer = generateKeyPairSync('ed25519');
  const trustRoot: PolicyAuthorityTrustRootV1 = {
    rootKeyId: 'root-key-1', authorityId: 'policy-authority-1', algorithm: 'Ed25519', publicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    fingerprintSha256: createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
  };
  const keySet: PolicyAuthorityKeySetV1 = {
    keySetVersion: 'gcac.agent-security/v1', authorityId: 'policy-authority-1', activeKeyId: 'authority-key-1', issuedAt: '2026-08-07T00:00:00.000Z',
    keys: [{ keyId: 'authority-key-1', algorithm: 'Ed25519', publicKeyPem: signer.publicKey.export({ type: 'spki', format: 'pem' }).toString(), status: 'ACTIVE', notBefore: '2026-08-07T00:00:00.000Z', notAfter: '2026-08-09T00:00:00.000Z' }],
  };
  const envelopeValue: Omit<SignedPolicyAuthorityKeySetV1, 'signature'> = { envelopeVersion: 'gcac.agent-security/v1', rootKeyId: trustRoot.rootKeyId, authorityId: trustRoot.authorityId, keySet };
  const envelope: SignedPolicyAuthorityKeySetV1 = { ...envelopeValue, signature: signPolicyPayload(envelopeValue, root.privateKey) };
  const signingKeys = { getPrivateKey: (keyId: string) => keyId === 'authority-key-1' ? signer.privateKey : undefined };
  const requestEvaluator = { evaluate: (request: PolicyAuthorityAuthorizationRequestV1 & { issuedAt: string; validUntil: string }) => ({ allowed: true, actions: request.actions, allowedPaths: request.allowedPaths, allowedServices: request.allowedServices, artifactDigests: request.artifactDigests, policyRef: request.policyRef, policyVersion: request.policyVersion }) };
  return new PolicyAuthorityServiceV1({ trustRoot, keySet: envelope, signingKeySource: signingKeys, evaluator: requestEvaluator, revocations: new InMemoryPolicyAuthorityRevocationStoreV1(), nonceStore: new NonceStoreV1(), now: () => '2026-08-08T00:01:00.000Z' });
}
