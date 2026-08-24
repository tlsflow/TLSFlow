import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentCertificateIssueResult, AgentCertificateRotateResult, AgentDetailProjection, AgentHeartbeatInput, AgentTaskLogAckResult, AgentTaskQueueProjection, AgentUpgradeSuggestionProjection, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DisableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan } from '../schema/agents.schema.js';
import { PgAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';

export class AgentsApplicationService {
  constructor(
    private readonly repository: AgentsRepository = new PgAgentsRepository(),
    private readonly domain = new AgentsDomainService(),
    private readonly gateways?: GatewaysRepository,
  ) {}

  getModuleMetadata() {
    return createModuleMetadata('agents', '/api/v1/agents', '011');
  }

  async createEnrollmentToken(tenantId: string, input: CreateEnrollmentTokenInput, requestId: string) {
    const created = this.domain.createEnrollmentToken(tenantId, input, requestId);
    const { token, ...stored } = created;
    await this.repository.createEnrollmentToken(stored);
    return { ...stored, token };
  }

  async register(tenantId: string, input: RegisterAgentInput, requestId: string) {
    const descriptor = this.domain.normalizeDescriptor(input);
    const role = input.role ?? 'full_agent';
    const existing = await this.repository.findByAgentKey(tenantId, descriptor.agentKey);
    const gateway = this.domain.normalizeGatewayOnRegister(input, existing?.gateway);
    let enrollmentTokenId: string | undefined;
    if (input.enrollmentToken) {
      const token = await this.repository.findEnrollmentTokenByHash(tenantId, this.domain.hashEnrollmentToken(input.enrollmentToken));
      if (!token) throw new AppError('AUTH_FORBIDDEN', '注册令牌无效');
      this.domain.assertEnrollmentAllowed(token, input);
      const usedCount = token.usedCount + 1;
      await this.repository.updateEnrollmentToken(token.id, {
        usedCount,
        lastUsedAt: new Date().toISOString(),
        status: usedCount >= token.maxUses ? 'exhausted' : 'active',
      });
      enrollmentTokenId = token.id;
    }
    const now = new Date().toISOString();
    if (existing) {
      const updated = await this.repository.updateRegistration(existing.id, {
        descriptor,
        status: existing.status === 'DISABLED' ? 'DISABLED' : 'ONLINE',
        role: input.role ?? existing.role,
        zone: gateway?.zoneIds[0] ?? input.zone ?? existing.zone,
        gateway: existing.status === 'DISABLED' && gateway ? { ...gateway, status: 'disabled' } : gateway,
        enrollmentTokenId: enrollmentTokenId ?? existing.enrollmentTokenId,
        certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : existing.certificateFingerprint,
        certificateExpiresAt: input.certificateExpiresAt ?? existing.certificateExpiresAt,
        updatedAt: now,
        lastRequestId: requestId,
      });
      void this.syncGatewayRegistry(tenantId, updated);
      return updated;
    }
    const registered = await this.repository.upsertRegistration({
      id: newId('agt'),
      tenantId,
      agentKey: descriptor.agentKey,
      descriptor,
      role,
      zone: gateway?.zoneIds[0] ?? input.zone ?? 'default',
      gateway,
      enrollmentTokenId,
      certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : undefined,
      certificateExpiresAt: input.certificateExpiresAt,
      status: 'ONLINE',
      registeredAt: now,
      updatedAt: now,
      lastRequestId: requestId,
      version: 1,
    });
    void this.syncGatewayRegistry(tenantId, registered);
    return registered;
  }

  async heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const gateway = this.domain.normalizeGatewayOnHeartbeat(agent, input, now);
    const updated = await this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: { ...agent.descriptor, version: input.version },
      gateway,
      updatedAt: now,
      lastRequestId: requestId,
    });
    void this.syncGatewayRegistry(tenantId, updated);
    const heartbeat = await this.repository.saveHeartbeat({
      tenantId,
      agentId: agent.id,
      status: nextStatus,
      version: input.version,
      gateway,
      taskSummary: input.taskSummary ?? { running: 0, queued: 0 },
      receivedAt: now,
      requestId,
    });
    return { agent: updated, heartbeat };
  }

  async createSession(tenantId: string, agentId: string, requestId: string) {
    const agent = await this.requireAgent(tenantId, agentId);
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

  async createMtlsSession(tenantId: string, input: CreateAgentSessionInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    this.domain.assertMtlsSession(agent, input.certificateFingerprint);
    return this.createSession(tenantId, input.agentId, requestId);
  }

  async createCertificateSigningRequest(tenantId: string, input: CreateAgentCertificateSigningRequestInput, actorId: string, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    return this.repository.createCertificateSigningRequest(this.domain.normalizeCertificateSigningRequest(tenantId, agent, input, actorId, requestId));
  }

  async signCertificate(tenantId: string, input: SignAgentCertificateInput): Promise<AgentCertificateIssueResult> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    if (agent.status === 'DISABLED') throw new AppError('VALIDATION_FAILED', 'DISABLED Agent 不能签发新证书', { agentId: agent.id });
    const csr = await this.repository.getCertificateSigningRequest(tenantId, input.csrId);
    if (!csr) throw new AppError('RESOURCE_NOT_FOUND', 'Agent CSR 不存在', { csrId: input.csrId });
    const ca = await this.ensureCertificateAuthority();
    const certificate = await this.repository.createCertificate(this.domain.issueCertificate({ tenantId, agent, csr, ca, ttlDays: input.ttlDays, issuedBy: input.issuedBy }));
    const signedCsr = await this.repository.updateCertificateSigningRequest(csr.id, {
      status: 'signed',
      signedCertificateId: certificate.id,
      signedAt: certificate.issuedAt,
    });
    await this.repository.updateRegistration(agent.id, {
      certificateFingerprint: certificate.fingerprintSha256,
      certificateExpiresAt: certificate.notAfter,
      certificateRevoked: false,
      updatedAt: new Date().toISOString(),
    });
    return { csr: signedCsr, certificate, ca };
  }

  async rotateCertificate(tenantId: string, input: RotateAgentCertificateInput, requestId: string): Promise<AgentCertificateRotateResult> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const previousCertificate = await this.repository.findActiveCertificate(tenantId, agent.id);
    const csr = await this.repository.createCertificateSigningRequest(this.domain.normalizeCertificateSigningRequest(tenantId, agent, {
      csrPem: input.csrPem,
      requestedTtlDays: input.ttlDays,
    }, input.issuedBy, requestId));
    const ca = await this.ensureCertificateAuthority();
    const certificate = await this.repository.createCertificate(this.domain.issueCertificate({
      tenantId,
      agent,
      csr,
      ca,
      ttlDays: input.ttlDays,
      issuedBy: input.issuedBy,
      rotatedFromCertificateId: previousCertificate?.id,
    }));
    const signedCsr = await this.repository.updateCertificateSigningRequest(csr.id, {
      status: 'signed',
      signedCertificateId: certificate.id,
      signedAt: certificate.issuedAt,
    });
    const rotatedPrevious = previousCertificate ? await this.repository.updateCertificate(previousCertificate.id, { status: 'rotated' }) : undefined;
    await this.repository.updateRegistration(agent.id, {
      certificateFingerprint: certificate.fingerprintSha256,
      certificateExpiresAt: certificate.notAfter,
      certificateRevoked: false,
      updatedAt: new Date().toISOString(),
    });
    return { csr: signedCsr, certificate, ca, previousCertificate: rotatedPrevious };
  }

  async revokeCertificate(tenantId: string, input: RevokeAgentCertificateInput) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const certificate = await this.repository.getCertificate(tenantId, input.certificateId);
    if (!certificate || certificate.agentId !== agent.id) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 证书不存在', { certificateId: input.certificateId });
    if (certificate.status === 'revoked') return certificate;
    const now = new Date().toISOString();
    const revoked = await this.repository.updateCertificate(certificate.id, {
      status: 'revoked',
      revokedAt: now,
      revokedBy: input.revokedBy,
      revokedReason: input.reason,
    });
    if (agent.certificateFingerprint === certificate.fingerprintSha256) {
      await this.repository.updateRegistration(agent.id, {
        certificateRevoked: true,
        revokedAt: agent.revokedAt ?? now,
        revokedBy: input.revokedBy,
        revokedReason: input.reason ?? 'Agent 证书被吊销',
        updatedAt: now,
      });
    }
    return revoked;
  }

  async listCertificates(tenantId: string, agentId: string) {
    await this.requireAgent(tenantId, agentId);
    return this.repository.listCertificates(tenantId, agentId);
  }

  async reportCapabilities(tenantId: string, input: AgentCapabilitySnapshotInput, requestId: string): Promise<AgentCapabilityProjection> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const snapshot = await this.repository.saveCapabilitySnapshot(this.domain.normalizeCapabilitySnapshot(tenantId, agent.id, input, requestId));
    const gateway = this.domain.normalizeGatewayOnCapabilities(agent, input);
    const updated = gateway ? await this.repository.updateRegistration(agent.id, {
      gateway,
      updatedAt: new Date().toISOString(),
      lastRequestId: requestId,
    }) : agent;
    void this.syncGatewayRegistry(tenantId, updated);
    return { agentId: agent.id, declarations: this.domain.toCapabilityDeclarations(updated, snapshot) };
  }

  async enqueueTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string): Promise<AgentTaskEnvelope> {
    await this.requireAgent(tenantId, input.agentId);
    const existing = await this.repository.findTaskByIdempotencyKey(tenantId, input.agentId, input.idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.repository.createTask({
      id: newId('agtask'),
      tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      idempotencyKey: input.idempotencyKey,
      payload: this.domain.sanitizePayload(input.payload ?? {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      requestId,
    });
  }

  async pullTasks(tenantId: string, agentId: string, limit = 10): Promise<AgentTaskEnvelope[]> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (agent.status === 'DISABLED') return [];
    const tasks = await this.repository.listTasks(tenantId, agentId, ['queued']);
    return tasks.slice(0, limit);
  }

  async ackTask(tenantId: string, input: AckAgentTaskInput): Promise<AgentTaskEnvelope> {
    const task = await this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.status === 'acked' && task.leaseId === input.leaseId) return task;
    if (task.status !== 'queued' && task.status !== 'leased') {
      throw new AppError('VALIDATION_FAILED', '任务不能重复 ack', { taskId: task.id, status: task.status });
    }
    if (task.leaseId && task.leaseId !== input.leaseId) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '任务 leaseId 冲突', { taskId: task.id });
    }
    return this.repository.updateTask(task.id, { status: 'acked', leaseId: input.leaseId, ackedAt: new Date().toISOString() });
  }

  async submitResult(tenantId: string, input: SubmitAgentTaskResultInput): Promise<AgentTaskEnvelope> {
    const task = await this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.leaseId !== input.leaseId) throw new AppError('IDEMPOTENCY_CONFLICT', '任务结果 leaseId 不匹配', { taskId: task.id });
    if (['succeeded', 'failed'].includes(task.status)) return task;
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
        detail: this.domain.sanitizeResultDetail(input.detail ?? {}),
      },
    });
  }

  async submitLog(tenantId: string, input: SubmitAgentTaskLogInput, requestId: string): Promise<AgentTaskLogEntry & { ackedSequence: number; lastAckedSequence: number }> {
    const result = await this.submitLogs(tenantId, { agentId: input.agentId, taskId: input.taskId, logs: [input] }, requestId);
    const entry = (await this.repository.listTaskLogs(tenantId, input.taskId)).find((item) => item.agentId === input.agentId && item.sequence === input.sequence);
    if (!entry) throw new AppError('RESOURCE_VERSION_CONFLICT', '日志 sequence 已落后于 ack cursor，不能补写', { sequence: input.sequence, ackedSequence: result.ackedSequence });
    return { ...entry, ackedSequence: result.ackedSequence, lastAckedSequence: result.lastAckedSequence };
  }

  async submitLogs(tenantId: string, input: SubmitAgentTaskLogsInput, requestId: string): Promise<AgentTaskLogAckResult> {
    await this.requireTask(tenantId, input.agentId, input.taskId);
    const previousCursor = await this.repository.getTaskLogCursor(tenantId, input.agentId, input.taskId);
    const previousAck = previousCursor?.lastAckedSequence ?? 0;
    const acceptedSequences: number[] = [];
    const duplicateSequences: number[] = [];
    const rejectedSequences: number[] = [];
    const existingLogs = await this.repository.listTaskLogs(tenantId, input.taskId);

    for (const log of input.logs) {
      const existing = existingLogs.find((item) => item.agentId === input.agentId && item.sequence === log.sequence);
      if (existing) {
        duplicateSequences.push(log.sequence);
        continue;
      }
      if (log.sequence <= previousAck) {
        rejectedSequences.push(log.sequence);
        continue;
      }
      const saved = await this.repository.saveTaskLog(this.domain.normalizeTaskLog(tenantId, { ...log, agentId: input.agentId, taskId: input.taskId }, requestId));
      existingLogs.push(saved);
      acceptedSequences.push(saved.sequence);
    }

    const allSequences = existingLogs
      .filter((item) => item.agentId === input.agentId)
      .map((item) => item.sequence);
    const ackedSequence = this.domain.nextContiguousAckedSequence(allSequences, previousAck);
    await this.repository.saveTaskLogCursor({
      tenantId,
      agentId: input.agentId,
      taskId: input.taskId,
      lastAckedSequence: ackedSequence,
      updatedAt: new Date().toISOString(),
      requestId,
    });
    return {
      agentId: input.agentId,
      taskId: input.taskId,
      acceptedSequences,
      duplicateSequences,
      rejectedSequences,
      ackedSequence,
      lastAckedSequence: ackedSequence,
    };
  }

  async listTaskLogs(tenantId: string, taskId: string) {
    const task = await this.repository.getTask(tenantId, taskId);
    if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return this.repository.listTaskLogs(tenantId, taskId);
  }

  async getLogCursor(tenantId: string, agentId: string, taskId: string) {
    await this.requireTask(tenantId, agentId, taskId);
    return await this.repository.getTaskLogCursor(tenantId, agentId, taskId) ?? {
      tenantId,
      agentId,
      taskId,
      lastAckedSequence: 0,
      updatedAt: undefined,
    };
  }

  async publishVersion(tenantId: string, input: PublishAgentVersionInput) {
    return this.repository.publishVersion(this.domain.normalizeRelease(tenantId, input));
  }

  async checkUpgrade(tenantId: string, input: CheckAgentUpgradeInput): Promise<AgentUpgradePlan | { status: 'not_required'; reason: string }> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const releases = await this.repository.listActiveVersions(tenantId);
    const release = releases.find((item) => item.platform === agent.descriptor.osType && (!item.arch || item.arch === agent.descriptor.arch));
    if (!release) return { status: 'not_required', reason: '没有匹配平台的升级版本' };
    if (release.version === agent.descriptor.version) return { status: 'not_required', reason: 'Agent 已是目标版本' };
    const existing = await this.repository.findUpgradePlanForAgent(tenantId, agent.id, release.id);
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

  async submitUpgradeResult(tenantId: string, input: SubmitAgentUpgradeResultInput) {
    await this.requireAgent(tenantId, input.agentId);
    const plan = await this.repository.getUpgradePlan(tenantId, input.planId);
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

  async disableAgent(tenantId: string, input: DisableAgentInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const now = new Date().toISOString();
    const updated = await this.repository.updateRegistration(agent.id, {
      status: 'DISABLED',
      gateway: agent.gateway ? { ...agent.gateway, status: input.revokeCertificate ? 'revoked' : 'disabled' } : undefined,
      updatedAt: now,
      lastRequestId: requestId,
      disabledAt: agent.disabledAt ?? now,
      disabledBy: input.actorId,
      disabledReason: input.reason,
      revokedAt: input.revokeCertificate ? (agent.revokedAt ?? now) : agent.revokedAt,
      revokedBy: input.revokeCertificate ? input.actorId : agent.revokedBy,
      revokedReason: input.revokeCertificate ? (input.reason ?? 'Agent 证书在禁用时吊销') : agent.revokedReason,
      certificateRevoked: input.revokeCertificate ? true : agent.certificateRevoked,
    });
    void this.syncGatewayRegistry(tenantId, updated);
    return updated;
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query);
  }

  async getAgentDetail(tenantId: string, agentId: string): Promise<AgentDetailProjection> {
    const agent = await this.requireAgent(tenantId, agentId);
    const capabilitySnapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agent.id);
    const latestHeartbeat = await this.repository.getLatestHeartbeat(tenantId, agent.id);
    const capabilities = await this.getCapabilityProjection(tenantId, agent.id);
    const taskQueue = await this.listTaskQueue(tenantId, agent.id);
    const upgradeSuggestion = await this.getUpgradeSuggestion(tenantId, agent.id);
    const recentErrors = await this.repository.listAgentTaskLogs(tenantId, agent.id, ['error']);
    return {
      agent,
      lifecycle: this.toLifecycle(agent),
      latestHeartbeat,
      capabilitySnapshot,
      capabilities,
      taskQueue,
      upgradeSuggestion,
      recentErrors: recentErrors.slice(0, 10),
    };
  }

  async getCapabilityProjection(tenantId: string, agentId: string): Promise<AgentCapabilityProjection> {
    const agent = await this.requireAgent(tenantId, agentId);
    const snapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agent.id);
    return { agentId: agent.id, declarations: snapshot ? this.domain.toCapabilityDeclarations(agent, snapshot) : [] };
  }

  async listTaskQueue(tenantId: string, agentId: string, statuses?: AgentTaskEnvelope['status'][]): Promise<AgentTaskQueueProjection> {
    await this.requireAgent(tenantId, agentId);
    const allTasks = await this.repository.listTasks(tenantId, agentId);
    const tasks = statuses?.length ? allTasks.filter((task) => statuses.includes(task.status)) : allTasks;
    return { agentId, counts: countTasks(allTasks), tasks };
  }

  async getUpgradeSuggestion(tenantId: string, agentId: string): Promise<AgentUpgradeSuggestionProjection> {
    const agent = await this.requireAgent(tenantId, agentId);
    const releases = await this.repository.listActiveVersions(tenantId);
    const release = releases.find((item) => item.platform === agent.descriptor.osType && (!item.arch || item.arch === agent.descriptor.arch));
    if (!release) {
      return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: '没有匹配平台的升级版本' } };
    }
    if (release.version === agent.descriptor.version) {
      return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: 'Agent 已是目标版本' } };
    }
    const existingPlan = await this.repository.findUpgradePlanForAgent(tenantId, agent.id, release.id);
    const manual = agent.role === 'legacy_agent';
    return {
      agentId: agent.id,
      currentVersion: agent.descriptor.version,
      suggestion: {
        status: manual ? 'manual_required' : 'available',
        reason: manual ? 'Legacy Agent 不支持自动升级' : '发现可用升级版本',
        targetVersion: release.version,
        releaseId: release.id,
        downloadUrl: release.downloadUrl,
        checksumSha256: release.checksumSha256,
        signature: release.signature,
        rollbackVersion: release.rollbackVersion,
        existingPlan,
      },
    };
  }

  getRepository(): AgentsRepository {
    return this.repository;
  }

  private async ensureCertificateAuthority() {
    const existing = await this.repository.getCertificateAuthority();
    return existing ?? this.repository.saveCertificateAuthority(this.domain.createCertificateAuthority());
  }

  private async requireAgent(tenantId: string, agentId: string) {
    const agent = await this.repository.getRegistration(tenantId, agentId);
    if (!agent) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 不存在', { agentId });
    return agent;
  }

  private async requireTask(tenantId: string, agentId: string, taskId: string) {
    const task = await this.repository.getTask(tenantId, taskId);
    if (!task || task.agentId !== agentId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return task;
  }

  private async syncGatewayRegistry(tenantId: string, agent: AgentRegistration): Promise<void> {
    if (!this.gateways || agent.role !== 'gateway' || !agent.gateway) return;
    const gateway = await this.gateways.findGatewayByAgentId(tenantId, agent.id);
    if (agent.gateway.zoneIds.length === 0) return;
    if (gateway) {
      await this.gateways.updateGatewayStatus(tenantId, gateway.id, {
        agentId: agent.id,
        version: agent.descriptor.version,
        zoneIds: agent.gateway.zoneIds,
        adapters: agent.gateway.adapters,
        capabilities: agent.gateway.capabilities,
        capabilitySetId: agent.gateway.capabilitySetId,
        currentLoad: agent.gateway.currentLoad,
        maxConcurrentTasks: agent.gateway.maxConcurrentTasks,
        successRate: agent.gateway.successRate,
        status: agent.gateway.status,
        lastHeartbeatAt: agent.gateway.lastHeartbeatAt,
      });
      return;
    }
    await this.gateways.registerGateway(tenantId, {
      id: agent.id,
      agentId: agent.id,
      zoneIds: agent.gateway.zoneIds,
      version: agent.descriptor.version,
      adapters: agent.gateway.adapters,
      capabilities: agent.gateway.capabilities,
      capabilitySetId: agent.gateway.capabilitySetId,
      currentLoad: agent.gateway.currentLoad,
      maxConcurrentTasks: agent.gateway.maxConcurrentTasks,
      successRate: agent.gateway.successRate,
    });
  }

  private toLifecycle(agent: AgentRegistration) {
    const disabled = agent.status === 'DISABLED' || Boolean(agent.disabledAt);
    const revoked = Boolean(agent.revokedAt || agent.certificateRevoked);
    return {
      status: agent.status,
      disabled,
      disabledAt: agent.disabledAt,
      disabledBy: agent.disabledBy,
      disabledReason: agent.disabledReason,
      revoked,
      revokedAt: agent.revokedAt,
      revokedBy: agent.revokedBy,
      revokedReason: agent.revokedReason,
      certificateRevoked: Boolean(agent.certificateRevoked),
      canHeartbeat: !disabled && !revoked,
      canPullTasks: !disabled && !revoked && agent.status !== 'OFFLINE',
    };
  }
}

function countTasks(tasks: AgentTaskEnvelope[]): Record<AgentTaskEnvelope['status'], number> {
  return tasks.reduce<Record<AgentTaskEnvelope['status'], number>>((counts, task) => {
    counts[task.status] += 1;
    return counts;
  }, { queued: 0, leased: 0, acked: 0, succeeded: 0, failed: 0, rejected: 0 });
}
