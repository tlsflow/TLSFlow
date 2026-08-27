import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { UnifiedAgentPlanAuthorizationDependenciesV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';
import {
  agentSecurityContractVersion,
  computeAgentPlanDigest,
  validateAgentCapabilityToken,
  validateAgentPlan,
  validatePolicyAuthorityDecision,
  type AgentPlanV1,
} from '../../agents/security/agent-security.contract.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../../agents/schema/agents.schema.js';
import type { AgentLocalPolicyV1 } from '../../agents/security/agent-security.contract.js';

export const AGENT_KEY_CUSTODY_POLICY_REF = 'certificate-key-custody' as const;
export const AGENT_KEY_CUSTODY_POLICY_VERSION = 'v1' as const;

export interface AgentKeyCustodyPluginAnchor {
  pluginId: string;
  pluginVersionId: string;
}

export interface AgentKeyCsrTaskInput {
  certificateRequestId: string;
  agentId: string;
  targetId: string;
  commonName: string;
  sans: string[];
  keyPath: string;
  certificatePath?: string;
  format?: 'pem' | 'pkcs12' | 'jks';
  alias?: string;
  /** Tomcat 配置文件路径；密码只在 Agent 本机读取，不进入任务载荷。 */
  configPath?: string;
  algorithm: 'rsa' | 'ec';
  rsaBits?: number;
  storageMode?: 'file_pem' | 'windows_cng';
  idempotencyKey: string;
  pluginId?: string;
  pluginVersionId?: string;
}

export interface AgentIssuedCertificateTaskInput {
  certificateRequestId: string;
  agentId: string;
  targetId: string;
  keyPath: string;
  certificatePath: string;
  localKeyRef: string;
  expectedPublicKeyFingerprintSha256: string;
  certificatePem: string;
  certificateChainPem: string;
  format: 'pem' | 'pkcs12' | 'jks';
  storageMode?: 'file_pem' | 'windows_cng';
  alias?: string;
  /** Tomcat 配置文件路径；密码只在 Agent 本机读取，不进入任务载荷。 */
  configPath?: string;
  idempotencyKey: string;
  pluginId?: string;
  pluginVersionId?: string;
}

type AgentTaskQueue = Pick<AgentsApplicationService, 'enqueueTask' | 'findTaskByIdempotencyKey'>;

/**
 * 本机持钥的唯一控制面适配器。它不接触私钥，只把受限 Agent Plan 交给
 * Policy Authority 签发，再写入现有 Agent v2 任务队列。
 */
export class AgentKeyCustodyAdapter {
  constructor(private readonly dependencies: {
    agents: AgentTaskQueue;
    authorization: UnifiedAgentPlanAuthorizationDependenciesV1;
    resolvePluginAnchor?: (input: { tenantId: string; agentId: string; targetId: string; pluginId?: string; pluginVersionId?: string }) => Promise<AgentKeyCustodyPluginAnchor>;
  }) {}

  async generateCsr(tenantId: string, input: AgentKeyCsrTaskInput): Promise<AgentTaskEnvelope> {
    const anchor = await this.resolveAnchor(tenantId, input);
    const operationId = `key-generate-${safeId(input.certificateRequestId)}`;
    const planId = `certificate-key-${safeId(input.certificateRequestId)}`;
    const operationInput: Record<string, unknown> = {
      path: requiredPath(input.keyPath, 'keyPath'),
      targetId: required(input.targetId, 'targetId'),
      commonName: required(input.commonName, 'commonName'),
      sans: [...input.sans],
      algorithm: input.algorithm,
      ...(input.rsaBits === undefined ? {} : { rsaBits: input.rsaBits }),
      ...(input.storageMode === undefined ? {} : { storageMode: input.storageMode }),
    };
    const operationKey = `certificate-request:${input.certificateRequestId}:key-generate`;
    const draft = draftPlan({
      planId,
      operationId,
      operationType: 'key.generate_csr',
      operationInput,
      operationKey,
      tenantId,
      agentId: input.agentId,
      pluginId: anchor.pluginId,
      pluginVersionId: anchor.pluginVersionId,
    });
    const authorized = await this.authorize({
      tenantId,
      agentId: input.agentId,
      anchor,
      plan: draft,
      actions: ['key.generate_csr'],
      allowedPaths: [requiredPath(input.keyPath, 'keyPath')],
    });
    const payload = buildPayload(authorized, {
      certificateRequestId: input.certificateRequestId,
      targetId: input.targetId,
      operation: 'key.generate_csr',
      keyPath: input.keyPath,
      ...(input.certificatePath ? { certificatePath: input.certificatePath } : {}),
      ...(input.format ? { format: input.format } : {}),
      ...(input.alias ? { alias: input.alias } : {}),
      ...(input.configPath ? { configPath: input.configPath } : {}),
      ...(input.storageMode ? { storageMode: input.storageMode } : {}),
      ...(input.pluginId ? { pluginId: input.pluginId } : {}),
      ...(input.pluginVersionId ? { pluginVersionId: input.pluginVersionId } : {}),
    });
    return this.enqueue(tenantId, input.agentId, operationKey, payload, `certificate-key:${input.certificateRequestId}:generate`);
  }

  async installIssuedCertificate(tenantId: string, input: AgentIssuedCertificateTaskInput): Promise<AgentTaskEnvelope> {
    assertPublicCertificateMaterial(input.certificatePem, 'certificatePem');
    assertPublicCertificateMaterial(input.certificateChainPem, 'certificateChainPem');
    const anchor = await this.resolveAnchor(tenantId, input);
    const operationId = `certificate-install-${safeId(input.certificateRequestId)}`;
    const planId = `certificate-install-${safeId(input.certificateRequestId)}`;
    const operationKey = `certificate-request:${input.certificateRequestId}:certificate-install`;
    const operationInput: Record<string, unknown> = {
      path: requiredPath(input.certificatePath, 'certificatePath'),
      keyPath: requiredPath(input.keyPath, 'keyPath'),
      targetId: required(input.targetId, 'targetId'),
      localKeyRef: required(input.localKeyRef, 'localKeyRef'),
      certificatePem: input.certificatePem,
      certificateChainPem: input.certificateChainPem,
      expectedPublicKeyFingerprintSha256: digest(input.expectedPublicKeyFingerprintSha256, 'expectedPublicKeyFingerprintSha256'),
      format: input.format,
      ...(input.alias === undefined ? {} : { alias: input.alias }),
      ...(input.storageMode === undefined ? {} : { storageMode: input.storageMode }),
      ...(input.configPath === undefined ? {} : { configPath: requiredPath(input.configPath, 'configPath') }),
    };
    const draft = draftPlan({
      planId,
      operationId,
      operationType: 'certificate.install_issued',
      operationInput,
      operationKey,
      tenantId,
      agentId: input.agentId,
      pluginId: anchor.pluginId,
      pluginVersionId: anchor.pluginVersionId,
    });
    const authorized = await this.authorize({
      tenantId,
      agentId: input.agentId,
      anchor,
      plan: draft,
      actions: ['certificate.install_issued'],
      allowedPaths: [
        requiredPath(input.certificatePath, 'certificatePath'),
        requiredPath(input.keyPath, 'keyPath'),
        ...(input.configPath ? [requiredPath(input.configPath, 'configPath')] : []),
      ],
    });
    const payload = buildPayload(authorized, {
      certificateRequestId: input.certificateRequestId,
      targetId: input.targetId,
      operation: 'certificate.install_issued',
      keyPath: input.keyPath,
      ...(input.configPath ? { configPath: input.configPath } : {}),
    });
    return this.enqueue(tenantId, input.agentId, operationKey, payload, `certificate-key:${input.certificateRequestId}:install`);
  }

  private async resolveAnchor(tenantId: string, input: { agentId: string; targetId: string; pluginId?: string; pluginVersionId?: string }): Promise<AgentKeyCustodyPluginAnchor> {
    if (Boolean(input.pluginId) !== Boolean(input.pluginVersionId)) {
      throw new AppError('VALIDATION_FAILED', 'pluginId 与 pluginVersionId 必须同时提供');
    }
    if (this.dependencies.resolvePluginAnchor) {
      const resolved = await this.dependencies.resolvePluginAnchor({
        tenantId,
        agentId: input.agentId,
        targetId: input.targetId,
        ...(input.pluginId ? { pluginId: input.pluginId } : {}),
        ...(input.pluginVersionId ? { pluginVersionId: input.pluginVersionId } : {}),
      });
      if (input.pluginId && input.pluginVersionId
        && (resolved.pluginId !== input.pluginId || resolved.pluginVersionId !== input.pluginVersionId)) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '本机持钥任务的 PluginVersion 与目标当前生效能力不一致', {
          requestedPluginId: input.pluginId,
          requestedPluginVersionId: input.pluginVersionId,
          effectivePluginId: resolved.pluginId,
          effectivePluginVersionId: resolved.pluginVersionId,
        });
      }
      return resolved;
    }
    if (input.pluginId && input.pluginVersionId) return { pluginId: input.pluginId, pluginVersionId: input.pluginVersionId };
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '本机持钥任务缺少固定 PluginVersion 授权锚点', { fallback: false });
  }

  private async authorize(input: {
    tenantId: string;
    agentId: string;
    anchor: AgentKeyCustodyPluginAnchor;
    plan: AgentPlanV1;
    actions: string[];
    allowedPaths: string[];
  }): Promise<{ plan: AgentPlanV1; token: ReturnType<typeof validateAgentCapabilityToken>; policyDecision: ReturnType<typeof validatePolicyAuthorityDecision> }> {
    const dependencies = this.dependencies.authorization;
    dependencies.policyAuthority.assertReady();
    if (dependencies.localPolicy && typeof dependencies.policyAuthority.provisionAgentPlan === 'function') {
      const currentLocalPolicy = await dependencies.localPolicy.resolve({ agentId: input.agentId, tenantId: input.tenantId });
      await dependencies.policyAuthority.provisionAgentPlan({
        tenantId: input.tenantId,
        agentId: input.agentId,
        pluginId: input.anchor.pluginId,
        pluginVersionId: input.anchor.pluginVersionId,
        capability: 'certificate.key.custody',
        planDigest: input.plan.planDigest,
        policyRef: AGENT_KEY_CUSTODY_POLICY_REF,
        policyVersion: AGENT_KEY_CUSTODY_POLICY_VERSION,
        actions: [...input.actions],
        allowedPaths: [...input.allowedPaths],
        allowedServices: [],
        commandRules: [],
        artifactDigests: [],
        lifetimeSeconds: 600,
        currentLocalPolicy: currentLocalPolicy as AgentLocalPolicyV1,
        compiledPlan: input.plan,
      });
    }
    const result = await dependencies.policyAuthority.issueAuthorization({
      agentId: input.agentId,
      tenantId: input.tenantId,
      pluginId: input.anchor.pluginId,
      pluginVersionId: input.anchor.pluginVersionId,
      capability: 'certificate.key.custody',
      actions: [...input.actions],
      allowedPaths: [...input.allowedPaths],
      allowedServices: [],
      artifactDigests: [],
      policyRef: AGENT_KEY_CUSTODY_POLICY_REF,
      policyVersion: AGENT_KEY_CUSTODY_POLICY_VERSION,
      planDigest: input.plan.planDigest,
      lifetimeSeconds: 600,
    });
    const policyDecision = validatePolicyAuthorityDecision(result.decision);
    if (!policyDecision.allowed || !result.token) {
      throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Policy Authority 拒绝本机持钥任务授权', { reason: policyDecision.reason, fallback: false });
    }
    const token = validateAgentCapabilityToken(result.token);
    const plan = validateAgentPlan({
      ...input.plan,
      tokenId: token.tokenId,
      policyDecisionId: policyDecision.decisionId,
      nonce: token.nonce,
      expiresAt: token.expiresAt,
      ...(token.approvalRef ? { approvalRef: token.approvalRef } : {}),
    });
    return { plan, token, policyDecision };
  }

  private async enqueue(tenantId: string, agentId: string, idempotencyKey: string, payload: Record<string, unknown>, requestId: string): Promise<AgentTaskEnvelope> {
    const existing = await this.dependencies.agents.findTaskByIdempotencyKey(tenantId, agentId, idempotencyKey);
    if (existing) return existing;
    return this.dependencies.agents.enqueueTask(tenantId, {
      agentId,
      executionRunId: payload.plan && typeof payload.plan === 'object' ? String((payload.plan as Record<string, unknown>).planId) : idempotencyKey,
      executionStepId: idempotencyKey,
      idempotencyKey,
      payload,
    }, requestId);
  }
}

function draftPlan(input: {
  planId: string;
  operationId: string;
  operationType: 'key.generate_csr' | 'certificate.install_issued';
  operationInput: Record<string, unknown>;
  operationKey: string;
  tenantId: string;
  agentId: string;
  pluginId: string;
  pluginVersionId: string;
}): AgentPlanV1 {
  const draft = {
    planVersion: agentSecurityContractVersion,
    planId: input.planId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    pluginId: input.pluginId,
    pluginVersionId: input.pluginVersionId,
    capability: 'certificate.key.custody',
    operations: [{
      operationId: input.operationId,
      operationType: input.operationType,
      stage: 'execute' as const,
      input: input.operationInput,
      dependsOn: [],
      idempotencyKey: input.operationKey,
      timeoutSeconds: 600,
    }],
    planDigest: '',
    tokenId: 'pending-token',
    policyDecisionId: 'pending-decision',
    nonce: 'pending-nonce',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    writeEffect: true,
  } satisfies AgentPlanV1;
  draft.planDigest = computeAgentPlanDigest(draft);
  return validateAgentPlan(draft);
}

function buildPayload(
  authorized: { plan: AgentPlanV1; token: ReturnType<typeof validateAgentCapabilityToken>; policyDecision: ReturnType<typeof validatePolicyAuthorityDecision> },
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return {
    actionType: 'agent.plan.execute',
    actionSchemaVersion: '1.0',
    agentId: authorized.plan.agentId,
    tenantId: authorized.plan.tenantId,
    pluginId: authorized.plan.pluginId,
    pluginVersion: authorized.plan.pluginVersionId,
    capability: authorized.plan.capability,
    actions: [...authorized.token.actions],
    paths: [...authorized.token.allowedPaths],
    services: [...authorized.token.allowedServices],
    artifactDigests: [...authorized.token.artifactDigests],
    planDigest: authorized.plan.planDigest,
    token: authorized.token,
    policyDecision: authorized.policyDecision,
    plan: authorized.plan,
    ...metadata,
  };
}

function required(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`);
  return value.trim();
}

function requiredPath(value: string, field: string): string {
  const result = required(value, field);
  if (!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(result) || result.split(/[\\/]/u).includes('..')) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是绝对路径且不能包含 ..`);
  }
  return result;
}

function digest(value: string, field: string): string {
  const result = required(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new AppError('VALIDATION_FAILED', `${field} 必须是 SHA-256 摘要`);
  return result;
}

function safeId(value: string): string {
  return required(value, 'id').replace(/[^A-Za-z0-9._:-]/gu, '-').slice(0, 180);
}

function assertPublicCertificateMaterial(value: string, field: string): void {
  const text = required(value, field);
  if (text.length > 256 * 1024 || !text.includes('BEGIN CERTIFICATE') || /BEGIN [A-Z ]*PRIVATE KEY/.test(text)) {
    throw new AppError('VALIDATION_FAILED', `${field} 只能包含受限大小的公开证书 PEM`);
  }
}
