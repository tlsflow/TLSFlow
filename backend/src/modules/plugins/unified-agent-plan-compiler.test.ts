import { generateKeyPairSync, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import { computeAgentPlanDigest, NonceStoreV1, signPolicyPayload, type AgentLocalPolicyV1, type AgentPlanV1, type PolicyAuthorityKeySetV1 } from '../agents/security/agent-security.contract.js';
import { InMemoryPolicyAuthorityRevocationStoreV1, PolicyAuthorityServiceV1, type PolicyAuthorityAuthorizationRequestV1, type PolicyAuthorityEvaluationV1, type PolicyAuthorityTrustRootV1, type SignedPolicyAuthorityKeySetV1 } from '../agents/security/policy-authority.service.js';
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

test('统一编译链自动调用 provisioning 并传递完整已编译 Plan', async () => {
  const plan = createPlan();
  const authority = createAuthority();
  let provisioningRequest: Record<string, unknown> | undefined;
  const dependencies = createDependencies({
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: (request) => authority.issueAuthorization(request),
      provisionAgentPlan: async (request) => {
        provisioningRequest = structuredClone(request) as unknown as Record<string, unknown>;
        return {
          localPolicyMaterial: {
            materialVersion: 'gcac.policy-authority-provisioning/v1',
            tenantId: plan.tenantId,
            agentId: plan.agentId,
            localPolicy: {
              policyVersion: 'gcac.agent-security/v1',
              agentId: plan.agentId,
              authorityKeyIds: ['authority-key-1'],
              allowedActions: ['filesystem.read'],
              pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read'] }],
              serviceRules: [],
              commandRules: [],
              disabled: false,
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
            authorityKeyId: 'authority-key-1',
            signature: 'signed-local-policy-material',
          },
        } as never;
      },
    },
  });

  const compiled = await new UnifiedAgentPlanCompilerService(pluginService(), dependencies).compile(compileInput(plan));

  assert.equal(provisioningRequest?.planDigest, plan.planDigest);
  assert.deepEqual(provisioningRequest?.compiledPlan, plan);
  assert.deepEqual(provisioningRequest?.actions, ['filesystem.read']);
  assert.deepEqual(provisioningRequest?.artifactDigests, ['a'.repeat(64)]);
  assert.deepEqual(provisioningRequest?.commandRules, []);
  assert.equal(compiled.localPolicyMaterial?.authorityKeyId, 'authority-key-1');
});

test('首次没有宿主 localPolicy 时自动生成能力上限候选并 provisioning', async () => {
  const plan = createPlan();
  const authority = createAuthority();
  let request: Record<string, unknown> | undefined;
  const dependencies = createDependencies({
    localPolicy: { resolve: async () => undefined },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: (value) => authority.issueAuthorization(value),
      provisionAgentPlan: async (value) => {
        request = structuredClone(value) as unknown as Record<string, unknown>;
        return {} as never;
      },
    },
  });
  const result = await new UnifiedAgentPlanCompilerService(pluginService(), dependencies).compile(compileInput(plan));
  assert.equal(result.diagnostics?.length, 1);
  assert.equal(request?.bootstrapLocalPolicy, true);
  assert.deepEqual((request?.currentLocalPolicy as { authorityKeyIds: string[] }).authorityKeyIds, ['bootstrap-pending']);
  assert.deepEqual((request?.currentLocalPolicy as { allowedActions: string[] }).allowedActions, ['filesystem.read']);
});

test('Agent v2 编译允许 Windows 路径分隔符在授权验证前后规范化', async () => {
  const plan = createPlan('C:/GCAC-Lab/config.json');
  const dependencies = createDependencies({}, { pathPrefix: 'C:/GCAC-Lab' });
  const compiled = await new UnifiedAgentPlanCompilerService(pluginService(), dependencies).compile(
    compileInput(plan, { pathPrefix: 'C:/GCAC-Lab' }),
  );

  assert.equal(compiled.plan.planDigest, plan.planDigest);
  assert.deepEqual(compiled.token.allowedPaths, ['C:\\GCAC-Lab']);
  assert.deepEqual(compiled.policyDecision.allowedPaths, ['C:\\GCAC-Lab']);
});

test('Policy Authority 拒绝且不签发 Token 时保留策略拒绝原因', async () => {
  const plan = createPlan();
  const authority = createAuthority({
    evaluate: (request) => ({
      allowed: false,
      actions: request.actions,
      allowedPaths: request.allowedPaths,
      allowedServices: request.allowedServices,
      artifactDigests: request.artifactDigests,
      policyRef: request.policyRef,
      policyVersion: request.policyVersion,
      reason: '本机执行策略未精确匹配当前请求范围',
    }),
  });
  const compiler = new UnifiedAgentPlanCompilerService(
    pluginService(),
    createDependencies({ issueAuthorization: (request) => authority.issueAuthorization(request) }),
  );

  await assert.rejects(
    compiler.compile(compileInput(plan)),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.errorCode, 'AGENT_AUTHORIZATION_UNAVAILABLE');
      assert.equal(error.message, 'Policy Authority 拒绝 Agent v2 生产授权');
      assert.equal((error.details as { reason?: string } | undefined)?.reason, '本机执行策略未精确匹配当前请求范围');
      assert.doesNotMatch(error.message, /安全合同无效/);
      return true;
    },
  );
});

test('缺少生产授权端口或 Grant 仍失败，本地策略缺失仅记录诊断并继续签发', async () => {
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
  const compiled = await new UnifiedAgentPlanCompilerService(pluginService(), missingPolicy).compile(base);
  assert.equal(compiled.diagnostics?.length, 1);
  assert.match(compiled.diagnostics?.[0] ?? '', /本地策略诊断失败/);
  assert.equal(issueCount, 1);
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

function createPlan(path = '/var/lib/gcac/config.json'): AgentPlanV1 {
  const plan = {
    planVersion: 'gcac.agent-security/v1', planId: 'plan-1', agentId: 'agent-1', tenantId: 'tenant-1', pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', capability: 'filesystem.read',
    operations: [{ operationId: 'op-1', operationType: 'filesystem.read', stage: 'prepare', input: { path }, dependsOn: [], idempotencyKey: 'idem-1', timeoutSeconds: 30 }],
    planDigest: '', tokenId: 'draft-token', policyDecisionId: 'draft-decision', nonce: 'draft-nonce', expiresAt: '2026-08-08T00:10:00.000Z', writeEffect: false,
  } as AgentPlanV1;
  plan.planDigest = computeAgentPlanDigest(plan);
  return plan;
}

function compileInput(plan: AgentPlanV1, options: { pathPrefix?: string } = {}) {
  const pathPrefix = options.pathPrefix ?? '/var/lib/gcac';
  return {
    tenantId: 'tenant-1', agentId: 'agent-1', executionRunId: 'run-1', executionStepId: 'step-1', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1',
    resolvedInput: {} as never,
    v2Request: {
      actionType: 'agent.plan.execute', plan,
      authorization: { grantId: 'grant-1', policyRef: 'policy-1', policyVersion: '1', actions: ['filesystem.read'], allowedPaths: [pathPrefix], allowedServices: ['service-1'], artifactDigests: ['a'.repeat(64)], lifetimeSeconds: 300 },
    },
  };
}

function createDependencies(overrides: Partial<UnifiedAgentPlanAuthorizationDependenciesV1> & { issueAuthorization?: (request: PolicyAuthorityAuthorizationRequestV1) => ReturnType<PolicyAuthorityServiceV1['issueAuthorization']> } = {}, options: { pathPrefix?: string } = {}): UnifiedAgentPlanAuthorizationDependenciesV1 {
  const authority = createAuthority();
  const issueAuthorization = overrides.issueAuthorization ?? ((request) => authority.issueAuthorization(request));
  const pathPrefix = options.pathPrefix ?? '/var/lib/gcac';
  return {
    policyAuthority: { assertReady: () => undefined, issueAuthorization },
    grants: { validate: async () => ({ id: 'grant-1', tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'AGENT', allowedActions: ['filesystem.read'], status: 'active', expiresAt: '2026-08-08T00:10:00.000Z', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', allowedSecretRefs: [], allowedArtifactRefs: [] }) },
    localPolicy: { resolve: async () => ({ policyVersion: 'gcac.agent-security/v1', agentId: 'agent-1', authorityKeyIds: ['authority-key-1'], allowedActions: ['filesystem.read'], pathRules: [{ prefix: pathPrefix, operations: ['filesystem.read'] }], serviceRules: ['service-1'], commandRules: [], disabled: false, updatedAt: '2026-08-08T00:00:00.000Z' } satisfies AgentLocalPolicyV1) },
    ...overrides,
  };
}

function createAuthority(
  evaluatorOverride?: { evaluate: (request: PolicyAuthorityAuthorizationRequestV1 & { issuedAt: string; validUntil: string }) => PolicyAuthorityEvaluationV1 },
): PolicyAuthorityServiceV1 {
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
  const requestEvaluator = evaluatorOverride ?? { evaluate: (request: PolicyAuthorityAuthorizationRequestV1 & { issuedAt: string; validUntil: string }) => ({ allowed: true, actions: request.actions, allowedPaths: request.allowedPaths, allowedServices: request.allowedServices, artifactDigests: request.artifactDigests, policyRef: request.policyRef, policyVersion: request.policyVersion }) };
  return new PolicyAuthorityServiceV1({ trustRoot, keySet: envelope, signingKeySource: signingKeys, evaluator: requestEvaluator, revocations: new InMemoryPolicyAuthorityRevocationStoreV1(), nonceStore: new NonceStoreV1(), now: () => '2026-08-08T00:01:00.000Z' });
}
