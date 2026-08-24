import { AppError } from '../../common/errors/app-error.js';
import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import { newId } from '../../shared/id.js';
import {
  validateAgentCapabilityToken,
  validatePolicyAuthorityDecision,
} from '../agents/security/agent-security.contract.js';
import { assertGatewayRouteChannel, assertGatewayTaskType, type GatewayAgentTaskResultInput, type GatewayDelegatedTaskInput, type GatewayEvidence, type GatewayTask, type GatewayTaskResult } from './gateway-agent.types.js';
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
    const adapter = assertGatewayRouteChannel(input.adapter, 'adapter');
    const action = assertGatewayTaskType(input.action, 'action');
    const existingId = this.idempotencyIndex.get(this.idempotencyKey(input.tenantId, input.idempotencyKey));
    if (existingId) {
      const existing = this.tasks.get(existingId)!;
      if (existing.gatewayId !== input.gatewayId
        || existing.delegatedTargetId !== input.delegatedTargetId
        || existing.executionRunId !== input.executionRunId
        || existing.stepId !== input.stepId
        || existing.action !== action
        || existing.adapter !== adapter) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'GatewayTask 幂等键与转发范围不一致', {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
          taskId: existing.id,
        });
      }
      return existing;
    }

    const now = input.now ?? new Date();
    const task: GatewayTask = {
      id: input.id ?? newId('gateway_task'),
      idempotencyKey: input.idempotencyKey,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      operatorId: input.operatorId,
      planId: input.planId,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      gatewayId: input.gatewayId,
      delegatedTargetId: input.delegatedTargetId,
      target: input.target,
      adapter,
      action,
      payload: structuredClone(input.payload ?? {}),
      grant: input.grant ? structuredClone(input.grant) : undefined,
      forwardingGrant: input.forwardingGrant ? structuredClone(input.forwardingGrant) : undefined,
      status: 'queued',
      evidenceIds: [],
      evidenceAckCursor: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return this.save(task);
  }

  ack(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    if (task.leaseId === leaseId && (task.status === 'acknowledged' || task.status === 'running')) return task;
    if (task.leaseId && task.leaseId !== leaseId) throw new Error('GatewayTask lease 冲突');
    if (task.status !== 'queued') return task;
    return this.save({ ...task, leaseId, status: 'acknowledged', acknowledgedAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  markRunning(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    const task = this.requireLease(taskId, leaseId);
    if (task.status === 'running') return task;
    if (task.status !== 'acknowledged') throw new Error(`GatewayTask 状态不允许运行: ${task.status}`);
    return this.save({ ...task, status: 'running', updatedAt: now.toISOString() });
  }

  appendEvidence(input: Omit<GatewayEvidence, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): GatewayEvidence {
    return this.appendEvidenceInternal(input);
  }

  /** 迟到响应只允许形成拒绝证据，不能改变已经落盘的终态。 */
  recordLateV2Response(taskId: string, leaseId: string, requestId: string, detail: Record<string, unknown>, now = new Date()): GatewayTask {
    const task = this.requireLease(taskId, leaseId);
    this.appendEvidenceInternal({
      taskId,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      forwardingGrantId: task.forwardingGrant?.id,
      delegatedAgentId: task.forwardingGrant?.delegatedAgentId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'unknown',
      evidenceRef: `audit://gateway-route/${task.id}/late/${requestId}`,
      kind: 'response_summary',
      summary: 'Agent v2 返回迟到 Receipt，Gateway 已拒绝该结果',
      metadata: { ...detail, requestId, rejected: true, reason: 'GATEWAY_LATE_RECEIPT' },
      createdAt: now.toISOString(),
    }, 'unknown');
    return this.get(task.id)!;
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
    const task = this.requireLease(taskId, leaseId);
    if (task.result) return task;
    assertTaskResultConsistency(result);
    const finishedAt = result.finishedAt ?? new Date().toISOString();
    const evidenceIds = result.evidenceIds ?? task.evidenceIds;
    const firstEvidenceRef = evidenceIds.map((id) => this.evidence.get(id)?.evidenceRef).find((ref): ref is string => Boolean(ref));
    const completed = this.save({
      ...task,
      status: result.status,
      result: {
        ...result,
        evidenceIds,
        evidenceRef: result.evidenceRef ?? firstEvidenceRef ?? evidenceIds[0],
        finishedAt,
      },
      updatedAt: finishedAt,
    });
    this.auditWriter?.recordResult(completed);
    return completed;
  }

  /**
   * 将真实 Gateway Agent 的 Agent v2 Receipt 回写到原始 GatewayTask。
   * 该入口负责租约、ForwardingGrant、Nonce 和 UNKNOWN 的同一条状态链，
   * 不允许通过第二个执行器重新转发任务。
   */
  async recordAgentTaskResult(input: GatewayAgentTaskResultInput): Promise<GatewayTask> {
    let task = this.requireTask(input.gatewayTaskId);
    if (task.result) return task;
    if (task.tenantId !== input.tenantId
      || (task.delegatedTargetId !== input.agentId && task.forwardingGrant?.delegatedAgentId !== input.agentId)) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 与 GatewayTask 身份绑定不一致', {
        reason: 'GATEWAY_AGENT_TASK_RESULT_BINDING_DENIED',
        gatewayTaskId: input.gatewayTaskId,
        agentTaskId: input.agentTaskId,
      });
    }
    const payload = asRecord(task.payload);
    if (payload.actionType !== input.actionType) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 动作与 GatewayTask 不一致', {
        reason: 'GATEWAY_AGENT_TASK_ACTION_BINDING_DENIED',
        gatewayTaskId: input.gatewayTaskId,
        actionType: input.actionType,
      });
    }
    if (task.leaseId && task.leaseId !== input.leaseId) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Agent v2 Receipt 的 leaseId 与 GatewayTask 不一致', {
        gatewayTaskId: input.gatewayTaskId,
        agentTaskId: input.agentTaskId,
      });
    }
    if (!task.leaseId) {
      task = this.ack(task.id, input.leaseId);
      task = this.markRunning(task.id, input.leaseId);
    }

    if (!task.v2NonceBinding) {
      const token = validateAgentCapabilityToken(payload.token);
      const decision = validatePolicyAuthorityDecision(payload.policyDecision);
      const forwardingGrant = task.forwardingGrant;
      if (!forwardingGrant) {
        throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 缺少 ForwardingGrant，拒绝接受 Agent v2 Receipt', {
          reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED',
          gatewayTaskId: input.gatewayTaskId,
        });
      }
      task = this.consumeV2NonceAndForwardingGrant(task.id, {
        tenantId: token.tenantId,
        agentId: token.agentId,
        tokenId: token.tokenId,
        nonce: token.nonce,
        revocationRef: decision.revocationRef,
      }, {
        ...forwardingGrant,
        status: 'used',
        remainingUses: 0,
        usedAt: new Date().toISOString(),
      });
    }

    const executionStatus = input.actionType === 'agent.plan.execute' && input.executionStatus !== 'SUCCESS'
      ? 'UNKNOWN'
      : input.executionStatus;
    const status: GatewayTaskResult['status'] = executionStatus === 'SUCCESS'
      ? 'success'
      : executionStatus === 'UNKNOWN'
        ? 'unknown'
        : executionStatus === 'CANCELLED'
          ? 'cancelled'
          : 'failed';
    const evidence = this.appendEvidenceInternal({
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      forwardingGrantId: task.forwardingGrant?.id,
      delegatedAgentId: task.forwardingGrant?.delegatedAgentId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: status,
      evidenceRef: `audit://gateway-route/${task.id}/agent-task/${input.agentTaskId}`,
      kind: 'response_summary',
      summary: status === 'success' ? 'Gateway Agent v2 返回真实成功 Receipt' : `Gateway Agent v2 返回 ${executionStatus}`,
      metadata: {
        agentTaskId: input.agentTaskId,
        agentId: input.agentId,
        actionType: input.actionType,
        detail: input.detail,
      },
    });
    const completed = this.result(task.id, input.leaseId, {
      success: status === 'success',
      status,
      summary: status === 'success' ? 'Gateway Agent v2 已返回真实授权结果' : `Gateway Agent v2 返回 ${executionStatus}`,
      evidenceIds: [evidence.id],
      errorCode: status === 'success' ? undefined : input.errorCode ?? (status === 'unknown' ? 'GATEWAY_EXECUTION_UNKNOWN' : 'AGENT_V2_EXECUTION_FAILED'),
      errorMessage: status === 'success' ? undefined : input.errorMessage,
      executionStatus,
      receipt: input.receipt,
    });
    await this.flushPersistence();
    return completed;
  }

  updateEvidenceAckCursor(taskId: string, ackCursor: number, now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    const current = task.evidenceAckCursor ?? 0;
    if (ackCursor <= current) return task;
    return this.save({ ...task, evidenceAckCursor: ackCursor, updatedAt: now.toISOString() });
  }

  updateForwardingGrant(taskId: string, forwardingGrant: GatewayTask['forwardingGrant'], now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    if (!forwardingGrant) throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 不能清除 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_MUTATION_DENIED' });
    if (task.forwardingGrant && task.forwardingGrant.id !== forwardingGrant.id) {
      throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 不能替换已绑定的 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_MUTATION_DENIED', taskId });
    }
    if (task.forwardingGrant?.status === 'used' && forwardingGrant.status !== 'used') {
      throw new AppError('AUTH_FORBIDDEN', '已消费的 ForwardingGrant 不能恢复', { reason: 'GATEWAY_FORWARDING_GRANT_RESTORE_DENIED', taskId });
    }
    return this.save({ ...task, forwardingGrant, updatedAt: now.toISOString() });
  }

  assertV2NonceAvailable(binding: GatewayV2NonceBinding): void {
    this.assertDurableV2NonceStore();
    const taskId = this.v2NonceIndex.get(this.v2NonceKey(binding));
    if (taskId) throw new AppError('AUTH_FORBIDDEN', 'Gateway 拒绝重复使用 Agent v2 nonce', { reason: 'GATEWAY_V2_NONCE_REPLAY', taskId, tokenId: binding.tokenId, nonce: binding.nonce });
  }

  consumeV2NonceAndForwardingGrant(taskId: string, binding: GatewayV2NonceBinding, consumedForwardingGrant: NonNullable<GatewayTask['forwardingGrant']>, now = new Date()): GatewayTask {
    this.assertDurableV2NonceStore();
    const task = this.requireTask(taskId);
    assertV2TaskBinding(task, binding);
    if (consumedForwardingGrant.id !== task.forwardingGrant?.id
      || consumedForwardingGrant.status !== 'used'
      || consumedForwardingGrant.remainingUses !== 0
      || consumedForwardingGrant.tenantId !== task.tenantId
      || consumedForwardingGrant.gatewayId !== task.gatewayId
      || consumedForwardingGrant.delegatedTargetId !== task.delegatedTargetId
      || consumedForwardingGrant.executionRunId !== task.executionRunId
      || consumedForwardingGrant.stepId !== task.stepId) {
      throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 Nonce 与已消费 ForwardingGrant 不一致', { reason: 'GATEWAY_V2_COMMIT_BINDING_DENIED', taskId });
    }
    this.assertV2NonceAvailable(binding);
    const nonceBinding = binding;
    const next = { ...task, v2NonceBinding: { ...nonceBinding, consumedAt: now.toISOString() }, updatedAt: now.toISOString() };
    next.forwardingGrant = structuredClone(consumedForwardingGrant);
    const saved = this.save(next);
    this.v2NonceIndex.set(this.v2NonceKey(binding), taskId);
    return saved;
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

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function isGatewayTaskRepositories(value: GatewayTaskRepositories | GatewayTaskServiceOptions | undefined): value is GatewayTaskRepositories {
  return Boolean(value) && 'tasks' in value! && 'evidence' in value!;
}
