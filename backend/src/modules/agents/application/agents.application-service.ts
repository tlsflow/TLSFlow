import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { isObservationStale, readPositiveSeconds } from '../../../shared/observation-freshness.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentCertificateIssueResult, AgentCertificateRotateResult, AgentDetailProjection, AgentHealthProjection, AgentHeartbeatInput, AgentInstallSessionBootstrapProjection, AgentTaskLogAckResult, AgentTaskQueueProjection, AgentUpgradeSuggestionProjection, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentInstallSessionInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DeleteAgentInput, DisableAgentInput, EnableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentRuntimeLogInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentHeartbeat, AgentInstallSession, AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';
import { PgAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';
import {
  agentV2ContractTypes,
  validateAgentCapabilityToken,
  validateAgentExecutionReceipt,
  validateAgentPlan,
  validatePolicyAuthorityDecision,
  type AgentExecutionReceiptV1,
  type AgentSecurityStatus,
  type AgentV2ContractType,
} from '../security/agent-security.contract.js';
import { AGENT_RELEASE_SIGNING_KEY_ID, buildLinuxAgentBundleTarGz, getLinuxAgentBundleManifest, getLinuxAgentInstallMaterials, LINUX_AGENT_RELEASE_VERSION, type LinuxAgentArtifactReference } from './linux-agent-bundle.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { ExecutionResultSyncService } from '../../executions/application/execution-result-sync.service.js';
import type { ExecutionDetailStreamService } from '../../executions/application/execution-detail-stream.service.js';
import type { LivenessApplicationService } from '../../liveness/application/liveness.application-service.js';
import type { AgentCapabilityDiscoveryProjector } from '../discovery/agent-capability-discovery.projector.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { GatewayTaskResultSink } from '../../gateway-agents/gateway-agent.types.js';
import { parsePluginFactBinding } from '../../plugins/application/plugin-fact-pipeline.service.js';
import type { PluginFactBindingV1, PluginFactPipelineResult, PluginFactPipelineService } from '../../plugins/application/plugin-fact-pipeline.service.js';
import type { AgentDiscoveryRequestFactory } from './agent-discovery-task-factory.js';
import { AgentDirectClient } from './agent-direct-client.js';

export interface AgentTrustMaterialIssuer {
  issue(input: { tenantId: string; agentId: string; osType?: string }): Promise<unknown>;
  getTrustedKeySet(): Record<string, string>;
}

export type AgentInstallMaterialPlatform = 'windows_go' | 'windows_compatibility' | 'linux_go';

export interface AgentInstallMaterialRequest {
  platform: AgentInstallMaterialPlatform;
  role?: 'full_agent' | 'gateway';
  zone?: string;
  agentKey?: string;
}

interface AgentInstallDescriptor {
  id: string;
  role: 'full_agent' | 'gateway';
  zone: string;
  authorizationTrustKeySet?: Record<string, string>;
  agentKey: string;
  expiresAt: string;
  enrollmentTokenRecord: EnrollmentToken & { token: string };
  serviceName: string;
  displayName: string;
  installRoot: string;
  configDir: string;
  dataDir: string;
  logDir: string;
}

export interface AgentInstallMaterialProjection {
  installationId: string;
  expiresAt: string;
  enrollmentToken: string;
  materials: AgentInstallArtifactMaterial[];
  task: AgentInstallTaskProjection;
}

export interface AgentInstallArtifactMaterial {
  platform: AgentInstallMaterialPlatform;
  arch: 'amd64' | 'arm64';
  artifactRef: string;
  version: string;
  digest: string;
  signature: string;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
}

export interface AgentInstallTaskProjection {
  type: 'agent.plan.execute';
  contractVersion: 'gcac.agent-security/v1';
  taskId: string;
  version: string;
  artifactRefs: string[];
  expiresAt: string;
  digest: string;
  signature: string;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
  input: {
    role: 'full_agent' | 'gateway';
    zone: string;
    agentKey: string;
    serviceName: string;
    displayName: string;
    installRoot: string;
    configDir: string;
    dataDir: string;
    logDir: string;
  };
}

interface AgentInstallSessionManifest {
  sessionId: string;
  platform: AgentInstallSession['platform'];
  serviceName: string;
  displayName: string;
  installRoot: string;
  configDir: string;
  dataDir: string;
  logDir: string;
  role: 'full_agent' | 'gateway';
  startAfterInstall: boolean;
  controlPlaneUrl: string;
  agentKey: string;
  tenantId: string;
  enrollmentToken: string;
  zone: string;
  bundleUrl?: string;
  bundleManifest?: ReturnType<typeof getLinuxAgentBundleManifest>;
	artifacts?: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
	authorizationTrustKeySet?: Record<string, string>;
}

const PINNED_WINDOWS_ARTIFACTS: Readonly<Record<'windows_go' | 'windows_compatibility', AgentInstallArtifactMaterial>> = Object.freeze({
  windows_go: Object.freeze({
    platform: 'windows_go',
    arch: 'amd64',
    artifactRef: 'artifact://gcac/agents/windows-go-full-agent/0.1.9/windows-amd64/gcac-agent.exe',
    version: '0.1.9',
    digest: 'e6681b0aad44fc13fd268adac9692d2bd69d111c66fb7eb8609f629081ee4c7c',
    signature: 'artifact://gcac/signatures/agents/windows-go-full-agent/0.1.9/windows-amd64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
  windows_compatibility: Object.freeze({
    platform: 'windows_compatibility',
    arch: 'amd64',
    artifactRef: 'artifact://gcac/agents/windows-compat-full-agent/0.1.0/windows-amd64/GCAC.WindowsCompatibilityAgent.exe',
    version: '0.1.0',
    digest: '080d514a338462fcf0c9bbd4bafa015203d3eef7eaf3da090802f9a2fda92a47',
    signature: 'artifact://gcac/signatures/agents/windows-compat-full-agent/0.1.0/windows-amd64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
});

export class AgentsApplicationService {
  private readonly offlineTimeoutCounts = new Map<string, number>();
  private gatewayTaskResultSink?: GatewayTaskResultSink;
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
    private readonly pluginFactPipeline?: PluginFactPipelineService,
    private discoveryRequestFactory?: AgentDiscoveryRequestFactory,
    private trustMaterialIssuer?: AgentTrustMaterialIssuer,
    private readonly directAgentClient = new AgentDirectClient(),
  ) {}

  getModuleMetadata() {
    return createModuleMetadata('agents', '/api/v1/agents', '011');
  }

  setGatewayTaskResultSink(sink?: GatewayTaskResultSink): void {
    this.gatewayTaskResultSink = sink;
  }

  setDiscoveryRequestFactory(factory?: AgentDiscoveryRequestFactory): void {
    this.discoveryRequestFactory = factory;
  }

  setTrustMaterialIssuer(issuer?: AgentTrustMaterialIssuer): void {
    this.trustMaterialIssuer = issuer;
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
        enrollmentTokenId: enrollmentTokenId ?? existing.enrollmentTokenId,
        certificateFingerprint: input.certificateFingerprint ? normalizeFingerprint(input.certificateFingerprint) : existing.certificateFingerprint,
        certificateExpiresAt: input.certificateExpiresAt ?? existing.certificateExpiresAt,
        updatedAt: now,
        lastRequestId: requestId,
      });
      await this.syncGatewayRegistry(tenantId, updated);
      return this.withTrustMaterial(updated);
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
      status: 'OFFLINE',
      registeredAt: now,
      updatedAt: now,
      lastRequestId: requestId,
      version: 1,
    });
    await this.syncGatewayRegistry(tenantId, registered);
    return this.withTrustMaterial(registered);
  }

  async heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const gateway = this.domain.normalizeGatewayOnHeartbeat(agent, input, now);
    const updated = await this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: {
        ...agent.descriptor,
        version: input.version,
        managementEndpoint: input.managementEndpoint === undefined
          ? agent.descriptor.managementEndpoint
          : this.domain.normalizeManagementEndpoint(input.managementEndpoint),
      },
      gateway,
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

  async enqueueTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string, livenessMode: 'full' | 'management' = 'full'): Promise<AgentTaskEnvelope> {
    assertSupportedAgentTaskPayload(input.payload ?? {});
    await this.requireAgent(tenantId, input.agentId);
    if (livenessMode === 'management') await this.assertManagementEndpointReachable(tenantId, input.agentId);
    else await this.assertLivenessAllowsExecution(tenantId, input.agentId);
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

  async probeManagementEndpoint(tenantId: string, agentId: string, timeoutMs?: number) {
    await this.requireAgent(tenantId, agentId);
    if (!this.liveness) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Agent TCP 探测服务未配置');
    return this.liveness.probeAgentManagementEndpoint({ tenantId, agentId, timeoutMs });
  }

  async refreshStandardDiscovery(tenantId: string, agentId: string, requestedBy: string, requestId: string): Promise<{
    mode: 'direct';
    requestId: string;
    capabilitySnapshotId?: string;
    detail?: Record<string, unknown>;
  }> {
    if (!this.capabilityDiscoveryProjector) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'Agent 标准发现投影器未配置');
    }
    const agent = await this.requireAgent(tenantId, agentId);
    await this.assertManagementEndpointReachable(tenantId, agentId);
    if (!this.discoveryRequestFactory) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'Web 发现直连请求工厂未配置，拒绝退回异步任务路径');
    }
    const directRequest = await this.discoveryRequestFactory.createForAgent({ tenantId, agent, requestedBy, requestId });
    const response = await this.directAgentClient.refreshWebInventory(agent, directRequest);
    const snapshot = await this.repository.getLatestCapabilitySnapshot(tenantId, agentId);
    return {
      mode: 'direct',
      requestId: directRequest.requestId,
      capabilitySnapshotId: snapshot?.id,
      detail: response.detail,
    };
  }

  async pullTasks(tenantId: string, agentId: string, limit = 10): Promise<AgentTaskEnvelope[]> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (agent.status === 'DISABLED') return [];
    if (this.liveness) {
      // Agent 任务是主动向控制面轮询的出站链路，不能因为控制面到 Agent
      // 的入站管理 TCP 探测失败而形成死锁。重新发现等需要入站能力的操作
      // 仍在入队前单独执行 management-probe 硬校验。
      const projection = await this.liveness.project(tenantId, 'AGENT', agentId, ['HEARTBEAT']);
      if (projection.signals.length > 0 && projection.livenessStatus === 'OFFLINE') return [];
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
    const rawDetail = input.detail ?? {};
    const actionType = resolveAgentTaskActionType(task.payload)
      ?? resolveAgentTaskActionType(readOptionalRecord(task.payload.gatewayTask)?.payload as Record<string, unknown> | undefined);
    // Receipt 摘要覆盖 tokenId 等绑定标识，必须先按原始合同验证，再执行日志脱敏。
    const validatedReceipt = validateQueuedAgentV2Receipt(task, rawDetail, task.tenantId, input.status, input.success);
    if (['succeeded', 'failed'].includes(task.status)) {
      // 终态任务只接受同一份回执的幂等重传；迟到或替换回执必须显式拒绝，不能静默覆盖。
      if (validatedReceipt) {
        const existingReceipt = readReceipt(readRecord(task.result)?.detail);
        if (!existingReceipt || existingReceipt.digest !== validatedReceipt.digest) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', 'Agent v2 迟到 Receipt 与已落账结果不一致，拒绝接受', {
            reason: 'AGENT_V2_LATE_RECEIPT_REJECTED',
            taskId: task.id,
            taskStatus: task.status,
            existingReceiptDigest: existingReceipt?.digest,
            receiptDigest: validatedReceipt.digest,
          });
        }
      }
      if (readAgentTaskOutcome(task) === 'UNKNOWN' && input.success) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', 'Agent v2 UNKNOWN 任务拒绝迟到成功结果', {
          reason: 'AGENT_V2_LATE_SUCCESS_REJECTED',
          taskId: task.id,
        });
      }
      return task;
    }
    if (!['acked', 'leased'].includes(task.status)) {
      throw new AppError('VALIDATION_FAILED', '只有已 ack 的任务能提交结果', { taskId: task.id, status: task.status });
    }
    const sanitizedAgentDetail = this.domain.sanitizeResultDetail(rawDetail);
    const submittedOutcome = resolveAgentTaskOutcome(input, sanitizedAgentDetail);
    assertAgentTaskResultConsistency(input.success, submittedOutcome);
    const pluginFactBinding = resolvePluginFactBinding(task, actionType);
    const pluginFactResult = pluginFactBinding && input.success
      ? await this.executePluginFactPipeline(task, rawDetail, pluginFactBinding)
      : undefined;
    const success = input.success && (!pluginFactResult || pluginFactResult.status === 'SUCCESS');
    const outcome = pluginFactResult ? resolvePluginFactTaskOutcome(pluginFactResult) : submittedOutcome;
    const errorCode = input.errorCode ?? pluginFactResult?.error?.code;
    const errorMessage = input.errorMessage ?? pluginFactResult?.error?.message;
    const resultDetail = pluginFactResult
      ? { ...rawDetail, pluginFactPipeline: serializePluginFactPipelineResult(pluginFactResult) }
      : rawDetail;
    const sanitizedDetail = this.domain.sanitizeResultDetail(resultDetail);
    const gatewayTask = readOptionalRecord(task.payload.gatewayTask);
    const gatewayTaskPayload = readOptionalRecord(gatewayTask?.payload);
    const gatewayTaskAgentId = readStringValue(readOptionalRecord(gatewayTaskPayload?.token)?.agentId)
      ?? readStringValue(readOptionalRecord(gatewayTaskPayload?.policyDecision)?.agentId)
      ?? task.agentId;
    if (this.gatewayTaskResultSink && actionType && gatewayTask?.id) {
      await this.gatewayTaskResultSink.recordAgentTaskResult({
        gatewayTaskId: String(gatewayTask.id),
        agentTaskId: task.id,
        tenantId: task.tenantId,
        agentId: validatedReceipt?.agentId ?? gatewayTaskAgentId,
        leaseId: input.leaseId,
        actionType,
        success,
        executionStatus: outcome,
        errorCode,
        errorMessage,
        detail: sanitizedDetail,
        receipt: validatedReceipt,
      });
    }
    console.info('[agents.submitResult]', JSON.stringify({
      tenantId,
      agentId: task.agentId,
      taskId: task.id,
      leaseId: input.leaseId,
      success,
      errorCode,
      errorMessage,
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
      status: success ? 'succeeded' : 'failed',
      resultAt: new Date().toISOString(),
      result: {
        success,
        status: outcome,
        errorCode,
        errorMessage,
        detail: sanitizedDetail,
      },
    });
    if (this.executionResultSync) {
      console.info('[agents.submitResult.sync]', JSON.stringify({
        tenantId: task.tenantId,
        executionRunId: task.executionRunId,
        executionStepId: task.executionStepId,
        success,
        status: outcome,
        errorCode,
        errorMessage,
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
        tenantId: task.tenantId,
        executionRunId: task.executionRunId,
        executionStepId: task.executionStepId,
        success,
        status: outcome,
        errorCode,
        errorMessage,
        detail: sanitizedDetail,
        actorId: task.agentId,
      });
    }
    if (success && task.payload?.actionType === 'agent.fact.collect' && task.payload?.refreshWebInventory === true) {
      await this.projectLatestCapabilitySnapshot(task.tenantId, task.agentId);
    }
    return updated;
  }

  private async executePluginFactPipeline(
    task: AgentTaskEnvelope,
    rawDetail: Record<string, unknown>,
    binding: PluginFactBindingV1,
  ): Promise<PluginFactPipelineResult> {
    if (!this.pluginFactPipeline) {
      throw new AppError('PLUGIN_RUNNER_START_FAILED', '插件事实任务缺少已装配的 Plugin Runner 流水线', {
        reason: 'PLUGIN_FACT_PIPELINE_UNAVAILABLE',
        taskId: task.id,
      });
    }
    const factEnvelope = readOptionalRecord(rawDetail.factEnvelope);
    if (!factEnvelope) {
      throw new AppError('VALIDATION_FAILED', '插件事实任务结果缺少 detail.factEnvelope', {
        reason: 'PLUGIN_FACT_ENVELOPE_REQUIRED',
        taskId: task.id,
      });
    }
    return this.pluginFactPipeline.execute({
      tenantId: task.tenantId,
      agentId: task.agentId,
      hostId: binding.hostId,
      executionId: task.executionRunId,
      executionStepId: task.executionStepId,
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
      pluginVersionId: binding.pluginVersionId,
      workflowVersionId: binding.workflowVersionId,
      capability: binding.capability,
      packageHash: binding.packageHash,
      manifestHash: binding.manifestHash,
      resourceHash: binding.resourceHash,
      planDigest: binding.planDigest,
      grantRefs: [...binding.grantRefs],
      hostPermissions: [...binding.hostPermissions],
      idempotencyKey: task.idempotencyKey,
      deadlineAt: binding.deadlineAt,
      factEnvelope,
      input: structuredClone(binding.input),
    });
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
    void tenantId;
    void taskId;
    void requestId;
    void onProgress;
    throw new AppError('AUTH_FORBIDDEN', 'Agent 直连执行旁路已禁用，任务必须由 Agent v2 控制面队列消费', {
      reason: 'AGENT_DIRECT_BYPASS_RETIRED',
      fallback: false,
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
      status: 'planned',
      reason: '发现可用升级版本',
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

  async createAgentInstallSession(
    tenantId: string,
    input: CreateAgentInstallSessionInput,
    requestId: string,
    baseUrl: string,
  ): Promise<AgentInstallSessionBootstrapProjection> {
    if (input.platform === 'windows_go') await ensureWindowsGoBundleAvailable();
    if (input.platform === 'windows_compatibility') await ensureWindowsCompatibilityBundleAvailable();
    if (input.platform === 'linux_go') buildLinuxAgentBundleTarGz();
    const session = this.domain.createAgentInstallSession(tenantId, input, requestId, baseUrl);
    const { bootstrapToken, enrollmentTokenRecord, ...stored } = session;
    await this.repository.createEnrollmentToken(enrollmentTokenRecord);
    await this.repository.createInstallSession(stored);
    const encodedToken = encodeURIComponent(bootstrapToken);
    const route = installRouteForPlatform(stored.platform);
    const bootstrapUrl = `${stored.controlPlaneUrl}${route}?token=${encodedToken}`;
    const installCommand = installCommandForPlatform(stored.platform, bootstrapUrl);
    return {
      sessionId: stored.id,
      platform: stored.platform,
      expiresAt: stored.expiresAt,
      bootstrapUrl,
      installCommand,
      bootstrapTokenPreview: stored.bootstrapTokenPreview,
      serviceName: stored.serviceName,
      displayName: stored.displayName,
      installRoot: stored.installRoot,
      configDir: stored.configDir,
      dataDir: stored.dataDir,
      logDir: stored.logDir,
      agentKey: stored.agentKey,
      zone: stored.zone,
      enrollmentTokenPreview: enrollmentTokenRecord.tokenPreview,
      ...optionalBundleUrl(stored),
    };
  }

  async consumeInstallSessionByToken(bootstrapToken: string, usedByIp?: string): Promise<AgentInstallSession> {
    const tokenHash = this.domain.hashInstallBootstrapToken(bootstrapToken);
    const usedAt = new Date().toISOString();
    const consumed = await this.repository.consumeInstallSessionByTokenHash(tokenHash, usedAt, usedByIp);
    if (consumed) return consumed;

    const existing = await this.repository.findInstallSessionByTokenHashAnyTenant(tokenHash);
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND', '安装会话不存在');
    if (new Date(existing.expiresAt).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', '安装会话已过期');
    if (existing.usedAt) throw new AppError('AUTH_FORBIDDEN', '安装会话已被使用');
    throw new AppError('RESOURCE_VERSION_CONFLICT', '安装会话消费冲突');
  }

  async getInstallSessionByToken(bootstrapToken: string): Promise<AgentInstallSession> {
    const session = await this.repository.findInstallSessionByTokenHashAnyTenant(this.domain.hashInstallBootstrapToken(bootstrapToken));
    if (!session) throw new AppError('RESOURCE_NOT_FOUND', '安装会话不存在');
    if (new Date(session.expiresAt).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', '安装会话已过期');
    if (session.usedAt) throw new AppError('AUTH_FORBIDDEN', '安装会话已被使用');
    return session;
  }

  async buildWindowsInstallManifest(session: AgentInstallSession, baseUrl = session.controlPlaneUrl): Promise<AgentInstallSessionManifest> {
    requireInstallPlatform(session.platform, WINDOWS_INSTALL_PLATFORMS, '安装会话不是 Windows 平台');
    return {
      ...this.baseInstallManifest(session, baseUrl),
      artifacts: await WINDOWS_ARTIFACT_LOADERS[session.platform](),
      ...(session.platform === 'windows_go_service' && this.trustMaterialIssuer
        ? { authorizationTrustKeySet: this.trustMaterialIssuer.getTrustedKeySet() }
        : {}),
    };
  }

  buildLinuxGoInstallManifest(session: AgentInstallSession, baseUrl = session.controlPlaneUrl): AgentInstallSessionManifest {
    requireInstallPlatform(session.platform, ['linux_go_systemd'], '安装会话不是 Linux Go 平台');
    return {
      ...this.baseInstallManifest(session, baseUrl),
      bundleUrl: `${baseUrl}/api/v1/agents/install/linux/bundle.tar.gz`,
      bundleManifest: getLinuxAgentBundleManifest(LINUX_AGENT_RELEASE_VERSION),
      ...(this.trustMaterialIssuer ? { authorizationTrustKeySet: this.trustMaterialIssuer.getTrustedKeySet() } : {}),
    };
  }

  buildLinuxBundleTarGz(): Buffer {
    return buildLinuxAgentBundleTarGz();
  }

  async createAgentInstallMaterials(
    tenantId: string,
    input: AgentInstallMaterialRequest,
    requestId: string,
  ): Promise<AgentInstallMaterialProjection> {
    const descriptor = this.createInstallDescriptor(tenantId, input, requestId);
    const { token: enrollmentToken, ...enrollmentTokenRecord } = descriptor.enrollmentTokenRecord;
    await this.repository.createEnrollmentToken(enrollmentTokenRecord);

    const material = this.getPinnedInstallArtifact(input.platform);
    const unsignedTask = {
      type: 'agent.plan.execute' as const,
      contractVersion: 'gcac.agent-security/v1' as const,
      taskId: descriptor.id,
      version: material.version,
      artifactRefs: [material.artifactRef],
      input: {
        role: descriptor.role!,
        zone: descriptor.zone!,
        agentKey: descriptor.agentKey!,
        serviceName: descriptor.serviceName,
        displayName: descriptor.displayName,
        installRoot: descriptor.installRoot,
        configDir: descriptor.configDir,
        dataDir: descriptor.dataDir,
        logDir: descriptor.logDir,
      },
      expiresAt: descriptor.expiresAt,
    };
    const taskDigest = sha256(JSON.stringify(unsignedTask));
    const task: AgentInstallTaskProjection = {
      ...unsignedTask,
      digest: taskDigest,
      signature: material.signature,
      signatureAlgorithm: material.signatureAlgorithm,
      signingKeyId: material.signingKeyId,
    };

    return {
      installationId: descriptor.id,
      expiresAt: descriptor.expiresAt,
      enrollmentToken,
      materials: [material],
      task,
    };
  }

  private baseInstallManifest(session: AgentInstallSession, baseUrl: string): AgentInstallSessionManifest {
    return {
      sessionId: session.id,
      platform: session.platform,
      serviceName: session.serviceName,
      displayName: session.displayName,
      installRoot: session.installRoot,
      configDir: session.configDir,
      dataDir: session.dataDir,
      logDir: session.logDir,
      role: session.role,
      startAfterInstall: session.startAfterInstall,
      controlPlaneUrl: baseUrl,
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      enrollmentToken: session.enrollmentToken,
      zone: session.zone,
    };
  }

  private async withTrustMaterial(agent: AgentRegistration): Promise<AgentRegistration & { trustMaterial?: unknown }> {
    const osType = agent.descriptor.osType.toLowerCase();
    if (!this.trustMaterialIssuer || (!osType.includes('linux') && !osType.includes('windows'))) return agent;
    return {
      ...agent,
      trustMaterial: await this.trustMaterialIssuer.issue({ tenantId: agent.tenantId, agentId: agent.id, osType: agent.descriptor.osType }),
    };
  }

  private createInstallDescriptor(tenantId: string, input: AgentInstallMaterialRequest, requestId: string): AgentInstallDescriptor {
    const role = normalizeInstallMaterialRole(input.role);
    if (input.platform === 'windows_compatibility' && role !== 'full_agent') {
      throw new AppError('VALIDATION_FAILED', 'Windows Compatibility Agent 只允许 full_agent 角色');
    }
    const id = newId('aginst');
    const zone = normalizeInstallMaterialValue(input.zone ?? 'default', 'zone');
    const agentKey = normalizeInstallMaterialValue(input.agentKey ?? `${input.platform}.${id.toLowerCase()}`, 'agentKey');
    const profile = installMaterialProfile(input.platform, role);
    const enrollmentTokenRecord = this.domain.createEnrollmentToken(tenantId, {
      allowedRoles: [role],
      allowedZones: [zone],
      maxUses: 1,
      ttlSeconds: 1800,
      createdBy: 'agent.install-materials',
    }, requestId);
    return {
      id,
      role,
      zone,
      agentKey,
      enrollmentTokenRecord,
      expiresAt: enrollmentTokenRecord.expiresAt,
      ...profile,
    };
  }

  private getPinnedInstallArtifact(platform: AgentInstallMaterialPlatform): AgentInstallArtifactMaterial {
    if (platform === 'linux_go') {
      const artifact = getLinuxAgentInstallMaterials()[0];
      if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', 'Linux Agent 安装 Artifact 未登记');
      return structuredClone(artifact);
    }
    const artifact = PINNED_WINDOWS_ARTIFACTS[platform];
    if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 安装 Artifact 未登记', { platform });
    return structuredClone(artifact);
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query).then(async (page) => {
      const items = this.deduplicateRegistrations(page.items);
      const projected = await Promise.all(items.map(async (agent) => ({
        ...agent,
        // 列表状态与详情状态必须一致：Agent 在线性只看心跳，管理 TCP 单独展示。
        ...(this.liveness ? await this.liveness.project(tenantId, 'AGENT', agent.id, ['HEARTBEAT']) : {}),
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
      // Agent 是否在线只由出站心跳决定。管理 TCP 是入站手动探测能力，不能
      // 因为防火墙、NAT 或临时端口故障把仍在主动心跳的 Agent 判成离线。
      const liveness = this.liveness
        ? await this.liveness.project(agent.tenantId, 'AGENT', agent.id, ['HEARTBEAT'])
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

  async getAgentDetail(tenantId: string, agentId: string, options: { includeLogs?: boolean } = {}): Promise<AgentDetailProjection> {
    const [detailData, liveness, managementLiveness] = await Promise.all([
      this.repository.getDetailData(tenantId, agentId, options),
      this.liveness?.project(tenantId, 'AGENT', agentId, ['HEARTBEAT']),
      this.liveness?.project(tenantId, 'AGENT', agentId, ['MANAGEMENT_TCP']),
    ]);
    if (!detailData) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 不存在', { agentId });
    const { agent, capabilitySnapshot, latestHeartbeat, tasks, recentErrors, runtimeLogs, recentTaskLogs, releases, upgradePlans } = detailData;
    const capabilities = {
      agentId: agent.id,
      declarations: capabilitySnapshot ? this.domain.toCapabilityDeclarations(agent, capabilitySnapshot) : [],
    };
    const taskQueue = { agentId: agent.id, counts: countTasks(tasks), tasks };
    const upgradeSuggestion = buildUpgradeSuggestion(agent, releases, upgradePlans);
    const health = this.toHealthProjection(agent, latestHeartbeat, liveness);
    if (liveness?.livenessStatus === 'OFFLINE') {
      health.status = 'failed';
      health.offline = true;
      health.offlineEvidence = [...health.offlineEvidence, `livenessReasonCode=${liveness.livenessReasonCode ?? 'unknown'}`];
    }
    return {
      agent,
      ...liveness,
      managementLiveness,
      lifecycle: this.toLifecycle(agent),
      latestHeartbeat,
      health,
      capabilitySnapshot,
      capabilities,
      taskQueue,
      upgradeSuggestion,
      recentErrors,
      runtimeLogs,
      recentTaskLogs: buildRecentTaskRuntimeLogs(tasks, recentTaskLogs),
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
    return {
      agentId: agent.id,
      currentVersion: agent.descriptor.version,
      suggestion: {
        status: 'available',
        reason: '发现可用升级版本',
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

  private toHealthProjection(agent: AgentRegistration, latestHeartbeat?: AgentHeartbeat, liveness?: { livenessStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'; livenessReasonCode?: string }): AgentHealthProjection {
    const offlineTimeoutSeconds = this.getOfflineTimeoutSeconds();
    const runtimeHealth = latestHeartbeat?.runtimeHealth;
    const lastHeartbeatAt = latestHeartbeat?.receivedAt ?? agent.gateway?.lastHeartbeatAt;
    const heartbeatAgeSeconds = safeAgeSeconds(lastHeartbeatAt);
    const offline = liveness?.livenessStatus === 'OFFLINE'
      || (liveness === undefined && (agent.status === 'OFFLINE' || isObservationStale(lastHeartbeatAt, offlineTimeoutSeconds)));
    const degradedReasons = dedupeStrings(runtimeHealth?.degradedReasons ?? []);
    const failureCounts = {
      heartbeat: runtimeHealth?.failureCounts?.heartbeat ?? 0,
      taskPoll: runtimeHealth?.failureCounts?.taskPoll ?? 0,
      recovery: runtimeHealth?.failureCounts?.recovery ?? 0,
    };
    const offlineEvidence = [
      offline ? (liveness?.livenessStatus === 'OFFLINE' ? `livenessReasonCode=${liveness.livenessReasonCode ?? 'unknown'}` : 'agent.status=OFFLINE') : '',
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
      runtimeHealth,
    };
  }

  private getOfflineTimeoutSeconds(): number {
    return readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 180);
  }

  private async assertLivenessAllowsExecution(tenantId: string, agentId: string): Promise<void> {
    if (!this.liveness) return;
    const projection = await this.liveness.project(tenantId, 'AGENT', agentId, ['HEARTBEAT']);
    if (projection.signals.length === 0) return;
    if (projection.livenessStatus === 'ONLINE') return;
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', projection.livenessStatus === 'OFFLINE' ? 'Agent 已离线，不能下发任务' : 'Agent 存活状态尚未确认，不能下发任务', {
      agentId,
      livenessStatus: projection.livenessStatus,
      reasonCode: projection.livenessReasonCode,
    });
  }

  private async assertManagementEndpointReachable(tenantId: string, agentId: string): Promise<void> {
    if (!this.liveness) return;
    const result = await this.liveness.probeAgentManagementEndpoint({ tenantId, agentId });
    if (result.success) return;
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 管理 TCP 端口不可达，不能下发重新发现任务', {
      agentId,
      reasonCode: result.reasonCode ?? 'TCP_CONNECT_FAILED',
      reasonDetail: result.reasonDetail,
      host: result.host,
      port: result.port,
      livenessStatus: result.projection.livenessStatus,
    });
  }

  private async listRecentTaskRuntimeLogs(tenantId: string, agentId: string): Promise<AgentDetailProjection['recentTaskLogs']> {
    const tasks = await this.repository.listTasks(tenantId, agentId);
    const taskById = new Map(tasks.map((task) => [task.id, task] as const));
    const allLogs = await this.repository.listAgentTaskLogs(tenantId, agentId);
    return buildRecentTaskRuntimeLogs(tasks, allLogs);
  }
}

function buildRecentTaskRuntimeLogs(tasks: AgentTaskEnvelope[], logs: AgentTaskLogEntry[]): AgentDetailProjection['recentTaskLogs'] {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  return logs
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
        executionMode: 'queued' as const,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 50);
}

function buildUpgradeSuggestion(
  agent: AgentRegistration,
  releases: AgentVersionRelease[],
  upgradePlans: AgentUpgradePlan[],
): AgentUpgradeSuggestionProjection {
  const release = [...releases]
    .sort((left, right) => compareAgentVersions(right.version, left.version))
    .find((item) => item.platform === agent.descriptor.osType && (!item.arch || item.arch === agent.descriptor.arch));
  if (!release) {
    return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: '没有匹配平台的升级版本' } };
  }
  if (release.version === agent.descriptor.version) {
    return { agentId: agent.id, currentVersion: agent.descriptor.version, suggestion: { status: 'not_required', reason: 'Agent 已是目标版本' } };
  }
  return {
    agentId: agent.id,
    currentVersion: agent.descriptor.version,
    suggestion: {
      status: 'available', reason: '发现可用升级版本', targetVersion: release.version, releaseId: release.id,
      downloadUrl: release.downloadUrl, checksumSha256: release.checksumSha256, signature: release.signature,
      rollbackVersion: release.rollbackVersion,
      existingPlan: upgradePlans.find((plan) => plan.releaseId === release.id),
    },
  };
}

function compareAgentVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function countTasks(tasks: AgentTaskEnvelope[]): Record<AgentTaskEnvelope['status'], number> {
  return tasks.reduce<Record<AgentTaskEnvelope['status'], number>>((counts, task) => {
    counts[task.status] += 1;
    return counts;
  }, { queued: 0, leased: 0, acked: 0, succeeded: 0, failed: 0, rejected: 0 });
}

function resolveAgentTaskOutcome(input: SubmitAgentTaskResultInput, detail: Record<string, unknown>): AgentSecurityStatus {
  const candidates = [
    input.status,
    detail.status,
    detail.executionStatus,
    readRecord(detail.receipt)?.status,
  ];
  const explicit = candidates.find((value): value is AgentSecurityStatus => value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED');
  if (explicit) return explicit;
  return input.success ? 'SUCCESS' : 'FAILED';
}

function assertAgentTaskResultConsistency(success: boolean, outcome: AgentSecurityStatus): void {
  if (success !== (outcome === 'SUCCESS')) {
    throw new AppError('VALIDATION_FAILED', 'Agent 任务结果的 success 与 status 不一致', {
      success,
      status: outcome,
    });
  }
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

function validateQueuedAgentV2Receipt(
  task: AgentTaskEnvelope,
  detail: Record<string, unknown>,
  tenantId: string,
  submittedStatus?: AgentSecurityStatus,
  submittedSuccess = false,
): AgentExecutionReceiptV1 | undefined {
  const gatewayTaskPayload = readOptionalRecord(readOptionalRecord(task.payload.gatewayTask)?.payload);
  const authorizationPayload = gatewayTaskPayload ?? task.payload;
  const actionType = resolveAgentTaskActionType(task.payload) ?? resolveAgentTaskActionType(authorizationPayload);
  const receiptValue = readOptionalRecord(detail.receipt);
  if (!actionType) {
    if (receiptValue) {
      throw new AppError('VALIDATION_FAILED', '非 Agent v2 任务不能提交 AgentExecutionReceiptV1', {
        reason: 'AGENT_V2_RECEIPT_ACTION_REQUIRED',
        taskId: task.id,
      });
    }
    return undefined;
  }

  const receiptRequired = actionType === 'agent.plan.execute' || actionType === 'agent.execution.receipt';
  const executionStatus = submittedStatus ?? readAgentSecurityStatus(detail.executionStatus);
  const gatewayResult = readOptionalRecord(detail.gatewayResult);
  const gatewayPreDispatchFailure = gatewayResult?.forwarded === false && executionStatus === 'FAILED' && submittedSuccess === false;
  if (!receiptValue) {
    // 授权未离开 Gateway，或已进入 UNKNOWN，均不能凭空生成 Receipt；只落协调结果并失败关闭。
    if (receiptRequired && executionStatus !== 'UNKNOWN' && !gatewayPreDispatchFailure) {
      throw new AppError('VALIDATION_FAILED', 'Agent v2 写操作结果缺少完整 Execution Receipt', {
        reason: 'AGENT_V2_RECEIPT_REQUIRED',
        taskId: task.id,
        actionType,
      });
    }
    return undefined;
  }

  const receipt = validateAgentExecutionReceipt(receiptValue);
  const expectedReceiptAgentId = readStringValue(readOptionalRecord(authorizationPayload.token)?.agentId) ?? task.agentId;
  if (receipt.agentId !== expectedReceiptAgentId || receipt.tenantId !== tenantId) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 的 Agent 或租户绑定不一致', {
      reason: 'AGENT_V2_RECEIPT_IDENTITY_DENIED',
      taskId: task.id,
      agentId: receipt.agentId,
      tenantId: receipt.tenantId,
    });
  }

  const tokenValue = readOptionalRecord(authorizationPayload.token);
  const decisionValue = readOptionalRecord(authorizationPayload.policyDecision);
  const planValue = readOptionalRecord(authorizationPayload.plan);
  if (!tokenValue || !decisionValue) {
    throw new AppError('AUTH_FORBIDDEN', 'Agent v2 任务缺少 Token 或 Policy Decision，拒绝接受 Receipt', {
      reason: 'AGENT_V2_AUTHORIZATION_MATERIAL_REQUIRED',
      taskId: task.id,
    });
  }
  const token = validateAgentCapabilityToken(tokenValue);
  const decision = validatePolicyAuthorityDecision(decisionValue);
  const plan = planValue ? validateAgentPlan(planValue) : undefined;
  if (token.agentId !== receipt.agentId || token.tenantId !== receipt.tenantId
    || token.tokenId !== receipt.tokenId || token.planDigest !== receipt.planDigest
    || decision.agentId !== token.agentId || decision.tenantId !== token.tenantId
    || decision.tokenId !== token.tokenId || decision.planDigest !== token.planDigest
    || decision.nonce !== token.nonce) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与 Token、Decision 绑定不一致', {
      reason: 'AGENT_V2_RECEIPT_BINDING_DENIED',
      taskId: task.id,
    });
  }
  if (plan && (plan.planId !== receipt.planId || plan.planDigest !== receipt.planDigest
    || plan.agentId !== receipt.agentId || plan.tenantId !== receipt.tenantId
    || !plan.operations.some((operation) => operation.operationId === receipt.operationId))) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与 AgentPlanV1 绑定不一致', {
      reason: 'AGENT_V2_RECEIPT_PLAN_BINDING_DENIED',
      taskId: task.id,
    });
  }
  if (receiptRequired && !receipt.nonceConsumed) {
    throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 未确认 Nonce 已消费', {
      reason: 'AGENT_V2_NONCE_NOT_CONSUMED',
      taskId: task.id,
    });
  }
  return receipt;
}

function readAgentSecurityStatus(value: unknown): AgentSecurityStatus | undefined {
  return value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED'
    ? value
    : undefined;
}

function readAgentTaskOutcome(task: AgentTaskEnvelope): AgentSecurityStatus | undefined {
  const result = readRecord(task.result);
  const status = result.status ?? readRecord(result.detail).executionStatus;
  return status === 'SUCCESS' || status === 'FAILED' || status === 'UNKNOWN' || status === 'CANCELLED'
    ? status
    : undefined;
}

function readReceipt(value: unknown): AgentExecutionReceiptV1 | undefined {
  const receipt = readOptionalRecord(readOptionalRecord(value)?.receipt);
  return receipt as AgentExecutionReceiptV1 | undefined;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function resolvePluginFactBinding(task: AgentTaskEnvelope, actionType: AgentV2ContractType | undefined): PluginFactBindingV1 | undefined {
  if (actionType !== 'agent.fact.collect' || !Object.prototype.hasOwnProperty.call(task.payload, 'pluginFactBinding')) return undefined;
  return parsePluginFactBinding(task.payload.pluginFactBinding);
}

function resolvePluginFactTaskOutcome(result: PluginFactPipelineResult): AgentSecurityStatus {
  return result.status === 'SUCCESS' ? 'SUCCESS' : result.status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
}

function serializePluginFactPipelineResult(result: PluginFactPipelineResult): Record<string, unknown> {
  return {
    status: result.status,
    factEnvelope: structuredClone(result.fact),
    normalizedObjects: structuredClone(result.normalizedObjects),
    ...(result.atomicPlan ? { atomicPlan: structuredClone(result.atomicPlan) } : {}),
    projectionSummaries: structuredClone(result.projectionSummaries),
    runnerSummary: structuredClone(result.runnerSummary),
    warnings: structuredClone(result.warnings),
    ...(result.error ? { error: structuredClone(result.error) } : {}),
  };
}

export function resolveAgentTaskActionType(payload: Record<string, unknown> | undefined): AgentV2ContractType | undefined {
  const actionType = readStringValue(payload?.actionType);
  return actionType && agentV2ContractTypes.includes(actionType as AgentV2ContractType)
    ? actionType as AgentV2ContractType
    : undefined;
}

function assertSupportedAgentTaskPayload(payload: Record<string, unknown>): void {
  const actionType = readStringValue(payload.actionType);
  const taskType = readStringValue(payload.type);
  if (taskType) {
    throw new AppError('VALIDATION_FAILED', 'Agent task 动作未注册，拒绝进入执行路径', { actionType: taskType });
  }
  if (!actionType || !agentV2ContractTypes.includes(actionType as AgentV2ContractType)) {
    throw new AppError('VALIDATION_FAILED', 'Agent task 动作未注册，拒绝进入执行路径', { actionType });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const windowsGoAgentRoot = resolveRepositoryAgentRoot('windows-go-full-agent');
const windowsCompatibilityAgentRoot = resolveRepositoryAgentRoot('windows-compat-full-agent');
const windowsCompatibilityReleaseRoot = path.join(windowsCompatibilityAgentRoot, 'bin', 'Release');
const WINDOWS_INSTALL_PLATFORMS = ['windows_go_service', 'windows_compatibility_service'] as const;
const WINDOWS_ARTIFACT_LOADERS: Record<typeof WINDOWS_INSTALL_PLATFORMS[number], () => Promise<Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>>> = {
  windows_go_service: loadWindowsGoAgentArtifacts,
  windows_compatibility_service: loadWindowsCompatibilityAgentArtifacts,
};

function installRouteForPlatform(platform: AgentInstallSession['platform']): string {
  const routes: Record<AgentInstallSession['platform'], string> = {
    windows_go_service: '/agent-install.ps1',
    windows_compatibility_service: '/agent-install.ps1',
    linux_go_systemd: '/agent-install',
  };
  return routes[platform];
}

function installCommandForPlatform(platform: AgentInstallSession['platform'], bootstrapUrl: string): string {
  const commands: Record<AgentInstallSession['platform'], string> = {
    windows_go_service: `irm '${bootstrapUrl}' | iex`,
    windows_compatibility_service: `irm '${bootstrapUrl}' | iex`,
    linux_go_systemd: `curl -fsSL '${bootstrapUrl}' | sudo bash`,
  };
  return commands[platform];
}

function optionalBundleUrl(session: Pick<AgentInstallSession, 'platform' | 'controlPlaneUrl'>): { bundleUrl?: string } {
  const bundlePathByPlatform: Partial<Record<AgentInstallSession['platform'], string>> = {
    linux_go_systemd: '/api/v1/agents/install/linux/bundle.tar.gz',
  };
  const bundlePath = bundlePathByPlatform[session.platform];
  return bundlePath ? { bundleUrl: `${session.controlPlaneUrl}${bundlePath}` } : {};
}

function requireInstallPlatform<T extends readonly AgentInstallSession['platform'][]>(platform: AgentInstallSession['platform'], supported: T, message: string): asserts platform is T[number] {
  if (!supported.includes(platform)) throw new AppError('VALIDATION_FAILED', message);
}

async function ensureWindowsGoBundleAvailable(): Promise<void> {
  if (!existsSync(path.join(windowsGoAgentRoot, 'gcac-agent.exe'))) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Go Agent 可执行文件未构建，不能生成一键安装命令');
  }
}

async function loadWindowsGoAgentArtifacts() {
  await ensureWindowsGoBundleAvailable();
  const artifacts = await walkWindowsAgentArtifacts(windowsGoAgentRoot, [
    'gcac-agent.exe',
    'install-service.ps1',
    'service-control.ps1',
    'uninstall-service.ps1',
    'config/agent.config.template.json',
    'release/verify-signature.ps1',
  ]);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function ensureWindowsCompatibilityBundleAvailable(): Promise<void> {
  const executable = path.join(windowsCompatibilityReleaseRoot, 'GCAC.WindowsCompatibilityAgent.exe');
  const config = `${executable}.config`;
  if (!existsSync(executable) || !existsSync(config)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Compatibility Agent 可执行文件未构建，不能生成一键安装命令');
  }
}

async function loadWindowsCompatibilityAgentArtifacts() {
  await ensureWindowsCompatibilityBundleAvailable();
  const artifacts = await walkWindowsAgentArtifacts(windowsCompatibilityReleaseRoot, [
    'GCAC.WindowsCompatibilityAgent.exe',
    'GCAC.WindowsCompatibilityAgent.exe.config',
  ]);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function walkWindowsAgentArtifacts(
  currentDir: string,
  allowedPaths: readonly string[],
  relativeDir = '',
): Promise<Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>> {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(currentDir, { withFileTypes: true }));
  const artifacts: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }> = [];
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (allowedPaths.some((allowed) => allowed.startsWith(`${relativePath}/`))) {
        artifacts.push(...await walkWindowsAgentArtifacts(path.join(currentDir, entry.name), allowedPaths, relativePath));
      }
      continue;
    }
    if (!allowedPaths.includes(relativePath)) continue;
    const absolutePath = path.join(currentDir, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    const binary = extension === '.exe' || extension === '.dll';
    artifacts.push({
      path: relativePath.replace(/\\/gu, '/'),
      content: binary ? (await readFile(absolutePath)).toString('base64') : stripUtf8Bom(await readFile(absolutePath, 'utf8')),
      encoding: binary ? 'base64' : 'utf8',
    });
  }
  return artifacts;
}

function resolveRepositoryAgentRoot(agentDirectoryName: string): string {
  const backendMarker = `${path.sep}backend${path.sep}`;
  const backendMarkerIndex = currentDirPath.lastIndexOf(backendMarker);
  if (backendMarkerIndex >= 0) {
    const repositoryRoot = currentDirPath.slice(0, backendMarkerIndex);
    return path.join(repositoryRoot, 'agents', agentDirectoryName);
  }
  return path.resolve(process.cwd(), '..', 'agents', agentDirectoryName);
}

function stripUtf8Bom(value: string): string {
  return value.replace(/^\uFEFF/u, '');
}

interface InstallMaterialProfile {
  serviceName: string;
  displayName: string;
  installRoot: string;
  configDir: string;
  dataDir: string;
  logDir: string;
}

function normalizeInstallMaterialRole(value: AgentInstallMaterialRequest['role']): 'full_agent' | 'gateway' {
  if (value === undefined || value === 'full_agent') return 'full_agent';
  if (value === 'gateway') return 'gateway';
  throw new AppError('VALIDATION_FAILED', 'role 只能是 full_agent 或 gateway', { role: value });
}

function normalizeInstallMaterialValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  if (normalized.length > 200 || /[\r\n\0]/u.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `${field} 格式不合法`, { field });
  }
  return normalized;
}

function installMaterialProfile(platform: AgentInstallMaterialPlatform, role: 'full_agent' | 'gateway'): InstallMaterialProfile {
  if (platform === 'windows_compatibility') {
    return {
      serviceName: 'GCACWindowsCompatibilityAgent',
      displayName: 'GCAC Windows Compatibility Agent',
      installRoot: 'C:\\Program Files\\GCAC\\WindowsCompatibilityAgent',
      configDir: 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\config',
      dataDir: 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\data',
      logDir: 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\logs',
    };
  }
  if (platform === 'windows_go') {
    return role === 'gateway'
      ? {
        serviceName: 'gcac-gateway-agent',
        displayName: 'GCAC Windows Gateway Agent',
        installRoot: 'C:\\Program Files\\GCAC\\Gateway',
        configDir: 'C:\\ProgramData\\GCAC\\Gateway\\config',
        dataDir: 'C:\\ProgramData\\GCAC\\Gateway\\data',
        logDir: 'C:\\ProgramData\\GCAC\\Gateway\\logs',
      }
      : {
        serviceName: 'gcac-windows-go-agent',
        displayName: 'GCAC Windows Go Full Agent',
        installRoot: 'C:\\Program Files\\GCAC\\WindowsGoAgent',
        configDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\config',
        dataDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\data',
        logDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\logs',
      };
  }
  return role === 'gateway'
    ? {
      serviceName: 'gcac-linux-gateway-agent',
      displayName: 'GCAC Linux Gateway Agent',
      installRoot: '/opt/gcac/gateway',
      configDir: '/etc/gcac/gateway',
      dataDir: '/var/lib/gcac/gateway',
      logDir: '/var/log/gcac/gateway',
    }
    : {
      serviceName: 'gcac-linux-agent',
      displayName: 'GCAC Linux Go Full Agent',
      installRoot: '/opt/gcac/linux-agent',
      configDir: '/etc/gcac/linux-agent',
      dataDir: '/var/lib/gcac/linux-agent',
      logDir: '/var/log/gcac/linux-agent',
    };
}
