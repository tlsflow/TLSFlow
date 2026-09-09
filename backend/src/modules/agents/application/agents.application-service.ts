import { createHash, createPrivateKey, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import { newId } from '../../../shared/id.js';
import { isObservationStale, readPositiveSeconds } from '../../../shared/observation-freshness.js';
import { AgentsDomainService, normalizeFingerprint } from '../domain/agents.domain-service.js';
import type { AckAgentTaskInput, AgentCapabilityProjection, AgentCapabilitySnapshotInput, AgentCertificateIssueResult, AgentCertificateRotateResult, AgentDetailProjection, AgentHealthProjection, AgentHeartbeatInput, AgentInstallSessionBootstrapProjection, AgentTaskLogAckResult, AgentTaskQueueProjection, AgentUpgradeSuggestionProjection, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentInstallSessionInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DeleteAgentInput, DisableAgentInput, DispatchAgentUpgradeInput, EnableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentRuntimeLogInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentHeartbeat, AgentInstallSession, AgentInstallSessionRole, AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan, AgentVersionRelease, EnrollmentToken, LinuxAgentPlatformFamily } from '../schema/agents.schema.js';
import { PgAgentsRepository, type AgentsRepository } from '../repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';
import { agentV2ContractTypes, validateAgentCapabilityToken, validateAgentExecutionReceipt, validateAgentPlan, validatePolicyAuthorityDecision, type AgentExecutionReceiptV1, type AgentSecurityStatus, type AgentV2ContractType } from '../security/agent-security.contract.js';
import { AGENT_RELEASE_SIGNING_KEY_ID, buildLinuxAgentBundleTarGz, getLinuxAgentBundleManifest, getLinuxAgentInstallMaterials, LINUX_AGENT_RELEASE_VERSION, type LinuxAgentArtifactReference } from './linux-agent-bundle.js';
import { buildGatewayAgentBundleTarGz, getGatewayAgentBundleManifest, getGatewayAgentInstallMaterials, loadGatewayWindowsAgentArtifacts } from './gateway-agent-bundle.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { ExecutionResultSyncService } from '../../executions/application/execution-result-sync.service.js';
import type { ExecutionDetailStreamService } from '../../executions/application/execution-detail-stream.service.js';
import type { LivenessApplicationService } from '../../liveness/application/liveness.application-service.js';
import type { AgentCapabilityDiscoveryProjector } from '../discovery/agent-capability-discovery.projector.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import { GATEWAY_RELAY_DEFAULT_PORT, loadOrCreateGatewayRelayIdentity } from '../../gateway-agents/gateway-relay.js';
import { parsePluginFactBinding } from '../../plugins/application/plugin-fact-pipeline.service.js';
import type { PluginFactBindingV1, PluginFactPipelineResult, PluginFactPipelineService } from '../../plugins/application/plugin-fact-pipeline.service.js';
import type { AgentDiscoveryRequestFactory } from './agent-discovery-task-factory.js';
import { AgentDirectClient } from './agent-direct-client.js';
import { AgentManagementClient, signAgentUpgradeEnvelope, type AgentManagementResponse, type AgentUpgradeEnvelope } from './agent-management-client.js';
import type { ApplicationExecutionCompatibilityService } from '../../assets/application/application-execution-compatibility.service.js';

const agentV2PreExecutionFailureCodes = new Set(['ACTION_HANDLER_NOT_REGISTERED', 'AGENT_V2_AUTHORIZATION_DENIED', 'AGENT_V2_MESSAGE_INVALID', 'AGENT_V2_ACTION_UNSUPPORTED', 'AGENT_PLAN_INVALID']);
const agentUpgradeHelperTimeoutMs = 5 * 60 * 1000;

export interface AgentTrustMaterialIssuer {
  issue(input: { tenantId: string; agentId: string; osType?: string }): Promise<unknown>;
  getTrustedKeySet(): Record<string, string>;
  /** 在生成安装清单前同步 Policy Authority 的当前公钥，避免轮换窗口使用旧 KeySet。 */
  refreshTrustedKeySet?: () => Promise<void>;
}

export type AgentInstallMaterialPlatform = 'windows_go' | 'windows_compatibility' | 'linux_go';

export interface AgentInstallMaterialRequest {
  platform: AgentInstallMaterialPlatform;
  role?: 'full_agent' | 'gateway';
  zone?: string;
  agentKey?: string;
  relayAllowedTargets?: string[];
  relayAllowedPorts?: number[];
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
  relayAllowedTargets?: string[];
  relayAllowedPorts?: number[];
}

export interface AgentInstallMaterialProjection {
  installationId: string;
  expiresAt: string;
  enrollmentToken: string;
  role: 'full_agent' | 'gateway';
  zone: string;
  relayAllowedTargets?: string[];
  relayAllowedPorts?: number[];
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
    relayAllowedTargets?: string[];
    relayAllowedPorts?: number[];
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
  role: AgentInstallSessionRole;
  platformFamily?: LinuxAgentPlatformFamily;
  managementPort: number;
  agentVersion?: string;
  startAfterInstall: boolean;
  controlPlaneUrl: string;
  agentKey: string;
  tenantId: string;
  enrollmentToken: string;
  zone: string;
  bundleUrl?: string;
  bundleManifest?: ReturnType<typeof getLinuxAgentBundleManifest>;
  /** gateway 角色时的独立 Gateway Agent bundle。 */
  gatewayBundleUrl?: string;
  gatewayBundleManifest?: ReturnType<typeof getGatewayAgentBundleManifest>;
  artifacts?: Array<{
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
  }>;
  authorizationTrustKeySet?: Record<string, string>;
  /** 宿主端 UpgradeEnvelope 的独立签名信任根，不得复用策略或发布信任根。 */
  upgradeTrustKeySet?: Record<string, string>;
  /** 下载升级制品的独立发布签名信任根。 */
  releaseTrustKeySet?: Record<string, string>;
  /** gateway 角色时注入的控制面中继公钥（hex ed25519）。 */
  relayClientPublicKeys?: string[];
  relayPort?: number;
  relayAllowedTargets?: string[];
  relayAllowedPorts?: number[];
}

const PINNED_WINDOWS_ARTIFACTS: Readonly<Record<'windows_go' | 'windows_compatibility', AgentInstallArtifactMaterial>> = Object.freeze({
  windows_go: Object.freeze({
    platform: 'windows_go',
    arch: 'amd64',
    artifactRef: 'artifact://gcac/agents/windows-go-full-agent/0.1.28/windows-amd64/gcac-agent.exe',
    version: '0.1.28',
    digest: '9ba263a588255318a0c7ee92a5a28913b148d26f35fb5a1a971125be85c0acc2',
    signature: 'artifact://gcac/signatures/agents/windows-go-full-agent/0.1.28/windows-amd64.sig',
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

const AGENT_UPGRADE_TRUST_KEYS_ENV = 'GCAC_AGENT_UPGRADE_TRUST_KEYS_JSON';
const AGENT_RELEASE_TRUST_KEYS_ENV = 'GCAC_AGENT_RELEASE_TRUST_KEYS_JSON';

function readAgentTrustKeySet(environmentName: string): Record<string, string> {
  const raw = process.env[environmentName]?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('CONFIGURATION_ERROR', `${environmentName} 必须是 JSON 对象`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('CONFIGURATION_ERROR', `${environmentName} 必须是 keyId 到 Ed25519 公钥的对象`);
  }
  const result: Record<string, string> = {};
  for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/.test(keyId) || typeof value !== 'string' || value.trim() === '') {
      throw new AppError('CONFIGURATION_ERROR', `${environmentName} 包含无效的 keyId 或公钥`);
    }
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
      throw new AppError('CONFIGURATION_ERROR', `${environmentName} 包含无效的 Ed25519 公钥`);
    }
    const decoded = Buffer.from(normalized, 'base64');
    if (decoded.length !== 32) throw new AppError('CONFIGURATION_ERROR', `${environmentName} 包含无效的 Ed25519 公钥`);
    result[keyId] = value.trim();
  }
  return result;
}

export class AgentsApplicationService {
  private readonly offlineTimeoutCounts = new Map<string, number>();
  private readonly activeUpgradeLocks = new Set<string>();
  private readonly localReleaseSync = new Map<string, Promise<void>>();
  private adcsRegistrationProvisioner?: (input: { tenantId: string; agentId: string; agentKey: string; name: string; caConfig?: string; pluginVersionId: string }) => Promise<void>;
  private certificateTaskResultHandler?: (input: {
    task: AgentTaskEnvelope;
    actionType: AgentV2ContractType;
    detail: Record<string, unknown>;
    status: AgentSecurityStatus;
    errorCode?: string;
    errorMessage?: string;
  }) => Promise<void>;
  private executionCompatibility?: Pick<ApplicationExecutionCompatibilityService, 'recheckAgent'>;
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
    private readonly agentManagementClient = new AgentManagementClient(),
  ) {}

  getModuleMetadata() {
    return createModuleMetadata('agents', '/api/v1/agents', '011');
  }

  setDiscoveryRequestFactory(factory?: AgentDiscoveryRequestFactory): void {
    this.discoveryRequestFactory = factory;
  }

  setTrustMaterialIssuer(issuer?: AgentTrustMaterialIssuer): void {
    this.trustMaterialIssuer = issuer;
  }

  setAdcsRegistrationProvisioner(provisioner?: AgentsApplicationService['adcsRegistrationProvisioner']): void {
    this.adcsRegistrationProvisioner = provisioner;
  }

  /** 注入证书生命周期回写，Agent 任务仍先按通用队列和 Receipt 合同落账。 */
  setCertificateTaskResultHandler(handler?: AgentsApplicationService['certificateTaskResultHandler']): void {
    this.certificateTaskResultHandler = handler;
  }

  setApplicationExecutionCompatibilityService(service?: Pick<ApplicationExecutionCompatibilityService, 'recheckAgent'>): void {
    this.executionCompatibility = service;
  }

  async createEnrollmentToken(tenantId: string, input: CreateEnrollmentTokenInput, requestId: string) {
    const created = this.domain.createEnrollmentToken(tenantId, input, requestId);
    const { token, ...stored } = created;
    await this.repository.createEnrollmentToken(stored);
    return { ...stored, token };
  }

  async register(tenantId: string, input: RegisterAgentInput, requestId: string) {
    let descriptor = this.domain.normalizeDescriptor(input);
    const isolateAdcsRegistration = input.role === 'adcs_agent' || descriptor.osType.toLowerCase() === 'windows_adcs';
    const existing = await this.resolveExistingRegistration(tenantId, descriptor.agentKey, descriptor.machineId, isolateAdcsRegistration);
    // Windows AD CS Agent 在启动阶段不能为了补全 CA 身份而阻塞心跳。
    // 安装器未提供 caConfig 时，保留同一 Agent 已经验证过的 CA 身份，空上报
    // 不得把有效绑定清空；显式提供的新值仍可正常更新。
    if (isolateAdcsRegistration && existing) {
      descriptor = {
        ...descriptor,
        caName: descriptor.caName || existing.descriptor.caName,
        caConfig: descriptor.caConfig || existing.descriptor.caConfig,
      };
    }
    const role = input.role ?? existing?.role ?? 'full_agent';
    const normalizedOsType = descriptor.osType.toLowerCase();
    if (normalizedOsType === 'windows_adcs' && role !== 'adcs_agent') {
      throw new AppError('VALIDATION_FAILED', 'Windows AD CS Agent 必须使用 adcs_agent 注册角色');
    }
    if (role === 'adcs_agent' && normalizedOsType !== 'windows_adcs') {
      throw new AppError('VALIDATION_FAILED', 'adcs_agent 只能注册到 windows_adcs 平台');
    }
    const gateway = this.domain.normalizeGatewayOnRegister({ ...input, role }, existing?.gateway);
    let enrollmentTokenId: string | undefined;
    if (input.enrollmentToken) {
      const token = await this.repository.findEnrollmentTokenByHash(tenantId, this.domain.hashEnrollmentToken(input.enrollmentToken));
      if (!token) throw new AppError('AUTH_FORBIDDEN', '注册令牌无效');
      const reusingOriginalEnrollment = existing?.enrollmentTokenId === token.id;
      if (reusingOriginalEnrollment) {
        if (token.status === 'revoked')
          throw new AppError('AUTH_FORBIDDEN', '注册令牌已撤销', {
            tokenId: token.id,
          });
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
      await this.provisionAdcsRegistration(tenantId, updated);
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
    await this.provisionAdcsRegistration(tenantId, registered);
    return this.withTrustMaterial(registered);
  }

  private async provisionAdcsRegistration(tenantId: string, agent: AgentRegistration): Promise<void> {
    if (!this.adcsRegistrationProvisioner || agent.role !== 'adcs_agent' || agent.descriptor.osType.toLowerCase() !== 'windows_adcs') return;
    try {
      await this.adcsRegistrationProvisioner({
        tenantId,
        agentId: agent.id,
        agentKey: agent.agentKey,
        name: agent.descriptor.caName || agent.descriptor.hostname || agent.agentKey,
        caConfig: agent.descriptor.caConfig,
        pluginVersionId: '',
      });
    } catch (error) {
      // Provider 自动登记失败不能回滚 Agent 注册；页面加载时的幂等补偿会再次尝试。
      structuredLogger.warn('AD CS Agent issuing backend provisioning failed', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'agents', tenantId, resourceType: 'agent', resourceId: agent.id });
    }
  }

  async heartbeat(tenantId: string, input: AgentHeartbeatInput, requestId: string) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const nextStatus = input.status ?? 'ONLINE';
    this.domain.assertStatusTransition(agent.status, nextStatus);
    const now = new Date().toISOString();
    const nextManagementEndpoint = input.managementEndpoint === undefined
      ? agent.descriptor.managementEndpoint
      : this.domain.normalizeManagementEndpoint(input.managementEndpoint);
    const compatibilityInputsChanged = agent.status !== nextStatus
      || agent.descriptor.version !== input.version
      || agent.descriptor.managementEndpoint !== nextManagementEndpoint;
    const gateway = this.domain.normalizeGatewayOnHeartbeat(agent, input, now);
    const updated = await this.repository.updateRegistration(agent.id, {
      status: nextStatus,
      descriptor: {
        ...agent.descriptor,
        version: input.version,
        managementEndpoint: input.managementEndpoint === undefined ? agent.descriptor.managementEndpoint : this.domain.normalizeManagementEndpoint(input.managementEndpoint),
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
    if (compatibilityInputsChanged) await this.refreshApplicationExecutionCompatibility(tenantId, agent.id);
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
    if (agent.status === 'DISABLED')
      throw new AppError('VALIDATION_FAILED', 'DISABLED Agent 不能签发新证书', {
        agentId: agent.id,
      });
    const csr = await this.repository.getCertificateSigningRequest(tenantId, input.csrId);
    if (!csr)
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent CSR 不存在', {
        csrId: input.csrId,
      });
    const ca = await this.ensureCertificateAuthority();
    const certificate = await this.repository.createCertificate(
      this.domain.issueCertificate({
        tenantId,
        agent,
        csr,
        ca,
        ttlDays: input.ttlDays,
        issuedBy: input.issuedBy,
      }),
    );
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
    const csr = await this.repository.createCertificateSigningRequest(
      this.domain.normalizeCertificateSigningRequest(
        tenantId,
        agent,
        {
          csrPem: input.csrPem,
          requestedTtlDays: input.ttlDays,
        },
        input.issuedBy,
        requestId,
      ),
    );
    const ca = await this.ensureCertificateAuthority();
    const certificate = await this.repository.createCertificate(
      this.domain.issueCertificate({
        tenantId,
        agent,
        csr,
        ca,
        ttlDays: input.ttlDays,
        issuedBy: input.issuedBy,
        rotatedFromCertificateId: previousCertificate?.id,
      }),
    );
    const signedCsr = await this.repository.updateCertificateSigningRequest(csr.id, {
      status: 'signed',
      signedCertificateId: certificate.id,
      signedAt: certificate.issuedAt,
    });
    const rotatedPrevious = previousCertificate
      ? await this.repository.updateCertificate(previousCertificate.id, {
          status: 'rotated',
        })
      : undefined;
    await this.repository.updateRegistration(agent.id, {
      certificateFingerprint: certificate.fingerprintSha256,
      certificateExpiresAt: certificate.notAfter,
      certificateRevoked: false,
      updatedAt: new Date().toISOString(),
    });
    return {
      csr: signedCsr,
      certificate,
      ca,
      previousCertificate: rotatedPrevious,
    };
  }

  async revokeCertificate(tenantId: string, input: RevokeAgentCertificateInput) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const certificate = await this.repository.getCertificate(tenantId, input.certificateId);
    if (!certificate || certificate.agentId !== agent.id)
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent 证书不存在', {
        certificateId: input.certificateId,
      });
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
        structuredLogger.error(
          'Agent capability discovery projection failed',
          {
            error: error instanceof Error ? error.message : String(error),
            snapshotId: snapshot.id,
          },
          {
            module: 'agents',
            tenantId,
            resourceType: 'agent',
            resourceId: agent.id,
          },
        );
      }
    }
    const gateway = this.domain.normalizeGatewayOnCapabilities(agent, input);
    const updated = gateway
      ? await this.repository.updateRegistration(agent.id, {
          gateway,
          updatedAt: new Date().toISOString(),
          lastRequestId: requestId,
        })
      : agent;
    await this.syncGatewayRegistry(tenantId, updated);
    await this.refreshApplicationExecutionCompatibility(tenantId, agent.id);
    return {
      agentId: agent.id,
      declarations: this.domain.toCapabilityDeclarations(updated, snapshot),
    };
  }

  async parseAgentRequestIdentity(token: string, request: { method: string; path: string }): Promise<{ actorId: string; tenantId: string } | undefined> {
    if (!isAgentMachineRoute(request.method, request.path)) return undefined;
    const normalizedToken = token.trim();
    if (!normalizedToken) return undefined;
    const enrollment = await this.repository.findEnrollmentTokenByHashAnyTenant(this.domain.hashEnrollmentToken(normalizedToken));
    if (!enrollment || enrollment.status === 'revoked') return undefined;
    return {
      actorId: `agent-token:${enrollment.id}`,
      tenantId: enrollment.tenantId,
    };
  }

  /**
   * 内置插件发现映射发生变化后，重放每个 Agent 的最新完整 Web 事实快照。
   *
   * 周期快照只有运行态，不能作为 Web 投影输入。只刷新插件注册表而不重放
   * 最后一次完整发现，会让历史 Web 投影继续占据设备详情。
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
      // 旧测试替身和第三方仓储实现可能尚未提供完整 Web 快照接口。
      // 正式 Pg 仓储始终优先使用完整 Web 快照；兼容回退只用于保持旧实现可运行。
      const fullSnapshotReader = (this.repository as AgentsRepository & {
        getLatestFullWebInventorySnapshot?: AgentsRepository['getLatestFullWebInventorySnapshot'];
      }).getLatestFullWebInventorySnapshot;
      const snapshot = fullSnapshotReader
        ? await fullSnapshotReader.call(this.repository, agent.tenantId, agent.id)
        : await this.repository.getLatestCapabilitySnapshot(agent.tenantId, agent.id);
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
        summary.failed.push({
          tenantId: agent.tenantId,
          agentId: agent.id,
          error: message,
        });
        structuredLogger.error(
          '内置插件刷新后的 Agent 发现重投影失败',
          {
            agentId: agent.id,
            snapshotId: snapshot.id,
            errorMessage: message,
          },
          {
            tenantId: agent.tenantId,
            module: 'agents',
            resourceType: 'agent',
            resourceId: agent.id,
          },
        );
      }
    }

    return summary;
  }

  async enqueueTask(tenantId: string, input: EnqueueAgentTaskInput, requestId: string, livenessMode: 'full' | 'management' = 'full'): Promise<AgentTaskEnvelope> {
    assertSupportedAgentTaskPayload(input.payload ?? {});
    await this.requireTaskAgent(tenantId, input.agentId);
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
    return this.liveness.probeAgentManagementEndpoint({
      tenantId,
      agentId,
      timeoutMs,
    });
  }

  async refreshStandardDiscovery(
    tenantId: string,
    agentId: string,
    requestedBy: string,
    requestId: string,
  ): Promise<{
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
    const directRequest = await this.discoveryRequestFactory.createForAgent({
      tenantId,
      agent,
      requestedBy,
      requestId,
    });
    const response = await this.directAgentClient.refreshWebInventory(agent, directRequest);
    const snapshot = await this.repository.getLatestFullWebInventorySnapshot(tenantId, agentId);
    return {
      mode: 'direct',
      requestId: directRequest.requestId,
      capabilitySnapshotId: snapshot?.id,
      detail: response.detail,
    };
  }

  /**
   * 为需要通用主机事实的宿主流程生成完整 Agent v2 事实采集载荷。
   * 证书信任检查复用这条授权链，不得自行拼装 factKinds 等未注册字段。
   */
  async createFactCollectionRequest(tenantId: string, agentId: string, requestedBy: string, requestId: string): Promise<{ requestId: string; payload: Record<string, unknown> }> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (!this.discoveryRequestFactory) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'Agent 事实采集请求工厂未配置，拒绝生成未授权载荷');
    }
    return this.discoveryRequestFactory.createForAgent({
      tenantId,
      agent,
      requestedBy,
      requestId,
      refreshWebInventory: false,
    });
  }

  async findTaskByIdempotencyKey(tenantId: string, agentId: string, idempotencyKey: string): Promise<AgentTaskEnvelope | undefined> {
    await this.requireTaskAgent(tenantId, agentId);
    return this.repository.findTaskByIdempotencyKey(tenantId, agentId, idempotencyKey);
  }

  async pullTasks(tenantId: string, agentId: string, limit = 10): Promise<AgentTaskEnvelope[]> {
    const agent = await this.requireTaskAgent(tenantId, agentId);
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
    await this.requireTaskAgent(tenantId, input.agentId);
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
    throw new AppError('VALIDATION_FAILED', '任务状态不允许 ack', {
      taskId: task.id,
      status: task.status,
    });
  }

  async submitResult(tenantId: string, input: SubmitAgentTaskResultInput): Promise<AgentTaskEnvelope> {
    await this.requireTaskAgent(tenantId, input.agentId);
    const task = await this.requireTask(tenantId, input.agentId, input.taskId);
    if (task.leaseId !== input.leaseId)
      throw new AppError('IDEMPOTENCY_CONFLICT', '任务结果 leaseId 不匹配', {
        taskId: task.id,
      });
    const rawDetail = input.detail ?? {};
    const actionType = resolveAgentTaskActionType(task.payload);
    // Receipt 摘要覆盖 tokenId 等绑定标识，必须先按原始合同验证，再执行日志脱敏。
    const validatedReceipt = validateQueuedAgentV2Receipt(task, rawDetail, task.tenantId, input.status, input.success, input.errorCode);
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
      throw new AppError('VALIDATION_FAILED', '只有已 ack 的任务能提交结果', {
        taskId: task.id,
        status: task.status,
      });
    }
    const sanitizedAgentDetail = this.domain.sanitizeResultDetail(rawDetail);
    const submittedOutcome = resolveAgentTaskOutcome(input, sanitizedAgentDetail);
    assertAgentTaskResultConsistency(input.success, submittedOutcome);
    const pluginFactBinding = resolvePluginFactBinding(task, actionType);
    const pluginFactResult = pluginFactBinding && input.success ? await this.executePluginFactPipeline(task, rawDetail, pluginFactBinding) : undefined;
    const success = input.success && (!pluginFactResult || pluginFactResult.status === 'SUCCESS');
    const outcome = pluginFactResult ? resolvePluginFactTaskOutcome(pluginFactResult) : submittedOutcome;
    const errorCode = input.errorCode ?? pluginFactResult?.error?.code;
    const errorMessage = input.errorMessage ?? pluginFactResult?.error?.message;
    const resultDetail = pluginFactResult
      ? {
          ...rawDetail,
          pluginFactPipeline: serializePluginFactPipelineResult(pluginFactResult),
        }
      : rawDetail;
    const sanitizedDetail = this.domain.sanitizeResultDetail(resultDetail);
    console.info(
      '[agents.submitResult]',
      JSON.stringify({
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
          firstFailedCheck: Array.isArray(sanitizedDetail.dryRunChecks) ? sanitizedDetail.dryRunChecks.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'failed') : undefined,
        },
      }),
    );
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
    if (this.certificateTaskResultHandler && actionType && ['certificate.key.custody', 'certificate.key.custody.v1'].includes(String(task.payload.capability))) {
      try {
        await this.certificateTaskResultHandler({
          task: updated,
          actionType,
          detail: sanitizedDetail,
          status: outcome,
          ...(errorCode ? { errorCode } : {}),
          ...(errorMessage ? { errorMessage } : {}),
        });
      } catch (error) {
        // 任务结果已经落账；回写失败必须保留告警，不能让 Agent 因重试而重复执行不可逆操作。
        structuredLogger.error('证书 Agent 任务结果已落账，但生命周期回写失败', {
          tenantId: task.tenantId,
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        }, { module: 'agents.certificate-lifecycle' });
      }
    }
    if (this.executionResultSync) {
      console.info(
        '[agents.submitResult.sync]',
        JSON.stringify({
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
            firstFailedCheck: Array.isArray(sanitizedDetail.dryRunChecks) ? sanitizedDetail.dryRunChecks.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'failed') : undefined,
          },
        }),
      );
      try {
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
      } catch (error) {
        // Agent 结果已经落账后，执行投影失败不能让 Agent 无限重传同一份写操作结果。
        // 记录完整的请求上下文供控制面恢复任务处理，HTTP 层仍返回已落账任务。
        structuredLogger.error('Agent 任务结果已落账，但执行状态同步失败', {
          tenantId: task.tenantId,
          taskId: task.id,
          executionRunId: task.executionRunId,
          executionStepId: task.executionStepId,
          error: error instanceof Error ? error.message : String(error),
        }, { module: 'agents.submitResult' });
      }
    }
    if (success && task.payload?.actionType === 'agent.fact.collect' && task.payload?.refreshWebInventory === true) {
      await this.projectLatestCapabilitySnapshot(task.tenantId, task.agentId);
    }
    return updated;
  }

  private async executePluginFactPipeline(task: AgentTaskEnvelope, rawDetail: Record<string, unknown>, binding: PluginFactBindingV1): Promise<PluginFactPipelineResult> {
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
    const snapshot = await this.repository.getLatestFullWebInventorySnapshot(tenantId, agentId);
    if (!snapshot) return;
    try {
      const agent = await this.requireAgent(tenantId, agentId);
      await this.capabilityDiscoveryProjector.project(agent, snapshot);
    } catch (error) {
      structuredLogger.error(
        'Agent 能力重扫完成后的标准发现投影失败',
        {
          agentId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        {
          tenantId,
          module: 'agents',
          resourceType: 'agent',
          resourceId: agentId,
        },
      );
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
    return {
      ...entry,
      ackedSequence: result.ackedSequence,
      lastAckedSequence: result.lastAckedSequence,
    };
  }

  async submitRuntimeLog(tenantId: string, input: SubmitAgentRuntimeLogInput, requestId: string) {
    await this.requireAgent(tenantId, input.agentId);
    return this.repository.saveRuntimeLog(this.domain.normalizeRuntimeLog(tenantId, input, requestId));
  }

  async submitLogs(tenantId: string, input: SubmitAgentTaskLogsInput, requestId: string): Promise<AgentTaskLogAckResult> {
    await this.requireTaskAgent(tenantId, input.agentId);
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

    const allSequences = existingLogs.filter((item) => item.agentId === input.agentId).map((item) => item.sequence);
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
    return (
      (await this.repository.getTaskLogCursor(tenantId, agentId, taskId)) ?? {
        tenantId,
        agentId,
        taskId,
        lastAckedSequence: 0,
        updatedAt: undefined,
      }
    );
  }

  async publishVersion(tenantId: string, input: PublishAgentVersionInput) {
    return this.repository.publishVersion(this.domain.normalizeRelease(tenantId, input));
  }

  /**
   * 返回控制面托管的本地 Agent 制品。路径只由已登记 Release 的产品线和架构映射，
   * 不接受请求方传入任意文件路径；每次下载前重新核对大小和摘要，避免构建目录被替换后继续分发旧登记。
   */
  async getReleaseArtifact(releaseId: string): Promise<{ release: AgentVersionRelease; content: Buffer }> {
    const release = await this.repository.getVersion(releaseId);
    if (!release || release.status !== 'active') {
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent Release 不存在或已不可用', { releaseId });
    }
    const productLine = resolveGoFullProductLine(release.platform, release.productLine);
    if (!productLine) {
      throw new AppError('RESOURCE_NOT_FOUND', '该 Agent Release 未启用控制面下载', { releaseId });
    }
    const architecture = normalizeAgentArchitecture(release.arch);
    const artifactPath = resolveGoFullArtifactPath(productLine, architecture);
    if (!artifactPath || !existsSync(artifactPath)) {
      throw new AppError('RESOURCE_NOT_FOUND', '本地 Agent 制品不存在，请先完成构建', { releaseId, architecture: release.arch });
    }
    const content = await readFile(artifactPath);
    const digest = createHash('sha256').update(content).digest('hex');
    if (content.length !== release.artifactSize || digest !== release.checksumSha256) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '本地 Agent 制品与 Release 摘要不一致', {
        releaseId,
        expectedSize: release.artifactSize,
        actualSize: content.length,
        expectedSha256: release.checksumSha256,
        actualSha256: digest,
      });
    }
    return { release, content };
  }

  async checkUpgrade(tenantId: string, input: CheckAgentUpgradeInput): Promise<AgentUpgradePlan | { status: 'not_required'; reason: string }> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    const releases = await this.listActiveVersions(tenantId);
    const release = selectUpgradeRelease(agent, releases, input);
    if (!release)
      return {
        status: 'not_required',
        reason: '没有匹配平台、架构或目标版本的升级版本',
      };
    if (release.version === agent.descriptor.version) return { status: 'not_required', reason: 'Agent 已是目标版本' };
    const idempotencyKey = input.idempotencyKey?.trim() || `agent-upgrade:${agent.id}:${release.id}`;
    const existingByKey = await this.repository.findUpgradePlanByIdempotencyKey?.(tenantId, agent.id, idempotencyKey);
    if (existingByKey) return existingByKey;
    const existing = await this.repository.findUpgradePlanForAgent(tenantId, agent.id, release.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.repository.createUpgradePlan({
      id: newId('agup'),
      transactionId: newId('agtxn'),
      tenantId,
      agentId: agent.id,
      releaseId: release.id,
      releaseDigest: release.checksumSha256,
      currentVersion: agent.descriptor.version,
      targetVersion: release.version,
      idempotencyKey,
      attempt: 0,
      status: 'planned',
      reason: '发现可用升级版本，等待宿主端确认',
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * 发送同一 UpgradePlan 的唯一 Envelope。传输成功只会进入 accepted，不能把 HTTP
   * 200 或 Agent 已接受误记为最终 succeeded。
   */
  async dispatchUpgrade(
    tenantId: string,
    input: DispatchAgentUpgradeInput,
    actorId: string,
    requestId: string,
    installPublicBaseUrl?: string,
  ): Promise<AgentUpgradePlan> {
    const agent = await this.requireAgent(tenantId, input.agentId);
    if (!isGoFullAgent(agent)) throw new AppError('VALIDATION_FAILED', '当前接口只支持 Windows/Linux Go Full Agent 升级', { reason: 'PRODUCT_LINE_UNSUPPORTED' });
    const plan = await this.repository.getUpgradePlan(tenantId, input.planId);
    if (!plan || plan.agentId !== agent.id)
      throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', {
        planId: input.planId,
      });
    if (['succeeded', 'failed', 'rolled_back', 'rejected', 'manual_required'].includes(plan.status)) return plan;
    const existingPlans = (await this.repository.listUpgradePlansForAgent?.(tenantId, agent.id)) ?? [];
    const activePlan = existingPlans.find((item) => item.id !== plan.id && ['approved', 'dispatching', 'accepted', 'running', 'retrying', 'unknown'].includes(item.status));
    if (activePlan)
      throw new AppError('RESOURCE_VERSION_CONFLICT', '同一 Agent 已有活动升级事务', {
        agentId: agent.id,
        planId: activePlan.id,
        reason: 'UPGRADE_CONFLICT',
      });
    const lockKey = `${tenantId}:${agent.id}`;
    if (this.activeUpgradeLocks.has(lockKey)) throw new AppError('RESOURCE_VERSION_CONFLICT', '同一 Agent 已有升级请求正在发送', { agentId: agent.id, reason: 'UPGRADE_CONFLICT' });
    this.activeUpgradeLocks.add(lockKey);
    try {
      const releases = await this.listActiveVersions(tenantId);
      const release = releases.find((item) => item.id === plan.releaseId);
      if (!release) throw new AppError('RESOURCE_NOT_FOUND', '升级计划绑定的 Release 不存在或已不可用', { releaseId: plan.releaseId });
      assertGoFullRelease(agent, release, plan.targetVersion);
      const transactionId = plan.transactionId || newId('agtxn');
      const attempt = (plan.attempt ?? 0) + 1;
      const dispatching = await this.repository.updateUpgradePlan(plan.id, {
        transactionId,
        actorId,
        approvalRef: input.approvalRef ?? plan.approvalRef,
        policyRef: input.policyRef ?? plan.policyRef ?? 'gcac.agent.upgrade',
        attempt,
        status: 'dispatching',
        reason: '正在通过 Agent 管理端点发送升级授权',
        result: plan.result,
        updatedAt: new Date().toISOString(),
      });
      let envelope: AgentUpgradeEnvelope;
      try {
        const upgradeBootstrapUrl = resolveGoFullProductLine(agent.descriptor.osType) === linuxGoProductLine
          ? (await this.createLinuxUpgradeBootstrap(agent, dispatching, requestId, release, installPublicBaseUrl)).bootstrapUrl
          : resolveGoFullProductLine(agent.descriptor.osType) === windowsGoProductLine
            ? (await this.createWindowsUpgradeBootstrap(agent, dispatching, requestId, release, installPublicBaseUrl)).bootstrapUrl
            : undefined;
        envelope = buildGoFullUpgradeEnvelope(agent, dispatching, release, requestId, upgradeBootstrapUrl);
      } catch (error) {
        await this.repository.updateUpgradePlan(plan.id, {
          status: 'rejected',
          reason: safeErrorMessage(error),
          result: {
            requestId,
            transport: 'not_sent',
            errorCode: readAppErrorCode(error),
            errorMessage: safeErrorMessage(error),
          },
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
      let response: AgentManagementResponse;
      try {
        response = await this.agentManagementClient.dispatchUpgrade(agent, envelope);
      } catch (error) {
        await this.repository.updateUpgradePlan(plan.id, {
          status: 'transport_failed',
          reason: 'Agent 管理端点传输失败，未确认本地副作用',
          result: {
            requestId,
            transport: 'failed',
            errorCode: readAppErrorCode(error),
            errorMessage: safeErrorMessage(error),
          },
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
      const accepted = response.accepted === true || response.success === true || response.status === 'accepted';
      // 先完成 Agent 授权，再创建状态轮询任务。否则 Worker 可能在授权请求到达前
      // 读取 Agent 磁盘中的上一笔 status.json，并将旧事务误判为本次事务的结果。
      let globalTask: Awaited<ReturnType<AgentsApplicationService['enqueueUpgradeTask']>>;
      if (accepted) {
        try {
          globalTask = await this.enqueueUpgradeTask({
            tenantId,
            agent,
            plan: dispatching,
            actorId,
            transactionId,
            attempt,
          });
        } catch (error) {
          structuredLogger.error('Agent 升级已接受但轮询任务入队失败', {
            tenantId,
            agentId: agent.id,
            planId: plan.id,
            transactionId,
            error: safeErrorMessage(error),
          }, { module: 'agents', resourceType: 'agent_upgrade', resourceId: plan.id });
        }
      }
      return this.repository.updateUpgradePlan(plan.id, {
        status: accepted ? 'accepted' : 'rejected',
        reason: accepted ? 'Agent 已接受升级事务，等待本地 Receipt' : response.errorMessage || 'Agent 拒绝升级事务',
        result: {
          requestId,
          transport: accepted ? 'accepted' : 'rejected',
          accepted,
          status: response.status,
          transactionId,
          actualTransactionId: response.transactionId,
          ...(globalTask ? { taskId: globalTask.id } : {}),
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        },
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.activeUpgradeLocks.delete(lockKey);
    }
  }

  /**
   * Linux 升级复用正式 bootstrap 安装入口。
   * 该入口会先安装新的 service unit，再执行重启，因此脚本不会被旧 Agent 的
   * systemd cgroup 清理；同一 agentKey 会让注册流程更新原设备，而不是创建新设备。
   */
  private async createLinuxUpgradeBootstrap(
    agent: AgentRegistration,
    plan: AgentUpgradePlan,
    requestId: string,
    release: AgentVersionRelease,
    installPublicBaseUrl?: string,
  ): Promise<AgentInstallSessionBootstrapProjection> {
    const releaseUrl = new URL(release.downloadUrl);
    const controlPlaneUrl = resolveUpgradeControlPlaneUrl(installPublicBaseUrl, releaseUrl);
    const session = await this.createAgentInstallSession(
      plan.tenantId,
      {
        platform: 'linux_go',
        role: 'full_agent',
        zone: agent.zone ?? 'default',
        agentKey: agent.agentKey,
        serviceName: 'gcac-linux-agent',
        displayName: agent.descriptor.hostname || 'GCAC Linux Go Full Agent',
        installRoot: '/opt/gcac/linux-agent',
        configDir: '/etc/gcac/linux-agent',
        dataDir: '/var/lib/gcac/linux-agent',
        logDir: '/var/log/gcac/linux-agent',
        startAfterInstall: true,
      },
      requestId,
      controlPlaneUrl,
    );
    return session;
  }

  /**
   * Windows 升级复用正式 PowerShell bootstrap 安装入口，确保 Agent、升级器和
   * Agent-side 发现插件始终来自同一套构建产物；同一 agentKey 会更新原设备。
   */
  private async createWindowsUpgradeBootstrap(
    agent: AgentRegistration,
    plan: AgentUpgradePlan,
    requestId: string,
    release: AgentVersionRelease,
    installPublicBaseUrl?: string,
  ): Promise<AgentInstallSessionBootstrapProjection> {
    const releaseUrl = new URL(release.downloadUrl);
    const controlPlaneUrl = resolveUpgradeControlPlaneUrl(installPublicBaseUrl, releaseUrl);
    return this.createAgentInstallSession(
      plan.tenantId,
      {
        platform: 'windows_go',
        role: 'full_agent',
        zone: agent.zone ?? 'default',
        agentKey: agent.agentKey,
        serviceName: `gcac-agent-${agent.id.slice(-6).toLowerCase()}`,
        displayName: agent.descriptor.hostname || 'GCAC Windows Go Full Agent',
        installRoot: 'C:\\Program Files\\GCAC\\FullAgentGo',
        configDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\config',
        dataDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\data',
        logDir: 'C:\\ProgramData\\GCAC\\FullAgentGo\\logs',
        startAfterInstall: true,
      },
      requestId,
      controlPlaneUrl,
    );
  }

  /** 中文说明：统一任务只负责观察已经确认的 UpgradePlan，升级授权仍由本次用户确认请求发送。 */
  private async enqueueUpgradeTask(input: {
    tenantId: string;
    agent: AgentRegistration;
    plan: AgentUpgradePlan;
    actorId: string;
    transactionId: string;
    attempt: number;
  }) {
    if (!this.tasks) return undefined;
    const displayName = input.agent.descriptor.hostname || input.agent.agentKey || input.agent.id;
    const summary = {
      resourceType: 'agent',
      resourceId: input.agent.id,
      displayName,
      agentId: input.agent.id,
      currentVersion: input.plan.currentVersion ?? input.agent.descriptor.version,
      targetVersion: input.plan.targetVersion,
      releaseId: input.plan.releaseId,
      planId: input.plan.id,
      transactionId: input.transactionId,
      phase: 'queued',
      summaryCode: 'queued',
    };
    return this.tasks.enqueue({
      tenantId: input.tenantId,
      taskType: 'AGENT_UPDATE',
      requestedBy: input.actorId,
      triggerSource: 'agent-upgrade-confirmed',
      idempotencyKey: `agent-upgrade:${input.plan.id}:attempt:${input.attempt}`,
      idempotencyScope: {
        actionType: 'agent.update',
        resourceType: 'agent',
        resourceId: input.agent.id,
      },
      payload: {
        agentId: input.agent.id,
        planId: input.plan.id,
        releaseId: input.plan.releaseId,
        transactionId: input.transactionId,
        currentVersion: input.plan.currentVersion ?? input.agent.descriptor.version,
        targetVersion: input.plan.targetVersion,
        attempt: input.attempt,
      },
      resourceSummary: summary,
      initialProgress: summary,
      resourceRefs: [{ resourceType: 'agent', resourceId: input.agent.id, displayKey: 'agents.page.title' }],
    });
  }

  async getUpgradeStatus(tenantId: string, agentId: string, planId: string): Promise<AgentUpgradePlan> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (!isGoFullAgent(agent)) throw new AppError('VALIDATION_FAILED', '当前接口只支持 Windows/Linux Go Full Agent 升级', { reason: 'PRODUCT_LINE_UNSUPPORTED' });
    const plan = await this.repository.getUpgradePlan(tenantId, planId);
    if (!plan || plan.agentId !== agent.id) throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', { planId });
    if (['succeeded', 'failed', 'rolled_back', 'rejected', 'unknown', 'manual_required', 'transport_failed'].includes(plan.status)) return plan;
    if (!plan.transactionId) return plan;
    let status: Awaited<ReturnType<AgentManagementClient['getUpgradeStatus']>>;
    try {
      status = await this.agentManagementClient.getUpgradeStatus(agent, plan.transactionId);
    } catch (error) {
      if (!isUpgradeTransactionIdentityMismatch(error)) throw error;
      const errorMessage = 'Agent 返回了不匹配的升级事务，副作用结果无法确认，已停止自动重试';
      const mismatchDetails = readRecord(error instanceof AppError ? error.details : undefined);
      return this.repository.updateUpgradePlan(plan.id, {
        status: 'unknown',
        reason: errorMessage,
        result: {
          ...plan.result,
          receipt: {
            ...readRecord(plan.result?.receipt),
            phase: 'unknown',
            status: 'unknown',
            transactionId: plan.transactionId,
            actualTransactionId: readStringValue(mismatchDetails.actualTransactionId),
            errorCode: 'AGENT_UPGRADE_RESULT_UNKNOWN',
            errorMessage,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    }
    if (isStaleUpgradeHelperStatus(status)) {
      const errorMessage = 'Agent 升级 helper 已超时且结果无法确认，已停止自动重试';
      return this.repository.updateUpgradePlan(plan.id, {
        status: 'unknown',
        reason: errorMessage,
        result: {
          ...plan.result,
          receipt: {
            ...readRecord(plan.result?.receipt),
            ...status,
            phase: 'unknown',
            status: 'unknown',
            errorCode: 'AGENT_UPGRADE_HELPER_TIMEOUT',
            errorMessage,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    }
    const mapped = mapAgentUpgradeStatus(status.status);
    if (!mapped) return plan;
    return this.repository.updateUpgradePlan(plan.id, {
      status: mapped,
      reason: status.errorMessage || `Agent 本地升级阶段：${status.phase ?? 'unknown'}`,
      result: { ...plan.result, receipt: status },
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * 中文说明：全局任务被强制结束不等于远端 Agent 已停止。将计划标记为人工处置，
   * 阻止 Worker 继续轮询，也避免控制面把未确认的远端结果当成可再次派发的活动计划。
   */
  async markUpgradeManualRequired(
    tenantId: string,
    agentId: string,
    planId: string,
    actorId: string,
    reason?: string,
  ): Promise<AgentUpgradePlan> {
    const plan = await this.repository.getUpgradePlan(tenantId, planId);
    if (!plan || plan.agentId !== agentId) throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', { planId });
    if (['succeeded', 'failed', 'rolled_back', 'rejected', 'unknown', 'manual_required'].includes(plan.status)) return plan;
    return this.repository.updateUpgradePlan(plan.id, {
      status: 'manual_required',
      actorId,
      reason: reason?.trim() || '全局任务已强制结束，远端升级结果需要人工确认',
      result: {
        ...plan.result,
        taskCancelled: true,
        taskCancelReason: reason?.trim() || '全局任务已强制结束',
      },
      updatedAt: new Date().toISOString(),
    });
  }

  async submitUpgradeResult(tenantId: string, input: SubmitAgentUpgradeResultInput) {
    await this.requireAgent(tenantId, input.agentId);
    const plan = await this.repository.getUpgradePlan(tenantId, input.planId);
    if (!plan || plan.agentId !== input.agentId)
      throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', {
        planId: input.planId,
      });
    if (plan.transactionId && input.planId !== plan.id)
      throw new AppError('VALIDATION_FAILED', '升级回执计划身份不匹配', {
        planId: input.planId,
      });
    return this.repository.updateUpgradePlan(plan.id, {
      status: input.success ? 'succeeded' : input.rolledBack ? 'rolled_back' : 'failed',
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
      gateway: agent.gateway
        ? {
            ...agent.gateway,
            status: input.revokeCertificate ? 'revoked' : 'disabled',
          }
        : undefined,
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
    await this.refreshApplicationExecutionCompatibility(tenantId, agent.id);
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
    await this.refreshApplicationExecutionCompatibility(tenantId, agent.id);
    return updated;
  }

  async deleteAgent(tenantId: string, input: DeleteAgentInput) {
    const agent = await this.requireAgent(tenantId, input.agentId);
    await this.repository.deleteRegistration(agent.id);
    await this.refreshApplicationExecutionCompatibility(tenantId, agent.id);
    return { deleted: true, agentId: agent.id };
  }

  private async refreshApplicationExecutionCompatibility(tenantId: string, agentId: string): Promise<void> {
    try {
      await this.executionCompatibility?.recheckAgent(tenantId, agentId);
    } catch (error) {
      // 兼容性重检失败不能阻断 Agent 心跳、能力上报或禁用操作；下一次执行前仍会再次门禁复检。
      structuredLogger.warn('应用执行兼容性重检失败', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'agents', tenantId, resourceType: 'agent', resourceId: agentId });
    }
  }

  async createAgentInstallSession(tenantId: string, input: CreateAgentInstallSessionInput, requestId: string, baseUrl: string): Promise<AgentInstallSessionBootstrapProjection> {
    if (input.platform === 'windows_go') await ensureWindowsGoBundleAvailable();
    if (input.platform === 'windows_compatibility') await ensureWindowsCompatibilityBundleAvailable();
    if (input.platform === 'windows_adcs') await ensureWindowsAdcsBundleAvailable();
    if (input.platform === 'linux_go') buildLinuxAgentBundleTarGz();
    const session = this.domain.createAgentInstallSession(tenantId, input, requestId, baseUrl);
    const { bootstrapToken, enrollmentTokenRecord, ...stored } = session;
    await this.repository.createEnrollmentToken(enrollmentTokenRecord);
    await this.repository.createInstallSession(stored);
    const encodedToken = encodeURIComponent(bootstrapToken);
    const route = installRouteForPlatform(stored.platform);
    const bootstrapUrl = `${stored.controlPlaneUrl}${route}?token=${encodedToken}`;
    const installCommand = installCommandForPlatform(stored.platform, bootstrapUrl, stored.platformFamily);
    const agentVersion = stored.platform === 'windows_adcs_service' ? await readWindowsAdcsAgentVersion() : undefined;
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
      managementPort: stored.managementPort ?? managementPortForInstallPlatform(stored.platform),
      ...(agentVersion ? { agentVersion } : {}),
      agentKey: stored.agentKey,
      zone: stored.zone,
      enrollmentTokenPreview: enrollmentTokenRecord.tokenPreview,
      role: stored.role,
      platformFamily: stored.platformFamily,
      relayAllowedTargets: stored.relayAllowedTargets,
      relayAllowedPorts: stored.relayAllowedPorts,
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

  async buildWindowsInstallManifest(session: AgentInstallSession, baseUrl = session.controlPlaneUrl, bootstrapToken?: string): Promise<AgentInstallSessionManifest> {
    requireInstallPlatform(session.platform, WINDOWS_INSTALL_PLATFORMS, '安装会话不是 Windows 平台');
    await this.trustMaterialIssuer?.refreshTrustedKeySet?.();
    const agentVersion = session.platform === 'windows_adcs_service' ? await readWindowsAdcsAgentVersion() : undefined;
    return {
      ...this.baseInstallManifest(session, baseUrl),
      ...(agentVersion ? { agentVersion } : {}),
      artifacts: session.role === 'gateway' ? await loadGatewayWindowsAgentArtifacts() : await WINDOWS_ARTIFACT_LOADERS[session.platform](),
      ...(isWindowsGoRuntimeInstallPlatform(session.platform) && this.trustMaterialIssuer
        ? {
            authorizationTrustKeySet: this.trustMaterialIssuer.getTrustedKeySet(),
          }
        : {}),
      ...(isWindowsGoRuntimeInstallPlatform(session.platform)
        ? {
            upgradeTrustKeySet: readAgentTrustKeySet(AGENT_UPGRADE_TRUST_KEYS_ENV),
            releaseTrustKeySet: readAgentTrustKeySet(AGENT_RELEASE_TRUST_KEYS_ENV),
          }
        : {}),
      ...(session.role === 'gateway' ? await this.relayInstallManifest() : {}),
    };
  }

  async buildLinuxGoInstallManifest(session: AgentInstallSession, baseUrl = session.controlPlaneUrl): Promise<AgentInstallSessionManifest> {
    requireInstallPlatform(session.platform, ['linux_go_systemd'], '安装会话不是 Linux Go 平台');
    await this.trustMaterialIssuer?.refreshTrustedKeySet?.();
    if (session.role === 'gateway') {
      return {
        ...this.baseInstallManifest(session, baseUrl),
        gatewayBundleUrl: `${baseUrl}/api/v1/agents/install/gateway/bundle.tar.gz`,
        gatewayBundleManifest: getGatewayAgentBundleManifest(),
        ...(this.trustMaterialIssuer
          ? {
              authorizationTrustKeySet: this.trustMaterialIssuer.getTrustedKeySet(),
            }
          : {}),
        ...(await this.relayInstallManifest()),
      };
    }
    return {
      ...this.baseInstallManifest(session, baseUrl),
      bundleUrl: `${baseUrl}/api/v1/agents/install/linux/bundle.tar.gz`,
      bundleManifest: getLinuxAgentBundleManifest(LINUX_AGENT_RELEASE_VERSION),
      ...(this.trustMaterialIssuer
        ? {
            authorizationTrustKeySet: this.trustMaterialIssuer.getTrustedKeySet(),
          }
        : {}),
      upgradeTrustKeySet: readAgentTrustKeySet(AGENT_UPGRADE_TRUST_KEYS_ENV),
      releaseTrustKeySet: readAgentTrustKeySet(AGENT_RELEASE_TRUST_KEYS_ENV),
    };
  }

  /** gateway 角色安装时附带控制面中继身份：公钥注入 Agent 配置，私钥只留在控制面。 */
  private async relayInstallManifest(): Promise<{
    relayClientPublicKeys: string[];
    relayPort: number;
  }> {
    const identity = await loadOrCreateGatewayRelayIdentity();
    return {
      relayClientPublicKeys: [identity.publicKeyHex],
      relayPort: GATEWAY_RELAY_DEFAULT_PORT,
    };
  }

  buildLinuxBundleTarGz(): Buffer {
    return buildLinuxAgentBundleTarGz();
  }

  buildGatewayLinuxBundleTarGz(): Buffer {
    return buildGatewayAgentBundleTarGz();
  }

  async createAgentInstallMaterials(tenantId: string, input: AgentInstallMaterialRequest, requestId: string): Promise<AgentInstallMaterialProjection> {
    const descriptor = this.createInstallDescriptor(tenantId, input, requestId);
    const { token: enrollmentToken, ...enrollmentTokenRecord } = descriptor.enrollmentTokenRecord;
    await this.repository.createEnrollmentToken(enrollmentTokenRecord);

    const material = this.getPinnedInstallArtifact(input.platform, descriptor.role);
    const relayManifest = descriptor.role === 'gateway' ? await this.relayInstallManifest() : undefined;
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
        ...(relayManifest
          ? {
              relayEnabled: true,
              relayListenAddress: '0.0.0.0',
              relayPort: relayManifest.relayPort,
              relayClientPublicKeys: relayManifest.relayClientPublicKeys,
              relayIdleTimeoutSeconds: 300,
              relayAllowedTargets: descriptor.relayAllowedTargets,
              relayAllowedPorts: descriptor.relayAllowedPorts,
            }
          : {}),
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
      role: descriptor.role,
      zone: descriptor.zone,
      relayAllowedTargets: descriptor.relayAllowedTargets,
      relayAllowedPorts: descriptor.relayAllowedPorts,
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
      managementPort: session.managementPort ?? managementPortForInstallPlatform(session.platform),
      role: session.role,
      platformFamily: session.platformFamily,
      startAfterInstall: session.startAfterInstall,
      // 安装入口可能经由前端开发端口（5172）暴露；Agent 的注册、心跳和
      // 任务接口必须直连控制面端口，不能把前端代理地址写入配置。
      controlPlaneUrl: resolveAgentControlPlaneUrl(baseUrl),
      agentKey: session.agentKey,
      tenantId: session.tenantId,
      enrollmentToken: session.enrollmentToken,
      zone: session.zone,
      relayAllowedTargets: session.relayAllowedTargets,
      relayAllowedPorts: session.relayAllowedPorts,
    };
  }

  private async withTrustMaterial(agent: AgentRegistration): Promise<AgentRegistration & { trustMaterial?: unknown }> {
    const osType = agent.descriptor.osType.toLowerCase();
    if (!this.trustMaterialIssuer || !isTrustedAgentOsType(osType)) return agent;
    return {
      ...agent,
      trustMaterial: await this.trustMaterialIssuer.issue({
        tenantId: agent.tenantId,
        agentId: agent.id,
        osType: agent.descriptor.osType,
      }),
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
    const relayPolicy = this.domain.normalizeRelayPolicy(role, input.relayAllowedTargets, input.relayAllowedPorts);
    const profile = installMaterialProfile(input.platform, role);
    const enrollmentTokenRecord = this.domain.createEnrollmentToken(
      tenantId,
      {
        allowedRoles: [role],
        allowedZones: [zone],
        maxUses: 1,
        ttlSeconds: 1800,
        createdBy: 'agent.install-materials',
      },
      requestId,
    );
    return {
      id,
      role,
      zone,
      agentKey,
      enrollmentTokenRecord,
      expiresAt: enrollmentTokenRecord.expiresAt,
      ...relayPolicy,
      ...profile,
    };
  }

  private getPinnedInstallArtifact(platform: AgentInstallMaterialPlatform, role: 'full_agent' | 'gateway'): AgentInstallArtifactMaterial {
    if (role === 'gateway') {
      if (platform === 'windows_compatibility') {
        throw new AppError('VALIDATION_FAILED', 'Windows Compatibility Agent 只允许 full_agent 角色');
      }
      return getGatewayAgentInstallMaterials(platform === 'linux_go' ? 'linux_go' : 'windows_go', 'amd64');
    }
    if (platform === 'linux_go') {
      const artifact = getLinuxAgentInstallMaterials()[0];
      if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', 'Linux Agent 安装 Artifact 未登记');
      return structuredClone(artifact);
    }
    const artifact = PINNED_WINDOWS_ARTIFACTS[platform];
    if (!artifact)
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent 安装 Artifact 未登记', {
        platform,
      });
    return structuredClone(artifact);
  }

  listAgents(tenantId: string, query: PageQuery) {
    return this.repository.listRegistrations(tenantId, query).then(async (page) => {
      const items = this.deduplicateRegistrations(page.items);
      const projected = await Promise.all(
        items.map(async (agent) => ({
          ...agent,
          // 列表状态与详情状态必须一致：Agent 在线性只看心跳，管理 TCP 单独展示。
          ...(this.liveness ? await this.liveness.project(tenantId, 'AGENT', agent.id, ['HEARTBEAT']) : {}),
        })),
      );
      return { ...page, items: projected, total: projected.length };
    });
  }

  /**
   * AD CS Agent 与主机 Agent 是两个独立身份，不能使用列表去重结果作为关联来源。
   * 这里直接读取注册记录，确保同一机器上的 AD CS Agent 不会因 machineId 相同而被遗漏。
   */
  async listAdcsAgents(tenantId: string): Promise<AgentRegistration[]> {
    return (await this.repository.listAllRegistrations())
      .filter((agent) => agent.tenantId === tenantId && isAdcsAgentRegistration(agent));
  }

  async evaluateOfflineAgents(
    options: {
      offlineTimeoutSeconds?: number;
      requiredConsecutiveTimeouts?: number;
      now?: Date;
    } = {},
  ) {
    const offlineTimeoutSeconds = options.offlineTimeoutSeconds && options.offlineTimeoutSeconds > 0 ? options.offlineTimeoutSeconds : 60;
    const requiredConsecutiveTimeouts = options.requiredConsecutiveTimeouts && options.requiredConsecutiveTimeouts > 0 ? Math.ceil(options.requiredConsecutiveTimeouts) : 2;
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
      const stale = now.getTime() - referenceTime > offlineTimeoutSeconds * 1000;
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
      const liveness = this.liveness ? await this.liveness.project(agent.tenantId, 'AGENT', agent.id, ['HEARTBEAT']) : undefined;
      if (liveness && liveness.livenessStatus !== 'OFFLINE') continue;
      if (!liveness && requiredConsecutiveTimeouts > 1) continue;
      if (agent.status === 'OFFLINE') continue;

      const updated = await this.repository.updateRegistration(agent.id, {
        status: 'OFFLINE',
        gateway: agent.gateway
          ? {
              ...agent.gateway,
              status: 'offline',
              lastHeartbeatAt: latestHeartbeat?.receivedAt ?? agent.gateway.lastHeartbeatAt,
            }
          : agent.gateway,
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
    await this.ensureLocalGoFullReleases(tenantId);
    const [detailData, liveness, managementLiveness] = await Promise.all([this.repository.getDetailData(tenantId, agentId, options), this.liveness?.project(tenantId, 'AGENT', agentId, ['HEARTBEAT']), this.liveness?.project(tenantId, 'AGENT', agentId, ['MANAGEMENT_TCP'])]);
    if (!detailData) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 不存在', { agentId });
    const { agent, capabilitySnapshot, latestHeartbeat, tasks, taskCounts, recentErrors, runtimeLogs, recentTaskLogs, releases, upgradePlans } = detailData;
    const capabilities = {
      agentId: agent.id,
      declarations: capabilitySnapshot ? this.domain.toCapabilityDeclarations(agent, capabilitySnapshot) : [],
    };
    const taskQueue = { agentId: agent.id, counts: taskCounts ?? countTasks(tasks), tasks };
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
    return {
      agentId: agent.id,
      declarations: snapshot ? this.domain.toCapabilityDeclarations(agent, snapshot) : [],
    };
  }

  async listTaskQueue(tenantId: string, agentId: string, statuses?: AgentTaskEnvelope['status'][]): Promise<AgentTaskQueueProjection> {
    await this.requireTaskAgent(tenantId, agentId);
    const allTasks = await this.repository.listTasks(tenantId, agentId);
    const tasks = statuses?.length ? allTasks.filter((task) => statuses.includes(task.status)) : allTasks;
    return { agentId, counts: countTasks(allTasks), tasks };
  }

  async getUpgradeSuggestion(tenantId: string, agentId: string): Promise<AgentUpgradeSuggestionProjection> {
    const agent = await this.requireAgent(tenantId, agentId);
    const releases = await this.listActiveVersions(tenantId);
    const release = selectLatestMatchingRelease(agent, releases);
    if (!release) {
      return {
        agentId: agent.id,
        currentVersion: agent.descriptor.version,
        suggestion: {
          status: 'not_required',
          reason: '没有匹配平台的升级版本',
        },
      };
    }
    if (release.version === agent.descriptor.version) {
      return {
        agentId: agent.id,
        currentVersion: agent.descriptor.version,
        suggestion: { status: 'not_required', reason: 'Agent 已是目标版本' },
      };
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

  /** 列表只需要升级摘要；先同步本地制品 Release，避免移除详情循环后丢失本地升级入口。 */
  async prepareUpgradeSummary(tenantId: string): Promise<void> {
    await this.ensureLocalGoFullReleases(tenantId);
  }

  private async listActiveVersions(tenantId: string): Promise<AgentVersionRelease[]> {
    await this.ensureLocalGoFullReleases(tenantId);
    return this.repository.listActiveVersions(tenantId);
  }

  private async ensureLocalGoFullReleases(tenantId: string): Promise<void> {
    const existing = this.localReleaseSync.get(tenantId);
    if (existing) return existing;
    const sync = (async () => {
      if (typeof this.repository.publishVersion !== 'function') return;
      const localProducts: Array<{
        productLine: GoFullProductLine;
        platform: 'WINDOWS' | 'LINUX';
        version: string;
      }> = [];
      for (const definition of [
        { productLine: windowsGoProductLine, platform: 'WINDOWS' as const, readVersion: readWindowsGoAgentVersion },
        { productLine: linuxGoProductLine, platform: 'LINUX' as const, readVersion: readLinuxGoAgentVersion },
      ]) {
        try {
          localProducts.push({
            productLine: definition.productLine,
            platform: definition.platform,
            version: await definition.readVersion(),
          });
        } catch (error) {
          // 中文说明：生产镜像只保证已打包的 Agent 可用，单个平台缺失不能阻断其它平台的升级摘要。
          structuredLogger.warn('本地 Agent Release 版本读取失败，跳过该平台', {
            productLine: definition.productLine,
            errorMessage: error instanceof Error ? error.message : String(error),
          }, { module: 'agents', tenantId });
        }
      }
      for (const product of localProducts) {
        for (const architecture of ['amd64', 'arm64'] as const) {
          const artifactPath = resolveGoFullArtifactPath(product.productLine, architecture);
          if (!artifactPath || !existsSync(artifactPath)) continue;
          const content = await readFile(artifactPath);
          const checksumSha256 = createHash('sha256').update(content).digest('hex');
          const releaseId = localGoFullReleaseId(product.productLine, tenantId, product.version, architecture);
          const release: AgentVersionRelease = {
            id: releaseId,
            tenantId,
            version: product.version,
            platform: product.platform,
            arch: architecture,
            productLine: product.productLine,
            artifactSize: content.length,
            downloadUrl: localGoFullReleaseDownloadUrl(releaseId),
            checksumSha256,
            // 本地构建先使用 SHA-256 闭环；配置发布信任根后由 Agent 强制验签。
            signature: 'unsigned',
            rolloutPercent: 100,
            status: 'active',
            createdAt: new Date().toISOString(),
            createdBy: 'system:local-build',
          };
          await this.repository.publishVersion(release);
        }
      }
    })();
    this.localReleaseSync.set(tenantId, sync);
    try {
      await sync;
    } finally {
      // 只合并同一时刻的并发检查；构建产物可能在进程运行期间更新，
      // 下一次检查必须重新计算摘要并刷新同一个 Release 记录。
      this.localReleaseSync.delete(tenantId);
    }
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

  /** 执行载荷编排只需要平台身份，避免触发详情页的 Release、健康和日志投影。 */
  async getAgentExecutionPlatform(tenantId: string, agentId: string): Promise<{ osType: string; role?: string }> {
    const agent = await this.requireAgent(tenantId, agentId);
    return {
      osType: agent.descriptor.osType,
      ...(agent.role === undefined ? {} : { role: agent.role }),
    };
  }

  /** 主动 CA 观测入口使用的最小 Agent 身份投影。 */
  async getAdcsAgentIdentity(tenantId: string, agentId: string): Promise<{
    id: string;
    agentKey: string;
    role?: string;
    status: string;
    descriptor: { osType: string; hostname: string; caName?: string; caConfig?: string };
  }> {
    const agent = await this.requireAgent(tenantId, agentId);
    return {
      id: agent.id,
      agentKey: agent.agentKey,
      role: agent.role,
      status: agent.status,
      descriptor: {
        osType: agent.descriptor.osType,
        hostname: agent.descriptor.hostname,
        caName: agent.descriptor.caName,
        caConfig: agent.descriptor.caConfig,
      },
    };
  }

  /** 返回 CA 页面需要的 Agent 实际运行态；版本以最近一次心跳为准。 */
  async getAdcsAgentRuntimeStatus(tenantId: string, agentId: string): Promise<{
    id: string;
    agentKey: string;
    version: string;
    versionSource: 'heartbeat' | 'registration';
    registeredVersion?: string;
    status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    heartbeatAt?: string;
    managementEndpoint?: string;
    observation?: import('../schema/agents.schema.js').AgentRuntimeHealth['observation'];
  }> {
    const agent = await this.requireAgent(tenantId, agentId);
    const [heartbeat, liveness] = await Promise.all([
      this.repository.getLatestHeartbeat(tenantId, agent.id),
      this.liveness?.project(tenantId, 'AGENT', agent.id, ['HEARTBEAT']),
    ]);
    const status = liveness?.livenessStatus
      ?? (agent.status === 'ONLINE' ? 'ONLINE' : agent.status === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN');
    const registeredVersion = agent.descriptor.version?.trim() || undefined;
    const heartbeatVersion = heartbeat?.version?.trim() || undefined;
    return {
      id: agent.id,
      agentKey: agent.agentKey,
      version: heartbeatVersion ?? registeredVersion ?? 'unknown',
      versionSource: heartbeatVersion ? 'heartbeat' : 'registration',
      ...(registeredVersion ? { registeredVersion } : {}),
      status,
      ...(heartbeat?.receivedAt ? { heartbeatAt: heartbeat.receivedAt } : {}),
      ...(agent.descriptor.managementEndpoint ? { managementEndpoint: agent.descriptor.managementEndpoint } : {}),
      ...(heartbeat?.runtimeHealth?.observation ? { observation: heartbeat.runtimeHealth.observation } : {}),
    };
  }

  /** 通过 Agent 管理端点执行一次真实 AD CS 扫描，不创建旧式同步任务。 */
  async refreshAdcsObservations(tenantId: string, agentId: string, force = false): Promise<Record<string, unknown>> {
    const agent = await this.requireAgent(tenantId, agentId);
    if (agent.role !== 'adcs_agent' || agent.descriptor.osType.toLowerCase() !== 'windows_adcs') {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '当前 Agent 不是 Windows AD CS Agent', {
        agentId,
        reason: 'AGENT_PLATFORM_MISMATCH',
      });
    }
    const result = await this.agentManagementClient.refreshAdcsObservations(agent, force);
    return {
      ...result,
      agentId: agent.id,
      agentKey: agent.agentKey,
      agentVersion: result.agentVersion ?? agent.descriptor.version,
      triggeredAt: new Date().toISOString(),
    };
  }

  /** Gateway 只提供 relay.tcp；Full、Compatibility、AD CS Agent 均可进入统一任务队列。 */
  private async requireTaskAgent(tenantId: string, agentId: string) {
    const agent = await this.requireAgent(tenantId, agentId);
    if (agent.role === 'gateway' || agent.gateway) {
      throw new AppError('AUTH_FORBIDDEN', 'Gateway 仅允许 TCP Relay，不得使用 Agent Task 队列', {
        reason: 'GATEWAY_RELAY_ONLY',
        agentId,
      });
    }
    return agent;
  }

  private async requireTask(tenantId: string, agentId: string, taskId: string) {
    const task = await this.repository.getTask(tenantId, taskId);
    if (!task || task.agentId !== agentId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    return task;
  }

  private async resolveExistingRegistration(tenantId: string, agentKey: string, machineId?: string, isolateAdcsRegistration = false) {
    const byAgentKey = await this.repository.findByAgentKey(tenantId, agentKey);
    if (byAgentKey) {
      // AD CS Agent 只能重注册已有的 AD CS 身份；不能用相同 Agent Key 接管 Full Agent。
      if (isolateAdcsRegistration === isAdcsAgentRegistration(byAgentKey)) return byAgentKey;
      return undefined;
    }
    if (isolateAdcsRegistration || !machineId) return undefined;
    const byMachineId = await this.repository.findByMachineId(tenantId, machineId);
    // 普通 Agent 也不能反向接管已经登记的 AD CS Agent。
    return byMachineId && !isAdcsAgentRegistration(byMachineId) ? byMachineId : undefined;
  }

  private deduplicateRegistrations(items: AgentRegistration[]): AgentRegistration[] {
    const winners = new Map<string, AgentRegistration>();
    for (const item of items) {
      // Full Agent 与 Windows AD CS Agent 是同一主机上的两个独立身份，
      // 不能因为 machineId 相同而在 Agent 列表中互相覆盖。
      const identityKind = isAdcsAgentRegistration(item) ? 'adcs' : 'standard';
      const dedupeKey = `${identityKind}:${item.descriptor.machineId?.trim() || item.agentKey}`;
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
      structuredLogger.error(
        'GatewayRegistry 后台同步失败',
        {
          tenantId,
          agentId: agent.id,
          error: cause instanceof Error ? cause.message : String(cause),
        },
        { module: 'agents', resourceType: 'agent', resourceId: agent.id },
      );
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

  private toHealthProjection(
    agent: AgentRegistration,
    latestHeartbeat?: AgentHeartbeat,
    liveness?: {
      livenessStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
      livenessReasonCode?: string;
    },
  ): AgentHealthProjection {
    const offlineTimeoutSeconds = this.getOfflineTimeoutSeconds();
    const runtimeHealth = latestHeartbeat?.runtimeHealth;
    const lastHeartbeatAt = latestHeartbeat?.receivedAt ?? agent.gateway?.lastHeartbeatAt;
    const heartbeatAgeSeconds = safeAgeSeconds(lastHeartbeatAt);
    const offline = liveness?.livenessStatus === 'OFFLINE' || (liveness === undefined && (agent.status === 'OFFLINE' || isObservationStale(lastHeartbeatAt, offlineTimeoutSeconds)));
    const degradedReasons = dedupeStrings(runtimeHealth?.degradedReasons ?? []);
    const failureCounts = {
      heartbeat: runtimeHealth?.failureCounts?.heartbeat ?? 0,
      taskPoll: runtimeHealth?.failureCounts?.taskPoll ?? 0,
      recovery: runtimeHealth?.failureCounts?.recovery ?? 0,
    };
    const offlineEvidence = [offline ? (liveness?.livenessStatus === 'OFFLINE' ? `livenessReasonCode=${liveness.livenessReasonCode ?? 'unknown'}` : 'agent.status=OFFLINE') : '', lastHeartbeatAt ? `lastHeartbeatAt=${lastHeartbeatAt}` : 'lastHeartbeatAt=missing', heartbeatAgeSeconds !== undefined ? `heartbeatAgeSeconds=${heartbeatAgeSeconds}` : '', `offlineTimeoutSeconds=${offlineTimeoutSeconds}`].filter(Boolean);

    return {
      status: offline ? 'failed' : (runtimeHealth?.status ?? (degradedReasons.length > 0 ? 'degraded' : 'unknown')),
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
    return readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 60);
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
    const result = await this.liveness.probeAgentManagementEndpoint({
      tenantId,
      agentId,
    });
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

function resolveAgentControlPlaneUrl(value: string): string {
  const configured = process.env.GCAC_AGENT_CONTROL_PLANE_URL?.trim();
  const candidate = configured || value;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return candidate;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return candidate;
  // 本地开发环境的 5172 是 Vite 入口，后端控制面默认监听 PORT（通常为
  // 3003）。生产环境或显式控制面地址保持原值，避免改变真实部署拓扑。
  if (!configured && process.env.NODE_ENV !== 'production' && parsed.port === '5172') {
    parsed.port = process.env.PORT?.trim() || '3003';
  }
  return parsed.origin.replace(/\/+$/u, '');
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

function buildUpgradeSuggestion(agent: AgentRegistration, releases: AgentVersionRelease[], upgradePlans: AgentUpgradePlan[]): AgentUpgradeSuggestionProjection {
  const release = selectLatestMatchingRelease(agent, releases);
  if (!release) {
    return {
      agentId: agent.id,
      currentVersion: agent.descriptor.version,
      suggestion: { status: 'not_required', reason: '没有匹配平台的升级版本' },
    };
  }
  if (release.version === agent.descriptor.version) {
    return {
      agentId: agent.id,
      currentVersion: agent.descriptor.version,
      suggestion: { status: 'not_required', reason: 'Agent 已是目标版本' },
    };
  }
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
      existingPlan: upgradePlans.find((plan) => plan.releaseId === release.id),
    },
  };
}

const windowsGoAgentOS = 'WINDOWS';
const linuxGoAgentOS = 'LINUX';
const windowsGoProductLine: 'windows-go-full' = 'windows-go-full';
const linuxGoProductLine: 'linux-go-full' = 'linux-go-full';
type GoFullProductLine = typeof windowsGoProductLine | typeof linuxGoProductLine;

function isGoFullAgent(agent: AgentRegistration): boolean {
  const osType = agent.descriptor.osType.toUpperCase();
  return agent.role !== 'gateway' && (osType === windowsGoAgentOS || osType === linuxGoAgentOS) && !osType.includes('COMPATIBILITY');
}

function resolveGoFullProductLine(platform: string | undefined, productLine?: AgentVersionRelease['productLine']): GoFullProductLine | undefined {
  const normalizedPlatform = platform?.toUpperCase();
  if (productLine === windowsGoProductLine) return normalizedPlatform && normalizedPlatform !== windowsGoAgentOS ? undefined : productLine;
  if (productLine === linuxGoProductLine) return normalizedPlatform && normalizedPlatform !== linuxGoAgentOS ? undefined : productLine;
  if (normalizedPlatform === windowsGoAgentOS) return windowsGoProductLine;
  if (normalizedPlatform === linuxGoAgentOS) return linuxGoProductLine;
  return undefined;
}

function selectLatestMatchingRelease(agent: AgentRegistration, releases: AgentVersionRelease[]): AgentVersionRelease | undefined {
  const productLine = resolveGoFullProductLine(agent.descriptor.osType);
  if (!productLine) return undefined;
  return [...releases]
    .sort((left, right) => compareAgentVersions(right.version, left.version))
    .find((item) => resolveGoFullProductLine(item.platform, item.productLine) === productLine && matchesAgentArchitecture(item.arch, agent.descriptor.arch));
}

function selectUpgradeRelease(agent: AgentRegistration, releases: AgentVersionRelease[], input: CheckAgentUpgradeInput): AgentVersionRelease | undefined {
  const productLine = resolveGoFullProductLine(agent.descriptor.osType);
  if (!productLine) return undefined;
  const candidates = releases
    .filter((item) => resolveGoFullProductLine(item.platform, item.productLine) === productLine && matchesAgentArchitecture(item.arch, agent.descriptor.arch))
    .sort((left, right) => compareAgentVersions(right.version, left.version));
  if (input.releaseId) return candidates.find((item) => item.id === input.releaseId);
  if (input.targetVersion) return candidates.find((item) => item.version === input.targetVersion);
  return candidates[0];
}

function matchesAgentArchitecture(releaseArch: string | undefined, agentArch: string | undefined): boolean {
  if (!releaseArch) return true;
  return normalizeAgentArchitecture(releaseArch) !== undefined && normalizeAgentArchitecture(releaseArch) === normalizeAgentArchitecture(agentArch);
}

function assertGoFullRelease(agent: AgentRegistration, release: AgentVersionRelease, targetVersion: string): void {
  const expectedProductLine = resolveGoFullProductLine(agent.descriptor.osType);
  const actualProductLine = resolveGoFullProductLine(release.platform, release.productLine);
  if (!expectedProductLine || actualProductLine !== expectedProductLine || release.version !== targetVersion) {
    throw new AppError('VALIDATION_FAILED', 'Release 与 Go Full Agent 的产品线、平台或版本不匹配', { reason: 'RUNTIME_BASELINE_MISMATCH' });
  }
  if (!matchesAgentArchitecture(release.arch, agent.descriptor.arch) || !normalizeAgentArchitecture(agent.descriptor.arch)) {
    throw new AppError('VALIDATION_FAILED', 'Release 与 Go Full Agent 的架构不匹配', { reason: 'RUNTIME_BASELINE_MISMATCH' });
  }
}

function normalizeAgentArchitecture(value: string | undefined): 'amd64' | 'arm64' | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'amd64' || normalized === 'x86_64' || normalized === 'x64') return 'amd64';
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64';
  return undefined;
}

function buildGoFullUpgradeEnvelope(
  agent: AgentRegistration,
  plan: AgentUpgradePlan,
  release: AgentVersionRelease,
  requestId: string,
  upgradeBootstrapUrl?: string,
): AgentUpgradeEnvelope {
  const authorityKeyId = process.env.GCAC_AGENT_UPGRADE_AUTHORITY_KEY_ID?.trim();
  const privateKeyPem = process.env.GCAC_AGENT_UPGRADE_SIGNING_KEY_PEM?.replaceAll('\\n', '\n').trim();
  const productLine = resolveGoFullProductLine(agent.descriptor.osType);
  const platform = agent.descriptor.osType.toLowerCase() as 'windows' | 'linux';
  const architecture = normalizeAgentArchitecture(agent.descriptor.arch);
  const signatureKeyId = release.signatureKeyId?.trim() || process.env.GCAC_AGENT_RELEASE_SIGNING_KEY_ID?.trim();
  // 本地构建 Release 在没有发布信任根时只携带 SHA-256；一旦配置 keyId，
  // 必须同时提供真实 Ed25519 制品签名，避免把占位字符串送到 Agent 验签。
  const configuredArtifactSignature = release.artifactSignature?.trim();
  const artifactSignature = signatureKeyId && configuredArtifactSignature ? configuredArtifactSignature : '';
  if (!architecture || !release.artifactSize || release.artifactSize <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Go Full Release 缺少产品线、架构或制品大小', { reason: 'RELEASE_METADATA_INCOMPLETE', releaseId: release.id });
  }
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
  const unsigned = {
    schemaVersion: 'management.upgrade.v1' as const,
    planId: plan.id,
    transactionId: plan.transactionId ?? newId('agtxn'),
    agentId: agent.id,
    ...(upgradeBootstrapUrl ? { upgradeBootstrapUrl } : {}),
    release: {
      releaseId: release.id,
      productLine: productLine as GoFullProductLine,
      version: release.version,
      platform,
      architecture,
      downloadUrl: release.downloadUrl,
      artifactSha256: release.checksumSha256,
      artifactSize: release.artifactSize,
      signatureKeyId: signatureKeyId ?? '',
      artifactSignature: artifactSignature ?? '',
    },
    policyRef: plan.policyRef ?? 'gcac.agent.upgrade',
    approvalRef: plan.approvalRef ?? '',
    nonce: randomBytes(24).toString('base64url'),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authorityKeyId: authorityKeyId ?? '',
  };
  let envelope: AgentUpgradeEnvelope = {
    ...unsigned,
    controlPlaneSignature: '',
  };
  if (authorityKeyId && privateKeyPem) {
    let privateKey;
    try {
      privateKey = createPrivateKey(privateKeyPem);
    } catch {
      throw new AppError('CONFIGURATION_ERROR', 'Go Full 升级签名私钥无法解析', { reason: 'UPGRADE_SIGNING_KEY_INVALID' });
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new AppError('CONFIGURATION_ERROR', 'Go Full 升级签名私钥必须是 Ed25519', { reason: 'UPGRADE_SIGNING_KEY_INVALID' });
    }
    envelope = signAgentUpgradeEnvelope(unsigned, privateKey);
  }
  structuredLogger.info(
    'Go Full UpgradeEnvelope 已签发',
    {
      tenantId: plan.tenantId,
      agentId: agent.id,
      planId: plan.id,
      transactionId: unsigned.transactionId,
      requestId,
      releaseId: release.id,
      artifactSha256: release.checksumSha256,
    },
    { module: 'agents', resourceType: 'agent_upgrade', resourceId: plan.id },
  );
  return envelope;
}

function mapAgentUpgradeStatus(status: string | undefined): AgentUpgradePlan['status'] | undefined {
  if (!status) return undefined;
  if (status === 'accepted') return 'accepted';
  if (status === 'running') return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'rolled_back') return 'rolled_back';
  if (status === 'unknown') return 'unknown';
  if (status === 'manual_required') return 'manual_required';
  return undefined;
}

function isUpgradeTransactionIdentityMismatch(error: unknown): boolean {
  return error instanceof AppError && readRecord(error.details).reason === 'AGENT_UPGRADE_RESPONSE_IDENTITY_MISMATCH';
}

function isStaleUpgradeHelperStatus(status: Awaited<ReturnType<AgentManagementClient['getUpgradeStatus']>>): boolean {
  if (status.status !== 'running' || !status.updatedAt || !['helper_started', 'script_started', 'downloading_script', 'executing_script'].includes(String(status.phase))) return false;
  const updatedAt = Date.parse(status.updatedAt);
  return !Number.isNaN(updatedAt) && Date.now() - updatedAt >= agentUpgradeHelperTimeoutMs;
}

function readAppErrorCode(error: unknown): string {
  return error instanceof AppError ? error.errorCode : 'AGENT_UPGRADE_TRANSPORT_FAILED';
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
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
  return tasks.reduce<Record<AgentTaskEnvelope['status'], number>>(
    (counts, task) => {
      counts[task.status] += 1;
      return counts;
    },
    { queued: 0, leased: 0, acked: 0, succeeded: 0, failed: 0, rejected: 0 },
  );
}

function resolveAgentTaskOutcome(input: SubmitAgentTaskResultInput, detail: Record<string, unknown>): AgentSecurityStatus {
  const candidates = [input.status, detail.status, detail.executionStatus, readRecord(detail.receipt)?.status];
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
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isAdcsAgentRegistration(agent: AgentRegistration): boolean {
  return agent.role === 'adcs_agent' || agent.descriptor.osType.toLowerCase() === 'windows_adcs';
}

const AGENT_MACHINE_ROUTES = new Set(['POST /api/v1/agents/register', 'POST /api/v1/agents/sessions', 'POST /api/v1/agents/certificate-requests', 'POST /api/v1/agents/certificates/rotate', 'POST /api/v1/agents/heartbeat', 'POST /api/v1/agents/capabilities', 'POST /api/v1/agents/ca-observations', 'GET /api/v1/agents/tasks/pull', 'POST /api/v1/agents/tasks/ack', 'POST /api/v1/agents/tasks/logs', 'POST /api/v1/agents/runtime-logs', 'POST /api/v1/agents/tasks/log-batches', 'POST /api/v1/agents/tasks/result', 'POST /api/v1/agents/upgrades/check', 'POST /api/v1/agents/upgrades/result', 'POST /api/v1/gateways/probe', 'POST /api/v1/gateways/status']);

function isAgentMachineRoute(method: string, path: string): boolean {
  return AGENT_MACHINE_ROUTES.has(`${method.toUpperCase()} ${path}`);
}

function validateQueuedAgentV2Receipt(task: AgentTaskEnvelope, detail: Record<string, unknown>, tenantId: string, submittedStatus?: AgentSecurityStatus, submittedSuccess = false, submittedErrorCode?: string): AgentExecutionReceiptV1 | undefined {
  const authorizationPayload = task.payload;
  const actionType = resolveAgentTaskActionType(task.payload);
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
  if (!receiptValue) {
    // 已进入 UNKNOWN 时不能凭空生成 Receipt；其它写操作必须由真实 Full Agent 提交回执。
    // ACTION_HANDLER_NOT_REGISTERED 发生在 Agent v2 计划进入执行器之前，
    // 没有任何写操作结果可签发 Receipt；按确定性失败收敛，避免旧任务永久 acked。
    if (receiptRequired && executionStatus !== 'UNKNOWN' && !agentV2PreExecutionFailureCodes.has(submittedErrorCode ?? '')) {
      throw new AppError('VALIDATION_FAILED', 'Agent v2 写操作结果缺少完整 Execution Receipt', {
        reason: 'AGENT_V2_RECEIPT_REQUIRED',
        taskId: task.id,
        actionType,
      });
    }
    return undefined;
  }

  const receipt = validateAgentExecutionReceipt(receiptValue);
  const expectedReceiptAgentId = readStringValue(readOptionalRecord(authorizationPayload.token)?.agentId)
    ?? readStringValue(authorizationPayload.agentId)
    ?? task.agentId;
  if (receipt.agentId !== expectedReceiptAgentId || receipt.tenantId !== tenantId) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 的 Agent 或租户绑定不一致', {
      reason: 'AGENT_V2_RECEIPT_IDENTITY_DENIED',
      taskId: task.id,
      agentId: receipt.agentId,
      tenantId: receipt.tenantId,
    });
  }

  // Microsoft AD CS Plugin 先在控制面生成 legacy AgentPlan，再由独立 AD CS Agent
  // 通过统一任务队列执行。该计划没有 Full Agent 的 Token/PolicyDecision 材料，
  // 但仍必须把 Receipt 绑定到 Authority 指定的 Agent、租户和固定计划摘要。
  const adcsPlan = readOptionalRecord(authorizationPayload.agentPlan);
  if (actionType === 'agent.plan.execute'
    && authorizationPayload.agentRole === 'adcs_agent'
    && authorizationPayload.agentPlatform === 'windows_adcs'
    && adcsPlan) {
    const expectedPlanDigest = readStringValue(adcsPlan.planDigest)?.replace(/^sha256:/u, '');
    if (receipt.agentId !== task.agentId || receipt.tenantId !== tenantId || receipt.planDigest !== expectedPlanDigest) {
      throw new AppError('AUTH_FORBIDDEN', 'AD CS Agent Receipt 未绑定任务计划', {
        reason: 'ADCS_AGENT_RECEIPT_BINDING_DENIED',
        taskId: task.id,
      });
    }
    if (receipt.status === 'SUCCESS' && !receipt.nonceConsumed) {
      throw new AppError('AUTH_FORBIDDEN', 'AD CS Agent Receipt 未确认操作已消费', {
        reason: 'ADCS_AGENT_RECEIPT_NONCE_REQUIRED',
        taskId: task.id,
      });
    }
    return receipt;
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
  if (token.agentId !== receipt.agentId || token.tenantId !== receipt.tenantId || token.tokenId !== receipt.tokenId || token.planDigest !== receipt.planDigest || decision.agentId !== token.agentId || decision.tenantId !== token.tenantId || decision.tokenId !== token.tokenId || decision.planDigest !== token.planDigest || decision.nonce !== token.nonce) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与 Token、Decision 绑定不一致', {
      reason: 'AGENT_V2_RECEIPT_BINDING_DENIED',
      taskId: task.id,
    });
  }
  if (plan && (plan.planId !== receipt.planId || plan.planDigest !== receipt.planDigest || plan.agentId !== receipt.agentId || plan.tenantId !== receipt.tenantId || !plan.operations.some((operation) => operation.operationId === receipt.operationId))) {
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
  return value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED' ? value : undefined;
}

function readAgentTaskOutcome(task: AgentTaskEnvelope): AgentSecurityStatus | undefined {
  const result = readRecord(task.result);
  const status = result.status ?? readRecord(result.detail).executionStatus;
  return status === 'SUCCESS' || status === 'FAILED' || status === 'UNKNOWN' || status === 'CANCELLED' ? status : undefined;
}

function readReceipt(value: unknown): AgentExecutionReceiptV1 | undefined {
  const receipt = readOptionalRecord(readOptionalRecord(value)?.receipt);
  return receipt as AgentExecutionReceiptV1 | undefined;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
  return actionType && agentV2ContractTypes.includes(actionType as AgentV2ContractType) ? (actionType as AgentV2ContractType) : undefined;
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
const configuredAgentReleaseBundleRoot = process.env.GCAC_AGENT_RELEASE_BUNDLE_ROOT?.trim() || undefined;
const windowsGoAgentRoot = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'amd64', 'full-agent')
  : resolveRepositoryAgentRoot('windows-go-full-agent');
const windowsGoAgentAmd64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'amd64', 'full-agent', 'gcac-agent.exe')
  : path.join(windowsGoAgentRoot, 'dist', 'gcac-agent.windows-amd64.exe');
const windowsGoAgentArm64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'arm64', 'full-agent', 'gcac-agent.exe')
  : path.join(windowsGoAgentRoot, 'dist', 'gcac-agent.windows-arm64.exe');
const linuxGoAgentRoot = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'linux', 'amd64')
  : resolveRepositoryAgentRoot('linux-go-full-agent');
const linuxGoAgentAmd64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'linux', 'amd64', 'gcac-linux-agent')
  : path.join(linuxGoAgentRoot, 'gcac-linux-agent');
const linuxGoAgentArm64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'linux', 'arm64', 'gcac-linux-agent')
  : path.join(linuxGoAgentRoot, 'gcac-linux-agent-arm64');
const windowsGoAgentUpdaterAmd64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'amd64', 'full-agent', 'gcac-agent-updater.exe')
  : path.join(windowsGoAgentRoot, 'dist', 'gcac-agent-updater.windows-amd64.exe');
const windowsGoRuntimeDiscoveryAmd64Artifact = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'amd64', 'full-agent', 'plugins', 'windows-runtime-discovery.exe')
  : path.join(windowsGoAgentRoot, 'dist', 'plugins', 'windows-runtime-discovery.windows-amd64.exe');
const windowsCompatibilityAgentRoot = configuredAgentReleaseBundleRoot
  ? path.join(configuredAgentReleaseBundleRoot, 'windows', 'amd64', 'compatibility')
  : resolveRepositoryAgentRoot('windows-compat-full-agent');
const windowsCompatibilityReleaseRoot = configuredAgentReleaseBundleRoot
  ? windowsCompatibilityAgentRoot
  : path.join(windowsCompatibilityAgentRoot, 'dist');
const windowsAdcsAgentRoot = resolveRepositoryAgentRoot('windows-adcs-agent');
const windowsAdcsAgentArtifact = path.join(windowsAdcsAgentRoot, 'dist', 'gcac-adcs-agent.windows-amd64.exe');
const WINDOWS_INSTALL_PLATFORMS = ['windows_go_service', 'windows_compatibility_service', 'windows_adcs_service'] as const;
const WINDOWS_GO_INSTALL_PLATFORM = 'windows_go_service' as const;
const WINDOWS_GO_RUNTIME_INSTALL_PLATFORMS = new Set<AgentInstallSession['platform']>(['windows_go_service', 'windows_compatibility_service']);
const TRUSTED_AGENT_OS_TYPES = new Set(['linux', 'windows']);
const WINDOWS_ARTIFACT_LOADERS: Record<(typeof WINDOWS_INSTALL_PLATFORMS)[number], () => Promise<Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>>> = {
  windows_go_service: loadWindowsGoAgentArtifacts,
  windows_compatibility_service: loadWindowsCompatibilityAgentArtifacts,
  windows_adcs_service: loadWindowsAdcsAgentArtifacts,
};

function isWindowsGoInstallPlatform(platform: AgentInstallSession['platform']): boolean {
  return platform === WINDOWS_GO_INSTALL_PLATFORM;
}

function isWindowsGoRuntimeInstallPlatform(platform: AgentInstallSession['platform']): boolean {
  return WINDOWS_GO_RUNTIME_INSTALL_PLATFORMS.has(platform);
}

function isTrustedAgentOsType(osType: string): boolean {
  return TRUSTED_AGENT_OS_TYPES.has(osType.split(/[-_]/u)[0] ?? '');
}

function installRouteForPlatform(platform: AgentInstallSession['platform']): string {
  const routes: Record<AgentInstallSession['platform'], string> = {
    windows_go_service: '/agent-install.ps1',
    windows_compatibility_service: '/agent-install.ps1',
    windows_adcs_service: '/api/v1/agents/install/windows-adcs/bootstrap.ps1',
    linux_go_systemd: '/agent-install',
  };
  return routes[platform];
}

function installCommandForPlatform(
  platform: AgentInstallSession['platform'],
  bootstrapUrl: string,
  platformFamily?: LinuxAgentPlatformFamily,
): string {
  const commands: Record<AgentInstallSession['platform'], string> = {
    windows_go_service: `irm '${bootstrapUrl}' | iex`,
    windows_compatibility_service: `irm '${bootstrapUrl}' | iex`,
    windows_adcs_service: `irm '${bootstrapUrl}' | iex`,
    linux_go_systemd: `curl -fsSL '${bootstrapUrl}' | sudo bash`,
  };
  const command = commands[platform];
  // 仅追加机器可读标识，管道和参数保持完全一致。
  return platform === 'linux_go_systemd' && platformFamily
    ? `${command} # os=${platformFamily}`
    : command;
}

function managementPortForInstallPlatform(platform: AgentInstallSession['platform']): number {
  if (platform === 'windows_go_service') return 18930;
  if (platform === 'windows_compatibility_service') return 18932;
  if (platform === 'windows_adcs_service') return 18933;
  return 18931;
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
  if (!existsSync(windowsGoAgentAmd64Artifact)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Go Agent 可执行文件未构建，不能生成一键安装命令');
  }
  if (!existsSync(windowsGoAgentUpdaterAmd64Artifact)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Go Agent 升级器未构建，不能生成一键安装命令');
  }
  if (!existsSync(windowsGoRuntimeDiscoveryAmd64Artifact)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Go Agent-side 发现插件未构建，不能生成一键安装命令');
  }
}

async function loadWindowsGoAgentArtifacts() {
  await ensureWindowsGoBundleAvailable();
  const artifacts = await walkWindowsAgentArtifacts(windowsGoAgentRoot, ['install-service.ps1', 'service-control.ps1', 'uninstall-service.ps1', 'config/agent.config.template.json', 'release/verify-signature.ps1']);
  // 安装器只分发本次构建生成的 amd64 发布物，根目录遗留的本地二进制不能参与打包。
  artifacts.push({
    path: 'gcac-agent.exe',
    content: (await readFile(windowsGoAgentAmd64Artifact)).toString('base64'),
    encoding: 'base64',
  });
  artifacts.push({
    path: 'gcac-agent-updater.exe',
    content: (await readFile(windowsGoAgentUpdaterAmd64Artifact)).toString('base64'),
    encoding: 'base64',
  });
  artifacts.push({
    path: 'plugins/windows-runtime-discovery.exe',
    content: (await readFile(windowsGoRuntimeDiscoveryAmd64Artifact)).toString('base64'),
    encoding: 'base64',
  });
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function ensureWindowsCompatibilityBundleAvailable(): Promise<void> {
  const executable = path.join(windowsCompatibilityReleaseRoot, 'GCAC.WindowsCompatibilityAgent.exe');
  const scanner = path.join(windowsCompatibilityReleaseRoot, 'plugins', 'windows-runtime-discovery.exe');
  const iisPlugin = path.join(windowsCompatibilityReleaseRoot, 'web-iis', 'web-iis-agent-side-plugin.exe');
  const updater = path.join(windowsCompatibilityReleaseRoot, 'gcac-agent-updater.exe');
  if (![executable, scanner, iisPlugin, updater].every((candidate) => existsSync(candidate))) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows Compatibility Agent 可执行文件未构建，不能生成一键安装命令');
  }
}

async function ensureWindowsAdcsBundleAvailable(): Promise<void> {
  if (!existsSync(windowsAdcsAgentArtifact)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows AD CS Agent 可执行文件未构建，不能生成一键安装命令');
  }
}

async function loadWindowsAdcsAgentArtifacts() {
  await ensureWindowsAdcsBundleAvailable();
  const artifacts = await walkWindowsAgentArtifacts(windowsAdcsAgentRoot, [
    'install-service.ps1',
    'uninstall-service.ps1',
    'service-control.ps1',
    'config/agent.config.template.json',
  ]);
  artifacts.push({
    path: 'gcac-adcs-agent.exe',
    content: (await readFile(windowsAdcsAgentArtifact)).toString('base64'),
    encoding: 'base64',
  });
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function loadWindowsCompatibilityAgentArtifacts() {
  await ensureWindowsCompatibilityBundleAvailable();
  const artifacts = await walkWindowsAgentArtifacts(windowsCompatibilityReleaseRoot, [
    'GCAC.WindowsCompatibilityAgent.exe',
    'gcac-agent-updater.exe',
    'plugins/windows-runtime-discovery.exe',
    'web-iis/web-iis-agent-side-plugin.exe',
  ]);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function walkWindowsAgentArtifacts(currentDir: string, allowedPaths: readonly string[], relativeDir = ''): Promise<Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>> {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(currentDir, { withFileTypes: true }));
  const artifacts: Array<{
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
  }> = [];
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (allowedPaths.some((allowed) => allowed.startsWith(`${relativePath}/`))) {
        artifacts.push(...(await walkWindowsAgentArtifacts(path.join(currentDir, entry.name), allowedPaths, relativePath)));
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

async function readWindowsGoAgentVersion(): Promise<string> {
  const sourcePath = path.join(windowsGoAgentRoot, 'main.go');
  if (existsSync(sourcePath)) {
    const source = await readFile(sourcePath, 'utf8');
    const match = source.match(/\bagentVersion\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"/u);
    if (match?.[1]) return match[1];
  }
  const bundleVersion = await readAgentReleaseBundleVersion(windowsGoProductLine);
  if (bundleVersion) return bundleVersion;
  throw new AppError('RESOURCE_NOT_FOUND', '无法从 Windows Go Agent 发布包读取版本');
}

async function readWindowsAdcsAgentVersion(): Promise<string> {
  const templatePath = path.join(windowsAdcsAgentRoot, 'config', 'agent.config.template.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(templatePath, 'utf8'));
  } catch {
    throw new AppError('RESOURCE_NOT_FOUND', '无法从 Windows AD CS Agent 配置模板读取版本');
  }
  const version = parsed && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'string'
    ? (parsed as { version: string }).version.trim()
    : '';
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Windows AD CS Agent 配置模板版本无效');
  }
  return version;
}

async function readLinuxGoAgentVersion(): Promise<string> {
  const buildScriptPath = path.join(linuxGoAgentRoot, 'build.sh');
  if (existsSync(buildScriptPath)) {
    const source = await readFile(buildScriptPath, 'utf8');
    const match = source.match(/VERSION_VALUE="\$\{VERSION:-([^"}]+)\}"/u);
    if (match?.[1] && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(match[1])) return match[1];
  }
  const bundleVersion = await readAgentReleaseBundleVersion(linuxGoProductLine);
  if (bundleVersion) return bundleVersion;
  throw new AppError('RESOURCE_NOT_FOUND', '无法从 Linux Go Agent 发布包读取版本');
}

async function readAgentReleaseBundleVersion(productLine: GoFullProductLine): Promise<string | undefined> {
  if (!configuredAgentReleaseBundleRoot) return undefined;
  const manifestPath = path.join(configuredAgentReleaseBundleRoot, 'manifest.json');
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      agentVersions?: Record<string, unknown>;
    };
    const version = manifest.agentVersions?.[productLine];
    return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveGoFullArtifactPath(productLine: GoFullProductLine, architecture: 'amd64' | 'arm64' | undefined): string | undefined {
  if (!architecture) return undefined;
  if (productLine === windowsGoProductLine) return architecture === 'amd64' ? windowsGoAgentAmd64Artifact : windowsGoAgentArm64Artifact;
  return architecture === 'amd64' ? linuxGoAgentAmd64Artifact : linuxGoAgentArm64Artifact;
}

function localGoFullReleaseId(productLine: GoFullProductLine, tenantId: string, version: string, architecture: string): string {
  // Release ID 表示租户、版本和架构，而不是某一次构建的摘要。
  // 这样重新构建同一版本时会幂等更新制品元数据，不会遗留多个同版本候选。
  return `agrel-local-${productLine}-${sha256(`${tenantId}:${version}:${architecture}`).slice(0, 24)}`;
}

function localGoFullReleaseDownloadUrl(releaseId: string): string {
  const configuredReleaseBase = process.env.GCAC_AGENT_RELEASE_BASE_URL?.trim();
  const configuredBase = configuredReleaseBase
    || process.env.GCAC_PUBLIC_BASE_URL?.trim()
    || `http://${resolveReachableHost()}:${process.env.PORT?.trim() || '3003'}`;
  let base: URL;
  try {
    base = new URL(configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`);
  } catch {
    throw new AppError('CONFIGURATION_ERROR', 'GCAC_AGENT_RELEASE_BASE_URL 或 GCAC_PUBLIC_BASE_URL 无效');
  }
  // 开发环境的既有公开基址通常指向 Vite 5172；Agent 下载应直接命中控制面 3003，
  // 避免依赖已经启动的前端代理。生产/显式 GCAC_AGENT_RELEASE_BASE_URL 不改写端口。
  if (!configuredReleaseBase && process.env.NODE_ENV !== 'production' && base.port === '5172') {
    base.port = process.env.PORT?.trim() || '3003';
  }
  return new URL(`/agent-releases/${encodeURIComponent(releaseId)}`, base).toString();
}

/**
 * 在线升级的 Bootstrap 必须从 Agent 可访问的控制面获取，不能从制品下载地址推导。
 * 旧的非 HTTP 调用没有请求上下文时仍保留 Release origin 回退，以兼容历史内部调用。
 */
function resolveUpgradeControlPlaneUrl(explicitBaseUrl: string | undefined, releaseUrl: URL): string {
  const configuredBaseUrl = explicitBaseUrl?.trim()
    || process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL?.trim()
    || process.env.GCAC_PUBLIC_BASE_URL?.trim();
  if (!configuredBaseUrl) return releaseUrl.origin;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    return parsed.origin.replace(/\/+$/u, '');
  } catch {
    throw new AppError('CONFIGURATION_ERROR', 'Agent 升级 Bootstrap 控制面地址无效', { controlPlaneUrl: configuredBaseUrl });
  }
}

function resolveReachableHost(): string {
  const address = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .find((item) => item.family === 'IPv4' && !item.internal)?.address;
  return address ?? '127.0.0.1';
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
  throw new AppError('VALIDATION_FAILED', 'role 只能是 full_agent 或 gateway', {
    role: value,
  });
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
        serviceName: 'gcac-gateway-agent',
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
