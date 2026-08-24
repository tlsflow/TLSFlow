import { createHash, createPublicKey } from 'node:crypto';

import { AppError } from '../../../common/errors/app-error.js';
import {
  validateAgentLocalPolicy,
  verifyPolicyPayload,
  type AgentLocalPolicyV1,
} from './agent-security.contract.js';
import type { UnifiedAgentPlanLocalPolicyPortV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';

const localPolicyBundleVersion = 'gcac.agent-local-policy/v1' as const;

interface AgentLocalPolicyBundleEntryV1 {
  tenantId: string;
  policy: AgentLocalPolicyV1;
}

export interface SignedAgentLocalPolicyBundleV1 {
  bundleVersion: typeof localPolicyBundleVersion;
  rootKeyId: string;
  policies: AgentLocalPolicyBundleEntryV1[];
  signature: string;
}

/**
 * 生产 Agent 本地策略来源。策略包和独立信任根均由部署环境显式提供，
 * 不读取 Agent 注册对象，不生成默认策略，也不在缺失时放行。
 */
export class ProductionAgentLocalPolicyAdapterV1 implements UnifiedAgentPlanLocalPolicyPortV1 {
  private readonly policies: readonly AgentLocalPolicyBundleEntryV1[];

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    const root = loadTrustRoot(environment);
    const bundle = loadBundle(environment, root);
    this.policies = bundle.policies.map((entry) => ({
      tenantId: entry.tenantId,
      policy: structuredClone(entry.policy),
    }));
  }

  async resolve(input: { agentId: string; tenantId: string }): Promise<AgentLocalPolicyV1> {
    const entry = this.policies.find((candidate) =>
      candidate.tenantId === input.tenantId && candidate.policy.agentId === input.agentId,
    );
    if (!entry) failClosed('生产 Agent 本地策略未匹配当前租户和 Agent');
    return structuredClone(entry.policy);
  }
}

export function createProductionAgentLocalPolicyAdapterV1(
  environment: NodeJS.ProcessEnv = process.env,
): UnifiedAgentPlanLocalPolicyPortV1 {
  return new ProductionAgentLocalPolicyAdapterV1(environment);
}

function loadTrustRoot(environment: NodeJS.ProcessEnv): { rootKeyId: string; publicKeyPem: string; fingerprintSha256: string } {
  const rootKeyId = requiredEnvironment(environment, 'GCAC_AGENT_LOCAL_POLICY_ROOT_KEY_ID');
  const publicKeyPem = requiredEnvironment(environment, 'GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM').replaceAll('\\n', '\n');
  const fingerprintSha256 = requiredEnvironment(environment, 'GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256');
  rejectDevelopmentIdentifier(rootKeyId, '本地策略信任根 keyId');
  if (!publicKeyPem.includes('BEGIN PUBLIC KEY')) failClosed('本地策略信任根必须是公钥 PEM');
  if (!/^[a-f0-9]{64}$/.test(fingerprintSha256)) failClosed('本地策略信任根指纹格式无效');
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') failClosed('本地策略信任根必须使用 Ed25519');
    const fingerprint = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (fingerprint !== fingerprintSha256) failClosed('本地策略信任根指纹不匹配');
  } catch (error) {
    if (error instanceof AppError) throw error;
    failClosed('本地策略信任根公钥无效');
  }
  return { rootKeyId, publicKeyPem, fingerprintSha256 };
}

function loadBundle(
  environment: NodeJS.ProcessEnv,
  root: { rootKeyId: string; publicKeyPem: string },
): SignedAgentLocalPolicyBundleV1 {
  const raw = requiredEnvironment(environment, 'GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failClosed('生产 Agent 本地策略包 JSON 无法解析');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) failClosed('生产 Agent 本地策略包必须是对象');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, ['bundleVersion', 'rootKeyId', 'policies', 'signature'], '生产 Agent 本地策略包');
  if (value.bundleVersion !== localPolicyBundleVersion
    || value.rootKeyId !== root.rootKeyId
    || !Array.isArray(value.policies)
    || value.policies.length === 0
    || value.policies.length > 1000
    || typeof value.signature !== 'string'
    || value.signature.trim() === '') {
    failClosed('生产 Agent 本地策略包字段不完整');
  }
  const policies = value.policies.map((entry, index) => validateEntry(entry, `生产 Agent 本地策略包.policies.${index}`));
  const identities = policies.map((entry) => `${entry.tenantId}:${entry.policy.agentId}`);
  if (new Set(identities).size !== identities.length) failClosed('生产 Agent 本地策略包包含重复租户和 Agent');
  const bundle = {
    bundleVersion: localPolicyBundleVersion,
    rootKeyId: root.rootKeyId,
    policies,
    signature: value.signature,
  } satisfies SignedAgentLocalPolicyBundleV1;
  if (!verifyPolicyPayload(bundle, bundle.signature, root.publicKeyPem)) failClosed('生产 Agent 本地策略包签名无效');
  return bundle;
}

function validateEntry(input: unknown, path: string): AgentLocalPolicyBundleEntryV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed(`${path} 必须是对象`);
  const value = input as Record<string, unknown>;
  exactKeys(value, ['tenantId', 'policy'], path);
  const tenantId = requireIdentifier(value.tenantId, `${path}.tenantId`);
  const policy = validateAgentLocalPolicy(value.policy);
  return { tenantId, policy };
}

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) failClosed(`${path} 包含未知字段`);
}

function requireIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) failClosed(`${path} 标识符无效`);
  rejectDevelopmentIdentifier(value, path);
  return value;
}

function rejectDevelopmentIdentifier(value: string, path: string): void {
  const normalized = value.toLowerCase();
  if (normalized.includes('default') || normalized.includes('development') || normalized.includes('dev-key')) {
    failClosed(`${path} 禁止使用开发默认标识`);
  }
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value?.trim()) failClosed(`缺少生产配置 ${name}`);
  return value;
}

function failClosed(message: string): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `Agent 本地策略已失败关闭：${message}`, { fallback: false });
}
