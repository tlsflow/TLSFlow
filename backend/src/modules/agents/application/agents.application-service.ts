import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentHeartbeatInput, CheckAgentUpgradeInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, SubmitAgentTaskLogInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentTaskEnvelope, AgentUpgradePlan } from '../schema/agents.schema.js';
import { InMemoryAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';

export class AgentsApplicationService {
  constructor(
    private readonly repository: AgentsRepository = new InMemoryAgentsRepository(),
    private readonly domain = new AgentsDomainService(),
  ) {}

  getModuleMetadata() {
    return createModuleMetadata('agents', '/api/v1/agents', '011');
  }

  createEnrollmentToken(tenantId: string, input: CreateEnrollmentTokenInput, requestId: string) {
    const created = this.domain.createEnrollmentToken(tenantId, input, requestId);
    const { token, ...stored } = created;
    this.repository.createEnrollmentToken(stored);
    // 注册令牌只展示一次，仓库里永远不保存明文。
    return { ...stored, token };
  }

  register(tenantId: string, input: RegisterAgentInput, requestId: string) {
    const descriptor = this.domain.normalizeDescriptor(input);
    let enrollmentTokenId: string | undefined;
    if (input.enrollmentToken) {
      const token = this.repository.findEnrollmentTokenByHash(tenantId, this.domain.hashEnrollmentToken(input.enrollmentToken));
      if (!token) throw new AppError('AUTH_FORBIDDEN', '注册令牌无效');
      this.domain.assertEnrollmentAllowed(token, input);
      const usedCount = token.usedCount + 1;
      this.repository.updateEnrollmentToken(token.id, {
        usedCount,
        lastUsedAt: new Date().toISOString(),
        status: usedCount >= token.maxUses ? 'exhausted' : 'active',
      });
      enrollmentTokenId = token.id;
    }
    const existing = this.repository.findByAgentKey(tenantId, descriptor.agentKey);
    const now = new Date().toISOString();
    if (existing) {
      return this.repository.updateRegistration(existing.id, {
        descriptor,
        status: existing.status === 'DISABLED' ? 'DISABLED' : 'ONLINE',
        role: input.role ?? existing.role,
        zone: input.zone ?? existing.zone,
        enrollmentTokenId: enrollmentTokenId ?? existing.enrollmentTokenId,
        certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : existing.certificateFingerprint,
        certificateExpiresAt: input.certificateExpiresAt ?? existing.certificateExpiresAt,
        updatedAt: now,
        lastRequestId: requestId,
      });
    }
    return this.repository.upsertRegistration({
      id: newId('agt'),
      tenantId,
      agentKey: descriptor.agentKey,
      descriptor,
      role: input.role ?? 'full_agent',
      zone: input.zone ?? 'default',
      enrollmentTokenId,
      certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : undefined,
      certificateExpiresAt: input.certificateExpiresAt,
      status: 'ONLINE',
      registeredAt: now,
      updatedAt: now,
      lastRequestId: requestId,
      version: 1,
    });
  }

  heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const updated = this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: { ...agent.descriptor, version: input.version },
      updatedAt: now,
      lastRequestId: requestId,
    });
    const heartbeat = this.repository.saveHeartbeat({
      tenantId,
      agentId: agent.id,
      status: nextStatus,
      version: input.version,
      taskSummary: input.taskSummary ?? { running: 0, queued: 0 },
      receivedAt: now,
      requestId,
    });
    return { agent: updated, heartbeat };
  }

  createSession(tenantId: string, agentId: string, requestId: string) {
    const agent = this.requireAgent(tenantId, agentId);
    if (!agent.certificateFingerprint) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent 未绑定 mTLS 证书指纹，不能创建长期会话', { agentId });
    }
    const now = new Date().toISOString();
    return this.repository.createSession({
      id: newId('agsess'),
      tenantId,
      agentId,
      status: 'active',
      certificateFingerprint: agent.certificateFingerprint,
      certificateExpiresAt: agent.certificateExpiresAt,
      createdAt: now,
      lastSeenAt: now,
      requestId,
    });
  }

  createMtlsSession(tenantId: string, input: CreateAgentSessionInput, requestId: string) {
    const agent = this.requireAgent(tenantId, input.agentId);
    this.domain.assertMtlsSession(agent, input.certificateFingerprint);
    return this.createSession(tenantId, input.agentId, requestId);
  }

  reportCapabilities(tenantId: string, input: AgentCapabilitySnapshotInput, requestId: string): AgentCapabilityProjection {
    const agent = this.requireAgent(tenantId, input.agentId);
    const snapshot = this.repository.saveCapabilitySnapshot(this.domain.normalizeCapabilitySnapshot(tenantId, agent.id, input, requestId));
    return { agentId: agent.id, declarations: this.domain.toCapabilityDeclarations(agent, snapshot) };
  }

  enqueueTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string): AgentTaskEnvelope {
    this.requireAgent(tenantId, input.agentId);
    const existing = this.repository.findTaskByIdempotencyKey(tenantId, input.agentId, input.idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.repository.createTask({
      id: newId('agtask'),
      tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      requestId,
    });
  }

  pullTasks(tenantId: string, agentId: string, limit = 10): AgentTaskEnvelope[] {
    this.requireAgent(tenantId, agentId);
    return this.repository.listTasks(tenantId, agentId, ['queued']).slice(0, limit);
  }

  ackTask(tenantId: string, input: AckAgentTaskInput): AgentTaskEnvelope {
    const task = this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.status !== 'queued' && task.status !== 'leased') {
      throw new AppError('VALIDATION_FAILED', '任务不能重复 ack', { taskId: task.id, status: task.status });
    }
    if (task.leaseId && task.leaseId !== input.leaseId) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '任务 leaseId 冲突', { taskId: task.id });
    }
    return this.repository.updateTask(task.id, { status: 'acked', leaseId: input.leaseId, ackedAt: new Date().toISOString() });
  }

  submitResult(tenantId: string, input: SubmitAgentTaskResultInput): AgentTaskEnvelope {
    const task = this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.leaseId !== input.leaseId) throw new AppError('IDEMPOTENCY_CONFLICT', '任务结果 leaseId 不匹配', { taskId: task.id });
    if (!['acked', 'leased'].includes(task.status)) {
      throw new AppError('VALIDATION_FAILED', '只有已 ack 的任务能提交结果', { taskId: task.id, status: task.status });
    }
    return this.repository.updateTask(task.id, {
      status: input.success ? 'succeeded' : 'failed',
      resultAt: new Date().toISOString(),
      result: {
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        detail: input.detail ?? {},
      },
    });
  }

  submitLog(tenantId: string, input: SubmitAgentTaskLogInput, requestId: string) {
    this.requireTask(tenantId, input.agentId, input.taskId);
    return this.repository.saveTaskLog(this.domain.normalizeTaskLog(tenantId, input, requestId));
  }

  listTaskLogs(tenantId: string, taskId: string) {
    const task = this.repository.getTask(tenantId, taskId);
    if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return this.repository.listTaskLogs(tenantId, taskId);
  }

  publishVersion(tenantId: string, input: PublishAgentVersionInput) {
    return this.repository.publishVersion(this.domain.normalizeRelease(tenantId, input));
  }

  checkUpgrade(tenantId: string, input: CheckAgentUpgradeInput): AgentUpgradePlan | { status: 'not_required'; reason: string } {
    const agent = this.requireAgent(tenantId, input.agentId);
    const release = this.repository.listActiveVersions(tenantId)
      .find((item) => item.platform === agent.descriptor.osType && (!item.arch || item.arch === agent.descriptor.arch));
    if (!release) return { status: 'not_required', reason: '没有匹配平台的升级版本' };
    if (release.version === agent.descriptor.version) return { status: 'not_required', reason: 'Agent 已是目标版本' };
    const existing = this.repository.findUpgradePlanForAgent(tenantId, agent.id, release.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.repository.createUpgradePlan({
      id: newId('agup'),
      tenantId,
      agentId: agent.id,
      releaseId: release.id,
      targetVersion: release.version,
      status: agent.role === 'legacy_agent' ? 'manual_required' : 'planned',
      reason: agent.role === 'legacy_agent' ? 'Legacy Agent 不支持自动升级' : '发现可用升级版本',
      createdAt: now,
      updatedAt: now,
    });
  }

  submitUpgradeResult(tenantId: string, input: SubmitAgentUpgradeResultInput) {
    this.requireAgent(tenantId, input.agentId);
    const plan = this.repository.getUpgradePlan(tenantId, input.planId);
    if (!plan || plan.agentId !== input.agentId) throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', { planId: input.planId });
    return this.repository.updateUpgradePlan(plan.id, {
      status: input.success ? 'succeeded' : (input.rolledBack ? 'rolled_back' : 'failed'),
      result: {
        success: input.success,
        rolledBack: input.rolledBack ?? false,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query);
  }

  getRepository(): AgentsRepository {
    return this.repository;
  }

  private requireAgent(tenantId: string, agentId: string) {
    const agent = this.repository.getRegistration(tenantId, agentId);
    if (!agent) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 不存在', { agentId });
    return agent;
  }

  private requireTask(tenantId: string, agentId: string, taskId: string) {
    const task = this.repository.getTask(tenantId, taskId);
    if (!task || task.agentId !== agentId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return task;
  }
}
