import { createHash, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import { AppError } from '../../../common/errors/app-error.js';
import {
  agentSecurityContractVersion,
  authorizeAgentPlan,
  maximumTokenLifetimeSeconds,
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
  type AgentLocalPolicyV1,
  type AgentPlanV1,
  type DecisionRevocationRecordV1,
  type NonceConsumptionRecordV1,
  type NonceStoreV1Port,
  type PolicyAuthorityDecisionV1,
  type PolicyAuthorityKeySetV1,
  type TokenRevocationRecordV1,
} from './agent-security.contract.js';

export interface PolicyAuthorityTrustRootV1 {
  rootKeyId: string;
  authorityId: string;
  algorithm: 'Ed25519';
  publicKeyPem: string;
  fingerprintSha256: string;
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
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
}

export interface SignedPolicyAuthorityPolicyBundleV1 {
  bundleVersion: typeof policyAuthorityPolicyBundleVersion;
  authorityId: string;
  issuedAt: string;
  rules: PolicyAuthorityPolicyRuleV1[];
  signature: string;
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
      && candidate.capability === input.capability,
    );
    if (!rule) return deniedEvaluation(input, '生产策略未匹配当前租户、Agent、插件版本或 Capability');
    if (!isSubset(input.actions, rule.actions)
      || !isSubset(input.allowedPaths, rule.allowedPaths)
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
      || value.revokedKeyIds.some((item) => !isSafeIdentifier(item as string))
      || value.revokedTokenIds.some((item) => /(?:default|development|dev-key)/i.test(item as string))
      || value.revokedKeyIds.some((item) => /(?:default|development|dev-key)/i.test(item as string))) {
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
  signingKeySource: PolicyAuthoritySigningKeySourceV1;
  evaluator: PolicyAuthorityEvaluatorV1;
  revocations: PolicyAuthorityRevocationStoreV1;
  nonceStore: NonceStoreV1Port;
  now?: () => string;
}

/**
 * Policy Authority 的进程内服务边界。所有安全材料和状态都必须由外部安全控制面显式注入。
 * 本类不读取数据库、不加载插件，也不提供任何开发密钥或隐式降级路径。
 */
export class PolicyAuthorityServiceV1 {
  private readonly trustRoot: PolicyAuthorityTrustRootV1;
  private readonly signingKeySource: PolicyAuthoritySigningKeySourceV1;
  private readonly evaluator: PolicyAuthorityEvaluatorV1;
  private readonly revocations: PolicyAuthorityRevocationStoreV1;
  private readonly nonceStore: NonceStoreV1Port;
  private readonly now: () => string;
  private currentKeySet: PolicyAuthorityKeySetV1;

  constructor(options: PolicyAuthorityServiceOptionsV1) {
    requireDependency(options, 'Policy Authority 配置');
    this.trustRoot = validateTrustRoot(options.trustRoot);
    this.signingKeySource = requireObject(options.signingKeySource, 'signingKeySource');
    this.evaluator = requireObject(options.evaluator, 'evaluator');
    this.revocations = requireObject(options.revocations, 'revocations');
    this.nonceStore = requireObject(options.nonceStore, 'nonceStore');
    this.now = options.now ?? (() => new Date().toISOString());
    let initialKeySet: SignedPolicyAuthorityKeySetV1;
    try {
      initialKeySet = resolveKeySet(options.keySet);
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('KeySet 来源不可用');
    }
    const now = this.currentTime();
    this.currentKeySet = this.loadAndVerifyKeySet(initialKeySet, now);
    this.assertSigningKey(this.currentKeySet, now);
  }

  getTrustedKeySet(): PolicyAuthorityKeySetV1 {
    return structuredClone(this.currentKeySet);
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
    const next = this.loadAndVerifyKeySet(nextSource, now);
    if (Date.parse(next.issuedAt) < Date.parse(this.currentKeySet.issuedAt)) failClosed('KeySet 轮换版本不能回退');
    this.assertSigningKey(next, now);
    this.currentKeySet = next;
  }

  issueAuthorization(request: PolicyAuthorityAuthorizationRequestV1): PolicyAuthorityAuthorizationResultV1 {
    const issuedAt = this.currentTime();
    const validUntil = addSeconds(issuedAt, request.lifetimeSeconds);
    validateIssueRequest(request, issuedAt, validUntil);
    const activeKey = this.getActiveSigningKey(issuedAt);
    const evaluationInput: PolicyAuthorityEvaluationInputV1 = { ...request, issuedAt, validUntil };
    let evaluation: PolicyAuthorityEvaluationV1;
    try {
      evaluation = this.evaluator.evaluate(structuredClone(evaluationInput));
    } catch (error) {
      if (error instanceof AppError) throw error;
      failClosed('策略评估失败');
    }
    validateEvaluation(evaluation, request, issuedAt, validUntil);

    const tokenId = `token-${randomUUID()}`;
    const nonce = `nonce-${randomUUID()}`;
    const decisionValue: Omit<PolicyAuthorityDecisionV1, 'signature'> = {
      decisionVersion: agentSecurityContractVersion,
      decisionId: `decision-${randomUUID()}`,
      allowed: evaluation.allowed,
      agentId: request.agentId,
      tenantId: request.tenantId,
      pluginId: request.pluginId,
      pluginVersionId: request.pluginVersionId,
      capability: request.capability,
      actions: evaluation.actions,
      allowedPaths: evaluation.allowedPaths,
      allowedServices: evaluation.allowedServices,
      artifactDigests: evaluation.artifactDigests,
      policyRef: evaluation.policyRef,
      policyVersion: evaluation.policyVersion,
      planDigest: request.planDigest,
      tokenId,
      nonce,
      issuedAt,
      validUntil,
      authorityKeyId: activeKey.keyId,
      revocationRef: `revocation-${randomUUID()}`,
      ...(request.approvalRef ? { approvalRef: request.approvalRef } : {}),
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    };
    const decision = validatePolicyAuthorityDecision({ ...decisionValue, signature: signPolicyPayload(decisionValue, activeKey.privateKey) });
    if (!evaluation.allowed) return { decision };

    const tokenValue: Omit<AgentCapabilityTokenV1, 'signature'> = {
      tokenVersion: agentSecurityContractVersion,
      tokenId,
      agentId: request.agentId,
      tenantId: request.tenantId,
      pluginId: request.pluginId,
      pluginVersionId: request.pluginVersionId,
      capability: request.capability,
      actions: evaluation.actions,
      allowedPaths: evaluation.allowedPaths,
      allowedServices: evaluation.allowedServices,
      artifactDigests: evaluation.artifactDigests,
      ...(request.approvalRef ? { approvalRef: request.approvalRef } : {}),
      policyRef: evaluation.policyRef,
      policyVersion: evaluation.policyVersion,
      issuedAt,
      expiresAt: validUntil,
      nonce,
      planDigest: request.planDigest,
      authorityKeyId: activeKey.keyId,
    };
    const token = validateAgentCapabilityToken({ ...tokenValue, signature: signPolicyPayload(tokenValue, activeKey.privateKey) });
    return { decision, token };
  }

  /** Agent 侧最终授权入口：重新校验合同、签名、绑定、撤销、过期和一次性 Nonce。 */
  authorize(input: { plan: unknown; token: unknown; decision: unknown; localPolicy: unknown }): NonceConsumptionRecordV1 {
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
      validatePublicKey(key.publicKeyPem);
      if (key.keyId === this.trustRoot.rootKeyId || publicKeyFingerprint(key.publicKeyPem) === this.trustRoot.fingerprintSha256) {
        failClosed('Policy Authority signing key 必须独立于信任根');
      }
    }
    if (!verifyTokenSignature(envelope, this.trustRoot.publicKeyPem)) failClosed('KeySet 信任根签名无效');
    if (Date.parse(keySet.issuedAt) > Date.parse(now) + 60_000) failClosed('KeySet 签发时间超前');
    return keySet;
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
 * 生产签名私钥来源。环境变量必须是 keyId 到 PEM 的完整映射，保证 KeySet 轮换时不存在按位置猜测私钥的路径。
 */
export class ProductionPolicyAuthoritySigningKeySourceV1 implements PolicyAuthoritySigningKeySourceV1 {
  private readonly keys: ReadonlyMap<string, string>;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    const raw = requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON');
    this.keys = parseSigningKeys(raw);
  }

  getPrivateKey(keyId: string): string | undefined {
    return this.keys.get(keyId);
  }
}

export interface ProductionPolicyAuthorityServicesV1 {
  service: PolicyAuthorityServiceV1;
  trustRoot: ProductionPolicyAuthorityTrustRootServiceV1;
  keySet: ProductionPolicyAuthorityKeySetServiceV1;
  signingKeys: ProductionPolicyAuthoritySigningKeySourceV1;
  policy: ProductionPolicyAuthorityPolicyServiceV1;
  state: FilePolicyAuthorityStateStoreV1;
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
  if (requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_PROCESS_ROLE') !== 'standalone') {
    failClosed('Policy Authority 必须以 standalone 进程角色启动');
  }
  const trustRoot = new ProductionPolicyAuthorityTrustRootServiceV1(environment);
  const keySet = new ProductionPolicyAuthorityKeySetServiceV1(environment);
  const signingKeys = new ProductionPolicyAuthoritySigningKeySourceV1(environment);
  const trustRootValue = trustRoot.getTrustRoot();
  const policy = new ProductionPolicyAuthorityPolicyServiceV1(environment);
  const state = new FilePolicyAuthorityStateStoreV1(requiredEnvironment(environment, 'GCAC_POLICY_AUTHORITY_STATE_FILE'));
  const service = new PolicyAuthorityServiceV1({
    trustRoot: trustRootValue,
    keySet,
    signingKeySource: signingKeys,
    evaluator: new SignedPolicyAuthorityPolicyEvaluatorV1(policy.load(trustRootValue), trustRootValue),
    revocations: state,
    nonceStore: state,
  });
  const services = { service, trustRoot, keySet, signingKeys, policy, state };
  productionPolicyAuthorityServices.add(services);
  return services;
}

function resolveKeySet(value: SignedPolicyAuthorityKeySetV1 | PolicyAuthorityKeySetSourceV1): SignedPolicyAuthorityKeySetV1 {
  if (typeof (value as PolicyAuthorityKeySetSourceV1).load === 'function') return (value as PolicyAuthorityKeySetSourceV1).load();
  return value as SignedPolicyAuthorityKeySetV1;
}
function validatePolicyBundle(input: unknown, trustRoot: PolicyAuthorityTrustRootV1): SignedPolicyAuthorityPolicyBundleV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failClosed('生产策略包必须是对象');
  const value = input as Record<string, unknown>;
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
  const value = input as Record<string, unknown>;
  exactRuntimeKeys(value, ['policyRef', 'policyVersion', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests'], path);
  const fields = ['policyRef', 'policyVersion', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability'] as const;
  for (const field of fields) if (typeof value[field] !== 'string' || !value[field].trim()) failClosed(`${path}.${field} 缺失`);
  if (!/^(?:web|app|device|cloud|ca)\.[a-z0-9]+(?:\.[a-z0-9-]+)*$/.test(value.pluginId as string)) failClosed(`${path}.pluginId 不是 Canonical Plugin ID`);
  for (const field of ['actions', 'allowedPaths', 'allowedServices', 'artifactDigests'] as const) {
    if (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === 'string' && item.trim())) failClosed(`${path}.${field} 无效`);
  }
  if ((value.actions as string[]).some((item) => !allowedPolicyActions.has(item))) failClosed(`${path}.actions 包含未授权操作`);
  if ((value.allowedPaths as string[]).some((item) => !isSafeAbsolutePath(item))) failClosed(`${path}.allowedPaths 包含非法路径`);
  if ((value.artifactDigests as string[]).some((item) => !/^[a-f0-9]{64}$/.test(item))) failClosed(`${path}.artifactDigests 包含非法摘要`);
  return {
    policyRef: value.policyRef as string,
    policyVersion: value.policyVersion as string,
    agentId: value.agentId as string,
    tenantId: value.tenantId as string,
    pluginId: value.pluginId as string,
    pluginVersionId: value.pluginVersionId as string,
    capability: value.capability as string,
    actions: [...value.actions as string[]],
    allowedPaths: [...value.allowedPaths as string[]],
    allowedServices: [...value.allowedServices as string[]],
    artifactDigests: [...value.artifactDigests as string[]],
  };
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
const allowedPolicyActions = new Set([
  'process.list', 'service.list', 'service.status', 'filesystem.stat', 'filesystem.read', 'filesystem.backup',
  'filesystem.atomic_replace', 'filesystem.restore', 'certificate.material.validate', 'certificate.store.inspect',
  'service.start', 'service.stop', 'service.reload', 'command.execute_allowlisted',
]);
function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) && !/(?:default|development|dev-key)/i.test(value);
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
function requireDependency<T>(value: T | undefined, name: string): asserts value is T { if (!value) failClosed(`${name} 缺失`); }
function requireObject<T extends object>(value: T | undefined, name: string): T { if (!value || typeof value !== 'object') failClosed(`${name} 缺失`); return value; }
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
function requireText(value: string, path: string): string { if (typeof value !== 'string' || value.trim() === '') failClosed(`${path} 缺失`); return value; }
function validateTrustRoot(root: PolicyAuthorityTrustRootV1): PolicyAuthorityTrustRootV1 {
  exactRuntimeKeys(root, ['rootKeyId', 'authorityId', 'algorithm', 'publicKeyPem', 'fingerprintSha256'], '独立信任根');
  if (!root || root.algorithm !== 'Ed25519' || !root.rootKeyId || !root.authorityId || !root.publicKeyPem || !/^[a-f0-9]{64}$/.test(root.fingerprintSha256)) failClosed('独立信任根配置不完整');
  rejectDevelopmentIdentifier(root.rootKeyId, 'rootKeyId');
  rejectDevelopmentIdentifier(root.authorityId, 'authorityId');
  validatePublicKey(root.publicKeyPem);
  if (publicKeyFingerprint(root.publicKeyPem) !== root.fingerprintSha256) failClosed('独立信任根指纹不匹配');
  return structuredClone(root);
}
function validateKeySetEnvelope(value: SignedPolicyAuthorityKeySetV1): void {
  exactRuntimeKeys(value, ['envelopeVersion', 'rootKeyId', 'authorityId', 'keySet', 'signature'], 'KeySet Envelope');
  if (!value || value.envelopeVersion !== agentSecurityContractVersion || !value.rootKeyId || !value.authorityId || !value.keySet || !value.signature) failClosed('KeySet Envelope 不完整');
  rejectDevelopmentIdentifier(value.rootKeyId, 'KeySet Envelope.rootKeyId');
  rejectDevelopmentIdentifier(value.authorityId, 'KeySet Envelope.authorityId');
}
function validateIssueRequest(request: PolicyAuthorityAuthorizationRequestV1, issuedAt: string, validUntil: string): void {
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
    ...(request.approvalRef ? { approvalRef: request.approvalRef } : {}),
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
  if (request.lifetimeSeconds < 1 || request.lifetimeSeconds > maximumTokenLifetimeSeconds || !Number.isInteger(request.lifetimeSeconds)) failClosed('Token 生命周期超出限制');
}
function validateEvaluation(evaluation: PolicyAuthorityEvaluationV1, request: PolicyAuthorityAuthorizationRequestV1, issuedAt: string, validUntil: string): void {
  if (!evaluation || typeof evaluation.allowed !== 'boolean') failClosed('策略评估结果不完整');
  const value = validateAgentCapabilityToken({ tokenVersion: agentSecurityContractVersion, tokenId: 'evaluation-token', agentId: request.agentId, tenantId: request.tenantId, pluginId: request.pluginId, pluginVersionId: request.pluginVersionId, capability: request.capability, actions: evaluation.actions, allowedPaths: evaluation.allowedPaths, allowedServices: evaluation.allowedServices, artifactDigests: evaluation.artifactDigests, policyRef: evaluation.policyRef, policyVersion: evaluation.policyVersion, issuedAt, expiresAt: validUntil, nonce: 'evaluation-nonce', planDigest: request.planDigest, authorityKeyId: 'evaluation-authority-key', signature: 'evaluation-signature' });
  if (value.actions.length === 0) failClosed('策略评估未返回动作');
  assertSubset(value.actions, request.actions, '策略评估动作');
  assertSubset(value.allowedPaths, request.allowedPaths, '策略评估路径');
  assertSubset(value.allowedServices, request.allowedServices, '策略评估服务');
  assertSubset(value.artifactDigests, request.artifactDigests, '策略评估 Artifact');
  if (evaluation.policyRef !== request.policyRef || evaluation.policyVersion !== request.policyVersion) failClosed('策略引用绑定不匹配');
  if (evaluation.reason !== undefined && !evaluation.reason.trim()) failClosed('策略拒绝原因不能为空');
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
  if (/(?:default|development|dev-key)/i.test(value)) failClosed(`${path} 禁止使用开发默认密钥`);
}
function failClosed(message: string): never { throw new AppError('SYSTEM_INTERNAL_ERROR', `Policy Authority 已失败关闭：${message}`, undefined, false); }
