import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { isObservationStale, readPositiveSeconds } from '../../../shared/observation-freshness.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import { AgentDirectClient } from './agent-direct-client.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentCertificateIssueResult, AgentCertificateRotateResult, AgentDetailProjection, AgentHealthProjection, AgentHeartbeatInput, AgentInstallSessionBootstrapProjection, AgentTaskLogAckResult, AgentTaskQueueProjection, AgentUpgradeSuggestionProjection, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, CreateGatewayEnableSessionInput, CreateLinuxGoInstallSessionInput, CreateWindowsCompatibilityInstallSessionInput, CreateWindowsPowerShellInstallSessionInput, DeleteAgentInput, DisableAgentInput, EnableAgentInput, EnqueueAgentCapabilityRescanInput, EnqueueAgentTaskInput, GatewayEnableSessionProjection, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentRuntimeLogInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentHeartbeat, AgentInstallSession, AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan } from '../schema/agents.schema.js';
import { PgAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';
import { buildLinuxAgentBundleTarGz, getLinuxAgentBundleManifest } from './linux-agent-bundle.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { ExecutionResultSyncService } from '../../executions/application/execution-result-sync.service.js';
import type { ExecutionDetailStreamService } from '../../executions/application/execution-detail-stream.service.js';
import type { LivenessApplicationService } from '../../liveness/application/liveness.application-service.js';
import type { AgentCapabilityDiscoveryProjector } from '../discovery/agent-capability-discovery.projector.js';
import type { StandardDiscoveryProjectionSummary } from '../../plugins/discovery/standard-device-discovery.projector.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

export class AgentsApplicationService {
  private readonly directClient = new AgentDirectClient();
  private readonly offlineTimeoutCounts = new Map<string, number>();
  constructor(
    private readonly repository: AgentsRepository = new PgAgentsRepository(),
    private readonly domain = new AgentsDomainService(),
    private readonly gateways?: GatewaysRepository,
    private readonly certificates?: CertificatesApplicationService,
    private readonly secrets?: SecretService,
    private readonly executionResultSync?: ExecutionResultSyncService,
    private readonly detailStream?: ExecutionDetailStreamService,
    private readonly liveness?: LivenessApplicationService,
    private readonly capabilityDiscoveryProjector?: AgentCapabilityDiscoveryProjector,
    private readonly tasks?: TaskEnqueuer,
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
    const existing = await this.resolveExistingRegistration(tenantId, descriptor.agentKey, descriptor.machineId);
    const gateway = this.domain.normalizeGatewayOnRegister(input, existing?.gateway);
    let enrollmentTokenId: string | undefined;
    if (input.enrollmentToken) {
      const token = await this.repository.findEnrollmentTokenByHash(tenantId, this.domain.hashEnrollmentToken(input.enrollmentToken));
      if (!token) throw new AppError('AUTH_FORBIDDEN', '注册令牌无效');
      const reusingOriginalEnrollment = existing?.enrollmentTokenId === token.id;
      if (reusingOriginalEnrollment) {
        if (token.status === 'revoked') throw new AppError('AUTH_FORBIDDEN', '注册令牌已撤销', { tokenId: token.id });
      } else {
        this.domain.assertEnrollmentAllowed(token, input);
        const usedCount = token.usedCount + 1;
        await this.repository.updateEnrollmentToken(token.id, {
          usedCount,
          lastUsedAt: new Date().toISOString(),
          status: usedCount >= token.maxUses ? 'exhausted' : 'active',
        });
      }
      enrollmentTokenId = token.id;
    }
    const now = new Date().toISOString();
    if (existing) {
      const updated = await this.repository.updateRegistration(existing.id, {
        descriptor,
        status: existing.status === 'DISABLED' ? 'DISABLED' : 'OFFLINE',
        role: input.role ?? existing.role,
        zone: gateway?.zoneIds[0] ?? input.zone ?? existing.zone,
        gateway: existing.status === 'DISABLED' && gateway ? { ...gateway, status: 'disabled' } : gateway,
        directControl: input.directControl ?? existing.directControl,
        enrollmentTokenId: enrollmentTokenId ?? existing.enrollmentTokenId,
        certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : existing.certificateFingerprint,
        certificateExpiresAt: input.certificateExpiresAt ?? existing.certificateExpiresAt,
        updatedAt: now,
        lastRequestId: requestId,
      });
      await this.syncGatewayRegistry(tenantId, updated);
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
      directControl: input.directControl,
      enrollmentTokenId,
      certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : undefined,
      certificateExpiresAt: input.certificateExpiresAt,
      status: 'OFFLINE',
      registeredAt: now,
      updatedAt: now,
      lastRequestId: requestId,
      version: 1,
    });
    await this.syncGatewayRegistry(tenantId, registered);
    return registered;
  }

  async heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const gateway = this.domain.normalizeGatewayOnHeartbeat(agent, input, now);
    const directControl = input.directControl ?? agent.directControl;
    const reportedIpAddress = resolveDirectControlHost(directControl?.listenAddress);
    const updated = await this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: {
        ...agent.descriptor,
        version: input.version,
        ...(reportedIpAddress ? { ipAddress: reportedIpAddress } : {}),
      },
      gateway,
      directControl,
      updatedAt: now,
      lastRequestId: requestId,
    });
    await this.syncGatewayRegistry(tenantId, updated);
    const heartbeat = await this.repository.saveHeartbeat({
      tenantId,
      agentId: agent.id,
      status: nextStatus,
      version: input.version,
      runtimeHealth: input.runtimeHealth,
      gateway,
      directControl,
      taskSummary: input.taskSummary ?? { running: 0, queued: 0 },
      receivedAt: now,
      requestId,
    });
    await this.liveness?.recordHeartbeat(tenantId, agent.id, now);
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
    if (this.capabilityDiscoveryProjector) {
      try {
        await this.capabilityDiscoveryProjector.project(agent, snapshot);
      } catch (error) {
        structuredLogger.error('Agent capability discovery projection failed', {
          error: error instanceof Error ? error.message : String(error),
          snapshotId: snapshot.id,
        }, {
          module: 'agents',
          tenantId,
          resourceType: 'agent',
          resourceId: agent.id,
        });
      }
    }
    const gateway = this.domain.normalizeGatewayOnCapabilities(agent, input);
    const updated = gateway ? await this.repository.updateRegistration(agent.id, {
      gateway,
      updatedAt: new Date().toISOString(),
      lastRequestId: requestId,
    }) : agent;
    await this.syncGatewayRegistry(tenantId, updated);
    return { agentId: agent.id, declarations: this.domain.toCapabilityDeclarations(updated, snapshot) };
  }

  async parseAgentRequestIdentity(
    token: string,
    request: { method: string; path: string },
  ): Promise<{ actorId: string; tenantId: string } | undefined> {
    if (!isAgentMachineRoute(request.method, request.path)) return undefined;
    const normalizedToken = token.trim();
    if (!normalizedToken) return undefined;
    const enrollment = await this.repository.findEnrollmentTokenByHashAnyTenant(
      this.domain.hashEnrollmentToken(normalizedToken),
    );
    if (!enrollment || enrollment.status === 'revoked') return undefined;
    return {
      actorId: `agent-token:${enrollment.id}`,
      tenantId: enrollment.tenantId,
    };
  }

  /**
   * 内置插件发现映射发生变化后，重放每个 Agent 的最新事实快照。
   *
   * Agent capability snapshot 是事实来源，插件映射是投影规则。
   * 只刷新插件注册表而不重放快照，会让历史 IIS 投影继续占据设备详情。
   */
  async reprojectLatestCapabilitySnapshots(tenantId?: string): Promise<{
    attempted: number;
    projected: number;
    skipped: number;
    failed: Array<{ tenantId: string; agentId: string; error: string }>;
  }> {
    if (!this.capabilityDiscoveryProjector) {
      return { attempted: 0, projected: 0, skipped: 0, failed: [] };
    }

    const summary = {
      attempted: 0,
      projected: 0,
      skipped: 0,
      failed: [] as Array<{ tenantId: string; agentId: string; error: string }>,
    };

    for (const agent of await this.repository.listAllRegistrations()) {
      if (tenantId && agent.tenantId !== tenantId) continue;
      const snapshot = await this.repository.getLatestCapabilitySnapshot(agent.tenantId, agent.id);
      if (!snapshot) {
        summary.skipped += 1;
        continue;
      }

      summary.attempted += 1;
      try {
        await this.capabilityDiscoveryProjector.project(agent, snapshot);
        summary.projected += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.failed.push({ tenantId: agent.tenantId, agentId: agent.id, error: message });
        structuredLogger.error('内置插件刷新后的 Agent 发现重投影失败', {
          agentId: agent.id,
          snapshotId: snapshot.id,
          errorMessage: message,
        }, {
          tenantId: agent.tenantId,
          module: 'agents',
          resourceType: 'agent',
          resourceId: agent.id,
        });
      }
    }

    return summary;
  }

  async enqueueTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string): Promise<AgentTaskEnvelope> {
    await this.requireAgent(tenantId, input.agentId);
    await this.assertLivenessAllowsExecution(tenantId, input.agentId);
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
      payload: input.payload ?? {},
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      requestId,
    });
  }

  /**
   * 创建由控制面主动发起的直连任务，并在入库时直接占有 lease。
   * 该任务不会暴露给 Agent 拉取接口，避免同一动作被直连与轮询重复执行。
   */
  async enqueueDirectTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string): Promise<AgentTaskEnvelope> {
    await this.requireAgent(tenantId, input.agentId);
    await this.assertLivenessAllowsExecution(tenantId, input.agentId);
    const existing = await this.repository.findTaskByIdempotencyKey(tenantId, input.agentId, input.idempotencyKey);
    if (existing) {
      if (existing.status === 'queued' || existing.status === 'leased') {
        const leaseId = `direct:${existing.id}`;
        return this.repository.updateTask(existing.id, {
          status: 'acked',
          leaseId,
          ackedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return existing;
    }
    const now = new Date().toISOString();
    const taskId = newId('agtask');
    return this.repository.createTask({
      id: taskId,
      tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      status: 'acked',
      leaseId: `direct:${taskId}`,
      ackedAt: now,
      createdAt: now,
      updatedAt: now,
      requestId,
    });
  }

  async enqueueCapabilityRescanTask(tenantId: string, input: EnqueueAgentCapabilityRescanInput, requestId: string): Promise<AgentTaskEnvelope> {
    await this.requireAgent(tenantId, input.agentId);
    const existingQueuedTask = await this.findActiveCapabilityRescanTask(tenantId, input.agentId);
    if (existingQueuedTask) return existingQueuedTask;
    const task = await this.enqueueTask(tenantId, {
      agentId: input.agentId,
      executionRunId: `agent_rescan:${input.agentId}`,
      executionStepId: `capability_rescan:${input.agentId}`,
      idempotencyKey: `agent.capability.rescan:${input.agentId}:${requestId}`,
      payload: {
        type: 'agent.capability.rescan',
        requestedBy: input.requestedBy,
        requestedAt: new Date().toISOString(),
      },
    }, requestId);
    enqueueTaskBestEffort(this.tasks, {
      tenantId,
      taskType: 'AGENT_CAPABILITY_RESCAN',
      requestedBy: input.requestedBy,
      triggerSource: 'agents.capability-rescan',
      idempotencyKey: `agent-capability-rescan:${task.id}`,
      payload: { agentTaskId: task.id, agentId: input.agentId },
      resourceRefs: [
        { resourceType: 'agent', resourceId: input.agentId },
        { resourceType: 'agentTask', resourceId: task.id },
      ],
    });
    // 中文说明：统一任务模式下，控制面只负责入列；即使 Agent 支持直连，也不能在这里绕过任务审计直接执行。
    return task;
  }

  async refreshStandardDiscovery(tenantId: string, agentId: string, requestedBy: string, requestId: string): Promise<{
    mode: 'standard-capability' | 'queued';
    task: AgentTaskEnvelope;
    capabilitySnapshotId?: string;
    projection?: StandardDiscoveryProjectionSummary;
  }> {
    if (!this.capabilityDiscoveryProjector) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'Agent 标准发现投影器未配置');
    }
    const previousSnapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agentId);
    const task = await this.enqueueCapabilityRescanTask(tenantId, { agentId, requestedBy }, requestId);

    if (task.status === 'failed' || task.status === 'rejected') {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 能力重扫失败', {
        agentId,
        taskId: task.id,
        status: task.status,
        result: task.result,
      });
    }
    if (task.status !== 'succeeded') {
      return { mode: 'queued', task };
    }

    const snapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agentId);
    if (!snapshot || snapshot.id === previousSnapshot?.id) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', 'Agent 能力重扫完成但未产生新快照', {
        agentId,
        taskId: task.id,
        previousSnapshotId: previousSnapshot?.id,
      });
    }
    const agent = await this.requireAgent(tenantId, agentId);
    const projection = await this.capabilityDiscoveryProjector.project(agent, snapshot);
    return {
      mode: 'standard-capability',
      task,
      capabilitySnapshotId: snapshot.id,
      projection,
    };
  }

  async pullTasks(tenantId: string, agentId: string, limit = 10): Promise<AgentTaskEnvelope[]> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (agent.status === 'DISABLED') return [];
    if (this.liveness) {
      const projection = await this.liveness.project(tenantId, 'AGENT', agentId, ['HEARTBEAT', 'MANAGEMENT_TCP']);
      if (projection.signals.length > 0 && projection.livenessStatus !== 'ONLINE') return [];
    }
    const tasks = await this.repository.listTasks(tenantId, agentId, ['queued']);
    return tasks.slice(0, limit);
  }

  async ackTask(tenantId: string, input: AckAgentTaskInput): Promise<AgentTaskEnvelope> {
    const task = await this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.status === 'queued') {
      const claimed = await this.repository.claimQueuedTask(task.id, input.agentId, input.leaseId, new Date().toISOString());
      if (claimed) return claimed;

      const current = await this.requireTask(tenantId, input.agentId, input.taskId);
      if (current.status !== 'queued') return current;
      throw new AppError('RESOURCE_VERSION_CONFLICT', '任务 lease 抢占冲突，请重试', { taskId: task.id });
    }
    // 拉取和直连可能同时看到同一条任务。已被其他 lease 占有时返回当前所有权，
    // 让调用方放弃执行，而不是把正常竞态伪装成“重复 ack”失败。
    if (task.status === 'acked') return task;
    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'rejected') return task;
    if (task.status === 'leased') return task;
    throw new AppError('VALIDATION_FAILED', '任务状态不允许 ack', { taskId: task.id, status: task.status });
  }

  async submitResult(tenantId: string, input: SubmitAgentTaskResultInput): Promise<AgentTaskEnvelope> {
    const task = await this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.leaseId !== input.leaseId) throw new AppError('IDEMPOTENCY_CONFLICT', '任务结果 leaseId 不匹配', { taskId: task.id });
    if (['succeeded', 'failed'].includes(task.status)) return task;
    if (!['acked', 'leased'].includes(task.status)) {
      throw new AppError('VALIDATION_FAILED', '只有已 ack 的任务能提交结果', { taskId: task.id, status: task.status });
    }
    const sanitizedDetail = this.domain.sanitizeResultDetail(input.detail ?? {});
    console.info('[agents.submitResult]', JSON.stringify({
      tenantId,
      agentId: input.agentId,
      taskId: input.taskId,
      leaseId: input.leaseId,
      success: input.success,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      detailKeys: Object.keys(sanitizedDetail),
      dryRunDebug: {
        mode: sanitizedDetail.mode,
        pfxPassLen: sanitizedDetail.pfxPassLen,
        pfxEdgeWhitespace: sanitizedDetail.pfxEdgeWhitespace,
        pfxPassUtf8Sha256: sanitizedDetail.pfxPassUtf8Sha256,
        pfxPassUtf8Len: sanitizedDetail.pfxPassUtf8Len,
        decodedPfxSha256: sanitizedDetail.decodedPfxSha256,
        decodedPfxSize: sanitizedDetail.decodedPfxSize,
        pfxSource: sanitizedDetail.pfxSource,
        dryRunSummary: sanitizedDetail.dryRunSummary,
        dryRunCheckCount: Array.isArray(sanitizedDetail.dryRunChecks) ? sanitizedDetail.dryRunChecks.length : undefined,
        firstFailedCheck: Array.isArray(sanitizedDetail.dryRunChecks)
          ? sanitizedDetail.dryRunChecks.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'failed')
          : undefined,
      },
    }));
    const updated = await this.repository.updateTask(task.id, {
      status: input.success ? 'succeeded' : 'failed',
      resultAt: new Date().toISOString(),
      result: {
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        detail: sanitizedDetail,
      },
    });
    if (this.executionResultSync) {
      console.info('[agents.submitResult.sync]', JSON.stringify({
        tenantId,
        executionRunId: task.executionRunId,
        executionStepId: task.executionStepId,
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        detailKeys: Object.keys(sanitizedDetail),
        dryRunDebug: {
          mode: sanitizedDetail.mode,
          pfxPassLen: sanitizedDetail.pfxPassLen,
          pfxEdgeWhitespace: sanitizedDetail.pfxEdgeWhitespace,
          pfxPassUtf8Sha256: sanitizedDetail.pfxPassUtf8Sha256,
          pfxPassUtf8Len: sanitizedDetail.pfxPassUtf8Len,
          decodedPfxSha256: sanitizedDetail.decodedPfxSha256,
          decodedPfxSize: sanitizedDetail.decodedPfxSize,
          pfxSource: sanitizedDetail.pfxSource,
          dryRunSummary: sanitizedDetail.dryRunSummary,
          dryRunCheckCount: Array.isArray(sanitizedDetail.dryRunChecks) ? sanitizedDetail.dryRunChecks.length : undefined,
          firstFailedCheck: Array.isArray(sanitizedDetail.dryRunChecks)
            ? sanitizedDetail.dryRunChecks.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'failed')
            : undefined,
        },
      }));
      await this.executionResultSync.applyAgentTaskResult({
        tenantId,
        executionRunId: task.executionRunId,
        executionStepId: task.executionStepId,
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        detail: sanitizedDetail,
        actorId: input.agentId,
      });
    }
    if (input.success && task.payload?.type === 'agent.capability.rescan') {
      await this.projectLatestCapabilitySnapshot(tenantId, task.agentId);
    }
    return updated;
  }

  private async projectLatestCapabilitySnapshot(tenantId: string, agentId: string): Promise<void> {
    if (!this.capabilityDiscoveryProjector) return;
    const snapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agentId);
    if (!snapshot) return;
    try {
      const agent = await this.requireAgent(tenantId, agentId);
      await this.capabilityDiscoveryProjector.project(agent, snapshot);
    } catch (error) {
      structuredLogger.error('Agent 能力重扫完成后的标准发现投影失败', {
        agentId,
        errorMessage: error instanceof Error ? error.message : String(error),
      }, {
        tenantId,
        module: 'agents',
        resourceType: 'agent',
        resourceId: agentId,
      });
    }
  }

  async executeTaskDirect(
    tenantId: string,
    taskId: string,
    requestId: string,
    onProgress?: (detail: Record<string, unknown>) => Promise<void> | void,
  ): Promise<{
    task: AgentTaskEnvelope;
    success: boolean;
    asyncPending?: boolean;
    errorCode?: string;
    errorMessage?: string;
    detail: Record<string, unknown>;
  }> {
    const task = await this.repository.getTask(tenantId, taskId);
    if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'rejected') {
      const result = readRecord(task.result);
      return {
        task,
        success: task.status === 'succeeded',
        errorCode: readStringValue(result.errorCode),
        errorMessage: readStringValue(result.errorMessage),
        detail: readRecord(result.detail),
      };
    }
    const actionType = resolveAgentTaskActionType(task.payload);
    if (!actionType) {
      throw new AppError('VALIDATION_FAILED', 'Agent task 缺少 actionType/type，不能直连执行', { taskId });
    }

    const agent = await this.requireAgent(tenantId, task.agentId);
    const leaseId = `direct:${task.id}`;
    const acknowledged = await this.ackTask(tenantId, { agentId: task.agentId, taskId: task.id, leaseId });
    if (acknowledged.leaseId && acknowledged.leaseId !== leaseId) {
      if (actionType === 'certificate.trust.inspect') {
        return this.waitForTaskResult(tenantId, task.id);
      }
      return {
        task: acknowledged,
        success: true,
        asyncPending: true,
        errorCode: 'AGENT_TASK_ALREADY_CLAIMED',
        errorMessage: 'Agent 已占有该任务，等待 Agent 返回结果',
        detail: {
          executionMode: 'queued',
          taskId: task.id,
          status: acknowledged.status,
        },
      };
    }

    let direct;
    try {
      direct = await this.directClient.executeAction(agent, {
        actionType,
        inputs: task.payload ?? {},
        requestId,
        onProgress,
      });
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      await this.submitResult(tenantId, {
        agentId: task.agentId,
        taskId: task.id,
        leaseId,
        success: false,
        errorCode: appError?.errorCode ?? 'DIRECT_EXECUTION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: { executionMode: 'direct', mode: 'agent_direct_execute_failed' },
      });
      throw error;
    }

    await this.submitResult(tenantId, {
      agentId: task.agentId,
      taskId: task.id,
      leaseId,
      success: direct.success,
      errorCode: direct.errorCode,
      errorMessage: direct.errorMessage,
      detail: {
        executionMode: 'direct',
        ...(direct.detail ?? {}),
      },
    });

    const updatedTask = await this.requireTask(tenantId, task.agentId, task.id);
    return {
      task: updatedTask,
      success: direct.success,
      errorCode: direct.errorCode,
      errorMessage: direct.errorMessage,
      detail: {
        mode: 'agent_direct_execute',
        taskId: task.id,
        directTaskId: direct.taskId,
        directControl: direct.directControl,
        ...(direct.detail ?? {}),
      },
    };
  }

  private async waitForTaskResult(
    tenantId: string,
    taskId: string,
    timeoutMs = 125_000,
  ): Promise<{
    task: AgentTaskEnvelope;
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    detail: Record<string, unknown>;
  }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await this.repository.getTask(tenantId, taskId);
      if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
      if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'rejected') {
        const result = readRecord(task.result);
        return {
          task,
          success: task.status === 'succeeded',
          errorCode: readStringValue(result.errorCode),
          errorMessage: readStringValue(result.errorMessage),
          detail: readRecord(result.detail),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '等待 Agent 根信任检查结果超时', {
      code: 'AGENT_TASK_RESULT_TIMEOUT',
      taskId,
      timeoutMs,
    });
  }

  async submitLog(tenantId: string, input: SubmitAgentTaskLogInput, requestId: string): Promise<AgentTaskLogEntry & { ackedSequence: number; lastAckedSequence: number }> {
    const result = await this.submitLogs(tenantId, { agentId: input.agentId, taskId: input.taskId, logs: [input] }, requestId);
    const entry = (await this.repository.listTaskLogs(tenantId, input.taskId)).find((item) => item.agentId === input.agentId && item.sequence === input.sequence);
    if (!entry) throw new AppError('RESOURCE_VERSION_CONFLICT', '日志 sequence 已落后于 ack cursor，不能补写', { sequence: input.sequence, ackedSequence: result.ackedSequence });
    return { ...entry, ackedSequence: result.ackedSequence, lastAckedSequence: result.lastAckedSequence };
  }

  async submitRuntimeLog(tenantId: string, input: SubmitAgentRuntimeLogInput, requestId: string) {
    await this.requireAgent(tenantId, input.agentId);
    return this.repository.saveRuntimeLog(this.domain.normalizeRuntimeLog(tenantId, input, requestId));
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
      const task = await this.repository.getTask(tenantId, input.taskId);
      if (task) {
        this.detailStream?.publishLog(task.executionRunId, tenantId, saved);
      }
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
    await this.syncGatewayRegistry(tenantId, updated);
    return updated;
  }

  async enableAgent(tenantId: string, input: EnableAgentInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const now = new Date().toISOString();
    const updated = await this.repository.updateRegistration(agent.id, {
      status: 'ONLINE',
      gateway: agent.gateway ? { ...agent.gateway, status: 'online' } : undefined,
      updatedAt: now,
      lastRequestId: requestId,
      disabledAt: undefined,
      disabledBy: undefined,
      disabledReason: undefined,
    });
    await this.syncGatewayRegistry(tenantId, updated);
    return updated;
  }

  async deleteAgent(tenantId: string, input: DeleteAgentInput) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    await this.repository.deleteRegistration(agent.id);
    return { deleted: true, agentId: agent.id };
  }

  async createWindowsPowerShellInstallSession(tenantId: string, input: CreateWindowsPowerShellInstallSessionInput, requestId: string, baseUrl: string, requestedBy?: string): Promise<AgentInstallSessionBootstrapProjection> {
    const session = this.domain.createWindowsPowerShellInstallSession(tenantId, input, requestId, baseUrl);
    await this.repository.createEnrollmentToken(session.enrollmentTokenRecord);
    await this.repository.createInstallSession({
      id: session.id,
      tenantId: session.tenantId,
      platform: session.platform,
      role: session.role,
      bootstrapTokenHash: session.bootstrapTokenHash,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      enrollmentToken: session.enrollmentToken,
      agentKey: session.agentKey,
      controlPlaneUrl: session.controlPlaneUrl,
      zone: session.zone,
      startAfterInstall: session.startAfterInstall,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      usedAt: session.usedAt,
      usedByIp: session.usedByIp,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
    });
    this.recordAgentInstallTask(tenantId, session.id, session.platform, requestedBy);
    const token = encodeURIComponent((session as AgentInstallSession & { bootstrapToken: string }).bootstrapToken);
    const bootstrapUrl = `${baseUrl}/agent-install.ps1?token=${token}`;
    return {
      sessionId: session.id,
      platform: 'windows_powershell_service',
      role: session.role,
      expiresAt: session.expiresAt,
      bootstrapUrl,
      installCommand: `irm ${baseUrl}/agent-install.ps1?token=${token} | iex`,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      enrollmentToken: session.enrollmentToken,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      zone: session.zone,
      enrollmentTokenPreview: `${session.enrollmentToken.slice(0, 12)}...${session.enrollmentToken.slice(-6)}`,
    };
  }

  async createWindowsCompatibilityInstallSession(tenantId: string, input: CreateWindowsCompatibilityInstallSessionInput, requestId: string, baseUrl: string, requestedBy?: string): Promise<AgentInstallSessionBootstrapProjection> {
    const session = this.domain.createWindowsCompatibilityInstallSession(tenantId, input, requestId, baseUrl);
    await this.repository.createEnrollmentToken(session.enrollmentTokenRecord);
    await this.repository.createInstallSession({
      id: session.id,
      tenantId: session.tenantId,
      platform: session.platform,
      role: session.role,
      bootstrapTokenHash: session.bootstrapTokenHash,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      enrollmentToken: session.enrollmentToken,
      agentKey: session.agentKey,
      controlPlaneUrl: session.controlPlaneUrl,
      zone: session.zone,
      startAfterInstall: session.startAfterInstall,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      usedAt: session.usedAt,
      usedByIp: session.usedByIp,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
    });
    this.recordAgentInstallTask(tenantId, session.id, session.platform, requestedBy);
    const token = encodeURIComponent(session.bootstrapToken);
    const bootstrapUrl = `${baseUrl}/agent-install.ps1?token=${token}`;
    return {
      sessionId: session.id,
      platform: session.platform,
      role: session.role,
      expiresAt: session.expiresAt,
      bootstrapUrl,
      installCommand: `(New-Object Net.WebClient).DownloadString('${bootstrapUrl}') | Invoke-Expression`,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      enrollmentToken: session.enrollmentToken,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      zone: session.zone,
      enrollmentTokenPreview: `${session.enrollmentToken.slice(0, 12)}...${session.enrollmentToken.slice(-6)}`,
    };
  }

  async createLinuxGoInstallSession(tenantId: string, input: CreateLinuxGoInstallSessionInput, requestId: string, baseUrl: string, requestedBy?: string): Promise<AgentInstallSessionBootstrapProjection> {
    const session = this.domain.createLinuxGoInstallSession(tenantId, input, requestId, baseUrl);
    await this.repository.createEnrollmentToken(session.enrollmentTokenRecord);
    await this.repository.createInstallSession({
      id: session.id,
      tenantId: session.tenantId,
      platform: session.platform,
      role: session.role,
      bootstrapTokenHash: session.bootstrapTokenHash,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      enrollmentToken: session.enrollmentToken,
      agentKey: session.agentKey,
      controlPlaneUrl: session.controlPlaneUrl,
      zone: session.zone,
      startAfterInstall: session.startAfterInstall,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      usedAt: session.usedAt,
      usedByIp: session.usedByIp,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
    });
    this.recordAgentInstallTask(tenantId, session.id, session.platform, requestedBy);
    const token = encodeURIComponent((session as AgentInstallSession & { bootstrapToken: string }).bootstrapToken);
    const bootstrapUrl = `${baseUrl}/agent-install?token=${token}`;
    const bundleUrl = `${baseUrl}/api/v1/agents/install/linux/bundle.tar.gz`;
    return {
      sessionId: session.id,
      platform: 'linux_go_systemd',
      role: session.role,
      expiresAt: session.expiresAt,
      bootstrapUrl,
      bundleUrl,
      installCommand: `curl -fsSL ${baseUrl}/agent-install?token=${token} | sudo bash`,
      bootstrapTokenPreview: session.bootstrapTokenPreview,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      zone: session.zone,
      enrollmentTokenPreview: `${session.enrollmentToken.slice(0, 12)}...${session.enrollmentToken.slice(-6)}`,
    };
  }

  async createGatewayEnableSession(tenantId: string, input: CreateGatewayEnableSessionInput, _requestId: string, baseUrl: string): Promise<GatewayEnableSessionProjection> {
    if (input.agentId) {
      await this.requireAgent(tenantId, input.agentId);
    }
    const platform = input.platform;
    const profile = gatewayEnablePlatformProfiles[platform];
    if (!profile) {
      throw new AppError('VALIDATION_FAILED', 'platform 只能是 windows_powershell_service 或 linux_go_systemd', { platform });
    }
    const zone = normalizeCommandValue(input.zone ?? 'default', 'zone');
    const serviceName = normalizeCommandValue(input.serviceName ?? profile.serviceName, 'serviceName');
    const configPath = input.configPath?.trim() || profile.configPath;
    const query = new URLSearchParams({
      zone,
      serviceName,
      configPath,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    const enableUrl = `${baseUrl}${profile.pathSuffix}?${query.toString()}`;
    return {
      platform,
      agentId: input.agentId,
      zone,
      serviceName,
      configPath,
      enableUrl,
      enableCommand: profile.command(enableUrl),
    };
  }

  async getWindowsPowerShellInstallSessionByToken(tenantId: string, bootstrapToken: string): Promise<AgentInstallSession> {
    const session = await this.repository.findInstallSessionByTokenHash(tenantId, sha256(bootstrapToken));
    if (!session) throw new AppError('RESOURCE_NOT_FOUND', '安装会话不存在');
    if (new Date(session.expiresAt).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', '安装会话已过期');
    if (session.usedAt) throw new AppError('AUTH_FORBIDDEN', '安装会话已被使用');
    return session;
  }

  async getInstallSessionByToken(bootstrapToken: string): Promise<AgentInstallSession> {
    const session = await this.repository.findInstallSessionByTokenHashAnyTenant(sha256(bootstrapToken));
    if (!session) throw new AppError('RESOURCE_NOT_FOUND', '安装会话不存在');
    if (new Date(session.expiresAt).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', '安装会话已过期');
    return session;
  }

  async consumeWindowsPowerShellInstallSessionByToken(tenantId: string, bootstrapToken: string, usedByIp?: string): Promise<AgentInstallSession> {
    return this.consumeInstallSession(sha256(bootstrapToken), usedByIp, tenantId);
  }

  async consumeInstallSessionByToken(bootstrapToken: string, usedByIp?: string): Promise<AgentInstallSession> {
    return this.consumeInstallSession(sha256(bootstrapToken), usedByIp);
  }

  async buildWindowsPowerShellInstallManifest(session: AgentInstallSession) {
    const builder = windowsInstallManifestBuilders[session.platform];
    if (!builder) throw new AppError('RESOURCE_NOT_FOUND', '未登记对应的 Windows Agent 安装器', { platform: session.platform });
    return builder(session);
  }

  buildLinuxGoInstallManifest(session: AgentInstallSession) {
    return {
      sessionId: session.id,
      platform: session.platform,
      role: session.role ?? 'full_agent',
      gatewayEnabled: session.role === 'gateway',
      directControlListenPort: installDirectControlListenPort(session),
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
      startAfterInstall: session.startAfterInstall,
      controlPlaneUrl: session.controlPlaneUrl,
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      enrollmentToken: session.enrollmentToken,
      zone: session.zone,
      bundleUrl: `${session.controlPlaneUrl}/api/v1/agents/install/linux/bundle.tar.gz`,
      bundleManifest: getLinuxAgentBundleManifest(),
    };
  }

  buildLinuxBundleTarGz(): Buffer {
    return buildLinuxAgentBundleTarGz();
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query).then(async (page) => {
      const items = this.deduplicateRegistrations(page.items);
      const projected = await Promise.all(items.map(async (agent) => ({
        ...agent,
        ...(this.liveness ? await this.liveness.project(tenantId, 'AGENT', agent.id, ['HEARTBEAT', 'MANAGEMENT_TCP']) : {}),
      })));
      return { ...page, items: projected, total: projected.length };
    });
  }

  async evaluateOfflineAgents(options: {
    offlineTimeoutSeconds?: number;
    requiredConsecutiveTimeouts?: number;
    now?: Date;
  } = {}) {
    const offlineTimeoutSeconds = options.offlineTimeoutSeconds && options.offlineTimeoutSeconds > 0
      ? options.offlineTimeoutSeconds
      : 180;
    const requiredConsecutiveTimeouts = options.requiredConsecutiveTimeouts && options.requiredConsecutiveTimeouts > 0
      ? Math.ceil(options.requiredConsecutiveTimeouts)
      : 2;
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const registrations = await this.repository.listAllRegistrations();
    let transitioned = 0;

    for (const agent of registrations) {
      const timeoutKey = `${agent.tenantId}:${agent.id}`;
      if (agent.status === 'DISABLED' || agent.revokedAt || agent.certificateRevoked) {
        this.offlineTimeoutCounts.delete(timeoutKey);
        continue;
      }
      const latestHeartbeat = await this.repository.getLatestHeartbeat(agent.tenantId, agent.id);
      const referenceAt = latestHeartbeat?.receivedAt ?? agent.updatedAt ?? agent.registeredAt;
      const referenceTime = Date.parse(referenceAt);
      if (Number.isNaN(referenceTime)) continue;
      const stale = now.getTime()- referenceTime > offlineTimeoutSeconds * 1000;
      if (!stale) {
        this.offlineTimeoutCounts.delete(timeoutKey);
        continue;
      }
      if (!this.liveness) {
        if (agent.status === 'OFFLINE') {
          this.offlineTimeoutCounts.delete(timeoutKey);
          continue;
        }
        const timeoutCount = (this.offlineTimeoutCounts.get(timeoutKey) ?? 0) + 1;
        this.offlineTimeoutCounts.set(timeoutKey, timeoutCount);
        if (timeoutCount < requiredConsecutiveTimeouts) continue;
      }
      await this.liveness?.recordHeartbeatTimeout({
        tenantId: agent.tenantId,
        agentId: agent.id,
        observedAt: nowIso,
        reasonDetail: `lastHeartbeatAt=${referenceAt};offlineTimeoutSeconds=${offlineTimeoutSeconds}`,
      });
      const liveness = this.liveness
        ? await this.liveness.project(agent.tenantId, 'AGENT', agent.id, ['HEARTBEAT', 'MANAGEMENT_TCP'])
        : undefined;
      if (liveness && liveness.livenessStatus !== 'OFFLINE') continue;
      if (!liveness && requiredConsecutiveTimeouts > 1) continue;
      if (agent.status === 'OFFLINE') continue;

      const updated = await this.repository.updateRegistration(agent.id, {
        status: 'OFFLINE',
        gateway: agent.gateway ? { ...agent.gateway, status: 'offline', lastHeartbeatAt: latestHeartbeat?.receivedAt ?? agent.gateway.lastHeartbeatAt } : agent.gateway,
        updatedAt: nowIso,
        lastRequestId: `offline_evaluator:${now.getTime()}`,
      });
      transitioned += 1;
      this.offlineTimeoutCounts.delete(timeoutKey);
      this.syncGatewayRegistryInBackground(agent.tenantId, updated);
    }

    return {
      evaluated: registrations.length,
      transitioned,
      offlineTimeoutSeconds,
      requiredConsecutiveTimeouts,
      evaluatedAt: nowIso,
    };
  }

  async getAgentDetail(tenantId: string, agentId: string): Promise<AgentDetailProjection> {
    const agent = await this.requireAgent(tenantId, agentId);
    const capabilitySnapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agent.id);
    const latestHeartbeat = await this.repository.getLatestHeartbeat(tenantId, agent.id);
    const capabilities = await this.getCapabilityProjection(tenantId, agent.id);
    const taskQueue = await this.listTaskQueue(tenantId, agent.id);
    const upgradeSuggestion = await this.getUpgradeSuggestion(tenantId, agent.id);
    const recentErrors = await this.repository.listAgentTaskLogs(tenantId, agent.id, ['error']);
    const runtimeLogs = await this.repository.listAgentRuntimeLogs(tenantId, agent.id);
    const recentTaskLogs = await this.listRecentTaskRuntimeLogs(tenantId, agent.id);
    const liveness = this.liveness
      ? await this.liveness.project(tenantId, 'AGENT', agent.id, ['HEARTBEAT', 'MANAGEMENT_TCP'])
      : undefined;
    const health = this.toHealthProjection(agent, latestHeartbeat);
    if (liveness?.livenessStatus === 'OFFLINE') {
      health.status = 'failed';
      health.offline = true;
      health.offlineEvidence = [...health.offlineEvidence, `livenessReasonCode=${liveness.livenessReasonCode ?? 'unknown'}`];
    }
    return {
      agent,
      ...liveness,
      lifecycle: this.toLifecycle(agent),
      latestHeartbeat,
      health,
      capabilitySnapshot,
      capabilities,
      taskQueue,
      upgradeSuggestion,
      recentErrors: recentErrors.slice(0, 10),
      runtimeLogs: runtimeLogs.slice(0, 50),
      recentTaskLogs,
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

  async getInstallSession(tenantId: string, sessionId: string): Promise<AgentInstallSession | undefined> {
    return this.repository.getInstallSession(tenantId, sessionId);
  }

  private recordAgentInstallTask(tenantId: string, sessionId: string, platform: string, requestedBy?: string): void {
    enqueueTaskBestEffort(this.tasks, {
      tenantId,
      taskType: 'AGENT_INSTALL',
      requestedBy,
      triggerSource: 'agents.install-session',
      idempotencyKey: `agent-install:${sessionId}`,
      payload: { sessionId, platform },
      resourceRefs: [{ resourceType: 'agentInstallSession', resourceId: sessionId }],
    });
  }

  private async requireTask(tenantId: string, agentId: string, taskId: string) {
    const task = await this.repository.getTask(tenantId, taskId);
    if (!task || task.agentId !== agentId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return task;
  }

  private async resolveExistingRegistration(tenantId: string, agentKey: string, machineId?: string) {
    const byAgentKey = await this.repository.findByAgentKey(tenantId, agentKey);
    if (byAgentKey) return byAgentKey;
    if (!machineId) return undefined;
    return this.repository.findByMachineId(tenantId, machineId);
  }

  private deduplicateRegistrations(items: AgentRegistration[]): AgentRegistration[] {
    const winners = new Map<string, AgentRegistration>();
    for (const item of items) {
      const dedupeKey = item.descriptor.machineId?.trim() || item.agentKey;
      const current = winners.get(dedupeKey);
      if (!current || item.updatedAt.localeCompare(current.updatedAt) > 0) {
        winners.set(dedupeKey, item);
      }
    }
    return [...winners.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async consumeInstallSession(tokenHash: string, usedByIp?: string, tenantId?: string): Promise<AgentInstallSession> {
    const usedAt = new Date().toISOString();
    const consumed = await this.repository.consumeInstallSessionByTokenHash(tokenHash, usedAt, usedByIp, tenantId);
    if (consumed) return consumed;

    const existing = tenantId
      ? await this.repository.findInstallSessionByTokenHash(tenantId, tokenHash)
      : await this.repository.findInstallSessionByTokenHashAnyTenant(tokenHash);
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND', '安装会话不存在');
    if (new Date(existing.expiresAt).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', '安装会话已过期');
    if (existing.usedAt) throw new AppError('AUTH_FORBIDDEN', '安装会话已被使用');
    throw new AppError('RESOURCE_VERSION_CONFLICT', '安装会话消费冲突');
  }

  private async syncGatewayRegistry(tenantId: string, agent: AgentRegistration): Promise<void> {
    if (!this.gateways || !agent.gateway) return;
    const gateway = await this.gateways.findGatewayByAgentId(tenantId, agent.id);
    if (agent.gateway.zoneIds.length === 0) return;
    if (gateway) {
      const patch: Parameters<typeof this.gateways.updateGatewayStatus>[2] = {
        agentId: agent.id,
        version: agent.descriptor.version,
        zoneIds: agent.gateway.zoneIds,
        adapters: agent.gateway.adapters,
        capabilities: agent.gateway.capabilities,
        currentLoad: agent.gateway.currentLoad,
        maxConcurrentTasks: agent.gateway.maxConcurrentTasks,
        successRate: agent.gateway.successRate,
        status: agent.gateway.status,
        lastHeartbeatAt: agent.gateway.lastHeartbeatAt,
      };
      if (agent.gateway.capabilitySetId) {
        patch.capabilitySetId = agent.gateway.capabilitySetId;
      }
      await this.gateways.updateGatewayStatus(tenantId, gateway.id, patch);
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

  private syncGatewayRegistryInBackground(tenantId: string, agent: AgentRegistration): void {
    void this.syncGatewayRegistry(tenantId, agent).catch((cause: unknown) => {
      structuredLogger.error('GatewayRegistry 后台同步失败', {
        tenantId,
        agentId: agent.id,
        error: cause instanceof Error ? cause.message : String(cause),
      }, { module: 'agents', resourceType: 'agent', resourceId: agent.id });
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

  private toHealthProjection(agent: AgentRegistration, latestHeartbeat?: AgentHeartbeat): AgentHealthProjection {
    const offlineTimeoutSeconds = this.getOfflineTimeoutSeconds();
    const runtimeHealth = latestHeartbeat?.runtimeHealth;
    const lastHeartbeatAt = latestHeartbeat?.receivedAt ?? agent.gateway?.lastHeartbeatAt;
    const heartbeatAgeSeconds = safeAgeSeconds(lastHeartbeatAt);
    const offline = agent.status === 'OFFLINE'
      || isObservationStale(lastHeartbeatAt, offlineTimeoutSeconds);
    const degradedReasons = dedupeStrings(runtimeHealth?.degradedReasons ?? []);
    const failureCounts = {
      heartbeat: runtimeHealth?.failureCounts?.heartbeat ?? 0,
      taskPoll: runtimeHealth?.failureCounts?.taskPoll ?? 0,
      recovery: runtimeHealth?.failureCounts?.recovery ?? 0,
    };
    const offlineEvidence = [
      offline ? 'agent.status=OFFLINE' : '',
      lastHeartbeatAt ? `lastHeartbeatAt=${lastHeartbeatAt}` : 'lastHeartbeatAt=missing',
      heartbeatAgeSeconds !== undefined ? `heartbeatAgeSeconds=${heartbeatAgeSeconds}` : '',
      `offlineTimeoutSeconds=${offlineTimeoutSeconds}`,
    ].filter(Boolean);

    return {
      status: offline ? 'failed' : runtimeHealth?.status ?? (degradedReasons.length > 0 ? 'degraded' : 'unknown'),
      offline,
      offlineTimeoutSeconds,
      lastHeartbeatAt,
      heartbeatAgeSeconds,
      lastRecoveryAt: runtimeHealth?.lastRecoveryAt,
      lastTaskPollAt: runtimeHealth?.lastTaskPollAt,
      lastTaskResultAt: runtimeHealth?.lastTaskResultAt,
      lastSelfCheckAt: runtimeHealth?.lastSelfCheckAt,
      pendingResultCount: runtimeHealth?.pendingResultCount ?? 0,
      recoverableTaskCount: runtimeHealth?.recoverableTaskCount ?? 0,
      lastError: runtimeHealth?.lastError,
      degradedReasons,
      offlineEvidence,
      failureCounts,
      directControl: latestHeartbeat?.directControl ?? agent.directControl ?? runtimeHealth?.directControl,
      runtimeHealth,
    };
  }

  private getOfflineTimeoutSeconds(): number {
    return readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 180);
  }

  private async assertLivenessAllowsExecution(tenantId: string, agentId: string): Promise<void> {
    if (!this.liveness) return;
    const projection = await this.liveness.project(tenantId, 'AGENT', agentId, ['HEARTBEAT', 'MANAGEMENT_TCP']);
    if (projection.signals.length === 0) return;
    if (projection.livenessStatus === 'ONLINE') return;
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', projection.livenessStatus === 'OFFLINE' ? 'Agent 已离线，不能下发任务' : 'Agent 存活状态尚未确认，不能下发任务', {
      agentId,
      livenessStatus: projection.livenessStatus,
      reasonCode: projection.livenessReasonCode,
    });
  }

  private async findActiveCapabilityRescanTask(tenantId: string, agentId: string): Promise<AgentTaskEnvelope | undefined> {
    const tasks = await this.repository.listTasks(tenantId, agentId, ['queued', 'leased', 'acked']);
    return tasks.find((task) => task.payload?.type === 'agent.capability.rescan');
  }

  private async listRecentTaskRuntimeLogs(tenantId: string, agentId: string): Promise<AgentDetailProjection['recentTaskLogs']> {
    const tasks = await this.repository.listTasks(tenantId, agentId);
    const taskById = new Map(tasks.map((task) => [task.id, task] as const));
    const allLogs = await this.repository.listAgentTaskLogs(tenantId, agentId);

    return allLogs
      .map((log) => {
        const task = taskById.get(log.taskId);
        if (!task) return null;
        const payload = task.payload ?? {};
        const bindingSelector = readRecord(payload.bindingSelector);
        return {
          id: log.id,
          taskId: log.taskId,
          executionStepId: task.executionStepId,
          emittedAt: log.emittedAt,
          level: log.level,
          message: log.message,
          taskType: readStringValue(payload.type) ?? 'unknown.task',
          siteName: readStringValue(payload.siteName),
          bindingInformation: readStringValue(bindingSelector.bindingInformation) ?? readStringValue(payload.bindingInformation),
          dryRun: payload.dryRun === true,
          executionMode: task.leaseId?.startsWith('direct:') ? 'direct' as const : 'queued' as const,
          directFallback: readDirectFallback(payload.dispatchDetail),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 50);
  }
}

function countTasks(tasks: AgentTaskEnvelope[]): Record<AgentTaskEnvelope['status'], number> {
  return tasks.reduce<Record<AgentTaskEnvelope['status'], number>>((counts, task) => {
    counts[task.status] += 1;
    return counts;
  }, { queued: 0, leased: 0, acked: 0, succeeded: 0, failed: 0, rejected: 0 });
}

function safeAgeSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const AGENT_MACHINE_ROUTES = new Set([
  'POST /api/v1/agents/register',
  'POST /api/v1/agents/sessions',
  'POST /api/v1/agents/certificate-requests',
  'POST /api/v1/agents/certificates/rotate',
  'POST /api/v1/agents/heartbeat',
  'POST /api/v1/agents/capabilities',
  'GET /api/v1/agents/tasks/pull',
  'POST /api/v1/agents/tasks/ack',
  'POST /api/v1/agents/tasks/logs',
  'POST /api/v1/agents/runtime-logs',
  'POST /api/v1/agents/tasks/log-batches',
  'POST /api/v1/agents/tasks/result',
  'POST /api/v1/agents/upgrades/check',
  'POST /api/v1/agents/upgrades/result',
  'POST /api/v1/gateways/probe',
  'POST /api/v1/gateways/status',
]);

function isAgentMachineRoute(method: string, path: string): boolean {
  return AGENT_MACHINE_ROUTES.has(`${method.toUpperCase()} ${path}`);
}

export function resolveAgentTaskActionType(payload: Record<string, unknown> | undefined): string | undefined {
  return readStringValue(payload?.actionType) ?? readStringValue(payload?.type);
}

function readDirectFallback(value: unknown): AgentDetailProjection['recentTaskLogs'][number]['directFallback'] | undefined {
  const record = readRecord(value);
  const fallback = readRecord(record.directFallback);
  if (!fallback || fallback.attempted !== true) return undefined;
  return {
    attempted: true,
    errorCode: readStringValue(fallback.errorCode),
    errorMessage: readStringValue(fallback.errorMessage),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const gatewayEnablePlatformProfiles: Partial<Record<CreateGatewayEnableSessionInput['platform'], {
  serviceName: string;
  configPath: string;
  pathSuffix: string;
  command: (url: string) => string;
}>> = {
  windows_powershell_service: {
    serviceName: 'gcac-agent',
    configPath: 'C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json',
    pathSuffix: '/agent-enable-gateway.ps1',
    command: (url) => `irm '${url}' | iex`,
  },
  linux_go_systemd: {
    serviceName: 'gcac-linux-agent',
    configPath: '/etc/gcac/linux-agent/agent.config.json',
    pathSuffix: '/agent-enable-gateway',
    command: (url) => `curl -fsSL '${url}' | sudo bash`,
  },
};

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const windowsGoAgentRoot = resolveWindowsGoAgentRoot();
const ignoredWindowsGoAgentPaths = new Set([
  'README.md',
]);

async function loadWindowsGoAgentArtifacts() {
  const artifacts = await walkWindowsGoAgentArtifacts(windowsGoAgentRoot);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

type WindowsInstallManifestBuilder = (session: AgentInstallSession) => Promise<Record<string, unknown>>;

const windowsInstallManifestBuilders: Partial<Record<AgentInstallSession['platform'], WindowsInstallManifestBuilder>> = {
  windows_powershell_service: buildWindowsModernInstallManifest,
  windows_compatibility_service: buildWindowsCompatibilityInstallManifest,
};

async function buildWindowsModernInstallManifest(session: AgentInstallSession): Promise<Record<string, unknown>> {
  return {
    sessionId: session.id,
    platform: session.platform,
    role: session.role ?? 'full_agent',
    gatewayEnabled: session.role === 'gateway',
    directControlListenPort: installDirectControlListenPort(session),
    tenantId: session.tenantId,
    serviceName: session.serviceName,
    displayName: session.displayName,
    installRoot: session.installRoot,
    configDir: session.configDir,
    dataDir: session.dataDir,
    logDir: session.logDir,
    startAfterInstall: session.startAfterInstall,
    controlPlaneUrl: session.controlPlaneUrl,
    agentKey: session.agentKey,
    enrollmentToken: session.enrollmentToken,
    zone: session.zone,
    artifacts: await loadWindowsGoAgentArtifacts(),
  };
}

async function buildWindowsCompatibilityInstallManifest(session: AgentInstallSession): Promise<Record<string, unknown>> {
  return {
    sessionId: session.id,
    platform: session.platform,
    tenantId: session.tenantId,
    serviceName: session.serviceName,
    displayName: session.displayName,
    installRoot: session.installRoot,
    configDir: session.configDir,
    dataDir: session.dataDir,
    logDir: session.logDir,
    startAfterInstall: session.startAfterInstall,
    controlPlaneUrl: session.controlPlaneUrl,
    agentKey: session.agentKey,
    enrollmentToken: session.enrollmentToken,
    zone: session.zone,
    binaryRelativePath: 'bin/Release/GCAC.WindowsCompatibilityAgent.exe',
    targetBinaryName: 'GCAC.WindowsCompatibilityAgent.exe',
    configRelativePath: 'config/agent.config.template.json',
    installScriptRelativePath: 'install-service.ps1',
    artifacts: await loadWindowsCompatibilityAgentArtifacts(),
    config: {
      schemaVersion: 'gcac.windows-compat-agent-config/v1',
      tenantId: session.tenantId,
      agentKey: session.agentKey,
      enrollmentToken: session.enrollmentToken,
      controlPlaneUrl: session.controlPlaneUrl,
      heartbeatIntervalSeconds: 10,
      taskPollIntervalSeconds: 5,
      directControlEnabled: true,
      directControlListenHost: '0.0.0.0',
      directControlListenPort: 18933,
      directControlAdvertiseHost: '',
      requiredHotfixes: [],
      dataDirectory: session.dataDir,
      logDirectory: session.logDir,
    },
  };
}

const installDirectControlPorts: Readonly<Record<string, number>> = Object.freeze({
  'full_agent:windows_powershell_service': 18930,
  'full_agent:linux_go_systemd': 18931,
  'gateway:windows_powershell_service': 18932,
  'gateway:linux_go_systemd': 18932,
  'gateway:windows_compatibility_service': 18932,
  'full_agent:windows_compatibility_service': 18933,
});

function installDirectControlListenPort(session: AgentInstallSession): number {
  const key = `${session.role}:${session.platform}`;
  const port = installDirectControlPorts[key];
  if (port === undefined) throw new AppError('VALIDATION_FAILED', 'Agent 安装目标缺少直连端口声明', { role: session.role, platform: session.platform });
  return port;
}

async function loadWindowsCompatibilityAgentArtifacts(): Promise<Array<{ path: string; description: string; content: string; encoding: 'utf8' | 'base64' }>> {
  const agentRoot = resolveWindowsCompatibilityAgentRoot();
  const artifactPaths = [
    { source: resolveWindowsCompatibilityBinaryPath(agentRoot), target: 'bin/Release/GCAC.WindowsCompatibilityAgent.exe', encoding: 'base64' as const },
    { source: `${resolveWindowsCompatibilityBinaryPath(agentRoot)}.config`, target: 'bin/Release/GCAC.WindowsCompatibilityAgent.exe.config', encoding: 'utf8' as const },
    { source: path.join(agentRoot, 'install-service.ps1'), target: 'install-service.ps1', encoding: 'utf8' as const },
    { source: path.join(agentRoot, 'uninstall-service.ps1'), target: 'uninstall-service.ps1', encoding: 'utf8' as const },
    { source: path.join(agentRoot, 'upgrade-service.ps1'), target: 'upgrade-service.ps1', encoding: 'utf8' as const },
    { source: path.join(agentRoot, 'config', 'agent.config.template.json'), target: 'config/agent.config.template.json', encoding: 'utf8' as const },
  ];
  for (const artifact of artifactPaths) {
    if (!existsSync(artifact.source)) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Windows Compatibility Agent 安装产物不存在，请先执行 build.ps1', { path: artifact.source });
    }
  }
  return Promise.all(artifactPaths.map(async (artifact) => ({
    path: artifact.target,
    description: `Windows Compatibility Agent 安装文件: ${artifact.target}`,
    content: artifact.encoding === 'base64'
      ? (await readFile(artifact.source)).toString('base64')
      : stripUtf8Bom(await readFile(artifact.source, 'utf8')),
    encoding: artifact.encoding,
  })));
}

async function walkWindowsGoAgentArtifacts(currentDir: string, relativeDir = ''): Promise<Array<{ path: string; description: string; content: string; encoding?: 'utf8' | 'base64' }>> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const artifacts: Array<{ path: string; description: string; content: string; encoding?: 'utf8' | 'base64' }> = [];
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (relativePath === 'tmp' || relativePath.startsWith('tmp/')) continue;
    if (ignoredWindowsGoAgentPaths.has(relativePath)) continue;
    if ([...ignoredWindowsGoAgentPaths].some((ignoredPath) => relativePath.startsWith(`${ignoredPath}/`))) continue;
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...await walkWindowsGoAgentArtifacts(absolutePath, relativePath));
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    const isBinaryArtifact = extension === '.exe' || extension === '.dll' || extension === '.pfx';
    artifacts.push({
      path: relativePath.replace(/\\/gu, '/'),
      description: `Windows Go Agent 兼容入口文件: ${relativePath}`,
      content: isBinaryArtifact ? (await readFile(absolutePath)).toString('base64') : stripUtf8Bom(await readFile(absolutePath, 'utf8')),
      encoding: isBinaryArtifact ? 'base64' : 'utf8',
    });
  }
  return artifacts;
}

function stripUtf8Bom(value: string): string {
  return value.replace(/^\uFEFF/u, '');
}

function normalizeCommandValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  if (/[\r\n\0]/u.test(normalized)) throw new AppError('VALIDATION_FAILED', `${field} 不能包含换行或空字符`, { field });
  return normalized;
}

function resolveWindowsGoAgentRoot(): string {
  const bundleRoot = process.env.GCAC_AGENT_RELEASE_BUNDLE_ROOT?.trim();
  if (bundleRoot) return path.resolve(bundleRoot, 'windows', releaseArchitecture(), 'full-agent');
  const backendMarker = `${path.sep}backend${path.sep}`;
  const backendMarkerIndex = currentDirPath.lastIndexOf(backendMarker);
  if (backendMarkerIndex >= 0) {
    const repositoryRoot = currentDirPath.slice(0, backendMarkerIndex);
    const candidate = path.join(repositoryRoot, 'agents', 'windows-go-full-agent');
    if (existsSync(candidate)) return candidate;
  }

  const relativeAgentPath = path.join('agents', 'windows-go-full-agent');
  const searchRoots = [currentDirPath, process.cwd()];
  for (const searchRoot of searchRoots) {
    let cursor = searchRoot;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.resolve(cursor, relativeAgentPath);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return path.resolve(process.cwd(), relativeAgentPath);
}

function resolveWindowsCompatibilityAgentRoot(): string {
  const configuredRoot = process.env.GCAC_WINDOWS_COMPAT_AGENT_ROOT?.trim();
  if (configuredRoot) return path.resolve(configuredRoot);
  return resolveAgentProductRoot('windows-compat-full-agent');
}

function resolveWindowsCompatibilityBinaryPath(agentRoot: string): string {
  const configuredBinary = process.env.GCAC_WINDOWS_COMPAT_AGENT_BINARY?.trim();
  return configuredBinary ? path.resolve(configuredBinary) : path.join(agentRoot, 'bin', 'Release', 'GCAC.WindowsCompatibilityAgent.exe');
}

function resolveAgentProductRoot(productDirectory: string): string {
  const bundleRoot = process.env.GCAC_AGENT_RELEASE_BUNDLE_ROOT?.trim();
  if (bundleRoot) {
    const bundleDirectory = productDirectory === 'windows-compat-full-agent' ? 'compatibility' : 'full-agent';
    return path.resolve(bundleRoot, 'windows', releaseArchitecture(), bundleDirectory);
  }
  const backendMarker = `${path.sep}backend${path.sep}`;
  const backendMarkerIndex = currentDirPath.lastIndexOf(backendMarker);
  if (backendMarkerIndex >= 0) {
    const candidate = path.join(currentDirPath.slice(0, backendMarkerIndex), 'agents', productDirectory);
    if (existsSync(candidate)) return candidate;
  }
  const relativeAgentPath = path.join('agents', productDirectory);
  for (const searchRoot of [currentDirPath, process.cwd()]) {
    let cursor = searchRoot;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.resolve(cursor, relativeAgentPath);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return path.resolve(process.cwd(), relativeAgentPath);
}

function releaseArchitecture(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  throw new AppError('VALIDATION_FAILED', '当前 Node 运行架构没有 Agent Release Bundle 映射', { nodeArch: process.arch });
}

function resolveDirectControlHost(listenAddress?: string): string | undefined {
  const value = listenAddress?.trim();
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname || undefined;
  } catch {
    return undefined;
  }
}
