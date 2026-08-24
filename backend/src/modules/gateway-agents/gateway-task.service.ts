import { AppError } from '../../common/errors/app-error.js';
import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import { newId } from '../../shared/id.js';
import {
  validateAgentCapabilityToken,
  validateAgentExecutionReceipt,
  validatePolicyAuthorityDecision,
  type AgentCapabilityTokenV1,
  type AgentExecutionReceiptV1,
  type AgentSecurityStatus,
  type PolicyAuthorityDecisionV1,
} from '../agents/security/agent-security.contract.js';
import { gatewayRelayOnlyError, type GatewayAgentTaskResultInput, type GatewayDelegatedTaskInput, type GatewayEvidence, type GatewayTask, type GatewayTaskResult } from './gateway-agent.types.js';
import type { GatewayTaskAuditWriter } from './gateway-target-history.service.js';
import type { DurableGatewayTaskRepositories } from './gateway-task.repository.js';

export interface GatewayTaskRepositories {
  tasks: RepositoryPort<GatewayTask>;
  evidence: RepositoryPort<GatewayEvidence>;
  flush?: () => Promise<void>;
}

export interface GatewayTaskServiceOptions {
  repositories?: GatewayTaskRepositories;
  auditWriter?: GatewayTaskAuditWriter;
}

type GatewayV2NonceBinding = Omit<NonNullable<GatewayTask['v2NonceBinding']>, 'consumedAt'>;

export class GatewayTaskService {
  private readonly tasks = new Map<string, GatewayTask>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly evidence = new Map<string, GatewayEvidence>();
  private readonly evidenceSequenceIndex = new Map<string, string>();
  private readonly evidenceRefIndex = new Map<string, string>();
  private readonly v2NonceIndex = new Map<string, string>();

  private repositories?: GatewayTaskRepositories;
  private readonly auditWriter?: GatewayTaskAuditWriter;

  constructor(options?: GatewayTaskRepositories | GatewayTaskServiceOptions) {
    this.repositories = isGatewayTaskRepositories(options) ? options : options?.repositories;
    this.auditWriter = isGatewayTaskRepositories(options) ? undefined : options?.auditWriter;
    // 生产 Agent v2 必须显式注入持久化仓储；未注入时只能承载非生产的合同记录。
    for (const task of this.repositories?.tasks.list() ?? []) {
      this.tasks.set(task.id, task);
      this.idempotencyIndex.set(this.idempotencyKey(task.tenantId, task.idempotencyKey), task.id);
      if (task.v2NonceBinding) this.v2NonceIndex.set(this.v2NonceKey(task.v2NonceBinding), task.id);
    }
    for (const item of this.repositories?.evidence.list() ?? []) {
      this.evidence.set(item.id, item);
      this.indexEvidence(item);
    }
  }

  /** 生产应用启动时恢复持久化任务；内存测试服务不调用此入口。 */
  async initialize(repositories: GatewayTaskRepositories | DurableGatewayTaskRepositories): Promise<void> {
    if (this.repositories) {
      if (this.repositories !== repositories) throw new AppError('SYSTEM_INTERNAL_ERROR', 'GatewayTaskService 持久化仓储重复初始化');
      return;
    }
    if (this.tasks.size > 0 || this.evidence.size > 0) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'GatewayTaskService 已有未持久化运行数据，拒绝切换仓储');
    }
    this.repositories = repositories;
    for (const task of repositories.tasks.list()) {
      this.tasks.set(task.id, task);
      this.idempotencyIndex.set(this.idempotencyKey(task.tenantId, task.idempotencyKey), task.id);
      if (task.v2NonceBinding) this.v2NonceIndex.set(this.v2NonceKey(task.v2NonceBinding), task.id);
    }
    for (const item of repositories.evidence.list()) {
      this.evidence.set(item.id, item);
      this.indexEvidence(item);
    }
  }

  async flushPersistence(): Promise<void> {
    await this.repositories?.flush?.();
  }

  /** 应用级持久化钩子；生产请求结束时由 App 统一调用。 */
  async flush(): Promise<void> {
    await this.flushPersistence();
  }

  get hasDurablePersistence(): boolean {
    return Boolean(this.repositories && typeof this.repositories.flush === 'function');
  }

  dispatch(input: GatewayDelegatedTaskInput): GatewayTask {
    void input;
    throw gatewayRelayOnlyError('GatewayTaskService.dispatch');
  }

  ack(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    void taskId;
    void leaseId;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.ack');
  }

  markRunning(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    void taskId;
    void leaseId;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.markRunning');
  }

  appendEvidence(input: Omit<GatewayEvidence, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): GatewayEvidence {
    void input;
    throw gatewayRelayOnlyError('GatewayTaskService.appendEvidence');
  }

  /** 迟到响应只允许形成拒绝证据，不能改变已经落盘的终态。 */
  recordLateV2Response(taskId: string, leaseId: string, requestId: string, detail: Record<string, unknown>, now = new Date()): GatewayTask {
    void taskId;
    void leaseId;
    void requestId;
    void detail;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.recordLateV2Response');
  }

  private appendEvidenceInternal(input: Omit<GatewayEvidence, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, resultOverride?: GatewayEvidence['result']): GatewayEvidence {
    const task = this.requireTask(input.taskId);
    const { executionRunId: _executionRunId, stepId: _stepId, action: _action, result: _result, evidenceRef: _evidenceRef, ...safeInput } = input;
    const evidenceRef = _evidenceRef ?? input.id ?? newId('evidence_ref');
    const sequence = input.sequence ?? this.nextEvidenceSequence(task);
    const existingId = this.evidenceSequenceIndex.get(this.evidenceSequenceKey(task.id, sequence)) ?? this.evidenceRefIndex.get(this.evidenceRefKey(task.id, evidenceRef));
    if (existingId) return this.evidence.get(existingId)!;
    const evidence: GatewayEvidence = {
      ...safeInput,
      operatorId: task.operatorId,
      planId: task.planId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: resultOverride ?? task.result?.status ?? (task.status === 'failed' || task.status === 'cancelled' || task.status === 'timeout' ? task.status : 'success'),
      evidenceRef,
      sequence,
      id: input.id ?? newId('gw_evd'),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (this.evidence.has(evidence.id)) return this.evidence.get(evidence.id)!;
    this.saveEvidence(evidence);
    this.save({ ...task, evidenceIds: [...new Set([...task.evidenceIds, evidence.id])], updatedAt: evidence.createdAt });
    this.auditWriter?.recordEvidence(this.requireTask(task.id), evidence);
    return evidence;
  }

  result(taskId: string, leaseId: string, result: Omit<GatewayTaskResult, 'evidenceIds' | 'finishedAt'> & Partial<Pick<GatewayTaskResult, 'evidenceIds' | 'finishedAt'>>): GatewayTask {
    void taskId;
    void leaseId;
    void result;
    throw gatewayRelayOnlyError('GatewayTaskService.result');
  }

  /**
   * 将真实 Gateway Agent 的 Agent v2 Receipt 回写到原始 GatewayTask。
   * 该入口负责租约、ForwardingGrant、Nonce 和 UNKNOWN 的同一条状态链，
   * 不允许通过第二个执行器重新转发任务。
   */
  async recordAgentTaskResult(input: GatewayAgentTaskResultInput): Promise<GatewayTask> {
    void input;
    throw gatewayRelayOnlyError('GatewayTaskService.recordAgentTaskResult');
  }

  updateEvidenceAckCursor(taskId: string, ackCursor: number, now = new Date()): GatewayTask {
    void taskId;
    void ackCursor;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.updateEvidenceAckCursor');
  }

  updateForwardingGrant(taskId: string, forwardingGrant: GatewayTask['forwardingGrant'], now = new Date()): GatewayTask {
    void taskId;
    void forwardingGrant;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.updateForwardingGrant');
  }

  assertV2NonceAvailable(binding: GatewayV2NonceBinding): void {
    this.assertDurableV2NonceStore();
    const taskId = this.v2NonceIndex.get(this.v2NonceKey(binding));
    if (taskId) throw new AppError('AUTH_FORBIDDEN', 'Gateway 拒绝重复使用 Agent v2 nonce', { reason: 'GATEWAY_V2_NONCE_REPLAY', taskId, tokenId: binding.tokenId, nonce: binding.nonce });
  }

  consumeV2NonceAndForwardingGrant(taskId: string, binding: GatewayV2NonceBinding, consumedForwardingGrant: NonNullable<GatewayTask['forwardingGrant']>, now = new Date()): GatewayTask {
    void taskId;
    void binding;
    void consumedForwardingGrant;
    void now;
    throw gatewayRelayOnlyError('GatewayTaskService.consumeV2NonceAndForwardingGrant');
  }

  get(taskId: string): GatewayTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  listRecoverable(): GatewayTask[] {
    return [...this.tasks.values()]
      .filter((task) => ['queued', 'acknowledged', 'running'].includes(task.status))
      .map((task) => structuredClone(task));
  }

  listEvidence(taskId: string): GatewayEvidence[] {
    const task = this.requireTask(taskId);
    return task.evidenceIds
      .map((id) => this.evidence.get(id))
      .filter((item): item is GatewayEvidence => item !== undefined)
      .map((item) => structuredClone(item));
  }

  private requireTask(taskId: string): GatewayTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('GatewayTask 不存在');
    return task;
  }

  private requireLease(taskId: string, leaseId: string): GatewayTask {
    const task = this.requireTask(taskId);
    if (task.leaseId !== leaseId) throw new Error('GatewayTask lease 无效');
    return task;
  }

  private save(task: GatewayTask): GatewayTask {
    const snapshot = structuredClone(task);
    this.tasks.set(snapshot.id, snapshot);
    this.idempotencyIndex.set(this.idempotencyKey(snapshot.tenantId, snapshot.idempotencyKey), snapshot.id);
    this.repositories?.tasks.upsert(snapshot);
    return structuredClone(snapshot);
  }

  private saveEvidence(evidence: GatewayEvidence): GatewayEvidence {
    const snapshot = structuredClone(evidence);
    this.evidence.set(snapshot.id, snapshot);
    this.indexEvidence(snapshot);
    this.repositories?.evidence.upsert(snapshot);
    return structuredClone(snapshot);
  }

  private indexEvidence(evidence: GatewayEvidence): void {
    if (evidence.sequence !== undefined) this.evidenceSequenceIndex.set(this.evidenceSequenceKey(evidence.taskId, evidence.sequence), evidence.id);
    this.evidenceRefIndex.set(this.evidenceRefKey(evidence.taskId, evidence.evidenceRef), evidence.id);
  }

  private nextEvidenceSequence(task: GatewayTask): number {
    const maxExisting = task.evidenceIds
      .map((id) => this.evidence.get(id)?.sequence)
      .filter((sequence): sequence is number => typeof sequence === 'number')
      .reduce((max, sequence) => Math.max(max, sequence), 0);
    return Math.max(task.evidenceAckCursor ?? 0, maxExisting) + 1;
  }

  private idempotencyKey(tenantId: string | undefined, idempotencyKey: string): string {
    return `${tenantId ?? ''}:${idempotencyKey}`;
  }

  private v2NonceKey(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string }): string {
    return [binding.tenantId, binding.agentId, binding.tokenId, binding.nonce].join(':');
  }

  private assertDurableV2NonceStore(): void {
    if (!this.hasDurablePersistence) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Gateway v2 Nonce 持久化仓储未装配，拒绝执行', {
        reason: 'GATEWAY_V2_NONCE_STORE_UNAVAILABLE',
        fallback: false,
      });
    }
  }

  private evidenceSequenceKey(taskId: string, sequence: number): string {
    return `${taskId}:${sequence}`;
  }

  private evidenceRefKey(taskId: string, evidenceRef: string): string {
    return `${taskId}:${evidenceRef}`;
  }
}

function resolveGatewayAgentExecutionStatus(
  input: Pick<GatewayAgentTaskResultInput, 'actionType' | 'executionStatus' | 'errorCode' | 'detail'>,
  receipt?: AgentExecutionReceiptV1,
): AgentSecurityStatus {
  const detail = input.detail ?? {};
  const detailStatuses = [detail.executionStatus, detail.status];
  const error = asRecord(detail.error);
  const hasUnknownEvidence = input.executionStatus === 'UNKNOWN'
    || detailStatuses.some((value) => value === 'UNKNOWN' || value === 'CANCELLED')
    || receipt?.status === 'UNKNOWN'
    || input.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE'
    || detail.mayBeUnknown === true
    || error.mayBeUnknown === true;
  if (hasUnknownEvidence) return 'UNKNOWN';
  if (input.actionType === 'agent.plan.execute' && input.executionStatus !== 'SUCCESS') return 'UNKNOWN';
  return input.executionStatus;
}

function assertTaskResultConsistency(result: Omit<GatewayTaskResult, 'evidenceIds' | 'finishedAt'> & Partial<Pick<GatewayTaskResult, 'evidenceIds' | 'finishedAt'>>): void {
  if (result.success === true && result.executionStatus !== undefined && result.executionStatus !== 'SUCCESS') {
    throw new AppError('VALIDATION_FAILED', 'GatewayTask 成功状态必须对应 SUCCESS 执行结果', { reason: 'GATEWAY_RESULT_STATUS_MISMATCH' });
  }
  if (result.status === 'unknown' && result.executionStatus !== 'UNKNOWN') {
    throw new AppError('VALIDATION_FAILED', 'GatewayTask UNKNOWN 状态必须对应 UNKNOWN 执行结果', { reason: 'GATEWAY_RESULT_STATUS_MISMATCH' });
  }
  if (result.executionStatus === 'UNKNOWN' && result.status !== 'unknown') {
    throw new AppError('VALIDATION_FAILED', 'UNKNOWN 执行结果必须进入 GatewayTask UNKNOWN 状态', { reason: 'GATEWAY_RESULT_STATUS_MISMATCH' });
  }
}

function assertV2TaskBinding(task: GatewayTask, binding: GatewayV2NonceBinding): void {
  if (task.action !== 'gateway.forward.agent_task' || task.adapter !== 'forward.agent_task' || !task.tenantId || !task.planId) {
    throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 不具备完整 Agent v2 执行绑定', { reason: 'GATEWAY_V2_TASK_BINDING_REQUIRED', taskId: task.id });
  }
  const source = asRecord(task.payload);
  const token = validateAgentCapabilityToken(source.token);
  const decision = validatePolicyAuthorityDecision(source.policyDecision);
  const gatewayGrant = asRecord(source.gatewayGrant ?? task.grant);
  const forwardingGrant = task.forwardingGrant;
  if (!forwardingGrant
    || forwardingGrant.status !== 'active'
    || forwardingGrant.remainingUses !== 1
    || forwardingGrant.tenantId !== task.tenantId
    || forwardingGrant.delegatedAgentId !== token.agentId
    || forwardingGrant.gatewayId !== task.gatewayId
    || forwardingGrant.delegatedTargetId !== task.delegatedTargetId
    || forwardingGrant.taskType !== task.action
    || forwardingGrant.routeChannel !== task.adapter
    || forwardingGrant.executionRunId !== task.executionRunId
    || forwardingGrant.stepId !== task.stepId
    || typeof gatewayGrant.grantId !== 'string'
    || gatewayGrant.forwardingGrantId !== forwardingGrant.id
    || gatewayGrant.tenantId !== task.tenantId
    || gatewayGrant.agentId !== token.agentId
    || gatewayGrant.planId !== task.planId
    || gatewayGrant.planDigest !== token.planDigest
    || gatewayGrant.pluginId !== token.pluginId
    || gatewayGrant.pluginVersionId !== token.pluginVersionId
    || gatewayGrant.capability !== token.capability
    || gatewayGrant.tokenId !== token.tokenId
    || gatewayGrant.policyDecisionId !== decision.decisionId
    || gatewayGrant.nonce !== token.nonce
    || gatewayGrant.revocationRef !== decision.revocationRef
    || decision.allowed !== true
    || token.tenantId !== binding.tenantId
    || token.agentId !== binding.agentId
    || token.tokenId !== binding.tokenId
    || token.nonce !== binding.nonce
    || decision.revocationRef !== binding.revocationRef
    || decision.agentId !== token.agentId
    || decision.tenantId !== token.tenantId
    || decision.pluginId !== token.pluginId
    || decision.pluginVersionId !== token.pluginVersionId
    || decision.capability !== token.capability
    || decision.planDigest !== token.planDigest
    || decision.tokenId !== token.tokenId
    || decision.nonce !== token.nonce) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 Nonce 消费绑定不一致', { reason: 'GATEWAY_V2_NONCE_BINDING_DENIED', taskId: task.id });
  }
}

function assertAgentTaskResultBinding(
  task: GatewayTask,
  input: GatewayAgentTaskResultInput,
  payload: Record<string, any>,
): { token: AgentCapabilityTokenV1; decision: PolicyAuthorityDecisionV1; receipt?: AgentExecutionReceiptV1 } {
  const token = validateAgentCapabilityToken(payload.token);
  const decision = validatePolicyAuthorityDecision(payload.policyDecision);
  const receipt = input.receipt ? validateAgentExecutionReceipt(input.receipt) : undefined;
  const forwardingGrant = task.forwardingGrant;
  const grant = asRecord(payload.gatewayGrant ?? task.grant);
  const sameArrays = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value) => right.includes(value));
  if (task.tenantId !== input.tenantId
    || payload.actionType !== input.actionType
    || (task.leaseId && task.leaseId !== input.leaseId)
    || token.tenantId !== input.tenantId
    || token.agentId !== input.agentId
    || decision.allowed !== true
    || decision.agentId !== token.agentId
    || decision.tenantId !== token.tenantId
    || decision.pluginId !== token.pluginId
    || decision.pluginVersionId !== token.pluginVersionId
    || decision.capability !== token.capability
    || decision.policyRef !== token.policyRef
    || decision.policyVersion !== token.policyVersion
    || decision.tokenId !== token.tokenId
    || decision.nonce !== token.nonce
    || decision.planDigest !== token.planDigest
    || decision.authorityKeyId !== token.authorityKeyId
    || decision.approvalRef !== token.approvalRef
    || !sameArrays(token.actions, decision.actions)
    || !sameArrays(token.allowedPaths, decision.allowedPaths)
    || !sameArrays(token.allowedServices, decision.allowedServices)
    || !sameArrays(token.artifactDigests, decision.artifactDigests)
    || (forwardingGrant !== undefined && (forwardingGrant.delegatedAgentId !== input.agentId
      || forwardingGrant.tenantId !== task.tenantId
      || forwardingGrant.gatewayId !== task.gatewayId
      || forwardingGrant.delegatedTargetId !== task.delegatedTargetId
      || forwardingGrant.executionRunId !== task.executionRunId
      || forwardingGrant.stepId !== task.stepId))
    || (typeof grant.grantId === 'string' && (grant.agentId !== input.agentId
      || grant.tenantId !== task.tenantId
      || grant.planDigest !== token.planDigest
      || grant.tokenId !== token.tokenId
      || grant.policyDecisionId !== decision.decisionId
      || grant.nonce !== token.nonce
      || grant.revocationRef !== decision.revocationRef))) {
    throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 与 GatewayTask 身份或授权材料不一致', {
      reason: 'GATEWAY_AGENT_TASK_RESULT_BINDING_DENIED',
      gatewayTaskId: input.gatewayTaskId,
      agentTaskId: input.agentTaskId,
    });
  }
  if (receipt) assertGatewayTaskReceiptBinding(task, input, payload, token, receipt);
  return { token, decision, receipt };
}

function assertGatewayTaskReceiptBinding(
  task: GatewayTask,
  input: GatewayAgentTaskResultInput,
  payload: Record<string, any>,
  token: AgentCapabilityTokenV1,
  receipt: AgentExecutionReceiptV1,
): void {
  if (receipt.agentId !== token.agentId || receipt.tenantId !== token.tenantId
    || receipt.tokenId !== token.tokenId || receipt.planDigest !== token.planDigest
    || (task.planId !== undefined && receipt.planId !== task.planId)
    || ((input.actionType === 'agent.plan.execute' || input.actionType === 'agent.execution.receipt') && !receipt.nonceConsumed)) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与 GatewayTask 授权绑定不一致', {
      reason: 'GATEWAY_AGENT_TASK_RECEIPT_BINDING_DENIED',
      gatewayTaskId: task.id,
      agentTaskId: input.agentTaskId,
    });
  }
  const plan = asRecord(payload.plan);
  if (Object.keys(plan).length > 0) {
    const operations = Array.isArray(plan.operations) ? plan.operations : [];
    if (plan.planId !== receipt.planId || plan.planDigest !== receipt.planDigest
      || plan.agentId !== receipt.agentId || plan.tenantId !== receipt.tenantId
      || !operations.some((operation) => asRecord(operation).operationId === receipt.operationId)) {
      throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与 AgentPlanV1 绑定不一致', {
        reason: 'GATEWAY_AGENT_TASK_RECEIPT_PLAN_BINDING_DENIED',
        gatewayTaskId: task.id,
        agentTaskId: input.agentTaskId,
      });
    }
  }
}

function assertConsumedV2TaskBinding(task: GatewayTask, token: AgentCapabilityTokenV1, decision: PolicyAuthorityDecisionV1): void {
  const binding = task.v2NonceBinding;
  const forwardingGrant = task.forwardingGrant;
  if (!binding || !forwardingGrant
    || forwardingGrant.status !== 'used'
    || forwardingGrant.remainingUses !== 0
    || forwardingGrant.delegatedAgentId !== token.agentId
    || forwardingGrant.tenantId !== task.tenantId
    || forwardingGrant.gatewayId !== task.gatewayId
    || forwardingGrant.delegatedTargetId !== task.delegatedTargetId
    || forwardingGrant.executionRunId !== task.executionRunId
    || forwardingGrant.stepId !== task.stepId
    || binding.tenantId !== token.tenantId
    || binding.agentId !== token.agentId
    || binding.tokenId !== token.tokenId
    || binding.nonce !== token.nonce
    || binding.revocationRef !== decision.revocationRef) {
    throw new AppError('AUTH_FORBIDDEN', '已消费的 Agent v2 Nonce 与授权材料不一致', {
      reason: 'GATEWAY_AGENT_TASK_RESULT_CONSUMED_BINDING_DENIED',
      taskId: task.id,
    });
  }
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function isGatewayTaskRepositories(value: GatewayTaskRepositories | GatewayTaskServiceOptions | undefined): value is GatewayTaskRepositories {
  return Boolean(value) && 'tasks' in value! && 'evidence' in value!;
}
