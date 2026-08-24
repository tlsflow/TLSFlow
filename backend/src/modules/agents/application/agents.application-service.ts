import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentCertificateIssueResult, AgentCertificateRotateResult, AgentDetailProjection, AgentHeartbeatInput, AgentTaskLogAckResult, AgentTaskQueueProjection, AgentUpgradeSuggestionProjection, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DisableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan } from '../schema/agents.schema.js';
import { InMemoryAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';

export class AgentsApplicationService {
  constructor(
    private readonly repository: AgentsRepository = new InMemoryAgentsRepository(),
    private readonly domain = new AgentsDomainService(),
    private readonly gateways?: GatewaysRepository,
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
    const role = input.role ?? 'full_agent';
    const existing = this.repository.findByAgentKey(tenantId, descriptor.agentKey);
    const gateway = this.domain.normalizeGatewayOnRegister(input, existing?.gateway);
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
    const now = new Date().toISOString();
    if (existing) {
      const updated = this.repository.updateRegistration(existing.id, {
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
      this.syncGatewayRegistry(tenantId, updated);
      return updated;
    }
    const registered = this.repository.upsertRegistration({
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
    this.syncGatewayRegistry(tenantId, registered);
    return registered;
  }

  heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const gateway = this.domain.normalizeGatewayOnHeartbeat(agent, input, now);
    const updated = this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: { ...agent.descriptor, version: input.version },
      gateway,
      updatedAt: now,
      lastRequestId: requestId,
    });
    this.syncGatewayRegistry(tenantId, updated);
    const heartbeat = this.repository.saveHeartbeat({
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

  createCertificateSigningRequest(tenantId: string, input: CreateAgentCertificateSigningRequestInput, actorId: string, requestId: string) {
    const agent = this.requireAgent(tenantId, input.agentId);
    return this.repository.createCertificateSigningRequest(this.domain.normalizeCertificateSigningRequest(tenantId, agent, input, actorId, requestId));
  }

  signCertificate(tenantId: string, input: SignAgentCertificateInput): AgentCertificateIssueResult {
    const agent = this.requireAgent(tenantId, input.agentId);
    if (agent.status === 'DISABLED') throw new AppError('VALIDATION_FAILED', 'DISABLED Agent 不能签发新证书', { agentId: agent.id });
    const csr = this.repository.getCertificateSigningRequest(tenantId, input.csrId);
    if (!csr) throw new AppError('RESOURCE_NOT_FOUND', 'Agent CSR 不存在', { csrId: input.csrId });
    const ca = this.ensureCertificateAuthority();
    const certificate = this.repository.createCertificate(this.domain.issueCertificate({ tenantId, agent, csr, ca, ttlDays: input.ttlDays, issuedBy: input.issuedBy }));
    const signedCsr = this.repository.updateCertificateSigningRequest(csr.id, {
      status: 'signed',
      signedCertificateId: certificate.id,
      signedAt: certificate.issuedAt,
    });
    this.repository.updateRegistration(agent.id, {
      certificateFingerprint: certificate.fingerprintSha256,
      certificateExpiresAt: certificate.notAfter,
      certificateRevoked: false,
      updatedAt: new Date().toISOString(),
    });
    return { csr: signedCsr, certificate, ca };
  }

  rotateCertificate(tenantId: string, input: RotateAgentCertificateInput, requestId: string): AgentCertificateRotateResult {
    const agent = this.requireAgent(tenantId, input.agentId);
    const previousCertificate = this.repository.findActiveCertificate(tenantId, agent.id);
    const csr = this.repository.createCertificateSigningRequest(this.domain.normalizeCertificateSigningRequest(tenantId, agent, {
      csrPem: input.csrPem,
      requestedTtlDays: input.ttlDays,
    }, input.issuedBy, requestId));
    const ca = this.ensureCertificateAuthority();
    const certificate = this.repository.createCertificate(this.domain.issueCertificate({
      tenantId,
      agent,
      csr,
      ca,
      ttlDays: input.ttlDays,
      issuedBy: input.issuedBy,
      rotatedFromCertificateId: previousCertificate?.id,
    }));
    const signedCsr = this.repository.updateCertificateSigningRequest(csr.id, {
      status: 'signed',
      signedCertificateId: certificate.id,
      signedAt: certificate.issuedAt,
    });
    const rotatedPrevious = previousCertificate ? this.repository.updateCertificate(previousCertificate.id, { status: 'rotated' }) : undefined;
    this.repository.updateRegistration(agent.id, {
      certificateFingerprint: certificate.fingerprintSha256,
      certificateExpiresAt: certificate.notAfter,
      certificateRevoked: false,
      updatedAt: new Date().toISOString(),
    });
    return { csr: signedCsr, certificate, ca, previousCertificate: rotatedPrevious };
  }

  revokeCertificate(tenantId: string, input: RevokeAgentCertificateInput) {
    const agent = this.requireAgent(tenantId, input.agentId);
    const certificate = this.repository.getCertificate(tenantId, input.certificateId);
    if (!certificate || certificate.agentId !== agent.id) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 证书不存在', { certificateId: input.certificateId });
    if (certificate.status === 'revoked') return certificate;
    const now = new Date().toISOString();
    const revoked = this.repository.updateCertificate(certificate.id, {
      status: 'revoked',
      revokedAt: now,
      revokedBy: input.revokedBy,
      revokedReason: input.reason,
    });
    if (agent.certificateFingerprint === certificate.fingerprintSha256) {
      this.repository.updateRegistration(agent.id, {
        certificateRevoked: true,
        revokedAt: agent.revokedAt ?? now,
        revokedBy: input.revokedBy,
        revokedReason: input.reason ?? 'Agent 证书被吊销',
        updatedAt: now,
      });
    }
    return revoked;
  }

  listCertificates(tenantId: string, agentId: string) {
    this.requireAgent(tenantId, agentId);
    return this.repository.listCertificates(tenantId, agentId);
  }

  reportCapabilities(tenantId: string, input: AgentCapabilitySnapshotInput, requestId: string): AgentCapabilityProjection {
    const agent = this.requireAgent(tenantId, input.agentId);
    const snapshot = this.repository.saveCapabilitySnapshot(this.domain.normalizeCapabilitySnapshot(tenantId, agent.id, input, requestId));
    const gateway = this.domain.normalizeGatewayOnCapabilities(agent, input);
    const updated = gateway ? this.repository.updateRegistration(agent.id, {
      gateway,
      updatedAt: new Date().toISOString(),
      lastRequestId: requestId,
    }) : agent;
    this.syncGatewayRegistry(tenantId, updated);
    return { agentId: agent.id, declarations: this.domain.toCapabilityDeclarations(updated, snapshot) };
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
      payload: this.domain.sanitizePayload(input.payload ?? {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      requestId,
    });
  }

  pullTasks(tenantId: string, agentId: string, limit = 10): AgentTaskEnvelope[] {
    const agent = this.requireAgent(tenantId, agentId);
    if (agent.status === 'DISABLED') return [];
    return this.repository.listTasks(tenantId, agentId, ['queued']).slice(0, limit);
  }

  ackTask(tenantId: string, input: AckAgentTaskInput): AgentTaskEnvelope {
    const task = this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.status === 'acked' && task.leaseId === input.leaseId) return task;
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

  submitLog(tenantId: string, input: SubmitAgentTaskLogInput, requestId: string): AgentTaskLogEntry & { ackedSequence: number; lastAckedSequence: number } {
    const result = this.submitLogs(tenantId, { agentId: input.agentId, taskId: input.taskId, logs: [input] }, requestId);
    const entry = this.repository.listTaskLogs(tenantId, input.taskId).find((item) => item.agentId === input.agentId && item.sequence === input.sequence);
    if (!entry) throw new AppError('RESOURCE_VERSION_CONFLICT', '日志 sequence 已落后于 ack cursor，不能补写', { sequence: input.sequence, ackedSequence: result.ackedSequence });
    return { ...entry, ackedSequence: result.ackedSequence, lastAckedSequence: result.lastAckedSequence };
  }

  submitLogs(tenantId: string, input: SubmitAgentTaskLogsInput, requestId: string): AgentTaskLogAckResult {
    this.requireTask(tenantId, input.agentId, input.taskId);
    const previousCursor = this.repository.getTaskLogCursor(tenantId, input.agentId, input.taskId);
    const previousAck = previousCursor?.lastAckedSequence ?? 0;
    const acceptedSequences: number[] = [];
    const duplicateSequences: number[] = [];
    const rejectedSequences: number[] = [];

    for (const log of input.logs) {
      const existing = this.repository.listTaskLogs(tenantId, input.taskId)
        .find((item) => item.agentId === input.agentId && item.sequence === log.sequence);
      if (existing) {
        duplicateSequences.push(log.sequence);
        continue;
      }
      if (log.sequence <= previousAck) {
        rejectedSequences.push(log.sequence);
        continue;
      }
      const saved = this.repository.saveTaskLog(this.domain.normalizeTaskLog(tenantId, { ...log, agentId: input.agentId, taskId: input.taskId }, requestId));
      acceptedSequences.push(saved.sequence);
    }

    const allSequences = this.repository.listTaskLogs(tenantId, input.taskId)
      .filter((item) => item.agentId === input.agentId)
      .map((item) => item.sequence);
    const ackedSequence = this.domain.nextContiguousAckedSequence(allSequences, previousAck);
    this.repository.saveTaskLogCursor({
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

  listTaskLogs(tenantId: string, taskId: string) {
    const task = this.repository.getTask(tenantId, taskId);
    if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return this.repository.listTaskLogs(tenantId, taskId);
  }

  getLogCursor(tenantId: string, agentId: string, taskId: string) {
    this.requireTask(tenantId, agentId, taskId);
    return this.repository.getTaskLogCursor(tenantId, agentId, taskId) ?? {
      tenantId,
      agentId,
      taskId,
      lastAckedSequence: 0,
      updatedAt: undefined,
    };
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

  disableAgent(tenantId: string, input: DisableAgentInput, requestId: string) {
    const agent = this.requireAgent(tenantId, input.agentId);
    const now = new Date().toISOString();
    const updated = this.repository.updateRegistration(agent.id, {
      status: 'DISABLED',
      gateway: agent.gateway ? { ...agent.gateway, status: input.revokeCertificate ? 'revoked' : 'disabled' } : undefined,
      updatedAt: now,
      lastRequestId: requestId,
      disabledAt: agent.disabledAt ?? now,
      disabledBy: input.actorId,
      disabledReason: input.reason,
      revokedAt: input.revokeCertificate ? (agent.revokedAt ?? now) : agent.revokedAt,
      revokedBy: input.revokeCertificate ? input.actorId : agent.revokedBy,
      revokedReason: input.revokeCertificate ? (input.reason ?? 'Agent 被禁用时吊销证书') : agent.revokedReason,
      certificateRevoked: input.revokeCertificate ? true : agent.certificateRevoked,
    });
    this.syncGatewayRegistry(tenantId, updated);
    return updated;
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query);
  }

  getAgentDetail(tenantId: string, agentId: string): AgentDetailProjection {
    const agent = this.requireAgent(tenantId, agentId);
    const capabilitySnapshot = this.repository.getLatestCapabilitySnapshot(tenantId, agent.id);
    return {
      agent,
      lifecycle: this.toLifecycle(agent),
      latestHeartbeat: this.repository.getLatestHeartbeat(tenantId, agent.id),
      capabilitySnapshot,
      capabilities: this.getCapabilityProjection(tenantId, agent.id),
      taskQueue: this.listTaskQueue(tenantId, agent.id),
      upgradeSuggestion: this.getUpgradeSuggestion(tenantId, agent.id),
      recentErrors: this.repository.listAgentTaskLogs(tenantId, agent.id, ['error']).slice(0, 10),
    };
  }

  getCapabilityProjection(tenantId: string, agentId: string): AgentCapabilityProjection {
    const agent = this.requireAgent(tenantId, agentId);
    const snapshot = this.repository.getLatestCapabilitySnapshot(tenantId, agent.id);
    return { agentId: agent.id, declarations: snapshot ? this.domain.toCapabilityDeclarations(agent, snapshot) : [] };
  }

  listTaskQueue(tenantId: string, agentId: string, statuses?: AgentTaskEnvelope['status'][]): AgentTaskQueueProjection {
    this.requireAgent(tenantId, agentId);
    const allTasks = this.repository.listTasks(tenantId, agentId);
    const tasks = statuses?.length ? allTasks.filter((task) => statuses.includes(task.status)) : allTasks;
    return { agentId, counts: countTasks(allTasks), tasks };
  }

  getUpgradeSuggestion(tenantId: string, agentId: string): AgentUpgradeSuggestionProjection {
    const agent = this.requireAgent(tenantId, agentId);
    const release = this.repository.listActiveVersions(tenantId)
      .find((item) => item.platform === agent.descriptor.osType && (!item.arch || item.arch === agent.descriptor.arch));
    if (!release) {
      return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: '没有匹配平台的升级版本' } };
    }
    if (release.version === agent.descriptor.version) {
      return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: 'Agent 已是目标版本' } };
    }
    const existingPlan = this.repository.findUpgradePlanForAgent(tenantId, agent.id, release.id);
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

  private ensureCertificateAuthority() {
    return this.repository.getCertificateAuthority() ?? this.repository.saveCertificateAuthority(this.domain.createCertificateAuthority());
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

  private syncGatewayRegistry(tenantId: string, agent: AgentRegistration): void {
    if (!this.gateways || agent.role !== 'gateway' || !agent.gateway) return;
    const gateway = this.gateways.findGatewayByAgentId(tenantId, agent.id);
    if (agent.gateway.zoneIds.length === 0) return;
    if (gateway) {
      this.gateways.updateGatewayStatus(tenantId, gateway.id, {
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
    this.gateways.registerGateway(tenantId, {
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
