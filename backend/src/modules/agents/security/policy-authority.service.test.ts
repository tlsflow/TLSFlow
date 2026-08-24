import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import {
  agentSecurityContractVersion,
  computeAgentPlanDigest,
  NonceStoreV1,
  signPolicyPayload,
  type AgentLocalPolicyV1,
  type AgentPlanV1,
  type PolicyAuthorityKeySetV1,
} from './agent-security.contract.js';
import {
  InMemoryPolicyAuthorityRevocationStoreV1,
  createProductionPolicyAuthorityServicesV1,
  isProductionPolicyAuthorityServicesV1,
  PolicyAuthorityServiceV1,
  requireProductionPolicyAuthorityServicesV1,
  type PolicyAuthorityAuthorizationRequestV1,
  type PolicyAuthorityTrustRootV1,
  type SignedPolicyAuthorityKeySetV1,
} from './policy-authority.service.js';

const fixtureRoot = resolve(process.cwd(), 'src/modules/agents/security/fixtures');
const validFixture = readJson(resolve(fixtureRoot, 'agent-security.valid.json')) as { contracts: Record<string, unknown> };
const serviceSchema = readJson(resolve(process.cwd(), 'src/modules/agents/security/schemas/policy-authority-service-v1.schema.json')) as JsonSchema;
const now = '2026-08-08T00:05:00.000Z';

test('生产服务验证独立信任根并签发绑定的 Decision 和 Token', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  assert.ok(result.token);
  assert.equal(result.decision.allowed, true);
  assert.equal(result.token?.authorityKeyId, 'authority-key-1');
  assert.equal(result.token?.tenantId, context.request.tenantId);
  assert.equal(result.token?.planDigest, context.request.planDigest);
  assert.doesNotThrow(() => context.service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: context.localPolicy }));
});

test('Token 与 Decision 的授权范围不能互相扩大', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  const decisionValue = { ...result.decision, actions: ['filesystem.stat'] };
  const decision = { ...decisionValue, signature: signPolicyPayload(decisionValue, context.signingKeySource.keys.get('authority-key-1')!) };
  const plan = createPlan(result);
  const localPolicy = { ...context.localPolicy, allowedActions: ['filesystem.read', 'filesystem.stat'], pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read', 'filesystem.stat'] }] };
  assert.throws(() => context.service.authorize({ plan, token: result.token, decision, localPolicy }), /同时授权/);
});

test('生产缺少根、KeySet、签名私钥或撤销状态时失败关闭', () => {
  const context = createContext();
  assert.throws(() => createProductionPolicyAuthorityServicesV1({}), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, signingKeySource: { getPrivateKey: () => undefined } }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, revocations: undefined as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, signature: 'tampered' } }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, unexpected: true } as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, keySet: { ...context.keySet, authorityId: 'other-authority' } } }), /authorityId/);
});

test('生产注册资源必须来自生产工厂，合同或内存替身不得冒充', () => {
  const context = createContext();
  assert.equal(isProductionPolicyAuthorityServicesV1(context), false);
  assert.throws(() => requireProductionPolicyAuthorityServicesV1(context), /失败关闭/);

  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    assert.equal(isProductionPolicyAuthorityServicesV1(production), true);
    assert.doesNotThrow(() => requireProductionPolicyAuthorityServicesV1(production));
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('Policy Authority signing key 必须与独立信任根分离', () => {
  const context = createContext();
  const rootPublicKey = createPublicKey(context.rootPrivateKey);
  const sameIdKey = createPolicyKey(context.trustRoot.rootKeyId, rootPublicKey, 'ACTIVE');
  const sameIdEnvelope = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: sameIdKey.keyId, keys: [sameIdKey] });
  assert.throws(() => new PolicyAuthorityServiceV1({
    ...context.options,
    keySet: sameIdEnvelope,
    signingKeySource: { getPrivateKey: () => context.rootPrivateKey },
  }), /独立/);

  const samePublicKey = createPolicyKey('authority-key-2', rootPublicKey, 'ACTIVE');
  const samePublicEnvelope = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: samePublicKey.keyId, keys: [samePublicKey] });
  assert.throws(() => new PolicyAuthorityServiceV1({
    ...context.options,
    keySet: samePublicEnvelope,
    signingKeySource: { getPrivateKey: () => context.rootPrivateKey },
  }), /独立/);
});

test('生产 KeySet 或签名密钥配置缺失时装配失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    delete environment.GCAC_POLICY_AUTHORITY_KEYSET_JSON;
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /失败关闭/);
    const invalidKeys = { ...createProductionEnvironment(context), GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: '{}' };
    try {
      assert.throws(() => createProductionPolicyAuthorityServicesV1(invalidKeys), /失败关闭/);
    } finally {
      cleanupProductionEnvironment(invalidKeys);
    }
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产状态或 Agent 本地策略缺失时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const missingState = { ...environment };
    delete missingState.GCAC_POLICY_AUTHORITY_STATE_FILE;
    assert.throws(() => createProductionPolicyAuthorityServicesV1(missingState), /失败关闭/);

    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    assert.throws(() => production.service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: undefined }), /失败关闭|必须是对象/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产装配使用真实签名策略包、持久撤销状态和一次性 Nonce', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    assert.ok(result.token);
    const plan = createPlan(result);
    assert.doesNotThrow(() => production.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }));
    assert.throws(() => production.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);

    const second = production.service.issueAuthorization(context.request);
    production.service.revokeToken(second.token, '生产撤销测试');
    assert.throws(() => production.service.authorize({ plan: createPlan(second), token: second.token, decision: second.decision, localPolicy: context.localPolicy }), /失败关闭/);

    const third = production.service.issueAuthorization(context.request);
    production.service.revokeDecision(third.decision, '生产决策撤销测试');
    assert.throws(() => production.service.authorize({ plan: createPlan(third), token: third.token, decision: third.decision, localPolicy: context.localPolicy }), /失败关闭/);

    const restarted = createProductionPolicyAuthorityServicesV1(environment);
    assert.throws(() => restarted.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('Key rotation 使用新 ACTIVE key，旧 key 在撤销后立即失败', () => {
  const context = createContext();
  const oldResult = context.service.issueAuthorization(context.request);
  const next = generateKeyPairSync('ed25519');
  const nextKey = createPolicyKey('authority-key-2', next.publicKey, 'ACTIVE');
  const rotated = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: nextKey.keyId, keys: [context.keySet.keys[0]!, nextKey] });
  context.signingKeySource.keys.set(nextKey.keyId, next.privateKey);
  context.service.refreshKeySet(rotated);
  const nextResult = context.service.issueAuthorization(context.request);
  assert.equal(nextResult.token?.authorityKeyId, 'authority-key-2');
  const revokedOld = createEnvelope(context.rootPrivateKey, { ...rotated.keySet, keys: rotated.keySet.keys.map((key) => key.keyId === 'authority-key-1' ? { ...key, status: 'REVOKED' as const } : key) });
  context.service.refreshKeySet(revokedOld);
  assert.throws(() => context.service.authorize({ plan: createPlan(oldResult), token: oldResult.token, decision: oldResult.decision, localPolicy: context.localPolicy }), /失败关闭/);
});

test('撤销、过期和 Nonce 重放均不可绕过', () => {
  let currentNow = now;
  const context = createContext(() => currentNow);
  const result = context.service.issueAuthorization(context.request);
  const plan = createPlan(result);
  context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy });
  assert.throws(() => context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);

  const second = context.service.issueAuthorization(context.request);
  context.service.revokeToken(second.token, 'incident response');
  assert.throws(() => context.service.authorize({ plan: createPlan(second), token: second.token, decision: second.decision, localPolicy: context.localPolicy }), /失败关闭/);

  currentNow = '2026-08-08T00:05:30.000Z';
  const third = context.service.issueAuthorization(context.request);
  currentNow = '2026-08-08T00:20:01.000Z';
  assert.throws(() => context.service.authorize({ plan: createPlan(third), token: third.token, decision: third.decision, localPolicy: context.localPolicy }), /过期|生效/);
});

test('Policy Authority Decision 撤销与 Token 撤销同样立即阻断授权', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  const plan = createPlan(result);
  context.service.revokeDecision(result.decision, 'decision incident response');
  assert.throws(
    () => context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }),
    /决策已被撤销/,
  );
});

test('Nonce 存储异常不会降级为执行允许', () => {
  const context = createContext();
  const failingNonceStore = { consume() { throw new Error('persistent nonce store unavailable'); } };
  const service = new PolicyAuthorityServiceV1({ ...context.options, nonceStore: failingNonceStore });
  const result = service.issueAuthorization(context.request);
  assert.throws(() => service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /失败关闭/);
});

test('Policy Authority 服务 Schema 拒绝缺少独立根绑定的 KeySet Envelope', () => {
  const context = createContext();
  const rootSchema = { $defs: (serviceSchema as JsonSchema & { $defs: Record<string, JsonSchema> }).$defs, $ref: '#/$defs/trustRoot' };
  const envelopeSchema = { $defs: (serviceSchema as JsonSchema & { $defs: Record<string, JsonSchema> }).$defs, $ref: '#/$defs/keySetEnvelope' };
  assert.equal(validateJsonSchema(context.trustRoot, rootSchema).valid, true);
  assert.equal(validateJsonSchema(context.envelope, envelopeSchema).valid, true);
  assert.equal(validateJsonSchema({ ...context.envelope, rootKeyId: undefined }, envelopeSchema).valid, false);
  assert.equal(validateJsonSchema({ ...context.envelope, unexpected: true }, envelopeSchema).valid, false);
});

test('生产签名策略规则结构不完整时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const policy = JSON.parse(environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON!) as Record<string, unknown>;
    const unsigned = { ...policy, rules: [{ ...(policy.rules as Array<Record<string, unknown>>)[0], allowedPaths: ['relative/path'] }] };
    environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON = JSON.stringify({ ...unsigned, signature: signPolicyPayload(unsigned, context.rootPrivateKey) });
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /非法路径/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产撤销状态缺少 Decision 撤销集合时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    writeFileSync(environment.GCAC_POLICY_AUTHORITY_STATE_FILE!, JSON.stringify({
      stateVersion: 'gcac.policy-authority-state/v1',
      revokedTokenIds: [],
      revokedKeyIds: [],
      nonces: [],
    }));
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /状态格式无效/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

function createContext(nowFactory: () => string = () => now) {
  const root = generateKeyPairSync('ed25519');
  const signer = generateKeyPairSync('ed25519');
  const keySet: PolicyAuthorityKeySetV1 = {
    keySetVersion: agentSecurityContractVersion,
    authorityId: 'policy-authority-1',
    activeKeyId: 'authority-key-1',
    keys: [createPolicyKey('authority-key-1', signer.publicKey, 'ACTIVE')],
    issuedAt: '2026-08-07T00:00:00.000Z',
  };
  const trustRoot = createTrustRoot(root.publicKey);
  const envelope = createEnvelope(root.privateKey, keySet);
  const signingKeySource = { keys: new Map<string, KeyObject | string>([['authority-key-1', signer.privateKey]]), getPrivateKey(keyId: string) { return this.keys.get(keyId); } };
  const revocations = new InMemoryPolicyAuthorityRevocationStoreV1();
  const evaluator = { evaluate(input: PolicyAuthorityAuthorizationRequestV1 & { issuedAt: string; validUntil: string }) { return { allowed: true, actions: input.actions, allowedPaths: input.allowedPaths, allowedServices: input.allowedServices, artifactDigests: input.artifactDigests, policyRef: input.policyRef, policyVersion: input.policyVersion }; } };
  const fixturePlan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  const request: PolicyAuthorityAuthorizationRequestV1 = { agentId: 'agent-1', tenantId: 'tenant-1', pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', capability: 'filesystem.read', actions: ['filesystem.read'], allowedPaths: ['/var/lib/gcac'], allowedServices: [], artifactDigests: ['a'.repeat(64)], policyRef: 'policy-1', policyVersion: '1', planDigest: computeAgentPlanDigest(fixturePlan), lifetimeSeconds: 300 };
  const localPolicy = { ...(structuredClone(validFixture.contracts.AgentLocalPolicyV1) as AgentLocalPolicyV1), authorityKeyIds: ['authority-key-1', 'authority-key-2'] };
  const options = { trustRoot, keySet: envelope, signingKeySource, evaluator, revocations, nonceStore: new NonceStoreV1(), now: nowFactory };
  return { rootPrivateKey: root.privateKey, trustRoot, envelope, keySet, signingKeySource, evaluator, revocations, request, localPolicy, options, service: new PolicyAuthorityServiceV1(options) };
}

function createProductionEnvironment(context: ReturnType<typeof createContext>): NodeJS.ProcessEnv {
  const signingKey = context.signingKeySource.keys.get('authority-key-1');
  if (!signingKey || typeof signingKey === 'string') throw new Error('测试上下文缺少签名私钥');
  const productionKeySet: PolicyAuthorityKeySetV1 = {
    ...context.keySet,
    keys: context.keySet.keys.map((key) => ({ ...key, notAfter: '2099-01-01T00:00:00.000Z' })),
  };
  const productionEnvelope = createEnvelope(context.rootPrivateKey, productionKeySet);
  const stateDir = mkdtempSync(join(tmpdir(), 'gcac-policy-authority-'));
  const stateFile = join(stateDir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ stateVersion: 'gcac.policy-authority-state/v1', revokedTokenIds: [], revokedDecisionIds: [], revokedKeyIds: [], nonces: [] }));
  const policyValue = {
    bundleVersion: 'gcac.policy-authority/v1',
    authorityId: context.trustRoot.authorityId,
    issuedAt: '2026-08-07T00:00:00.000Z',
    rules: [{
      policyRef: context.request.policyRef,
      policyVersion: context.request.policyVersion,
      agentId: context.request.agentId,
      tenantId: context.request.tenantId,
      pluginId: context.request.pluginId,
      pluginVersionId: context.request.pluginVersionId,
      capability: context.request.capability,
      actions: context.request.actions,
      allowedPaths: context.request.allowedPaths,
      allowedServices: context.request.allowedServices,
      artifactDigests: context.request.artifactDigests,
    }],
  };
  const policy = { ...policyValue, signature: signPolicyPayload(policyValue, context.rootPrivateKey) };
  return {
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'standalone',
    GCAC_POLICY_AUTHORITY_ROOT_KEY_ID: context.trustRoot.rootKeyId,
    GCAC_POLICY_AUTHORITY_ID: context.trustRoot.authorityId,
    GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM: context.trustRoot.publicKeyPem,
    GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256: context.trustRoot.fingerprintSha256,
    GCAC_POLICY_AUTHORITY_KEYSET_JSON: JSON.stringify(productionEnvelope),
    GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON: JSON.stringify(policy),
    GCAC_POLICY_AUTHORITY_STATE_FILE: stateFile,
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: JSON.stringify({
      'authority-key-1': signingKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
  };
}

function cleanupProductionEnvironment(environment: NodeJS.ProcessEnv): void {
  const stateFile = environment.GCAC_POLICY_AUTHORITY_STATE_FILE;
  if (stateFile) rmSync(resolve(stateFile, '..'), { recursive: true, force: true });
}

function createPlan(result: { token?: { tokenId: string; nonce: string; expiresAt: string }; decision: { decisionId: string } }): AgentPlanV1 {
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  plan.tokenId = result.token!.tokenId;
  plan.nonce = result.token!.nonce;
  plan.expiresAt = result.token!.expiresAt;
  plan.policyDecisionId = result.decision.decisionId;
  plan.planDigest = computeAgentPlanDigest(plan);
  return plan;
}

function createTrustRoot(publicKey: KeyObject): PolicyAuthorityTrustRootV1 {
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { rootKeyId: 'root-key-1', authorityId: 'policy-authority-1', algorithm: 'Ed25519', publicKeyPem, fingerprintSha256: publicKeyFingerprint(publicKeyPem) };
}

function createPolicyKey(keyId: string, publicKey: KeyObject, status: 'ACTIVE' | 'REVOKED') {
  return { keyId, algorithm: 'Ed25519' as const, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status, notBefore: '2026-08-07T00:00:00.000Z', notAfter: '2026-08-09T00:00:00.000Z' };
}

function createEnvelope(rootPrivateKey: KeyObject, keySet: PolicyAuthorityKeySetV1): SignedPolicyAuthorityKeySetV1 {
  const value = { envelopeVersion: agentSecurityContractVersion, rootKeyId: 'root-key-1', authorityId: keySet.authorityId, keySet };
  return { ...value, signature: signPolicyPayload(value, rootPrivateKey) };
}

function publicKeyFingerprint(publicKeyPem: string): string { return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex'); }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')) as unknown; }
