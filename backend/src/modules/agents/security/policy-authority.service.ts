import { createHash, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import { AppError } from '../../../common/errors/app-error.js';
import {
  agentSecurityContractVersion,
  authorizeAgentPlan,
  canonicalPluginIdPattern,
  maximumTokenLifetimeSeconds,
  sha256Digest,
  signPolicyPayload,
  verifyPolicyPayload,
  validateAgentCapabilityToken,
  validateAgentLocalPolicy,
  validateAgentPlan,
  validateDecisionRevocationRecord,
  validatePolicyAuthorityDecision,
  validatePolicyAuthorityKeySet,
  validateNonceConsumptionRecord,
  validateTokenRevocationRecord,
  type AgentCapabilityTokenV1,
  type AgentLocalCommandRuleV1,
  type AgentLocalPolicyV1,
  type AgentPlanV1,
  type DecisionRevocationRecordV1,
  type NonceConsumptionRecordV1,
  type NonceStoreV1Port,
  type PolicyAuthorityDecisionV1,
  type PolicyAuthorityKeySetV1,
  type TokenRevocationRecordV1,
} from './agent-security.contract.js';
import { CERTIFICATE_UPDATE_POLICY_REF, CERTIFICATE_UPDATE_POLICY_VERSION } from './policy-version.constants.js';
import { selectWebDiscoveryPaths } from '../agent-discovery-paths.js';

export interface PolicyAuthorityTrustRootV1 {
  rootKeyId: string;
  authorityId: string;
  algorithm: 'Ed25519';
  publicKeyPem: string;
  fingerprintSha256: string;
}

export const policyAuthorityBootstrapVersion = 'gcac.policy-authority-bootstrap/v1' as const;

/**
 * Agent 首次注册使用的 Bootstrap 材料。它只固定 Policy Authority 身份和根指纹，
 * 不包含高风险执行 Token，也不能替代后续 KeySet、审批和本地策略校验。
 */
export interface PolicyAuthorityBootstrapV1 {
  bootstrapVersion: typeof policyAuthorityBootstrapVersion;
  bootstrapId: string;
  authorityId: string;
  rootKeyId: string;
  rootFingerprintSha256: string;
  issuedAt: string;
  validUntil: string;
  signature: string;
}

export interface PolicyAuthorityBootstrapSourceV1 {
  load(trustRoot: PolicyAuthorityTrustRootV1, now?: string): PolicyAuthorityBootstrapV1;
}

export interface SignedPolicyAuthorityKeySetV1 {
  envelopeVersion: typeof agentSecurityContractVersion;
  rootKeyId: string;
  authorityId: string;
  keySet: PolicyAuthorityKeySetV1;
  signature: string;
}

export interface PolicyAuthorityKeySetSourceV1 {
  load(): SignedPolicyAuthorityKeySetV1;
}

export interface PolicyAuthoritySigningKeySourceV1 {
  getPrivateKey(keyId: string): KeyObject | string | undefined;
}

export interface PolicyAuthorityRevocationStoreV1 {
  isTokenRevoked(tokenId: string, authorityKeyId: string): boolean;
  isDecisionRevoked(decisionId: string, authorityKeyId: string): boolean;
  isKeyRevoked(authorityKeyId: string): boolean;
  revokeToken(record: TokenRevocationRecordV1): void;
  revokeDecision(record: DecisionRevocationRecordV1): void;
  revokeKey(authorityKeyId: string): void;
}

/**
 * 生产状态存储必须在同一把锁内完成撤销检查和 Nonce 消费，避免撤销与授权之间出现竞态窗口。
 */
export interface AtomicPolicyAuthorityStateStoreV1 extends PolicyAuthorityRevocationStoreV1, NonceStoreV1Port {
  consumeAuthorization(
    record: NonceConsumptionRecordV1,
    authorityKeyId: string,
    tokenId: string,
    decisionId: string,
  ): NonceConsumptionRecordV1;
}

export interface PolicyAuthorityEvaluationInputV1 {
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  policyRef: string;
  policyVersion: string;
  planDigest: string;
  approvalRef?: string;
  issuedAt: string;
  validUntil: string;
}

export interface PolicyAuthorityEvaluationV1 {
  allowed: boolean;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  policyRef: string;
  policyVersion: string;
  reason?: string;
}

export interface PolicyAuthorityEvaluatorV1 {
  evaluate(input: PolicyAuthorityEvaluationInputV1): PolicyAuthorityEvaluationV1;
}

export const policyAuthorityPolicyBundleVersion = 'gcac.policy-authority/v1' as const;
export const policyAuthorityStateVersion = 'gcac.policy-authority-state/v1' as const;

export interface PolicyAuthorityPolicyRuleV1 {
  policyRef: string;
  policyVersion: string;
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  /** 生产动态规则必须精确绑定已编译 Agent Plan；历史静态策略可省略以保持读取兼容。 */
  planDigest?: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  /** 动态命令白名单只保存在 Policy Authority 规则，不投影到本地策略摘要。 */
  commandRules?: AgentLocalCommandRuleV1[];
  approvalRef?: string;
  validUntil?: string;
}

export interface SignedPolicyAuthorityPolicyBundleV1 {
  bundleVersion: typeof policyAuthorityPolicyBundleVersion;
  authorityId: string;
  issuedAt: string;
  rules: PolicyAuthorityPolicyRuleV1[];
  signature: string;
}

export const policyAuthorityProvisioningVersion = 'gcac.policy-authority-provisioning/v1' as const;
export const policyAuthorityProvisioningReceiptVersion = 'gcac.policy-authority-provisioning-receipt/v1' as const;

/** 已编译 Agent Plan 的正式 provisioning 输入。插件 runtime 不得自行拼装此对象。 */
export interface PolicyAuthorityProvisioningRequestV1 {
  tenantId: string;
  agentId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  planDigest: string;
  policyRef: string;
  policyVersion: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  commandRules: AgentLocalCommandRuleV1[];
  artifactDigests: string[];
  approvalRef?: string;
  lifetimeSeconds: number;
  /** Agent 当前稳定能力上限；其中不得出现 Artifact 摘要。 */
  currentLocalPolicy: AgentLocalPolicyV1;
  /** 首次自动装配时由统一编译链生成的能力上限候选。 */
  bootstrapLocalPolicy?: boolean;
  /** provisioning 只能接收完整已编译计划，禁止插件 runtime 自行拼装授权字段。 */
  compiledPlan: AgentPlanV1;
}

export interface SignedPolicyAuthorityProvisioningRuleV1 extends PolicyAuthorityPolicyRuleV1 {
  provisioningVersion: typeof policyAuthorityProvisioningVersion;
  authorityKeyId: string;
  issuedAt: string;
  validUntil: string;
  signature: string;
}

export interface SignedAgentLocalPolicyMaterialV1 {
  materialVersion: typeof policyAuthorityProvisioningVersion;
  tenantId: string;
  agentId: string;
  localPolicy: AgentLocalPolicyV1;
  authorityKeyId: string;
  signature: string;
}

export interface PolicyAuthorityProvisioningReceiptV1 {
  receiptVersion: typeof policyAuthorityProvisioningReceiptVersion;
  revision: string;
  requestDigest: string;
  ruleDigest: string;
  localPolicyDigest: string;
  issuedAt: string;
  signature: string;
}

export interface PolicyAuthorityProvisioningResultV1 {
  provisioningVersion: typeof policyAuthorityProvisioningVersion;
  revision: string;
  requestDigest: string;
  rule: SignedPolicyAuthorityProvisioningRuleV1;
  localPolicyMaterial: SignedAgentLocalPolicyMaterialV1;
  receipt: PolicyAuthorityProvisioningReceiptV1;
}

/**
 * Agent 首次注册所需的基础信任材料。它只包含稳定的发现能力上限，
 * 不包含任何证书 Artifact 或动态执行范围；由 Policy Authority 进程签发。
 */
export interface PolicyAuthorityAgentTrustMaterialRequestV1 {
  tenantId: string;
  agentId: string;
  osType?: string;
}

export interface PolicyAuthorityAgentTrustMaterialV1 {
  materialVersion: typeof agentSecurityContractVersion;
  issuedAt: string;
  validUntil: string;
  capabilityKeySet: Record<string, string>;
  policyAuthorityKeySet: Record<string, string>;
  localPolicy: AgentLocalPolicyV1;
  localPolicyAuthorityKeyId: string;
  localPolicySignature: string;
}

export interface PolicyAuthorityProvisioningStoreV1 {
  find(requestDigest: string): PolicyAuthorityProvisioningResultV1 | undefined;
  findMatching(input: Pick<PolicyAuthorityProvisioningRequestV1, 'tenantId' | 'agentId' | 'pluginId' | 'pluginVersionId' | 'capability' | 'policyRef' | 'policyVersion' | 'planDigest'>): PolicyAuthorityProvisioningResultV1 | undefined;
  commit(result: PolicyAuthorityProvisioningResultV1): void;
}

/** 单进程测试和受控管理入口使用的原子 provisioning 存储。 */
export class InMemoryPolicyAuthorityProvisioningStoreV1 implements PolicyAuthorityProvisioningStoreV1 {
  private readonly records = new Map<string, PolicyAuthorityProvisioningResultV1>();

  find(requestDigest: string): PolicyAuthorityProvisioningResultV1 | undefined {
    const value = this.records.get(requestDigest);
    return value ? structuredClone(value) : undefined;
  }

  findMatching(input: Pick<PolicyAuthorityProvisioningRequestV1, 'tenantId' | 'agentId' | 'pluginId' | 'pluginVersionId' | 'capability' | 'policyRef' | 'policyVersion' | 'planDigest'>): PolicyAuthorityProvisioningResultV1 | undefined {
    let identityMatch: PolicyAuthorityProvisioningResultV1 | undefined;
    for (const value of this.records.values()) {
      const rule = value.rule;
      if (rule.tenantId === input.tenantId && rule.agentId === input.agentId && rule.pluginId === input.pluginId
        && rule.pluginVersionId === input.pluginVersionId && rule.capability === input.capability
        && rule.policyRef === input.policyRef && rule.policyVersion === input.policyVersion) {
        identityMatch ??= value;
        if (rule.planDigest === input.planDigest) return structuredClone(value);
      }
    }
    return identityMatch ? structuredClone(identityMatch) : undefined;
  }

  commit(result: PolicyAuthorityProvisioningResultV1): void {
    const existing = this.records.get(result.requestDigest);
    if (existing && sha256Digest(existing) !== sha256Digest(result)) failClosed('重复 provisioning 输入产生了不同结果');
    this.records.set(result.requestDigest, structuredClone(result));
  }
}

/** 生产 Policy Authority 使用的单文件原子存储；不写 execution-policy.json，也不写 Agent 文件。 */
export class FilePolicyAuthorityProvisioningStoreV1 implements PolicyAuthorityProvisioningStoreV1 {
  private readonly records: Map<string, PolicyAuthorityProvisioningResultV1>;

  constructor(private readonly filePath: string) {
    if (!isAbsolute(filePath)) failClosed('Policy Authority provisioning 存储必须使用绝对路径');
    this.records = new Map();
    if (!existsSync(filePath)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(filePath, 'utf8')); } catch { failClosed('Policy Authority provisioning 存储无法读取'); }
    if (!Array.isArray(parsed)) failClosed('Policy Authority provisioning 存储必须是数组');
    for (const item of parsed) {
      const result = validatePolicyAuthorityProvisioningResultV1(item);
      this.records.set(result.requestDigest, result);
    }
  }

  find(requestDigest: string): PolicyAuthorityProvisioningResultV1 | undefined {
    const value = this.records.get(requestDigest);
    return value ? structuredClone(value) : undefined;
  }

  findMatching(input: Pick<PolicyAuthorityProvisioningRequestV1, 'tenantId' | 'agentId' | 'pluginId' | 'pluginVersionId' | 'capability' | 'policyRef' | 'policyVersion' | 'planDigest'>): PolicyAuthorityProvisioningResultV1 | undefined {
    let identityMatch: PolicyAuthorityProvisioningResultV1 | undefined;
    for (const value of this.records.values()) {
      const rule = value.rule;
      if (rule.tenantId === input.tenantId && rule.agentId === input.agentId && rule.pluginId === input.pluginId
        && rule.pluginVersionId === input.pluginVersionId && rule.capability === input.capability
        && rule.policyRef === input.policyRef && rule.policyVersion === input.policyVersion) {
        identityMatch ??= value;
        if (rule.planDigest === input.planDigest) return structuredClone(value);
      }
    }
    return identityMatch ? structuredClone(identityMatch) : undefined;
  }

  commit(result: PolicyAuthorityProvisioningResultV1): void {
    const existing = this.records.get(result.requestDigest);
    if (existing && sha256Digest(existing) !== sha256Digest(result)) failClosed('重复 provisioning 输入产生了不同结果');
    const nextRecords = new Map(this.records);
    nextRecords.set(result.requestDigest, structuredClone(result));
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const handle = openSync(temporary, 'wx', 0o600);
      try { writeSync(handle, `${JSON.stringify([...nextRecords.values()])}\n`, undefined, 'utf8'); } finally { closeSync(handle); }
      renameSync(temporary, this.filePath);
      this.records.clear();
      for (const [requestDigest, stored] of nextRecords) this.records.set(requestDigest, stored);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* 清理失败仍然由下方错误关闭 */ }
      failClosed(`Policy Authority provisioning 持久化失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * 生产策略只接受由独立信任根签名的、精确绑定到租户/Agent/插件版本的规则。
 * 规则不读取宿主对象，也不通过 Repository 解析任何隐式权限。
 */
export class SignedPolicyAuthorityPolicyEvaluatorV1 implements PolicyAuthorityEvaluatorV1 {
  private readonly rules: readonly PolicyAuthorityPolicyRuleV1[];

  constructor(bundle: SignedPolicyAuthorityPolicyBundleV1, trustRoot: PolicyAuthorityTrustRootV1) {
    validatePolicyBundle(bundle, trustRoot);
    this.rules = structuredClone(bundle.rules);
  }

  evaluate(input: PolicyAuthorityEvaluationInputV1): PolicyAuthorityEvaluationV1 {
    const rule = this.rules.find((candidate) =>
      candidate.policyRef === input.policyRef
      && candidate.policyVersion === input.policyVersion
      && candidate.agentId === input.agentId
      && candidate.tenantId === input.tenantId
      && candidate.pluginId === input.pluginId
      && candidate.pluginVersionId === input.pluginVersionId
      && candidate.capability === input.capability
      && (candidate.planDigest === undefined || candidate.planDigest === input.planDigest),
    );
    if (!rule) return deniedEvaluation(input, '生产策略未匹配当前租户、Agent、插件版本或 Capability');
    if (!isSubset(input.actions, rule.actions)
      || !input.allowedPaths.every((path) => isPathWithin(path, rule.allowedPaths))
      || !isSubset(input.allowedServices, rule.allowedServices)
      || !isSubset(input.artifactDigests, rule.artifactDigests)) {
      return deniedEvaluation(input, '请求范围超出已签名生产策略');
    }
    return {
      allowed: true,
      actions: [...input.actions],
      allowedPaths: [...input.allowedPaths],
      allowedServices: [...input.allowedServices],
      artifactDigests: [...input.artifactDigests],
      policyRef: input.policyRef,
      policyVersion: input.policyVersion,
    };
  }
}

interface PolicyAuthorityStateV1 {
  stateVersion: typeof policyAuthorityStateVersion;
  revokedTokenIds: string[];
  revokedDecisionIds: string[];
  revokedKeyIds: string[];
  nonces: NonceConsumptionRecordV1[];
}

/**
 * Policy Authority 专用的持久状态存储。它只操作明确的状态文件，不依赖宿主 DatabasePort。
 * 消费 Nonce 和写入撤销记录都在跨进程锁内完成；状态损坏、锁异常或文件缺失均失败关闭。
 */
export class FilePolicyAuthorityStateStoreV1 implements AtomicPolicyAuthorityStateStoreV1 {
  private readonly lockPath: string;

  constructor(private readonly statePath: string) {
    if (!isAbsolute(statePath)) failClosed('Policy Authority 状态文件必须使用绝对路径');
    this.lockPath = `${statePath}.lock`;
    this.readState();
  }

  getStatePath(): string {
    return this.statePath;
  }

  isTokenRevoked(tokenId: string, authorityKeyId: string): boolean {
    return this.withLock(() => this.readState().revokedTokenIds.includes(`${authorityKeyId}:${tokenId}`));
  }

  isDecisionRevoked(decisionId: string, authorityKeyId: string): boolean {
    return this.withLock(() => this.readState().revokedDecisionIds.includes(`${authorityKeyId}:${decisionId}`));
  }

  isKeyRevoked(authorityKeyId: string): boolean {
    return this.withLock(() => this.readState().revokedKeyIds.includes(authorityKeyId));
  }

  revokeToken(record: TokenRevocationRecordV1): void {
    validateTokenRevocationRecord(record);
    this.withLock(() => {
      const state = this.readState();
      const tokenRef = `${record.authorityKeyId}:${record.tokenId}`;
      if (!state.revokedTokenIds.includes(tokenRef)) state.revokedTokenIds.push(tokenRef);
      this.writeState(state);
    });
  }

  revokeDecision(record: DecisionRevocationRecordV1): void {
    validateDecisionRevocationRecord(record);
    this.withLock(() => {
      const state = this.readState();
      const decisionRef = `${record.authorityKeyId}:${record.decisionId}`;
      if (!state.revokedDecisionIds.includes(decisionRef)) state.revokedDecisionIds.push(decisionRef);
      this.writeState(state);
    });
  }

  revokeKey(authorityKeyId: string): void {
    if (!authorityKeyId.trim()) failClosed('撤销 authority key 不能为空');
    rejectDevelopmentIdentifier(authorityKeyId, 'authorityKeyId');
    this.withLock(() => {
      const state = this.readState();
      if (!state.revokedKeyIds.includes(authorityKeyId)) state.revokedKeyIds.push(authorityKeyId);
      this.writeState(state);
    });
  }

  hasNonce(nonce: string): boolean {
    return this.withLock(() => this.readState().nonces.some((record) => record.nonce === nonce));
  }

  consume(record: NonceConsumptionRecordV1): NonceConsumptionRecordV1 {
    validateNonceConsumptionRecord(record);
    this.withLock(() => {
      const state = this.readState();
      if (state.nonces.some((item) => item.nonce === record.nonce)) failClosed('Nonce 已消费');
      state.nonces.push(structuredClone(record));
      this.writeState(state);
    });
    return structuredClone(record);
  }

  consumeAuthorization(
    record: NonceConsumptionRecordV1,
    authorityKeyId: string,
    tokenId: string,
    decisionId: string,
  ): NonceConsumptionRecordV1 {
    validateNonceConsumptionRecord(record);
    if (record.tokenId !== tokenId) failClosed('Nonce 消费 Token 绑定不匹配');
    this.withLock(() => {
      const state = this.readState();
      if (state.revokedKeyIds.includes(authorityKeyId)) failClosed('authority key 已被撤销');
      if (state.revokedTokenIds.includes(`${authorityKeyId}:${tokenId}`)) failClosed('Token 已被撤销');
      if (state.revokedDecisionIds.includes(`${authorityKeyId}:${decisionId}`)) failClosed('Policy Authority 决策已被撤销');
      if (state.nonces.some((item) => item.nonce === record.nonce)) failClosed('Nonce 已消费');
      state.nonces.push(structuredClone(record));
      this.writeState(state);
    });
    return structuredClone(record);
  }

  private readState(): PolicyAuthorityStateV1 {
    if (!existsSync(this.statePath)) failClosed('生产撤销/Nonce 状态文件缺失');
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
    } catch {
      failClosed('生产撤销/Nonce 状态文件无法读取');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) failClosed('生产状态文件必须是对象');
    const value = parsed as Record<string, unknown>;
    exactRuntimeKeys(value, ['stateVersion', 'revokedTokenIds', 'revokedDecisionIds', 'revokedKeyIds', 'nonces'], 'Policy Authority 状态');
    if (value.stateVersion !== policyAuthorityStateVersion
      || !Array.isArray(value.revokedTokenIds)
      || !Array.isArray(value.revokedDecisionIds)
      || !Array.isArray(value.revokedKeyIds)
      || !Array.isArray(value.nonces)
      || !value.revokedTokenIds.every((item) => typeof item === 'string')
      || !value.revokedDecisionIds.every((item) => typeof item === 'string')
      || !value.revokedKeyIds.every((item) => typeof item === 'string')) {
      failClosed('生产撤销/Nonce 状态格式无效');
    }
    if (value.revokedTokenIds.some((item) => !isRevocationReference(item as string))
      || value.revokedDecisionIds.some((item) => !isRevocationReference(item as string))
      || value.revokedKeyIds.some((item) => !isSafeIdentifier(item as string))) {
      failClosed('生产撤销状态包含开发默认密钥');
    }
    const nonces = value.nonces.map((item) => validateNonceConsumptionRecord(item));
    if (new Set(nonces.map((item) => item.nonce)).size !== nonces.length) failClosed('生产 Nonce 状态包含重复记录');
    return {
      stateVersion: policyAuthorityStateVersion,
      revokedTokenIds: [...value.revokedTokenIds as string[]],
      revokedDecisionIds: [...value.revokedDecisionIds as string[]],
      revokedKeyIds: [...value.revokedKeyIds as string[]],
      nonces,
    };
  }

  private writeState(state: PolicyAuthorityStateV1): void {
    let temporaryPath: string | undefined;
    let handle: number | undefined;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      temporaryPath = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;
      handle = openSync(temporaryPath, 'wx', 0o600);
      const content = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
      if (writeSync(handle, content, 0, content.length) !== content.length) failClosed('生产撤销/Nonce 状态写入不完整');
      fsyncSync(handle);
      closeSync(handle);
      handle = undefined;
      renameSync(temporaryPath, this.statePath);
      temporaryPath = undefined;
    } catch {
      if (handle !== undefined) {
        try { closeSync(handle); } catch { /* 清理失败仍需失败关闭 */ }
      }
      if (temporaryPath !== undefined) {
        try { unlinkSync(temporaryPath); } catch { /* 临时文件清理失败仍需失败关闭 */ }
      }
      failClosed('生产撤销/Nonce 状态无法持久化');
    }
  }

  private withLock<T>(work: () => T): T {
    let handle: number | undefined;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          handle = openSync(this.lockPath, 'wx', 0o600);
          break;
        } catch {
          // 仅等待已有 Policy Authority 进程释放锁；陈旧锁不自动删除，避免并发双消费。
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      if (handle === undefined) failClosed('Policy Authority 状态锁不可用');
      return work();
    } finally {
      if (handle !== undefined) {
        try { closeSync(handle); } catch { /* 下面的锁文件删除仍会失败关闭 */ }
        try { unlinkSync(this.lockPath); } catch { failClosed('Policy Authority 状态锁无法释放'); }
      }
    }
  }
}

export interface PolicyAuthorityAuthorizationRequestV1 {
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  policyRef: string;
  policyVersion: string;
  planDigest: string;
  approvalRef?: string;
  lifetimeSeconds: number;
}

export interface PolicyAuthorityAuthorizationResultV1 {
  decision: PolicyAuthorityDecisionV1;
  token?: AgentCapabilityTokenV1;
}

export interface PolicyAuthorityServiceOptionsV1 {
  trustRoot: PolicyAuthorityTrustRootV1;
  keySet: SignedPolicyAuthorityKeySetV1 | PolicyAuthorityKeySetSourceV1;
  /** 生产装配必须显式提供已由根签名的 Bootstrap；合同测试可省略此生产材料。 */
  bootstrap?: PolicyAuthorityBootstrapV1;
  signingKeySource: PolicyAuthoritySigningKeySourceV1;
  evaluator: PolicyAuthorityEvaluatorV1;
  revocations: PolicyAuthorityRevocationStoreV1;
  nonceStore: NonceStoreV1Port;
  /** 正式 provisioning 的原子存储；缺失时 provisioning 入口失败关闭。 */
  provisioning?: PolicyAuthorityProvisioningStoreV1;
  now?: () => string;
}

/**
 * Policy Authority 的进程内服务边界。所有安全材料和状态都必须由外部安全控制面显式注入。
 * 本类不读取数据库、不加载插件，也不提供任何开发密钥或隐式降级路径。
 */
export class PolicyAuthorityServiceV1 {
  private readonly trustRoot: PolicyAuthorityTrustRootV1;
  private readonly keySetSource?: PolicyAuthorityKeySetSourceV1;
  private readonly signingKeySource: PolicyAuthoritySigningKeySourceV1;
  private readonly evaluator: PolicyAuthorityEvaluatorV1;
  private readonly revocations: PolicyAuthorityRevocationStoreV1;
  private readonly nonceStore: NonceStoreV1Port;
  private readonly provisioning?: PolicyAuthorityProvisioningStoreV1;
  private readonly now: () => string;
  private readonly bootstrap?: PolicyAuthorityBootstrapV1;
  private currentKeySet: PolicyAuthorityKeySetV1;

  constructor(options: PolicyAuthorityServiceOptionsV1) {
    requireDependency(options, 'Policy Authority 配置');
    this.trustRoot = validateTrustRoot(options.trustRoot);
    this.keySetSource = isKeySetSource(options.keySet) ? options.keySet : undefined;
    this.signingKeySource = requireObject(options.signingKeySource, 'signingKeySource');
    this.evaluator = requireObject(options.evaluator, 'evaluator');
    this.revocations = requireObject(options.revocations, 'revocations');
    this.nonceStore = requireObject(options.nonceStore, 'nonceStore');
    this.provisioning = options.provisioning;
    requireCallable(this.signingKeySource, 'getPrivateKey');
    requireCallable(this.evaluator, 'evaluate');
    requireCallable(this.revocations, 'isTokenRevoked');
    requireCallable(this.revocations, 'isDecisionRevoked');
    requireCallable(this.revocations, 'isKeyRevoked');
    requireCallable(this.revocations, 'revokeToken');
    requireCallable(this.revocations, 'revokeDecision');
    requireCallable(this.revocations, 'revokeKey');
    requireCallable(this.nonceStore, 'consume');
    if (this.provisioning) {
      requireCallable(this.provisioning, 'find');
      requireCallable(this.provisioning, 'findMatching');
      requireCallable(this.provisioning, 'commit');
    }
    this.now = options.now ?? (() => new Date().toISOString());
    const configuredNow = this.currentTime();
    this.bootstrap = options.bootstrap === undefined
      ? undefined
      : validatePolicyAuthorityBootstrap(options.bootstrap, this.trustRoot, configuredNow);
    let initialKeySet: SignedPolicyAuthorityKeySetV1;
    try {
      initialKeySet = resolveKeySet(options.keySet);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('KeySet 来源不可用');
    }
    const now = configuredNow;
    this.currentKeySet = this.loadAndVerifyKeySet(initialKeySet, now);
    this.assertSigningKey(this.currentKeySet, now);
  }

  getTrustedKeySet(): PolicyAuthorityKeySetV1 {
    return structuredClone(this.currentKeySet);
  }

  getBootstrap(): PolicyAuthorityBootstrapV1 | undefined {
    return this.bootstrap ? structuredClone(this.bootstrap) : undefined;
  }

  /**
   * 自动签发 Agent 首次注册材料。宿主只能提交 Agent 身份，不能提交策略范围或签名内容；
   * 证书执行所需的精确上限仍由后续已编译 Plan provisioning 生成并下发。
   */
  issueAgentTrustMaterial(request: PolicyAuthorityAgentTrustMaterialRequestV1): PolicyAuthorityAgentTrustMaterialV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    validateAgentTrustMaterialRequest(request);
    const issuedAt = this.currentTime();
    const activeKey = this.getActiveSigningKey(issuedAt);
    const keyMap = Object.fromEntries(this.currentKeySet.keys.map((key) => [key.keyId, rawEd25519PublicKey(key.publicKeyPem)]));
    const discoveryActions = ['filesystem.read', 'process.list', 'service.list'];
    const allowedPaths = selectWebDiscoveryPaths(request.osType ?? 'linux');
    const localPolicy = validateAgentLocalPolicy({
      policyVersion: agentSecurityContractVersion,
      agentId: request.agentId,
      authorityKeyIds: [activeKey.keyId],
      allowedActions: discoveryActions,
      pathRules: allowedPaths.map((prefix) => ({ prefix, operations: ['filesystem.read'] })),
      serviceRules: [],
      commandRules: [],
      disabled: false,
      updatedAt: issuedAt,
    });
    const material: PolicyAuthorityAgentTrustMaterialV1 = {
      materialVersion: agentSecurityContractVersion,
      issuedAt,
      validUntil: addSeconds(issuedAt, 365 * 24 * 60 * 60),
      capabilityKeySet: keyMap,
      policyAuthorityKeySet: keyMap,
      localPolicy,
      localPolicyAuthorityKeyId: activeKey.keyId,
      localPolicySignature: signPolicyPayload(localPolicy, activeKey.privateKey),
    };
    validatePolicyAuthorityAgentTrustMaterial(material, this.currentKeySet);
    return structuredClone(material);
  }

  /**
   * 对已经编译的 Agent Plan 一次性生成动态 PA 规则和稳定本地能力上限材料。
   * 所有校验、签名和持久化完成前不会提交任何一类材料。
   */
  provisionAgentPlan(request: PolicyAuthorityProvisioningRequestV1): PolicyAuthorityProvisioningResultV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    if (!this.provisioning) failClosed('Policy Authority provisioning 存储不可用');
    const validated = validateProvisioningRequest(request);
    const requestDigest = provisioningRequestDigest(validated);
    const existing = this.provisioning.find(requestDigest);
    if (existing) {
      const key = this.findKey(existing.rule.authorityKeyId, this.currentTime(), true);
      assertProvisioningSignatures(existing, key.publicKeyPem);
      return structuredClone(existing);
    }

    const issuedAt = this.currentTime();
    // provisioning 与随后 issueAuthorization 是两个受控调用；预留极小编排时钟窗口，
    // 避免规则在签发 Token 前因毫秒级时间推进而先过期。Token 本身仍严格使用请求生命周期。
    const validUntil = addSeconds(issuedAt, validated.lifetimeSeconds + 5);
    const activeKey = this.getActiveSigningKey(issuedAt);
    const ruleUnsigned: Omit<SignedPolicyAuthorityProvisioningRuleV1, 'signature'> = {
      provisioningVersion: policyAuthorityProvisioningVersion,
      policyRef: validated.policyRef,
      policyVersion: validated.policyVersion,
      agentId: validated.agentId,
      tenantId: validated.tenantId,
      pluginId: validated.pluginId,
      pluginVersionId: validated.pluginVersionId,
      capability: validated.capability,
      planDigest: validated.planDigest,
      actions: [...validated.actions],
      allowedPaths: [...validated.allowedPaths],
      allowedServices: [...validated.allowedServices],
      artifactDigests: [...validated.artifactDigests],
      commandRules: structuredClone(validated.commandRules),
      ...(validated.approvalRef ? { approvalRef: validated.approvalRef } : {}),
      authorityKeyId: activeKey.keyId,
      issuedAt,
      validUntil,
    };
    const rule = { ...ruleUnsigned, signature: signPolicyPayload(ruleUnsigned, activeKey.privateKey) };
    const localPolicy = projectLocalPolicyUpperBound(
      validated.currentLocalPolicy,
      validated.agentId,
      activeKey.keyId,
      validated.bootstrapLocalPolicy === true,
      validated.commandRules,
    );
    const localUnsigned: Omit<SignedAgentLocalPolicyMaterialV1, 'signature'> = {
      materialVersion: policyAuthorityProvisioningVersion,
      tenantId: validated.tenantId,
      agentId: validated.agentId,
      localPolicy,
      authorityKeyId: activeKey.keyId,
    };
    const localPolicyMaterial = { ...localUnsigned, signature: signPolicyPayload(localUnsigned, activeKey.privateKey) };
    const revision = `provisioning-${requestDigest.slice(0, 32)}`;
    const receiptUnsigned: Omit<PolicyAuthorityProvisioningReceiptV1, 'signature'> = {
      receiptVersion: policyAuthorityProvisioningReceiptVersion,
      revision,
      requestDigest,
      ruleDigest: sha256Digest(rule),
      localPolicyDigest: sha256Digest(localUnsigned),
      issuedAt,
    };
    const receipt = { ...receiptUnsigned, signature: signPolicyPayload(receiptUnsigned, activeKey.privateKey) };
    const result: PolicyAuthorityProvisioningResultV1 = {
      provisioningVersion: policyAuthorityProvisioningVersion,
      revision,
      requestDigest,
      rule,
      localPolicyMaterial,
      receipt,
    };
    const validatedResult = validatePolicyAuthorityProvisioningResultV1(result);
    // 只提交一次完整记录，文件存储内部使用临时文件 + rename，保证两类材料不会半写入。
    this.provisioning.commit(validatedResult);
    return structuredClone(validatedResult);
  }

  /** 轮换只替换已由信任根签名且具备可用 ACTIVE 私钥的新 KeySet。 */
  refreshKeySet(source: SignedPolicyAuthorityKeySetV1 | PolicyAuthorityKeySetSourceV1): void {
    let nextSource: SignedPolicyAuthorityKeySetV1;
    try {
      nextSource = resolveKeySet(source);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('KeySet 来源不可用');
    }
    const now = this.currentTime();
    this.assertBootstrap(now);
    const next = this.loadAndVerifyKeySet(nextSource, now);
    this.applyKeySet(next, now);
  }

  issueAuthorization(request: PolicyAuthorityAuthorizationRequestV1): PolicyAuthorityAuthorizationResultV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    const issuedAt = this.currentTime();
    const validatedRequest = validateIssueRequest(request, issuedAt);
    const validUntil = addSeconds(issuedAt, validatedRequest.lifetimeSeconds);
    const activeKey = this.getActiveSigningKey(issuedAt);
    const evaluationInput: PolicyAuthorityEvaluationInputV1 = { ...validatedRequest, issuedAt, validUntil };
    let evaluation: PolicyAuthorityEvaluationV1;
    try {
      evaluation = this.evaluateWithProvisionedRule(evaluationInput) ?? this.evaluator.evaluate(structuredClone(evaluationInput));
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('策略评估失败');
    }
    evaluation = validateEvaluation(evaluation, validatedRequest, issuedAt, validUntil);

    const tokenId = `token-${randomUUID()}`;
    const nonce = `nonce-${randomUUID()}`;
    const decisionValue: Omit<PolicyAuthorityDecisionV1, 'signature'> = {
      decisionVersion: agentSecurityContractVersion,
      decisionId: `decision-${randomUUID()}`,
      allowed: evaluation.allowed,
      agentId: validatedRequest.agentId,
      tenantId: validatedRequest.tenantId,
      pluginId: validatedRequest.pluginId,
      pluginVersionId: validatedRequest.pluginVersionId,
      capability: validatedRequest.capability,
      actions: evaluation.actions,
      allowedPaths: evaluation.allowedPaths,
      allowedServices: evaluation.allowedServices,
      artifactDigests: evaluation.artifactDigests,
      policyRef: evaluation.policyRef,
      policyVersion: evaluation.policyVersion,
      planDigest: validatedRequest.planDigest,
      tokenId,
      nonce,
      issuedAt,
      validUntil,
      authorityKeyId: activeKey.keyId,
      revocationRef: `revocation-${randomUUID()}`,
      ...(validatedRequest.approvalRef !== undefined ? { approvalRef: validatedRequest.approvalRef } : {}),
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    };
    const decision = validatePolicyAuthorityDecision({ ...decisionValue, signature: signPolicyPayload(decisionValue, activeKey.privateKey) });
    if (!evaluation.allowed) return { decision };

    const tokenValue: Omit<AgentCapabilityTokenV1, 'signature'> = {
      tokenVersion: agentSecurityContractVersion,
      tokenId,
      agentId: validatedRequest.agentId,
      tenantId: validatedRequest.tenantId,
      pluginId: validatedRequest.pluginId,
      pluginVersionId: validatedRequest.pluginVersionId,
      capability: validatedRequest.capability,
      actions: evaluation.actions,
      allowedPaths: evaluation.allowedPaths,
      allowedServices: evaluation.allowedServices,
      artifactDigests: evaluation.artifactDigests,
      ...(validatedRequest.approvalRef !== undefined ? { approvalRef: validatedRequest.approvalRef } : {}),
      policyRef: evaluation.policyRef,
      policyVersion: evaluation.policyVersion,
      issuedAt,
      expiresAt: validUntil,
      nonce,
      planDigest: validatedRequest.planDigest,
      authorityKeyId: activeKey.keyId,
    };
    const token = validateAgentCapabilityToken({ ...tokenValue, signature: signPolicyPayload(tokenValue, activeKey.privateKey) });
    return { decision, token };
  }

  private evaluateWithProvisionedRule(input: PolicyAuthorityEvaluationInputV1): PolicyAuthorityEvaluationV1 | undefined {
    if (!this.provisioning) return undefined;
    const candidate = this.provisioning.findMatching(input);
    if (!candidate) return undefined;
    const rule = candidate.rule;
    const key = this.findKey(rule.authorityKeyId, input.issuedAt, true);
    assertProvisioningSignatures(candidate, key.publicKeyPem);
    if (rule.validUntil === undefined || rule.validUntil < input.validUntil
      || rule.policyRef !== input.policyRef || rule.policyVersion !== input.policyVersion
      || rule.agentId !== input.agentId || rule.tenantId !== input.tenantId
      || rule.pluginId !== input.pluginId || rule.pluginVersionId !== input.pluginVersionId
      || rule.capability !== input.capability || rule.planDigest !== input.planDigest
      || !isSubset(input.actions, rule.actions)
      || !input.allowedPaths.every((path) => isPathWithin(path, rule.allowedPaths))
      || !isSubset(input.allowedServices, rule.allowedServices)
      || !isSubset(input.artifactDigests, rule.artifactDigests)) {
      return deniedEvaluation(input, 'provisioning 规则未精确匹配当前 Plan、范围或有效期');
    }
    return {
      allowed: true,
      actions: [...input.actions],
      allowedPaths: [...input.allowedPaths],
      allowedServices: [...input.allowedServices],
      artifactDigests: [...input.artifactDigests],
      policyRef: input.policyRef,
      policyVersion: input.policyVersion,
    };
  }

  /** Agent 侧最终授权入口：重新校验合同、签名、绑定、撤销、过期和一次性 Nonce。 */
  authorize(input: { plan: unknown; token: unknown; decision: unknown; localPolicy: unknown }): NonceConsumptionRecordV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    const plan = validateAgentPlan(input.plan);
    const token = validateAgentCapabilityToken(input.token);
    const decision = validatePolicyAuthorityDecision(input.decision);
    const localPolicy = validateAgentLocalPolicy(input.localPolicy);
    const now = this.currentTime();
    const key = this.findKey(token.authorityKeyId, now, true);
    try {
      if (this.revocations.isKeyRevoked(token.authorityKeyId) !== false) failClosed('authority key 已被撤销');
      if (this.revocations.isTokenRevoked(token.tokenId, token.authorityKeyId) !== false) failClosed('Token 已被撤销');
      if (this.revocations.isDecisionRevoked(decision.decisionId, token.authorityKeyId) !== false) failClosed('Policy Authority 决策已被撤销');
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('撤销状态不可用');
    }
    try {
      const atomicStore = this.nonceStore as Partial<AtomicPolicyAuthorityStateStoreV1>;
      const nonceStore: NonceStoreV1Port = typeof atomicStore.consumeAuthorization === 'function'
        ? { consume: (record) => atomicStore.consumeAuthorization!(record, token.authorityKeyId, token.tokenId, decision.decisionId) }
        : this.nonceStore;
      return authorizeAgentPlan({ plan, token, decision, keySet: this.currentKeySet, localPolicy, nonceStore, now });
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('Nonce 一次性消费状态不可用');
    }
  }

  revokeToken(tokenInput: unknown, reason: string): TokenRevocationRecordV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    const token = validateAgentCapabilityToken(tokenInput);
    const now = this.currentTime();
    const key = this.findKey(token.authorityKeyId, now, false);
    if (!verifyTokenSignature(token, key.publicKeyPem)) failClosed('无法验证待撤销 Token 的签名');
    const record: TokenRevocationRecordV1 = {
      recordVersion: agentSecurityContractVersion,
      tokenId: token.tokenId,
      authorityKeyId: token.authorityKeyId,
      reason: requireText(reason, '撤销原因'),
      revokedAt: now,
    };
    try {
      this.revocations.revokeToken(record);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('撤销状态不可用');
    }
    return record;
  }

  revokeDecision(decisionInput: unknown, reason: string): DecisionRevocationRecordV1 {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    const decision = validatePolicyAuthorityDecision(decisionInput);
    const now = this.currentTime();
    const key = this.findKey(decision.authorityKeyId, now, false);
    if (!verifyTokenSignature(decision, key.publicKeyPem)) failClosed('无法验证待撤销 Policy Authority 决策的签名');
    const record: DecisionRevocationRecordV1 = {
      recordVersion: agentSecurityContractVersion,
      decisionId: decision.decisionId,
      authorityKeyId: decision.authorityKeyId,
      reason: requireText(reason, '撤销原因'),
      revokedAt: now,
    };
    try {
      this.revocations.revokeDecision(record);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('撤销状态不可用');
    }
    return record;
  }

  /**
   * 通过 Policy Authority 正式入口持久撤销签发 Key，禁止调用方直接改写 KeySet 或绕过撤销状态。
   * KeySet 轮换后，即使旧 Key 不再出现在当前 KeySet，已持久化的撤销状态仍优先于任何缓存凭证。
   */
  revokeKey(authorityKeyId: string): void {
    this.refreshConfiguredKeySet();
    this.assertBootstrap(this.currentTime());
    const keyId = requireText(authorityKeyId, 'authorityKeyId');
    if (!isSafeIdentifier(keyId)) failClosed('authorityKeyId 格式不合法');
    rejectDevelopmentIdentifier(keyId, 'authorityKeyId');
    if (!this.currentKeySet.keys.some((key) => key.keyId === keyId)) failClosed('不能撤销未知的 Policy Authority key');
    try {
      this.revocations.revokeKey(keyId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('撤销状态不可用');
    }
  }

  private getActiveSigningKey(now: string): { keyId: string; privateKey: KeyObject | string } {
    const key = this.findKey(this.currentKeySet.activeKeyId, now, false);
    if (key.status !== 'ACTIVE') failClosed('当前 ACTIVE signing key 不可用');
    this.assertKeyNotRevoked(key.keyId);
    const privateKey = this.signingKeySource.getPrivateKey(key.keyId);
    if (!privateKey) failClosed('缺少 Policy Authority signing key');
    assertPrivateKeyMatches(key.publicKeyPem, privateKey);
    return { keyId: key.keyId, privateKey };
  }

  private assertSigningKey(keySet: PolicyAuthorityKeySetV1, now: string): void {
    const key = keySet.keys.find((candidate) => candidate.keyId === keySet.activeKeyId);
    if (!key || key.status !== 'ACTIVE') failClosed('KeySet 缺少 ACTIVE signing key');
    if (!isWithin(now, key.notBefore, key.notAfter)) failClosed('当前 ACTIVE signing key 不在有效时间窗内');
    this.assertKeyNotRevoked(key.keyId);
    const privateKey = this.signingKeySource.getPrivateKey(key.keyId);
    if (!privateKey) failClosed('缺少 Policy Authority signing key');
    assertPrivateKeyMatches(key.publicKeyPem, privateKey);
  }

  private assertKeyNotRevoked(keyId: string): void {
    try {
      if (this.revocations.isKeyRevoked(keyId) !== false) failClosed('当前 authority key 已被撤销');
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('撤销状态不可用');
    }
  }

  private findKey(keyId: string, now: string, requireActive: boolean) {
    const key = this.currentKeySet.keys.find((candidate) => candidate.keyId === keyId);
    if (!key || (requireActive && key.status !== 'ACTIVE')) failClosed('未知或已撤销的 authority key');
    if (!isWithin(now, key.notBefore, key.notAfter)) failClosed('authority key 已过期或尚未生效');
    return key;
  }

  private assertBootstrap(now: string): void {
    if (this.bootstrap === undefined) return;
    validatePolicyAuthorityBootstrap(this.bootstrap, this.trustRoot, now);
  }

  private currentTime(): string {
    let value: string;
    try {
      value = this.now();
    } catch {
      failClosed('系统时钟不可用');
    }
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !value.includes('T')) failClosed('系统时钟返回非法时间');
    return value;
  }

  private loadAndVerifyKeySet(envelope: SignedPolicyAuthorityKeySetV1, now: string): PolicyAuthorityKeySetV1 {
    validateKeySetEnvelope(envelope);
    if (envelope.rootKeyId !== this.trustRoot.rootKeyId || envelope.authorityId !== this.trustRoot.authorityId) failClosed('KeySet 未绑定独立信任根');
    const keySet = validatePolicyAuthorityKeySet(envelope.keySet);
    if (keySet.authorityId !== envelope.authorityId) failClosed('KeySet 内层 authorityId 与 Envelope 不匹配');
    for (const key of keySet.keys) {
      rejectDevelopmentIdentifier(key.keyId, 'KeySet keyId');
      validatePublicKey(key.publicKeyPem);
      if (key.keyId === this.trustRoot.rootKeyId || publicKeyFingerprint(key.publicKeyPem) === this.trustRoot.fingerprintSha256) {
        failClosed('Policy Authority signing key 必须独立于信任根');
      }
    }
    if (!verifyTokenSignature(envelope, this.trustRoot.publicKeyPem)) failClosed('KeySet 信任根签名无效');
    if (Date.parse(keySet.issuedAt) > Date.parse(now) + 60_000) failClosed('KeySet 签发时间超前');
    return structuredClone(keySet);
  }

  private refreshConfiguredKeySet(): void {
    const now = this.currentTime();
    this.assertBootstrap(now);
    if (!this.keySetSource) return;
    let envelope: SignedPolicyAuthorityKeySetV1;
    try {
      envelope = resolveKeySet(this.keySetSource);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('KeySet 来源不可用');
    }
    const next = this.loadAndVerifyKeySet(envelope, now);
    this.applyKeySet(next, now);
  }

  private applyKeySet(next: PolicyAuthorityKeySetV1, now: string): void {
    if (keySetFingerprint(next) === keySetFingerprint(this.currentKeySet)) return;
    if (Date.parse(next.issuedAt) <= Date.parse(this.currentKeySet.issuedAt)) failClosed('KeySet 轮换版本必须严格递增');
    this.assertSigningKey(next, now);
    this.currentKeySet = structuredClone(next);
  }
}

export class InMemoryPolicyAuthorityRevocationStoreV1 implements PolicyAuthorityRevocationStoreV1 {
  private readonly tokens = new Set<string>();
  private readonly decisions = new Set<string>();
  private readonly keys = new Set<string>();

  isTokenRevoked(tokenId: string, authorityKeyId: string): boolean { return this.tokens.has(`${authorityKeyId}:${tokenId}`); }
  isDecisionRevoked(decisionId: string, authorityKeyId: string): boolean { return this.decisions.has(`${authorityKeyId}:${decisionId}`); }
  isKeyRevoked(authorityKeyId: string): boolean { return this.keys.has(authorityKeyId); }
  revokeToken(record: TokenRevocationRecordV1): void { this.tokens.add(`${record.authorityKeyId}:${record.tokenId}`); }
  revokeDecision(record: DecisionRevocationRecordV1): void { this.decisions.add(`${record.authorityKeyId}:${record.decisionId}`); }
  revokeKey(authorityKeyId: string): void { this.keys.add(authorityKeyId); }
}

/**
 * 生产容器的独立信任根来源。只接受部署环境显式注入，绝不生成或回退到开发密钥。
 */
export class ProductionPolicyAuthorityTrustRootServiceV1 {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  getTrustRoot(): PolicyAuthorityTrustRootV1 {
    return {
      rootKeyId: requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_ROOT_KEY_ID'),
      authorityId: requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_ID'),
      algorithm: 'Ed25519',
      publicKeyPem: requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM').replaceAll('\\n', '\n'),
      fingerprintSha256: requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256'),
    };
  }
}

/**
 * 生产 Bootstrap 来源。Bootstrap 必须由独立根签名，并且只能固定 authority 与根指纹；
 * 它不携带签发私钥、Token 或可直接执行的动作范围。
 */
export class ProductionPolicyAuthorityBootstrapServiceV1 implements PolicyAuthorityBootstrapSourceV1 {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  load(trustRoot: PolicyAuthorityTrustRootV1, now = new Date().toISOString()): PolicyAuthorityBootstrapV1 {
    const raw = requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failClosed('Policy Authority Bootstrap JSON 无法解析');
    }
    return validatePolicyAuthorityBootstrap(parsed, trustRoot, now);
  }
}

/**
 * 生产 KeySet 来源。每次读取都会重新解析部署配置，供服务在轮换时重新验证根签名。
 */
export class ProductionPolicyAuthorityKeySetServiceV1 implements PolicyAuthorityKeySetSourceV1 {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  load(): SignedPolicyAuthorityKeySetV1 {
    const keySetJson = requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_KEYSET_JSON');
    try {
      return JSON.parse(keySetJson) as SignedPolicyAuthorityKeySetV1;
    } catch {
      failClosed('KeySet JSON 无法解析');
    }
  }
}

/** 生产策略包来源；策略包缺失、未签名或由错误信任根签发时拒绝启动。 */
export class ProductionPolicyAuthorityPolicyServiceV1 {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  load(trustRoot: PolicyAuthorityTrustRootV1): SignedPolicyAuthorityPolicyBundleV1 {
    const raw = requiredEnvironment(this.environment, 'GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failClosed('生产策略包 JSON 无法解析');
    }
    return validatePolicyBundle(parsed, trustRoot);
  }
}

/**
 * 生产签名私钥来源。宿主只传递绝对路径，私钥内容仅由 standalone Policy Authority 进程读取。
 */
export class ProductionPolicyAuthoritySigningKeySourceV1 implements PolicyAuthoritySigningKeySourceV1 {
  private readonly filePath: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.filePath = requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE');
    if (!isAbsolute(this.filePath)) failClosed('Policy Authority signing key 文件必须是绝对路径');
    assertSigningKeyFile(this.filePath);
    parseSigningKeys(readFileSync(this.filePath, 'utf8'));
  }

  getPrivateKey(keyId: string): string | undefined {
    return parseSigningKeys(readSigningKeyFile(this.filePath)).get(keyId);
  }
}

export interface ProductionPolicyAuthorityServicesV1 {
  service: PolicyAuthorityServiceV1;
  trustRoot: ProductionPolicyAuthorityTrustRootServiceV1;
  bootstrap: ProductionPolicyAuthorityBootstrapServiceV1;
  keySet: ProductionPolicyAuthorityKeySetServiceV1;
  signingKeys: ProductionPolicyAuthoritySigningKeySourceV1;
  policy: ProductionPolicyAuthorityPolicyServiceV1;
  state: FilePolicyAuthorityStateStoreV1;
  provisioning: FilePolicyAuthorityProvisioningStoreV1;
}

const productionPolicyAuthorityServices = new WeakSet<object>();

/** 只有生产工厂返回的完整资源集合才能注入生产注册入口。 */
export function isProductionPolicyAuthorityServicesV1(value: unknown): value is ProductionPolicyAuthorityServicesV1 {
  return typeof value === 'object' && value !== null && productionPolicyAuthorityServices.has(value);
}

export function requireProductionPolicyAuthorityServicesV1(value: unknown): ProductionPolicyAuthorityServicesV1 {
  if (!isProductionPolicyAuthorityServicesV1(value)) failClosed('生产注册入口拒绝非生产 Policy Authority 资源');
  return value;
}

/**
 * 装配独立 Policy Authority 进程所需的生产资源。
 * 生产装配不接受 evaluator/revocation/Nonce 的测试替身，也不从宿主数据库获取任何安全状态。
 */
export function createProductionPolicyAuthorityServicesV1(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionPolicyAuthorityServicesV1 {
  if (requiredEnvironment(environment, 'NODE_ENV') !== 'production') {
    failClosed('Policy Authority 生产装配必须运行在 production');
  }
  if (requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_PROCESS_ROLE') !== 'standalone') {
    failClosed('Policy Authority 必须以 standalone 进程角色启动');
  }
  const trustRoot = new ProductionPolicyAuthorityTrustRootServiceV1(environment);
  const bootstrap = new ProductionPolicyAuthorityBootstrapServiceV1(environment);
  const keySet = new ProductionPolicyAuthorityKeySetServiceV1(environment);
  const signingKeys = new ProductionPolicyAuthoritySigningKeySourceV1(environment);
  const trustRootValue = trustRoot.getTrustRoot();
  const bootstrapValue = bootstrap.load(trustRootValue);
  const policy = new ProductionPolicyAuthorityPolicyServiceV1(environment);
  const statePath = requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_STATE_FILE');
  const state = new FilePolicyAuthorityStateStoreV1(statePath);
  const provisioning = new FilePolicyAuthorityProvisioningStoreV1(`${statePath}.provisioning.json`);
  const service = new PolicyAuthorityServiceV1({
    trustRoot: trustRootValue,
    keySet,
    bootstrap: bootstrapValue,
    signingKeySource: signingKeys,
    evaluator: new SignedPolicyAuthorityPolicyEvaluatorV1(policy.load(trustRootValue), trustRootValue),
    revocations: state,
    nonceStore: state,
    provisioning,
  });
  const services = Object.freeze({ service, trustRoot, bootstrap, keySet, signingKeys, policy, state, provisioning });
  productionPolicyAuthorityServices.add(services);
  return services;
}

function isKeySetSource(value: SignedPolicyAuthorityKeySetV1 | PolicyAuthorityKeySetSourceV1): value is PolicyAuthorityKeySetSourceV1 {
  return typeof (value as PolicyAuthorityKeySetSourceV1).load === 'function';
}

function resolveKeySet(value: SignedPolicyAuthorityKeySetV1 | PolicyAuthorityKeySetSourceV1): SignedPolicyAuthorityKeySetV1 {
  if (typeof (value as PolicyAuthorityKeySetSourceV1).load === 'function') return (value as PolicyAuthorityKeySetSourceV1).load();
  return value as SignedPolicyAuthorityKeySetV1;
}
function validatePolicyBundle(input: unknown, trustRoot: PolicyAuthorityTrustRootV1): SignedPolicyAuthorityPolicyBundleV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed('生产策略包必须是对象');
  const value = input as unknown as Record<string, unknown>;
  exactRuntimeKeys(value, ['bundleVersion', 'authorityId', 'issuedAt', 'rules', 'signature'], '生产策略包');
  if (value.bundleVersion !== policyAuthorityPolicyBundleVersion
    || value.authorityId !== trustRoot.authorityId
    || typeof value.issuedAt !== 'string'
    || !Array.isArray(value.rules)
    || typeof value.signature !== 'string'
    || value.signature.trim() === '') failClosed('生产策略包字段不完整');
  if (Number.isNaN(Date.parse(value.issuedAt))) failClosed('生产策略包 issuedAt 无效');
  const rules = value.rules.map((item, index) => validatePolicyRule(item, `生产策略包.rules.${index}`));
  const bundle = {
    bundleVersion: policyAuthorityPolicyBundleVersion,
    authorityId: value.authorityId,
    issuedAt: value.issuedAt,
    rules,
    signature: value.signature,
  } as SignedPolicyAuthorityPolicyBundleV1;
  if (!verifyPolicyPayload(bundle, bundle.signature, trustRoot.publicKeyPem)) failClosed('生产策略包签名无效');
  return bundle;
}
function validatePolicyRule(input: unknown, path: string): PolicyAuthorityPolicyRuleV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed(`${path} 必须是对象`);
  const value = input as unknown as Record<string, unknown>;
  exactRuntimeKeys(value, ['policyRef', 'policyVersion', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'planDigest', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'commandRules', 'approvalRef', 'validUntil'], path);
  const fields = ['policyRef', 'policyVersion', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability'] as const;
  for (const field of fields) if (typeof value[field] !== 'string' || !value[field].trim()) failClosed(`${path}.${field} 缺失`);
  if (!new RegExp(canonicalPluginIdPattern).test(value.pluginId as string)) failClosed(`${path}.pluginId 不是 Canonical Plugin ID`);
  if (value.planDigest !== undefined && (typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.planDigest))) failClosed(`${path}.planDigest 无效`);
  for (const field of ['actions', 'allowedPaths', 'allowedServices', 'artifactDigests'] as const) {
    if (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === 'string' && item.trim())) failClosed(`${path}.${field} 无效`);
  }
  if ((value.actions as string[]).some((item) => !allowedPolicyActions.has(item))) failClosed(`${path}.actions 包含未授权操作`);
  if ((value.allowedPaths as string[]).some((item) => !isSafeAbsolutePath(item))) failClosed(`${path}.allowedPaths 包含非法路径`);
  if ((value.artifactDigests as string[]).some((item) => !/^[a-f0-9]{64}$/.test(item))) failClosed(`${path}.artifactDigests 包含非法摘要`);
  if (value.commandRules !== undefined) validateProvisioningCommandRules(value.commandRules, `${path}.commandRules`);
  if (value.approvalRef !== undefined && (typeof value.approvalRef !== 'string' || !value.approvalRef.trim())) failClosed(`${path}.approvalRef 无效`);
  if (value.validUntil !== undefined && (typeof value.validUntil !== 'string' || Number.isNaN(Date.parse(value.validUntil)))) failClosed(`${path}.validUntil 无效`);
  return {
    policyRef: value.policyRef as string,
    policyVersion: value.policyVersion as string,
    agentId: value.agentId as string,
    tenantId: value.tenantId as string,
    pluginId: value.pluginId as string,
    pluginVersionId: value.pluginVersionId as string,
    capability: value.capability as string,
    ...(value.planDigest !== undefined ? { planDigest: value.planDigest as string } : {}),
    actions: [...value.actions as string[]],
    allowedPaths: [...value.allowedPaths as string[]],
    allowedServices: [...value.allowedServices as string[]],
    artifactDigests: [...value.artifactDigests as string[]],
    ...(value.commandRules !== undefined ? { commandRules: structuredClone(value.commandRules as AgentLocalCommandRuleV1[]) } : {}),
    ...(value.approvalRef !== undefined ? { approvalRef: value.approvalRef as string } : {}),
    ...(value.validUntil !== undefined ? { validUntil: value.validUntil as string } : {}),
  };
}

function validateProvisioningRequest(input: PolicyAuthorityProvisioningRequestV1): PolicyAuthorityProvisioningRequestV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed('provisioning 请求必须是对象');
  const value = input as unknown as Record<string, unknown>;
  exactRuntimeKeys(value, ['tenantId', 'agentId', 'pluginId', 'pluginVersionId', 'capability', 'planDigest', 'policyRef', 'policyVersion', 'actions', 'allowedPaths', 'allowedServices', 'commandRules', 'artifactDigests', 'approvalRef', 'lifetimeSeconds', 'currentLocalPolicy', 'bootstrapLocalPolicy', 'compiledPlan'], 'provisioning 请求');
  const textFields = ['tenantId', 'agentId', 'pluginVersionId', 'capability', 'policyRef', 'policyVersion'] as const;
  for (const field of textFields) if (typeof value[field] !== 'string' || !(value[field] as string).trim() || !isSafeIdentifier(value[field] as string)) failClosed(`provisioning ${field} 无效`);
  if (typeof value.pluginId !== 'string' || !new RegExp(canonicalPluginIdPattern).test(value.pluginId)) failClosed('provisioning pluginId 无效');
  if (value.policyRef === CERTIFICATE_UPDATE_POLICY_REF && value.policyVersion !== CERTIFICATE_UPDATE_POLICY_VERSION) failClosed('证书更新 policyVersion 必须统一为 v1');
  if (typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.planDigest)) failClosed('provisioning planDigest 无效');
  if (!Number.isInteger(value.lifetimeSeconds) || (value.lifetimeSeconds as number) < 1 || (value.lifetimeSeconds as number) > maximumTokenLifetimeSeconds) failClosed('provisioning 生命周期无效');
  const strings = (field: string, digestValues = false): string[] => {
    const values = value[field];
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string' || !(item as string).trim())) failClosed(`provisioning ${field} 无效`);
    if (digestValues && (values as string[]).some((item) => !/^[a-f0-9]{64}$/.test(item))) failClosed(`provisioning ${field} 摘要无效`);
    if (field === 'actions' && (values as string[]).some((item) => !allowedPolicyActions.has(item))) failClosed('provisioning actions 包含未授权操作');
    if (field === 'allowedPaths' && (values as string[]).some((item) => !isSafeAbsolutePath(item))) failClosed('provisioning allowedPaths 包含非法路径');
    return [...new Set(values as string[])];
  };
  const currentLocalPolicy = validateAgentLocalPolicy(value.currentLocalPolicy);
  if (currentLocalPolicy.agentId !== value.agentId || currentLocalPolicy.disabled) failClosed('当前 Agent 本地策略身份不匹配或已禁用');
  const bootstrapLocalPolicy = value.bootstrapLocalPolicy === true;
  if (!bootstrapLocalPolicy && currentLocalPolicy.authorityKeyIds.length === 0) failClosed('当前 Agent 本地策略缺少信任 Key');
  if (bootstrapLocalPolicy
    && (currentLocalPolicy.authorityKeyIds.length !== 1 || currentLocalPolicy.authorityKeyIds[0] !== 'bootstrap-pending')) {
    failClosed('自动 bootstrap 本地策略只能携带 bootstrap-pending 标记');
  }
  const actions = strings('actions');
  const allowedPaths = strings('allowedPaths');
  const allowedServices = strings('allowedServices');
  const artifactDigests = strings('artifactDigests', true);
  const compiledPlan = validateAgentPlan(value.compiledPlan);
  if (compiledPlan.agentId !== value.agentId || compiledPlan.tenantId !== value.tenantId || compiledPlan.pluginId !== value.pluginId
    || compiledPlan.pluginVersionId !== value.pluginVersionId || compiledPlan.capability !== value.capability || compiledPlan.planDigest !== value.planDigest) failClosed('provisioning compiledPlan 身份或摘要不匹配');
  const planActions = [...new Set(compiledPlan.operations.map((operation) => operation.operationType))];
  if (!sameStringArray(planActions, actions)) failClosed('provisioning actions 与编译计划不匹配');
  // 编译 Plan 是命令范围的唯一事实来源。调用方可能来自旧执行快照，不能把旧版
  // commandRules 当成当前命令授权；从已验证 Plan 重新投影可兼容旧快照且不会扩大范围。
  const commandRules = deriveProvisioningCommandRules(compiledPlan);
  // 命令规则已经由同一份已验证 Plan 派生。这里只校验程序路径、工作目录和程序摘要的
  // 动态范围；参数模板由计划摘要和 Agent 端本地 commandRules 共同固定，避免现场路径
  // 规范化经过两套比较器后把同一条 Linux 命令误判为未覆盖。
  assertCompiledPlanScope(compiledPlan, allowedPaths, allowedServices, artifactDigests);
  if (actions.some((action) => !currentLocalPolicy.allowedActions.includes(action))) failClosed('provisioning 动作超出 Agent 本地能力上限');
  if (allowedServices.some((service) => !currentLocalPolicy.serviceRules.includes(service))) failClosed('provisioning 服务超出 Agent 本地能力上限');
  for (const path of allowedPaths) {
    const covering = currentLocalPolicy.pathRules.filter((rule) => isPathWithin(path, [rule.prefix]));
    if (covering.length === 0 || actions.some((action) => action.startsWith('filesystem.') && !covering.some((rule) => rule.operations.includes(action)))) failClosed('provisioning 路径超出 Agent 受控目录');
  }
  if (!bootstrapLocalPolicy) {
    for (const command of commandRules) {
      if (!currentLocalPolicy.commandRules.some((candidate) => sha256Digest(candidate) === sha256Digest(command))) failClosed('provisioning 命令规则超出 Agent 本地能力上限');
    }
  }
  return {
    tenantId: value.tenantId as string,
    agentId: value.agentId as string,
    pluginId: value.pluginId as string,
    pluginVersionId: value.pluginVersionId as string,
    capability: value.capability as string,
    planDigest: value.planDigest as string,
    policyRef: value.policyRef as string,
    policyVersion: value.policyVersion as string,
    actions,
    allowedPaths,
    allowedServices,
    commandRules,
    artifactDigests,
    ...(value.approvalRef === undefined ? {} : { approvalRef: requireText(value.approvalRef as string, 'provisioning approvalRef') }),
    lifetimeSeconds: value.lifetimeSeconds as number,
    currentLocalPolicy,
    ...(bootstrapLocalPolicy ? { bootstrapLocalPolicy: true } : {}),
    compiledPlan,
  };
}

function validateAgentTrustMaterialRequest(input: PolicyAuthorityAgentTrustMaterialRequestV1): void {
  exactRuntimeKeys(input as unknown as Record<string, unknown>, ['tenantId', 'agentId', 'osType'], 'Agent 信任材料请求');
  if (!isSafeIdentifier(input.tenantId) || !isSafeIdentifier(input.agentId)) failClosed('Agent 信任材料请求身份无效');
  if (input.osType !== undefined && (typeof input.osType !== 'string' || input.osType.length > 128)) {
    failClosed('Agent 信任材料请求 osType 无效');
  }
}

function validatePolicyAuthorityAgentTrustMaterial(
  material: PolicyAuthorityAgentTrustMaterialV1,
  keySet: PolicyAuthorityKeySetV1,
): void {
  if (material.materialVersion !== agentSecurityContractVersion
    || Number.isNaN(Date.parse(material.issuedAt))
    || Number.isNaN(Date.parse(material.validUntil))
    || Date.parse(material.validUntil) <= Date.parse(material.issuedAt)
    || material.localPolicy.agentId === ''
    || material.localPolicy.disabled
    || material.localPolicyAuthorityKeyId === ''
    || material.localPolicySignature === '') {
    failClosed('Agent 信任材料字段无效');
  }
  const trusted = keySet.keys.find((key) => key.keyId === material.localPolicyAuthorityKeyId);
  if (!trusted || material.localPolicy.authorityKeyIds.length !== 1 || material.localPolicy.authorityKeyIds[0] !== trusted.keyId) {
    failClosed('Agent 信任材料签发 Key 不在当前 KeySet');
  }
  if (!verifyPolicyPayload(material.localPolicy, material.localPolicySignature, trusted.publicKeyPem)) {
    failClosed('Agent 信任材料 localPolicy 签名无效');
  }
  if (!sameStringMap(material.capabilityKeySet, material.policyAuthorityKeySet)) {
    failClosed('Agent 信任材料 KeySet 不一致');
  }
}

function validateProvisioningCommandRules(value: unknown, path: string): AgentLocalCommandRuleV1[] {
  if (!Array.isArray(value) || value.length > 100) failClosed(`${path} 必须是数组`);
  const rules = value.map((item, index) => {
    const base = validateAgentLocalPolicy({
      policyVersion: agentSecurityContractVersion,
      agentId: 'provisioning-agent',
      authorityKeyIds: ['provisioning-authority'],
      allowedActions: ['command.execute_allowlisted'],
      pathRules: [],
      serviceRules: [],
      commandRules: [item],
      disabled: false,
      updatedAt: new Date(0).toISOString(),
    });
    return base.commandRules[0]!;
  });
  if (new Set(rules.map((rule) => sha256Digest(rule))).size !== rules.length) failClosed(`${path} 不能包含重复规则`);
  return rules;
}

function deriveProvisioningCommandRules(plan: AgentPlanV1): AgentLocalCommandRuleV1[] {
  const rules = plan.operations
    .filter((operation) => operation.operationType === 'command.execute_allowlisted')
    // Plan 命令 input 还包含执行时的 args 和 Artifact 摘要；这里只投影
    // Agent 本地命令规则合同允许的稳定字段，避免把动态 Artifact 写入 localPolicy。
    .map((operation) => projectCommandRuleFromPlanInput(operation.input));
  const validated = validateProvisioningCommandRules(rules, 'compiledPlan commandRules');
  const seen = new Set<string>();
  return validated.filter((rule) => {
    const digest = sha256Digest(rule);
    if (seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

function projectCommandRuleFromPlanInput(input: Record<string, unknown>): AgentLocalCommandRuleV1 {
  const rule = {
    executablePath: input.executablePath,
    executableSha256: input.executableSha256,
    argumentTemplate: input.argumentTemplate,
    environmentAllowlist: input.environmentAllowlist,
    workingDirectory: input.workingDirectory,
    networkScopes: input.networkScopes,
    childProcessPolicy: input.childProcessPolicy,
    timeoutSeconds: input.timeoutSeconds,
    outputLimitBytes: input.outputLimitBytes,
  };
  return rule as AgentLocalCommandRuleV1;
}

function assertCompiledPlanScope(
  plan: AgentPlanV1,
  allowedPaths: readonly string[],
  allowedServices: readonly string[],
  artifactDigests: readonly string[],
): void {
  for (const operation of plan.operations) {
    const path = typeof operation.input.path === 'string' ? operation.input.path : undefined;
    if (path && !isPathWithin(path, allowedPaths)) failClosed('provisioning allowedPaths 未覆盖编译计划路径');
    const serviceName = typeof operation.input.serviceName === 'string' ? operation.input.serviceName : undefined;
    if (serviceName && !allowedServices.includes(serviceName)) failClosed('provisioning allowedServices 未覆盖编译计划服务');
    const artifactDigest = typeof operation.input.artifactDigest === 'string' ? operation.input.artifactDigest : undefined;
    if (artifactDigest && !artifactDigests.includes(artifactDigest)) failClosed('provisioning artifactDigests 未覆盖编译计划 Artifact');
    if (operation.operationType !== 'command.execute_allowlisted') continue;
    const executablePath = typeof operation.input.executablePath === 'string' ? operation.input.executablePath : undefined;
    const workingDirectory = typeof operation.input.workingDirectory === 'string' ? operation.input.workingDirectory : undefined;
    const executableSha256 = typeof operation.input.executableSha256 === 'string' ? operation.input.executableSha256 : undefined;
    if (!executablePath || !isPathWithin(executablePath, allowedPaths)
      || !workingDirectory || !isPathWithin(workingDirectory, allowedPaths)
      || !executableSha256 || !artifactDigests.includes(executableSha256)) {
      failClosed('provisioning 命令范围未被编译计划授权覆盖');
    }
  }
}

function projectLocalPolicyUpperBound(
  policy: AgentLocalPolicyV1,
  agentId: string,
  authorityKeyId: string,
  bootstrap = false,
  bootstrapCommandRules: AgentLocalCommandRuleV1[] = [],
): AgentLocalPolicyV1 {
  if (!bootstrap && !policy.authorityKeyIds.includes(authorityKeyId)) failClosed('Agent 本地策略不信任当前 Policy Authority key');
  return validateAgentLocalPolicy({
    ...structuredClone(policy),
    agentId,
    authorityKeyIds: bootstrap ? [authorityKeyId] : [...policy.authorityKeyIds],
    ...(bootstrap ? { commandRules: structuredClone(bootstrapCommandRules) } : {}),
    // Artifact 摘要不在 AgentLocalPolicyV1 合同中，保证不会被投影到 Agent。
  });
}

function provisioningRequestDigest(request: PolicyAuthorityProvisioningRequestV1): string {
  const { updatedAt: _updatedAt, ...stableLocalPolicy } = request.currentLocalPolicy;
  const value = {
    tenantId: request.tenantId,
    agentId: request.agentId,
    pluginId: request.pluginId,
    pluginVersionId: request.pluginVersionId,
    capability: request.capability,
    planDigest: request.planDigest,
    policyRef: request.policyRef,
    policyVersion: request.policyVersion,
    actions: [...request.actions].sort(),
    allowedPaths: [...request.allowedPaths].sort(),
    allowedServices: [...request.allowedServices].sort(),
    commandRules: request.commandRules.map((rule) => sha256Digest(rule)).sort(),
    artifactDigests: [...request.artifactDigests].sort(),
    lifetimeSeconds: request.lifetimeSeconds,
    bootstrapLocalPolicy: request.bootstrapLocalPolicy === true,
    currentLocalPolicy: {
      ...stableLocalPolicy,
      allowedActions: [...request.currentLocalPolicy.allowedActions].sort(),
      pathRules: request.currentLocalPolicy.pathRules.map((rule) => ({ prefix: rule.prefix, operations: [...rule.operations].sort() })).sort((a, b) => a.prefix.localeCompare(b.prefix)),
      serviceRules: [...request.currentLocalPolicy.serviceRules].sort(),
      commandRules: request.currentLocalPolicy.commandRules.map((rule) => sha256Digest(rule)).sort(),
    },
    ...(request.approvalRef === undefined ? {} : { approvalRef: request.approvalRef }),
  };
  return sha256Digest(value);
}

export function validatePolicyAuthorityProvisioningResultV1(input: unknown): PolicyAuthorityProvisioningResultV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed('provisioning 结果必须是对象');
  const value = input as Record<string, unknown>;
  exactRuntimeKeys(value, ['provisioningVersion', 'revision', 'requestDigest', 'rule', 'localPolicyMaterial', 'receipt'], 'provisioning 结果');
  if (value.provisioningVersion !== policyAuthorityProvisioningVersion || typeof value.revision !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value.revision) || typeof value.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestDigest)) failClosed('provisioning 结果头无效');
  const rule = value.rule as Record<string, unknown>;
  const local = value.localPolicyMaterial as Record<string, unknown>;
  const receipt = value.receipt as Record<string, unknown>;
  const ruleBase = { ...rule };
  delete ruleBase.provisioningVersion;
  delete ruleBase.authorityKeyId;
  delete ruleBase.issuedAt;
  delete ruleBase.validUntil;
  delete ruleBase.signature;
  validatePolicyRule(ruleBase, 'provisioning.rule');
  if (rule.provisioningVersion !== policyAuthorityProvisioningVersion || typeof rule.authorityKeyId !== 'string' || typeof rule.issuedAt !== 'string' || typeof rule.validUntil !== 'string' || typeof rule.signature !== 'string' || typeof rule.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(rule.planDigest)) failClosed('provisioning.rule 签名材料无效');
  exactRuntimeKeys(local, ['materialVersion', 'tenantId', 'agentId', 'localPolicy', 'authorityKeyId', 'signature'], 'provisioning.localPolicyMaterial');
  if (local.materialVersion !== policyAuthorityProvisioningVersion || typeof local.tenantId !== 'string' || typeof local.agentId !== 'string' || typeof local.authorityKeyId !== 'string' || typeof local.signature !== 'string') failClosed('provisioning.localPolicyMaterial 无效');
  const localPolicy = validateAgentLocalPolicy(local.localPolicy);
  if (localPolicy.agentId !== local.agentId || local.tenantId !== rule.tenantId || local.agentId !== rule.agentId || local.authorityKeyId !== rule.authorityKeyId) failClosed('provisioning 本地策略身份不匹配');
  exactRuntimeKeys(receipt, ['receiptVersion', 'revision', 'requestDigest', 'ruleDigest', 'localPolicyDigest', 'issuedAt', 'signature'], 'provisioning.receipt');
  if (receipt.receiptVersion !== policyAuthorityProvisioningReceiptVersion || receipt.revision !== value.revision || receipt.requestDigest !== value.requestDigest || typeof receipt.ruleDigest !== 'string' || typeof receipt.localPolicyDigest !== 'string' || typeof receipt.issuedAt !== 'string' || typeof receipt.signature !== 'string') failClosed('provisioning.receipt 无效');
  const { signature: _localSignature, ...localUnsigned } = local;
  if (receipt.ruleDigest !== sha256Digest(rule) || receipt.localPolicyDigest !== sha256Digest(localUnsigned)) failClosed('provisioning 摘要与签名材料不匹配');
  return structuredClone(input as PolicyAuthorityProvisioningResultV1);
}

function assertProvisioningSignatures(result: PolicyAuthorityProvisioningResultV1, publicKeyPem: string): void {
  const { signature: _localSignature, ...localUnsigned } = result.localPolicyMaterial;
  if (!verifyPolicyPayload(result.rule, result.rule.signature, publicKeyPem)
    || !verifyPolicyPayload(result.localPolicyMaterial, result.localPolicyMaterial.signature, publicKeyPem)
    || !verifyPolicyPayload(result.receipt, result.receipt.signature, publicKeyPem)
    || result.receipt.ruleDigest !== sha256Digest(result.rule)
    || result.receipt.localPolicyDigest !== sha256Digest(localUnsigned)
    || result.receipt.revision !== result.revision
    || result.receipt.requestDigest !== result.requestDigest) failClosed('provisioning 签名或摘要校验失败');
}
function deniedEvaluation(input: PolicyAuthorityEvaluationInputV1, reason: string): PolicyAuthorityEvaluationV1 {
  return {
    allowed: false,
    actions: [...input.actions],
    allowedPaths: [...input.allowedPaths],
    allowedServices: [...input.allowedServices],
    artifactDigests: [...input.artifactDigests],
    policyRef: input.policyRef,
    policyVersion: input.policyVersion,
    reason,
  };
}
function isSubset(values: readonly string[], allowed: readonly string[]): boolean {
  return values.every((value) => allowed.includes(value));
}
function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function isPathWithin(value: string, prefixes: readonly string[]): boolean {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
  return prefixes.some((prefix) => {
    const root = prefix.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
    return normalized === root || normalized.startsWith(`${root}/`);
  });
}
const allowedPolicyActions = new Set([
  'process.list', 'service.list', 'service.status', 'filesystem.stat', 'filesystem.read', 'filesystem.backup',
  'filesystem.atomic_replace', 'filesystem.restore', 'certificate.material.validate', 'certificate.store.inspect', 'certificate.store.install',
  'service.start', 'service.stop', 'service.restart', 'service.reload', 'command.execute_allowlisted',
]);
function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) && !isDevelopmentIdentifier(value);
}
function isRevocationReference(value: string): boolean {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return false;
  return isSafeIdentifier(value.slice(0, separator)) && isSafeIdentifier(value.slice(separator + 1));
}
function isSafeAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value)
    && !value.split(/[\\/]/).includes('..')
    && value.length <= 1024;
}
function keySetFingerprint(keySet: PolicyAuthorityKeySetV1): string {
  return createHash('sha256').update(JSON.stringify({
    keySetVersion: keySet.keySetVersion,
    authorityId: keySet.authorityId,
    activeKeyId: keySet.activeKeyId,
    issuedAt: keySet.issuedAt,
    keys: [...keySet.keys].sort((left, right) => left.keyId.localeCompare(right.keyId)),
  })).digest('hex');
}
function requireDependency<T>(value: T | undefined, name: string): asserts value is T { if (!value) failClosed(`${name} 缺失`); }
function requireObject<T extends object>(value: T | undefined, name: string): T { if (!value || typeof value !== 'object') failClosed(`${name} 缺失`); return value; }
function requireCallable(value: object, name: string): void { if (typeof (value as Record<string, unknown>)[name] !== 'function') failClosed(`生产依赖 ${name} 缺失`); }
function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string { const value = environment[name]; if (!value?.trim()) failClosed(`缺少生产配置 ${name}`); return value; }
function parseSigningKeys(raw: string): ReadonlyMap<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failClosed('signing key JSON 无法解析');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failClosed('signing key JSON 必须是对象');
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.some(([keyId, privateKey]) => !keyId.trim() || typeof privateKey !== 'string' || !privateKey.trim())) {
    return failClosed('signing key JSON 包含无效条目');
  }
  for (const [keyId] of entries) rejectDevelopmentIdentifier(keyId, 'signingKeyId');
  return new Map(entries.map(([keyId, privateKey]) => [keyId, (privateKey as string).replaceAll('\\n', '\n')]));
}
function readSigningKeyFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    return failClosed(`Policy Authority signing key 文件无法读取：${filePath}`);
  }
}
function assertSigningKeyFile(filePath: string): void {
  try {
    if (!statSync(filePath).isFile()) throw new Error('路径类型不匹配');
  } catch (error) {
    failClosed(`Policy Authority signing key 文件不存在：${filePath}`);
  }
}
function requireText(value: string, path: string): string { if (typeof value !== 'string' || value.trim() === '') failClosed(`${path} 缺失`); return value; }
function isDevelopmentIdentifier(value: string): boolean {
  return /(?:^|[-_.:])(?:default|development|dev|test|fixture)(?:[-_.:]|$)/i.test(value);
}

export function validatePolicyAuthorityBootstrap(
  input: unknown,
  trustRoot: PolicyAuthorityTrustRootV1,
  now = new Date().toISOString(),
): PolicyAuthorityBootstrapV1 {
  const value = input as Record<string, unknown>;
  exactRuntimeKeys(value, ['bootstrapVersion', 'bootstrapId', 'authorityId', 'rootKeyId', 'rootFingerprintSha256', 'issuedAt', 'validUntil', 'signature'], 'Policy Authority Bootstrap');
  if (value.bootstrapVersion !== policyAuthorityBootstrapVersion
    || typeof value.bootstrapId !== 'string'
    || typeof value.authorityId !== 'string'
    || typeof value.rootKeyId !== 'string'
    || typeof value.rootFingerprintSha256 !== 'string'
    || typeof value.issuedAt !== 'string'
    || typeof value.validUntil !== 'string'
    || typeof value.signature !== 'string'
    || value.signature.trim() === '') {
    failClosed('Policy Authority Bootstrap 字段不完整');
  }
  if (!isSafeIdentifier(value.bootstrapId) || !isSafeIdentifier(value.authorityId) || !isSafeIdentifier(value.rootKeyId)) {
    failClosed('Policy Authority Bootstrap 标识符无效');
  }
  if (value.authorityId !== trustRoot.authorityId || value.rootKeyId !== trustRoot.rootKeyId) {
    failClosed('Policy Authority Bootstrap 未绑定独立信任根');
  }
  if (!/^[a-f0-9]{64}$/.test(value.rootFingerprintSha256)
    || value.rootFingerprintSha256 !== trustRoot.fingerprintSha256) {
    failClosed('Policy Authority Bootstrap 根指纹不匹配');
  }
  const issuedAt = Date.parse(value.issuedAt);
  const validUntil = Date.parse(value.validUntil);
  const nowValue = Date.parse(now);
  if (![issuedAt, validUntil, nowValue].every(Number.isFinite) || issuedAt > validUntil || nowValue < issuedAt || nowValue > validUntil) {
    failClosed('Policy Authority Bootstrap 已过期或尚未生效');
  }
  const bootstrap = {
    bootstrapVersion: policyAuthorityBootstrapVersion,
    bootstrapId: value.bootstrapId,
    authorityId: value.authorityId,
    rootKeyId: value.rootKeyId,
    rootFingerprintSha256: value.rootFingerprintSha256,
    issuedAt: value.issuedAt,
    validUntil: value.validUntil,
    signature: value.signature,
  } as PolicyAuthorityBootstrapV1;
  if (!verifyPolicyPayload(bootstrap, bootstrap.signature, trustRoot.publicKeyPem)) {
    failClosed('Policy Authority Bootstrap 根签名无效');
  }
  return structuredClone(bootstrap);
}

function validateTrustRoot(root: PolicyAuthorityTrustRootV1): PolicyAuthorityTrustRootV1 {
  exactRuntimeKeys(root, ['rootKeyId', 'authorityId', 'algorithm', 'publicKeyPem', 'fingerprintSha256'], '独立信任根');
  if (!root || root.algorithm !== 'Ed25519' || !root.rootKeyId || !root.authorityId || !root.publicKeyPem || !/^[a-f0-9]{64}$/.test(root.fingerprintSha256)) failClosed('独立信任根配置不完整');
  rejectDevelopmentIdentifier(root.rootKeyId, 'rootKeyId');
  rejectDevelopmentIdentifier(root.authorityId, 'authorityId');
  validatePublicKey(root.publicKeyPem);
  if (publicKeyFingerprint(root.publicKeyPem) !== root.fingerprintSha256) failClosed('独立信任根指纹不匹配');
  return structuredClone(root);
}

function rawEd25519PublicKey(publicKeyPem: string): string {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') failClosed('Policy Authority 公钥必须使用 Ed25519');
    const der = key.export({ type: 'spki', format: 'der' });
    return Buffer.from(der).subarray(-32).toString('base64');
  } catch (error) {
    if (error instanceof AppError) throw error;
    failClosed('Policy Authority 公钥无法转换为 Agent 信任材料');
  }
}

function sameStringMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function validateKeySetEnvelope(value: SignedPolicyAuthorityKeySetV1): void {
  exactRuntimeKeys(value, ['envelopeVersion', 'rootKeyId', 'authorityId', 'keySet', 'signature'], 'KeySet Envelope');
  if (!value || value.envelopeVersion !== agentSecurityContractVersion || !value.rootKeyId || !value.authorityId || !value.keySet || !value.signature) failClosed('KeySet Envelope 不完整');
  rejectDevelopmentIdentifier(value.rootKeyId, 'KeySet Envelope.rootKeyId');
  rejectDevelopmentIdentifier(value.authorityId, 'KeySet Envelope.authorityId');
}
function validateIssueRequest(request: PolicyAuthorityAuthorizationRequestV1, issuedAt: string): PolicyAuthorityAuthorizationRequestV1 {
  exactRuntimeKeys(request, ['agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'policyRef', 'policyVersion', 'planDigest', 'approvalRef', 'lifetimeSeconds'], '授权请求');
  if (request.policyRef === CERTIFICATE_UPDATE_POLICY_REF && request.policyVersion !== CERTIFICATE_UPDATE_POLICY_VERSION) failClosed('证书更新 policyVersion 必须统一为 v1');
  if (!Number.isInteger(request.lifetimeSeconds) || request.lifetimeSeconds < 1 || request.lifetimeSeconds > maximumTokenLifetimeSeconds) failClosed('Token 生命周期超出限制');
  const validUntil = addSeconds(issuedAt, request.lifetimeSeconds);
  const value = validateAgentCapabilityToken({
    tokenVersion: agentSecurityContractVersion,
    tokenId: 'request-token',
    agentId: request.agentId,
    tenantId: request.tenantId,
    pluginId: request.pluginId,
    pluginVersionId: request.pluginVersionId,
    capability: request.capability,
    actions: request.actions,
    allowedPaths: request.allowedPaths,
    allowedServices: request.allowedServices,
    artifactDigests: request.artifactDigests,
    ...(request.approvalRef !== undefined ? { approvalRef: request.approvalRef } : {}),
    policyRef: request.policyRef,
    policyVersion: request.policyVersion,
    issuedAt,
    expiresAt: validUntil,
    nonce: 'request-nonce',
    planDigest: request.planDigest,
    authorityKeyId: 'request-authority-key',
    signature: 'request-signature',
  });
  if (value.actions.length === 0) failClosed('授权动作不能为空');
  return {
    agentId: value.agentId,
    tenantId: value.tenantId,
    pluginId: value.pluginId,
    pluginVersionId: value.pluginVersionId,
    capability: value.capability,
    actions: value.actions,
    allowedPaths: value.allowedPaths,
    allowedServices: value.allowedServices,
    artifactDigests: value.artifactDigests,
    policyRef: value.policyRef,
    policyVersion: value.policyVersion,
    planDigest: value.planDigest,
    ...(value.approvalRef !== undefined ? { approvalRef: value.approvalRef } : {}),
    lifetimeSeconds: request.lifetimeSeconds,
  };
}
function validateEvaluation(evaluation: PolicyAuthorityEvaluationV1, request: PolicyAuthorityAuthorizationRequestV1, issuedAt: string, validUntil: string): PolicyAuthorityEvaluationV1 {
  if (!evaluation || typeof evaluation.allowed !== 'boolean') failClosed('策略评估结果不完整');
  const value = validateAgentCapabilityToken({ tokenVersion: agentSecurityContractVersion, tokenId: 'evaluation-token', agentId: request.agentId, tenantId: request.tenantId, pluginId: request.pluginId, pluginVersionId: request.pluginVersionId, capability: request.capability, actions: evaluation.actions, allowedPaths: evaluation.allowedPaths, allowedServices: evaluation.allowedServices, artifactDigests: evaluation.artifactDigests, policyRef: evaluation.policyRef, policyVersion: evaluation.policyVersion, issuedAt, expiresAt: validUntil, nonce: 'evaluation-nonce', planDigest: request.planDigest, authorityKeyId: 'evaluation-authority-key', signature: 'evaluation-signature' });
  if (value.actions.length === 0) failClosed('策略评估未返回动作');
  assertSubset(value.actions, request.actions, '策略评估动作');
  assertSubset(value.allowedPaths, request.allowedPaths, '策略评估路径');
  assertSubset(value.allowedServices, request.allowedServices, '策略评估服务');
  assertSubset(value.artifactDigests, request.artifactDigests, '策略评估 Artifact');
  if (evaluation.policyRef !== request.policyRef || evaluation.policyVersion !== request.policyVersion) failClosed('策略引用绑定不匹配');
  if (evaluation.reason !== undefined
    && (typeof evaluation.reason !== 'string' || evaluation.reason.trim() === '')) {
    failClosed('策略拒绝原因不能为空');
  }
  return {
    allowed: evaluation.allowed,
    actions: value.actions,
    allowedPaths: value.allowedPaths,
    allowedServices: value.allowedServices,
    artifactDigests: value.artifactDigests,
    policyRef: value.policyRef,
    policyVersion: value.policyVersion,
    ...(evaluation.reason !== undefined ? { reason: evaluation.reason } : {}),
  };
}
function assertSubset(values: string[], allowed: string[], label: string): void { if (values.some((value) => !allowed.includes(value))) failClosed(`${label}超出请求范围`); }
function verifyTokenSignature(value: unknown, publicKeyPem: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signature = (value as Record<string, unknown>).signature;
  return typeof signature === 'string' && verifyPolicyPayload(value, signature, publicKeyPem);
}
function validatePublicKey(publicKeyPem: string): void { try { if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519') failClosed('Policy Authority 公钥算法不匹配'); } catch { failClosed('Policy Authority 公钥无效'); } }
function publicKeyFingerprint(publicKeyPem: string): string { return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex'); }
function assertPrivateKeyMatches(publicKeyPem: string, privateKey: KeyObject | string): void {
  try {
    const expected = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    const actualKey = createPublicKey(privateKey);
    if (actualKey.asymmetricKeyType !== 'ed25519') failClosed('Policy Authority signing key 算法不匹配');
    const actual = actualKey.export({ type: 'spki', format: 'der' });
    if (!expected.equals(actual)) failClosed('Policy Authority signing key 与 KeySet 公钥不匹配');
  } catch { failClosed('Policy Authority signing key 无效'); }
}
function addSeconds(start: string, seconds: number): string { return new Date(Date.parse(start) + seconds * 1000).toISOString(); }
function isWithin(now: string, start: string, end: string): boolean { const nowMs = Date.parse(now); return Number.isFinite(nowMs) && nowMs >= Date.parse(start) && nowMs <= Date.parse(end); }
function exactRuntimeKeys(value: unknown, allowed: string[], path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failClosed(`${path} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) failClosed(`${path} 包含未知字段`);
}
function rejectDevelopmentIdentifier(value: string, path: string): void {
  if (isDevelopmentIdentifier(value)) failClosed(`${path} 禁止使用开发默认密钥`);
}
function failClosed(message: string, details?: unknown): never { throw new AppError('SYSTEM_INTERNAL_ERROR', `Policy Authority 已失败关闭：${message}`, details, false); }
