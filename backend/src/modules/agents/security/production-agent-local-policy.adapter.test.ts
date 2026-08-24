import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { AppError } from '../../../common/errors/app-error.js';
import { signPolicyPayload, type AgentLocalPolicyV1 } from './agent-security.contract.js';
import {
  ProductionAgentLocalPolicyAdapterV1,
  type SignedAgentLocalPolicyBundleV1,
} from './production-agent-local-policy.adapter.js';

test('生产 localPolicy 缺少策略或独立信任根时失败关闭', () => {
  assert.throws(
    () => new ProductionAgentLocalPolicyAdapterV1({ NODE_ENV: 'production' }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE'
      && /失败关闭/.test(error.message),
  );

  const environment = createEnvironment();
  delete environment.GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON;
  assert.throws(() => new ProductionAgentLocalPolicyAdapterV1(environment), /失败关闭/);
});

test('生产 localPolicy 只接受独立信任根签发的策略包', async () => {
  const context = createContext();
  const environment = createEnvironment(context);
  assert.deepEqual(
    await awaitResolve(environment, 'tenant-1', 'agent-1'),
    context.policy,
  );

  const badSignature = { ...environment, GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON: JSON.stringify({
    ...context.bundle,
    signature: `${context.bundle.signature}tampered`,
  }) };
  assert.throws(() => new ProductionAgentLocalPolicyAdapterV1(badSignature), /失败关闭/);

  const wrongFingerprint = { ...environment, GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256: '0'.repeat(64) };
  assert.throws(() => new ProductionAgentLocalPolicyAdapterV1(wrongFingerprint), /失败关闭/);
});

test('生产 localPolicy 信任根必须是 Ed25519，不能用其他算法替代', () => {
  const context = createContext();
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const unsigned = { ...context.bundle, signature: undefined };
  delete unsigned.signature;
  const bundle = { ...unsigned, signature: signPolicyPayload(unsigned, rsa.privateKey) };
  const environment = createEnvironment(context);
  environment.GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM = publicKeyPem;
  environment.GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256 = createHash('sha256')
    .update(rsa.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  environment.GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON = JSON.stringify(bundle);
  assert.throws(() => new ProductionAgentLocalPolicyAdapterV1(environment), /Ed25519/);
});

test('生产 localPolicy 不从宿主对象猜测，未知租户或 Agent 失败关闭', async () => {
  const context = createContext();
  const adapter = new ProductionAgentLocalPolicyAdapterV1(createEnvironment(context));
  await assert.rejects(
    adapter.resolve({ tenantId: 'tenant-unknown', agentId: 'agent-unknown' }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
  const resolved = await adapter.resolve({ tenantId: 'tenant-1', agentId: 'agent-1' });
  resolved.allowedActions.push('agent.unapproved');
  assert.deepEqual(await adapter.resolve({ tenantId: 'tenant-1', agentId: 'agent-1' }), context.policy);
});

function awaitResolve(environment: NodeJS.ProcessEnv, tenantId: string, agentId: string): Promise<AgentLocalPolicyV1> {
  return new ProductionAgentLocalPolicyAdapterV1(environment).resolve({ tenantId, agentId });
}

function createContext(): {
  policy: AgentLocalPolicyV1;
  bundle: SignedAgentLocalPolicyBundleV1;
  publicKeyPem: string;
  fingerprintSha256: string;
} {
  const root = generateKeyPairSync('ed25519');
  const publicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprintSha256 = createHash('sha256')
    .update(root.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  const policy: AgentLocalPolicyV1 = {
    policyVersion: 'gcac.agent-security/v1',
    agentId: 'agent-1',
    authorityKeyIds: ['authority-key-1'],
    allowedActions: ['filesystem.read'],
    pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read'] }],
    serviceRules: [],
    commandRules: [],
    disabled: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const unsigned = {
    bundleVersion: 'gcac.agent-local-policy/v1' as const,
    rootKeyId: 'local-policy-root-1',
    policies: [{ tenantId: 'tenant-1', policy }],
  };
  const bundle = { ...unsigned, signature: signPolicyPayload(unsigned, root.privateKey) };
  return { policy, bundle, publicKeyPem, fingerprintSha256 };
}

function createEnvironment(context = createContext()): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GCAC_AGENT_LOCAL_POLICY_ROOT_KEY_ID: context.bundle.rootKeyId,
    GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM: context.publicKeyPem,
    GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256: context.fingerprintSha256,
    GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON: JSON.stringify(context.bundle),
  };
}
