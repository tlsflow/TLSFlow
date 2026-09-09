import { createPublicKey } from 'node:crypto';

import { AppError } from '../../../common/errors/app-error.js';
import {
  agentSecurityContractVersion,
  validateAgentLocalPolicy,
  verifyPolicyPayload,
} from './agent-security.contract.js';
import type { AgentTrustMaterialIssuer } from '../application/agents.application-service.js';
import {
  PolicyAuthorityServiceV1,
  type PolicyAuthorityAgentTrustMaterialRequestV1,
  type PolicyAuthorityAgentTrustMaterialV1,
} from './policy-authority.service.js';
import type { PolicyAuthorityProcessClientV1 } from './policy-authority-process.js';

type ProductionPolicyAuthority = PolicyAuthorityServiceV1 | PolicyAuthorityProcessClientV1;

/**
 * 生产 Agent 注册材料适配器。首次安装和重新注册均由 Policy Authority 自动签发，
 * 宿主只转发结构化身份请求，不读取或持有任何签名私钥。
 */
export class ProductionAgentTrustMaterialIssuerV1 implements AgentTrustMaterialIssuer {
  private trustedKeySet: Record<string, string>;

  constructor(
    private readonly policyAuthority: ProductionPolicyAuthority,
    initialKeySet: Record<string, string>,
  ) {
    if (Object.keys(initialKeySet).length === 0) failClosed('生产 Agent 注册缺少 Policy Authority 公钥集合');
    this.trustedKeySet = { ...initialKeySet };
  }

  getTrustedKeySet(): Record<string, string> {
    return { ...this.trustedKeySet };
  }

  async refreshTrustedKeySet(): Promise<void> {
    const keySet = this.policyAuthority instanceof PolicyAuthorityServiceV1
      ? this.policyAuthority.getTrustedKeySet()
      : await this.policyAuthority.getTrustedKeySet();
    const refreshed: Record<string, string> = {};
    if (keySet && typeof keySet === 'object' && Array.isArray((keySet as { keys?: unknown }).keys)) {
      for (const key of (keySet as { keys: Array<{ keyId: string; publicKeyPem: string; status: string }> }).keys) {
        if (key.status !== 'ACTIVE') continue;
        refreshed[key.keyId] = rawPublicKeyBase64(key.publicKeyPem);
      }
    } else if (keySet && typeof keySet === 'object' && !Array.isArray(keySet)) {
      // 进程版 Policy Authority 已在 IPC 客户端转换为 keyId -> raw Ed25519 公钥。
      for (const [keyId, publicKey] of Object.entries(keySet as Record<string, unknown>)) {
        if (typeof publicKey !== 'string' || publicKey.trim() === '') failClosed('Policy Authority KeySet 条目无效');
        const bytes = Buffer.from(publicKey, 'base64');
        if (bytes.length !== 32) failClosed('Policy Authority 公钥长度无效');
        refreshed[keyId] = publicKey;
      }
    }
    if (Object.keys(refreshed).length === 0) failClosed('Policy Authority 当前没有 ACTIVE 公钥');
    this.trustedKeySet = refreshed;
  }

  async issue(input: { tenantId: string; agentId: string; osType?: string }): Promise<unknown> {
    const request: PolicyAuthorityAgentTrustMaterialRequestV1 = {
      tenantId: input.tenantId,
      agentId: input.agentId,
      ...(input.osType === undefined ? {} : { osType: input.osType }),
    };
    const material = await issueFromAuthority(this.policyAuthority, request);
    validateMaterial(material);
    this.trustedKeySet = { ...material.capabilityKeySet };
    return material;
  }
}

export function createProductionAgentTrustMaterialIssuerV1(
  policyAuthority: ProductionPolicyAuthority,
  environment: NodeJS.ProcessEnv = process.env,
): AgentTrustMaterialIssuer {
  return new ProductionAgentTrustMaterialIssuerV1(policyAuthority, readInitialKeySet(environment));
}

async function issueFromAuthority(
  authority: ProductionPolicyAuthority,
  request: PolicyAuthorityAgentTrustMaterialRequestV1,
): Promise<PolicyAuthorityAgentTrustMaterialV1> {
  try {
    if (authority instanceof PolicyAuthorityServiceV1) {
      return authority.issueAgentTrustMaterial(request);
    }
    return await authority.issueAgentTrustMaterial(request);
  } catch (error) {
    if (error instanceof AppError) throw error;
    failClosed(`Policy Authority Agent 注册材料签发失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function readInitialKeySet(environment: NodeJS.ProcessEnv): Record<string, string> {
  const raw = environment.GCAC_POLICY_AUTHORITY_KEYSET_JSON?.trim();
  if (!raw) failClosed('生产 Agent 注册缺少 GCAC_POLICY_AUTHORITY_KEYSET_JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failClosed('生产 Policy Authority KeySet JSON 无法解析');
  }
  const keySet = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).keySet
    : undefined;
  if (!keySet || typeof keySet !== 'object' || Array.isArray(keySet)) failClosed('生产 Policy Authority KeySet 缺少 keySet');
  const keys = (keySet as Record<string, unknown>).keys;
  if (!Array.isArray(keys) || keys.length === 0) failClosed('生产 Policy Authority KeySet 没有有效公钥');
  const output: Record<string, string> = {};
  for (const item of keys) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) failClosed('生产 Policy Authority KeySet 条目无效');
    const value = item as Record<string, unknown>;
    if (typeof value.keyId !== 'string' || typeof value.publicKeyPem !== 'string' || value.status !== 'ACTIVE') {
      failClosed('生产 Policy Authority KeySet 条目字段无效');
    }
    try {
      const key = createPublicKey(value.publicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519') failClosed('生产 Policy Authority 公钥必须使用 Ed25519');
      output[value.keyId] = Buffer.from(key.export({ type: 'spki', format: 'der' })).subarray(-32).toString('base64');
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('生产 Policy Authority 公钥无效');
    }
  }
  return output;
}

function validateMaterial(material: PolicyAuthorityAgentTrustMaterialV1): void {
  if (!material || material.materialVersion !== agentSecurityContractVersion
    || typeof material.issuedAt !== 'string' || typeof material.validUntil !== 'string'
    || Date.parse(material.validUntil) <= Date.parse(material.issuedAt)
    || typeof material.localPolicyAuthorityKeyId !== 'string'
    || typeof material.localPolicySignature !== 'string') {
    failClosed('Policy Authority Agent 注册材料字段不完整');
  }
  const localPolicy = validateAgentLocalPolicy(material.localPolicy);
  const publicKey = material.capabilityKeySet[material.localPolicyAuthorityKeyId];
  if (!publicKey || !material.localPolicy.authorityKeyIds.includes(material.localPolicyAuthorityKeyId)) {
    failClosed('Policy Authority Agent 注册材料未绑定当前公钥');
  }
  if (!verifyPolicyPayload(localPolicy, material.localPolicySignature, rawPublicKeyPem(publicKey))) {
    failClosed('Policy Authority Agent 注册材料 localPolicy 签名无效');
  }
  if (JSON.stringify(material.capabilityKeySet) !== JSON.stringify(material.policyAuthorityKeySet)) {
    failClosed('Policy Authority Agent 注册材料 KeySet 不一致');
  }
}

function rawPublicKeyPem(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== 32) failClosed('Agent 注册公钥长度无效');
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    bytes,
  ]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString();
}

function rawPublicKeyBase64(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') failClosed('Policy Authority KeySet 必须使用 Ed25519');
  const der = Buffer.from(key.export({ type: 'spki', format: 'der' }));
  if (der.length < 32) failClosed('Policy Authority 公钥长度无效');
  return der.subarray(-32).toString('base64');
}

function failClosed(message: string): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `生产 Agent 信任材料已失败关闭：${message}`, { fallback: false });
}
