import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityDeclaration } from '../../../shared/contracts/capability-contracts.js';
import { newId } from '../../../shared/id.js';
import type { AgentCapabilitySnapshotInput, CreateAgentInstallSessionInput, CreateEnrollmentTokenInput, PublishAgentVersionInput, RegisterAgentInput, SubmitAgentRuntimeLogInput, SubmitAgentTaskLogInput } from '../dto/agents.dto.js';
import type { AgentCapabilitySnapshot, AgentCertificate, AgentCertificateAuthority, AgentCertificateSigningRequest, AgentDescriptor, AgentGatewayExtension, AgentInstallSession, AgentRegistration, AgentRuntimeLogEntry, AgentTaskLogEntry, AgentVersionRelease, EnrollmentToken, LinuxAgentPlatformFamily } from '../schema/agents.schema.js';

const MOCK_SAFE_CA_COMMON_NAME = 'GCAC Agent Mock Safe CA';
const INSTALL_SESSION_TTL_MS = 10 * 60 * 1000;
const WINDOWS_GO_RELEASE_PRODUCT_LINE = 'windows-go-full';
const RELEASE_REQUIREMENTS = new Map([
  [WINDOWS_GO_RELEASE_PRODUCT_LINE, { platform: 'WINDOWS', requireArchitecture: true }],
  ['linux-go-full', { platform: 'LINUX', requireArchitecture: true }],
]);
const WINDOWS_FULL_AGENT_PLATFORMS = new Set(['windows_go_service', 'windows_compatibility_service']);
const WINDOWS_ADCS_PLATFORM = 'windows_adcs_service';
const WINDOWS_COMPATIBILITY_PLATFORM = 'windows_compatibility_service';
const WINDOWS_ADCS_PROFILE = {
  serviceName: 'GCACWindowsAdcsAgent',
  displayName: 'GCAC Windows AD CS Agent',
  installRoot: 'C:\\Program Files\\GCAC\\WindowsAdcsAgent',
  configDir: 'C:\\ProgramData\\GCAC\\WindowsAdcsAgent\\config',
  dataDir: 'C:\\ProgramData\\GCAC\\WindowsAdcsAgent\\data',
  logDir: 'C:\\ProgramData\\GCAC\\WindowsAdcsAgent\\logs',
  managementPort: 18933,
} as const;
const INSTALL_AGENT_KEY_PREFIX: Record<'windows_go_service' | 'windows_compatibility_service' | 'windows_adcs_service' | 'linux_go_systemd', string> = {
  windows_go_service: 'windowsgo',
  windows_compatibility_service: 'windowscompat',
  windows_adcs_service: 'windowsadcs',
  linux_go_systemd: 'linuxgo',
};

function isWindowsFullAgentPlatform(
  platform: AgentInstallSession['platform'],
): platform is Extract<AgentInstallSession['platform'], 'windows_go_service' | 'windows_compatibility_service'> {
  return WINDOWS_FULL_AGENT_PLATFORMS.has(platform);
}

export class AgentsDomainService {
  createEnrollmentToken(tenantId: string, input: CreateEnrollmentTokenInput, requestId: string): EnrollmentToken & { token: string } {
    const maxUses = input.maxUses ?? 1;
    const ttlSeconds = input.ttlSeconds ?? 3600;
    if (maxUses < 1 || maxUses > 100) throw new AppError('VALIDATION_FAILED', 'maxUses 必须在 1-100 之间');
    if (ttlSeconds < 60 || ttlSeconds > 86_400) throw new AppError('VALIDATION_FAILED', 'ttlSeconds 必须在 60-86400 之间');
    const token = `${newId('enroll')}.${newId('secret')}`;
    const now = new Date();
    return {
      id: newId('enrtok'),
      tenantId,
      token,
      tokenHash: hashToken(token),
      tokenPreview: `${token.slice(0, 12)}...${token.slice(-6)}`,
      allowedRoles: normalizeList(input.allowedRoles ?? ['full_agent']),
      allowedZones: normalizeList(input.allowedZones ?? ['default']),
      maxUses,
      usedCount: 0,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      status: 'active',
      createdAt: now.toISOString(),
      createdBy: input.createdBy,
      auditRef: requestId,
    };
  }

  normalizeDescriptor(input: RegisterAgentInput): AgentDescriptor {
    const agentKey = normalizeKey(input.agentKey, 'agentKey');
    const hostname = normalizeRequired(input.hostname, 'hostname').toLowerCase();
    const version = normalizeRequired(input.version, 'version');
    const osType = normalizeRequired(input.osType, 'osType').toUpperCase();
    return {
      agentKey,
      machineId: input.machineId?.trim(),
      hostname,
      caName: input.caName?.trim(),
      caConfig: input.caConfig?.trim(),
      version,
      osType,
      arch: input.arch?.trim(),
      ipAddress: input.ipAddress?.trim(),
      managementEndpoint: normalizeManagementEndpoint(input.managementEndpoint),
      linuxDistribution: input.linuxDistribution?.trim(),
      osVersion: input.osVersion?.trim(),
      labels: [...new Set((input.labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean))],
    };
  }

  normalizeManagementEndpoint(value: string | undefined): string | undefined {
    return normalizeManagementEndpoint(value);
  }

  normalizeGatewayOnRegister(input: RegisterAgentInput, existing?: AgentGatewayExtension): AgentGatewayExtension | undefined {
    const role = normalizeOptionalKey(input.role ?? '');
    if (role !== 'gateway' && (hasGatewaySignal(input) || Boolean(existing))) {
      throw new AppError('VALIDATION_FAILED', 'Full Agent 不允许携带 Gateway/Relay 能力；请使用独立 Gateway Agent', {
        reason: 'FULL_AGENT_GATEWAY_FIELDS_REJECTED',
      });
    }
    const gatewaySignal = role === 'gateway';
    if (!gatewaySignal) return undefined;
    const zoneIds = normalizeZoneIds(input.zoneIds ?? (input.zone ? [input.zone] : existing?.zoneIds ?? []));
    if ((role === 'gateway' || hasGatewaySignal(input)) && zoneIds.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Gateway Agent 注册必须提供 zone 或 zoneIds');
    }
    return this.normalizeGatewayExtension({
      existing,
      zoneIds,
      adapters: input.adapters,
      capabilities: input.capabilities,
      resourceLimits: input.resourceLimits,
      currentLoad: input.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks,
      successRate: input.successRate,
      status: existing?.status,
    });
  }

  normalizeGatewayOnHeartbeat(agent: AgentRegistration, input: { adapters?: string[]; capabilities?: string[]; resourceLimits?: Record<string, unknown>; currentLoad?: number; maxConcurrentTasks?: number; successRate?: number }, receivedAt: string): AgentGatewayExtension | undefined {
    if (agent.role !== 'gateway') {
      if (agent.gateway || hasGatewaySignal(input)) {
        throw new AppError('VALIDATION_FAILED', 'Full Agent 心跳不允许携带 Gateway/Relay 能力', {
          reason: 'FULL_AGENT_GATEWAY_FIELDS_REJECTED',
          agentId: agent.id,
        });
      }
      return undefined;
    }
    return this.normalizeGatewayExtension({
      existing: agent.gateway,
      zoneIds: agent.gateway?.zoneIds ?? (agent.zone ? [agent.zone] : []),
      adapters: input.adapters,
      capabilities: input.capabilities,
      resourceLimits: input.resourceLimits,
      currentLoad: input.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks,
      successRate: input.successRate,
      status: agent.status === 'DISABLED' ? 'disabled' : 'online',
      lastHeartbeatAt: receivedAt,
    });
  }

  normalizeGatewayOnCapabilities(agent: AgentRegistration, input: AgentCapabilitySnapshotInput): AgentGatewayExtension | undefined {
    const reportedCapabilities = input.capabilities.map((item) => item.capabilityKey);
    if (agent.role !== 'gateway') {
      if (agent.gateway || hasGatewaySignal({ adapters: input.adapters, capabilities: reportedCapabilities })) {
        throw new AppError('VALIDATION_FAILED', 'Full Agent 能力快照不允许携带 Gateway/Relay 能力', {
          reason: 'FULL_AGENT_GATEWAY_FIELDS_REJECTED',
          agentId: agent.id,
        });
      }
      return undefined;
    }
    return this.normalizeGatewayExtension({
      existing: agent.gateway,
      zoneIds: agent.gateway?.zoneIds ?? (agent.zone ? [agent.zone] : []),
      adapters: input.adapters,
      capabilities: reportedCapabilities,
      resourceLimits: input.resourceLimits,
      currentLoad: input.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks,
      successRate: input.successRate,
      status: agent.status === 'DISABLED' ? 'disabled' : agent.gateway?.status,
    });
  }

  assertEnrollmentAllowed(token: EnrollmentToken, input: RegisterAgentInput): void {
    const now = Date.now();
    if (token.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '注册令牌不可用', { status: token.status });
    if (new Date(token.expiresAt).getTime() < now) throw new AppError('AUTH_FORBIDDEN', '注册令牌已过期', { tokenId: token.id });
    if (token.usedCount >= token.maxUses) throw new AppError('AUTH_FORBIDDEN', '注册令牌使用次数已耗尽', { tokenId: token.id });
    const role = normalizeOptionalKey(input.role ?? 'full_agent');
    const zoneIds = normalizeZoneIds(input.zoneIds ?? (input.zone ? [input.zone] : ['default']));
    const zone = zoneIds[0] ?? 'default';
    if (!token.allowedRoles.includes(role)) throw new AppError('AUTH_FORBIDDEN', '注册令牌 role 不匹配', { role });
    if (zoneIds.some((item) => !token.allowedZones.includes(item))) throw new AppError('AUTH_FORBIDDEN', '注册令牌 zone 不匹配', { zoneIds });
  }

  hashEnrollmentToken(token: string): string {
    return hashToken(token);
  }

  hashInstallBootstrapToken(token: string): string {
    return sha256Hex(token);
  }

  createAgentInstallSession(
    tenantId: string,
    input: CreateAgentInstallSessionInput,
    requestId: string,
    controlPlaneUrl: string,
  ): AgentInstallSession & { bootstrapToken: string; enrollmentTokenRecord: EnrollmentToken & { token: string } } {
    const platform = normalizeInstallSessionPlatform(input.platform);
    const platformFamily = normalizeLinuxPlatformFamily(platform, input.platformFamily);
    const role = normalizeInstallSessionRole(input.role);
    if (WINDOWS_FULL_AGENT_PLATFORMS.has(platform) && role !== 'full_agent') throw new AppError('VALIDATION_FAILED', 'Windows Full/Compatibility Agent 安装会话只允许 full_agent 角色');
    if (platform === WINDOWS_ADCS_PLATFORM && role !== 'adcs_agent') throw new AppError('VALIDATION_FAILED', 'Windows AD CS Agent 安装会话只允许 adcs_agent 角色');
    if (platform === 'linux_go_systemd' && role === 'adcs_agent') throw new AppError('VALIDATION_FAILED', 'AD CS Agent 只支持 Windows AD CS 平台');

    const relayPolicy = this.normalizeRelayPolicy(role, input.relayAllowedTargets, input.relayAllowedPorts);

    const zone = normalizeOptionalKey(input.zone ?? 'default') || 'default';
    const enrollmentTokenRecord = this.createEnrollmentToken(tenantId, {
      allowedRoles: [role],
      allowedZones: [zone],
      maxUses: 1,
      ttlSeconds: 1800,
      createdBy: 'agent.install-session',
    }, requestId);
    const now = new Date();
    const id = newId('aginst');
    const bootstrapToken = createInstallBootstrapToken();
    const profile = isWindowsFullAgentPlatform(platform) || platform === WINDOWS_ADCS_PLATFORM
      ? normalizeWindowsInstallProfile(input, id, platform)
      : normalizeLinuxInstallProfile(input);
    const defaultAgentKey = `${INSTALL_AGENT_KEY_PREFIX[platform]}.${id.toLowerCase()}`;
    return {
      id,
      tenantId,
      platform,
      bootstrapToken,
      bootstrapTokenHash: sha256Hex(bootstrapToken),
      bootstrapTokenPreview: bootstrapToken,
      enrollmentTokenRecord,
      enrollmentToken: enrollmentTokenRecord.token,
      agentKey: normalizeKey(input.agentKey ?? defaultAgentKey, 'agentKey'),
      controlPlaneUrl: normalizeControlPlaneUrl(controlPlaneUrl),
      zone,
      role,
      ...(platformFamily ? { platformFamily } : {}),
      startAfterInstall: input.startAfterInstall !== false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INSTALL_SESSION_TTL_MS).toISOString(),
      ...relayPolicy,
      ...profile,
    };
  }

  /**
   * Gateway 安装必须把目标和端口白名单写入配置；Full Agent 不得借安装接口携带任何 Relay 字段。
   */
  normalizeRelayPolicy(
    role: 'full_agent' | 'gateway' | 'adcs_agent',
    targets: string[] | undefined,
    ports: number[] | undefined,
  ): { relayAllowedTargets?: string[]; relayAllowedPorts?: number[] } {
    if (role !== 'gateway') {
      if (targets !== undefined || ports !== undefined) {
        throw new AppError('VALIDATION_FAILED', 'Full Agent 安装不允许携带 Relay 白名单', { reason: 'FULL_AGENT_GATEWAY_FIELDS_REJECTED' });
      }
      return {};
    }
    if (!targets?.length || !ports?.length) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 安装必须显式提供 relayAllowedTargets 和 relayAllowedPorts', {
        reason: 'GATEWAY_RELAY_POLICY_REQUIRED',
      });
    }
    const relayAllowedTargets = [...new Set(targets.map((value, index) => normalizeRelayAllowedTarget(value, index)))];
    const relayAllowedPorts = [...new Set(ports.map((value, index) => normalizeRelayAllowedPort(value, index)))];
    return { relayAllowedTargets, relayAllowedPorts };
  }

  assertMtlsSession(agent: AgentRegistration, certificateFingerprint: string): void {
    if (!agent.certificateFingerprint) throw new AppError('AUTH_FORBIDDEN', 'Agent 未绑定 mTLS 证书指纹', { agentId: agent.id });
    if (agent.certificateFingerprint !== normalizeFingerprint(certificateFingerprint)) {
      throw new AppError('AUTH_FORBIDDEN', 'mTLS 证书指纹不匹配', { agentId: agent.id });
    }
    if (agent.certificateExpiresAt && new Date(agent.certificateExpiresAt).getTime() < Date.now()) {
      throw new AppError('AUTH_FORBIDDEN', 'mTLS 证书已过期', { agentId: agent.id });
    }
  }

  createCertificateAuthority(now = new Date()): AgentCertificateAuthority {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const notBefore = now.toISOString();
    const notAfter = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000).toISOString();
    const certificatePem = createMockSafeCertificatePem({
      subjectCommonName: MOCK_SAFE_CA_COMMON_NAME,
      issuerCommonName: MOCK_SAFE_CA_COMMON_NAME,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      serialNumber: 'ca-' + randomBytes(8).toString('hex'),
      notBefore,
      notAfter,
      ca: true,
    });
    return {
      id: newId('agca'),
      subjectCommonName: MOCK_SAFE_CA_COMMON_NAME,
      certificatePem,
      fingerprintSha256: sha256Hex(certificatePem),
      notBefore,
      notAfter,
    };
  }

  normalizeCertificateSigningRequest(tenantId: string, agent: AgentRegistration, input: { csrPem: string; requestedTtlDays?: number }, createdBy: string, requestId: string): AgentCertificateSigningRequest {
    const parsed = parseMockSafeCsr(input.csrPem);
    const requestedTtlDays = normalizeTtlDays(input.requestedTtlDays ?? 90);
    return {
      id: newId('agcsr'),
      tenantId,
      agentId: agent.id,
      csrPem: parsed.csrPem,
      csrSha256: sha256Hex(parsed.csrPem),
      subjectCommonName: parsed.subjectCommonName,
      publicKeyPem: parsed.publicKeyPem,
      requestedTtlDays,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy,
      requestId,
    };
  }

  issueCertificate(input: {
    tenantId: string;
    agent: AgentRegistration;
    csr: AgentCertificateSigningRequest;
    ca: AgentCertificateAuthority;
    ttlDays?: number;
    issuedBy: string;
    rotatedFromCertificateId?: string;
  }): AgentCertificate {
    if (input.csr.status !== 'pending') throw new AppError('RESOURCE_VERSION_CONFLICT', 'CSR 已经处理过，不能重复签发', { csrId: input.csr.id, status: input.csr.status });
    if (input.csr.agentId !== input.agent.id || input.csr.tenantId !== input.tenantId) throw new AppError('VALIDATION_FAILED', 'CSR 与 Agent 不匹配', { csrId: input.csr.id, agentId: input.agent.id });
    const ttlDays = normalizeTtlDays(input.ttlDays ?? input.csr.requestedTtlDays);
    const now = new Date();
    const notBefore = now.toISOString();
    const notAfter = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const serialNumber = randomBytes(16).toString('hex');
    const certificatePem = createMockSafeCertificatePem({
      subjectCommonName: input.csr.subjectCommonName,
      issuerCommonName: input.ca.subjectCommonName,
      publicKeyPem: input.csr.publicKeyPem,
      serialNumber,
      notBefore,
      notAfter,
      ca: false,
    });
    return {
      id: newId('agcert'),
      tenantId: input.tenantId,
      agentId: input.agent.id,
      csrId: input.csr.id,
      serialNumber,
      certificatePem,
      certificateChainPem: `${certificatePem}\n${input.ca.certificatePem}`.trim(),
      issuerCertificatePem: input.ca.certificatePem,
      fingerprintSha256: sha256Hex(certificatePem),
      subjectCommonName: input.csr.subjectCommonName,
      issuerCommonName: input.ca.subjectCommonName,
      notBefore,
      notAfter,
      status: 'active',
      issuedAt: now.toISOString(),
      issuedBy: input.issuedBy,
      rotatedFromCertificateId: input.rotatedFromCertificateId,
    };
  }

  assertCertificateUsable(certificate: AgentCertificate): void {
    if (certificate.status !== 'active') throw new AppError('AUTH_FORBIDDEN', 'Agent 证书不可用', { certificateId: certificate.id, status: certificate.status });
    if (new Date(certificate.notAfter).getTime() < Date.now()) throw new AppError('AUTH_FORBIDDEN', 'Agent 证书已过期', { certificateId: certificate.id });
    const parsed = parseMockSafeCertificate(certificate.certificatePem);
    if (parsed.fingerprintSha256 !== certificate.fingerprintSha256) {
      throw new AppError('VALIDATION_FAILED', 'Agent 证书指纹与证书材料不一致', { certificateId: certificate.id });
    }
  }

  assertStatusTransition(current: string, next: string): void {
    if (current === 'DISABLED' && next !== 'DISABLED') {
      throw new AppError('VALIDATION_FAILED', 'DISABLED Agent 不能通过心跳自动恢复', { current, next });
    }
  }

  normalizeCapabilitySnapshot(tenantId: string, agentId: string, input: AgentCapabilitySnapshotInput, requestId: string): AgentCapabilitySnapshot {
    if (input.agentId !== agentId) throw new AppError('VALIDATION_FAILED', 'agentId 不一致', { agentId, inputAgentId: input.agentId });
    const capabilities = input.capabilities.map((item, index) => {
      const capabilityKey = normalizeCapabilityKey(item.capabilityKey, `capabilities[${index}].capabilityKey`);
      if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) {
        throw new AppError('VALIDATION_FAILED', 'confidence 必须在 0-1 之间', { index });
      }
      return {
        capabilityKey,
        value: item.value,
        confidence: item.confidence,
        evidence: item.evidence,
      };
    });
    return {
      id: newId('agcap'),
      tenantId,
      agentId,
      compatibilityLevel: input.compatibilityLevel,
      capabilities,
      reportedAt: new Date().toISOString(),
      requestId,
    };
  }

  toCapabilityDeclarations(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): CapabilityDeclaration[] {
    return snapshot.capabilities.map((item) => ({
      id: newId('capdecl'),
      tenantId: snapshot.tenantId,
      targetType: 'agent',
      targetId: agent.id,
      capabilityKey: item.capabilityKey,
      originalCapabilityKey: item.capabilityKey,
      value: item.value,
      parameters: {},
      source: 'agent_report',
      confidence: item.confidence,
      riskLevel: 'low',
      evidence: item.evidence ? { summary: 'Agent 能力快照', details: item.evidence } : { summary: 'Agent 能力快照' },
      detectedAt: snapshot.reportedAt,
      status: 'active',
      createdBy: agent.id,
      auditRef: snapshot.requestId,
    }));
  }

  normalizeTaskLog(tenantId: string, input: SubmitAgentTaskLogInput, requestId: string): AgentTaskLogEntry {
    if (!Number.isInteger(input.sequence) || input.sequence < 0) throw new AppError('VALIDATION_FAILED', '日志 sequence 必须是非负整数');
    const message = String(input.message ?? '');
    if (!message.trim()) throw new AppError('VALIDATION_FAILED', '日志 message 不能为空');
    const redactedMessage = redactSensitive(message);
    return {
      id: newId('aglog'),
      tenantId,
      agentId: input.agentId,
      taskId: input.taskId,
      sequence: input.sequence,
      level: input.level ?? 'info',
      message: redactedMessage,
      redacted: redactedMessage !== message,
      emittedAt: input.emittedAt ?? new Date().toISOString(),
      requestId,
    };
  }

  normalizeRuntimeLog(tenantId: string, input: SubmitAgentRuntimeLogInput, requestId: string): AgentRuntimeLogEntry {
    const summary = normalizeRequired(input.summary, 'summary');
    const redactedSummary = redactSensitive(summary);
    const sanitizedDetail = input.detail ? sanitizeUnknown(input.detail) as Record<string, unknown> : undefined;
    return {
      id: newId('agrtlog'),
      tenantId,
      agentId: normalizeRequired(input.agentId, 'agentId'),
      category: input.category,
      level: input.level ?? 'info',
      summary: redactedSummary,
      detail: sanitizedDetail,
      redacted: redactedSummary !== summary || JSON.stringify(sanitizedDetail ?? {}) !== JSON.stringify(input.detail ?? {}),
      emittedAt: input.emittedAt ?? new Date().toISOString(),
      requestId,
    };
  }

  nextContiguousAckedSequence(existingSequences: number[], lastAckedSequence: number): number {
    const sequences = new Set(existingSequences.filter((sequence) => sequence > lastAckedSequence));
    let cursor = lastAckedSequence;
    while (sequences.has(cursor + 1)) cursor += 1;
    return cursor;
  }

  normalizeRelease(tenantId: string, input: PublishAgentVersionInput): AgentVersionRelease {
    if (!/^[0-9]+(\.[0-9]+){1,3}([-.][a-z0-9.]+)?$/i.test(input.version)) throw new AppError('VALIDATION_FAILED', 'version 格式不合法');
    if (!/^https?:\/\//.test(input.downloadUrl)) throw new AppError('VALIDATION_FAILED', '升级包 downloadUrl 必须是 HTTP(S) 地址');
    if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(input.downloadUrl)) {
      throw new AppError('VALIDATION_FAILED', '生产环境升级包 downloadUrl 必须是 HTTPS');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new AppError('VALIDATION_FAILED', 'checksumSha256 必须是 SHA-256 十六进制');
    if (!input.signature.trim()) throw new AppError('VALIDATION_FAILED', 'signature 必填');
    const releaseRequirements = RELEASE_REQUIREMENTS.get(input.productLine ?? '');
    if (releaseRequirements && (input.platform.toUpperCase() !== releaseRequirements.platform
      || (releaseRequirements.requireArchitecture && !input.arch?.trim())
      || !input.signatureKeyId?.trim()
      || !(input.artifactSize && Number.isInteger(input.artifactSize) && input.artifactSize > 0))) {
      throw new AppError('VALIDATION_FAILED', 'Go Full Agent Release 必须提供匹配平台、架构、制品大小和签名 keyId');
    }
    const rolloutPercent = input.rolloutPercent ?? 100;
    if (rolloutPercent < 0 || rolloutPercent > 100) throw new AppError('VALIDATION_FAILED', 'rolloutPercent 必须在 0-100 之间');
    const now = new Date().toISOString();
    return {
      id: newId('agrel'),
      tenantId,
      version: input.version,
      platform: input.platform.toUpperCase(),
      arch: input.arch,
      productLine: input.productLine,
      signatureKeyId: input.signatureKeyId?.trim() || undefined,
      artifactSignature: input.artifactSignature?.trim() || input.signature,
      artifactSize: input.artifactSize,
      minCompatibilityLevel: input.minCompatibilityLevel,
      downloadUrl: input.downloadUrl,
      checksumSha256: input.checksumSha256.toLowerCase(),
      signature: input.signature,
      rollbackVersion: input.rollbackVersion,
      rolloutPercent,
      status: 'active',
      createdAt: now,
      createdBy: input.createdBy,
    };
  }

  sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    return sanitizeUnknown(payload) as Record<string, unknown>;
  }

  sanitizeResultDetail(detail: Record<string, unknown>): Record<string, unknown> {
    return sanitizeUnknown(detail) as Record<string, unknown>;
  }

  private normalizeGatewayExtension(input: {
    existing?: AgentGatewayExtension;
    zoneIds: string[];
    adapters?: string[];
    capabilities?: string[];
    resourceLimits?: Record<string, unknown>;
    currentLoad?: number;
    maxConcurrentTasks?: number;
    successRate?: number;
    status?: AgentGatewayExtension['status'];
    lastHeartbeatAt?: string;
  }): AgentGatewayExtension {
    const maxConcurrentTasks = normalizeNonNegativeInteger(input.maxConcurrentTasks ?? input.existing?.maxConcurrentTasks ?? 1, 'maxConcurrentTasks');
    const currentLoad = normalizeNonNegativeInteger(input.currentLoad ?? input.existing?.currentLoad ?? 0, 'currentLoad');
    const successRate = normalizeRate(input.successRate ?? input.existing?.successRate ?? 1, 'successRate');
    return {
      zoneIds: input.zoneIds.length ? input.zoneIds : input.existing?.zoneIds ?? [],
      // Gateway 升级后只保留 Relay 能力；旧快照不再继续广播业务转发能力。
      adapters: input.adapters ? normalizeGatewayRouteChannels(input.adapters) : defaultGatewayRouteChannels(),
      capabilities: input.capabilities ? normalizeGatewayCapabilities(input.capabilities) : defaultGatewayCapabilities(),
      resourceLimits: sanitizeUnknown(input.resourceLimits ?? input.existing?.resourceLimits ?? {}) as Record<string, unknown>,
      currentLoad,
      maxConcurrentTasks,
      successRate,
      status: input.status ?? input.existing?.status ?? 'online',
      lastHeartbeatAt: input.lastHeartbeatAt ?? input.existing?.lastHeartbeatAt,
      capabilitySetId: input.existing?.capabilitySetId,
    };
  }
}

function normalizeLinuxPlatformFamily(
  platform: AgentInstallSession['platform'],
  value: LinuxAgentPlatformFamily | undefined,
): LinuxAgentPlatformFamily | undefined {
  if (value === undefined) return undefined;
  if (platform !== 'linux_go_systemd') {
    throw new AppError('VALIDATION_FAILED', 'platformFamily 仅支持 Linux Agent 安装会话');
  }
  if (!['red-hat', 'debian-ubuntu', 'kylin', 'uos'].includes(value)) {
    throw new AppError('VALIDATION_FAILED', '不支持的 Linux 平台系列', { platformFamily: value });
  }
  return value;
}

function normalizeManagementEndpoint(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'managementEndpoint 必须是完整 HTTP(S) 地址');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || !endpoint.port) {
    throw new AppError('VALIDATION_FAILED', 'managementEndpoint 必须包含 HTTP(S) 协议、主机和端口');
  }
  if (['0.0.0.0', '::', '[::]'].includes(endpoint.hostname)) {
    throw new AppError('VALIDATION_FAILED', 'managementEndpoint 不能使用通配监听地址');
  }
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', 'managementEndpoint 端口无效');
  }
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

function defaultGatewayRouteChannels(): string[] {
  return ['relay.tcp'];
}

function defaultGatewayCapabilities(): string[] {
  return ['gateway.relay.tcp'];
}

function normalizeGatewayRouteChannels(values: string[]): string[] {
  return normalizeList(values.map((value) => {
    const normalized = normalizeOptionalKey(value);
    if (normalized === 'relay.tcp') return normalized;
    throw new AppError('VALIDATION_FAILED', 'Gateway 只允许 relay.tcp 网络转发能力，旧业务通道已退役', { value, reason: 'GATEWAY_RELAY_ONLY' });
  }));
}

function normalizeGatewayCapabilities(values: string[]): string[] {
  const normalized = normalizeList(values);
  if (normalized.length === 0) return defaultGatewayCapabilities();
  if (normalized.some((value) => value !== 'gateway.relay.tcp')) {
    throw new AppError('VALIDATION_FAILED', 'Gateway 只允许 gateway.relay.tcp 能力，旧业务能力已退役', { reason: 'GATEWAY_RELAY_ONLY' });
  }
  return ['gateway.relay.tcp'];
}

function hashToken(token: string): string {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) hash = ((hash << 5) - hash + token.charCodeAt(index)) | 0;
  return `tok_${Math.abs(hash).toString(16)}`;
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((item) => normalizeOptionalKey(item)).filter(Boolean))];
}

function normalizeZoneIds(values: string[]): string[] {
  return normalizeList(values);
}

function hasGatewaySignal(input: { adapters?: string[]; capabilities?: string[] }): boolean {
  const adapters = normalizeList(input.adapters ?? []);
  const capabilities = normalizeList(input.capabilities ?? []);
  return adapters.includes('relay.tcp')
    || capabilities.includes('gateway.relay.tcp')
    || adapters.some((item) => item.startsWith('probe.') || item.startsWith('forward.'))
    || capabilities.some((item) => item.startsWith('gateway.'));
}

function normalizeRelayAllowedTarget(value: string, index: number): string {
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_FAILED', `relayAllowedTargets[${index}] 必须是字符串`);
  }
  const normalized = value.trim().toLowerCase().replace(/\.$/u, '');
  if (!normalized || normalized.length > 253 || /[\u0000-\u001f\u007f\s%]/u.test(normalized) || normalized.includes('*')) {
    throw new AppError('VALIDATION_FAILED', `relayAllowedTargets[${index}] 不是合法主机名、IP 或 CIDR`, { value });
  }
  const slashIndex = normalized.indexOf('/');
  if (slashIndex >= 0) {
    const address = normalized.slice(0, slashIndex);
    const prefix = Number(normalized.slice(slashIndex + 1));
    const bits = isIP(address) === 6 ? 128 : isIP(address) === 4 ? 32 : 0;
    if (!bits || !Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
      throw new AppError('VALIDATION_FAILED', `relayAllowedTargets[${index}] CIDR 不合法`, { value });
    }
    return normalized;
  }
  if (isIP(normalized) === 0 && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `relayAllowedTargets[${index}] 不是合法主机名或 IP`, { value });
  }
  return normalized;
}

function normalizeRelayAllowedPort(value: number, index: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppError('VALIDATION_FAILED', `relayAllowedPorts[${index}] 必须是 1-65535 的整数`, { value });
  }
  return value;
}

function normalizeOptionalKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeFingerprint(value: string): string {
  const normalized = normalizeRequired(value, 'certificateFingerprint').replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{16,128}$/.test(normalized)) throw new AppError('VALIDATION_FAILED', '证书指纹格式不合法');
  return normalized;
}

function redactSensitive(message: string): string {
  return message
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/(authorization|token|password|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^secret:\/\/[a-z0-9_/-]+(?:#[a-z0-9_-]+)?$/i.test(value.trim())) return value;
    return redactSensitive(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    // 这些是 Agent v2 合同中的公开绑定标识，不是 bearer token；脱敏会破坏 Receipt 摘要和审计关联。
    if (['tokenId', 'policyDecisionId', 'authorityKeyId', 'revocationRef'].includes(key)) return [key, sanitizeUnknown(item)];
    if (/authorization|token|password|api[_-]?key|secret/i.test(key)) {
      if (typeof item === 'string' && /^secret:\/\/[a-z0-9_/-]+(?:#[a-z0-9_-]+)?$/i.test(item.trim())) return [key, item];
      return [key, '[REDACTED]'];
    }
    return [key, sanitizeUnknown(item)];
  }));
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new AppError('VALIDATION_FAILED', `${field} 必须是非负整数`, { field });
  return value;
}

function normalizeRate(value: number, field: string): number {
  if (typeof value !== 'number' || value < 0 || value > 1) throw new AppError('VALIDATION_FAILED', `${field} 必须在 0-1 之间`, { field });
  return value;
}

function normalizeTtlDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 397) throw new AppError('VALIDATION_FAILED', '证书 ttlDays 必须在 1-397 天之间');
  return value;
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function normalizeKey(value: string, field: string): string {
  const normalized = normalizeRequired(value, field).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.:-]{1,127}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `${field} 格式不合法`, { field });
  }
  return normalized;
}

function normalizeInstallSessionPlatform(value: CreateAgentInstallSessionInput['platform']): AgentInstallSession['platform'] {
  if (value === 'windows_go') return 'windows_go_service';
  if (value === 'windows_compatibility') return 'windows_compatibility_service';
  if (value === 'linux_go') return 'linux_go_systemd';
  if (value === 'windows_adcs') return 'windows_adcs_service';
  throw new AppError('VALIDATION_FAILED', '不支持的 Agent 安装平台', { platform: value });
}

function normalizeInstallSessionRole(value: CreateAgentInstallSessionInput['role']): 'full_agent' | 'gateway' | 'adcs_agent' {
  if (!value) return 'full_agent';
  if (value === 'full_agent' || value === 'gateway' || value === 'adcs_agent') return value;
  throw new AppError('VALIDATION_FAILED', '不支持的 Agent 安装角色', { role: value });
}

function normalizeWindowsInstallProfile(
  input: CreateAgentInstallSessionInput,
  id: string,
  platform: Extract<AgentInstallSession['platform'], 'windows_go_service' | 'windows_compatibility_service' | 'windows_adcs_service'>,
): Pick<AgentInstallSession, 'serviceName' | 'displayName' | 'installRoot' | 'configDir' | 'dataDir' | 'logDir' | 'managementPort'> {
  if (platform === WINDOWS_ADCS_PLATFORM) {
    assertFixedWindowsAdcsProfile(input);
    return WINDOWS_ADCS_PROFILE;
  }
  const compatibility = platform === WINDOWS_COMPATIBILITY_PLATFORM;
  return {
    serviceName: normalizeServiceName(input.serviceName ?? (compatibility ? 'GCACWindowsCompatibilityAgent' : `gcac-agent-${id.slice(-6).toLowerCase()}`)),
    displayName: normalizeOptionalDisplayName(input.displayName) ?? (compatibility ? 'GCAC Windows Compatibility Agent' : 'GCAC Go Full Agent'),
    installRoot: normalizeWindowsPath(input.installRoot ?? (compatibility ? 'C:\\Program Files\\GCAC\\WindowsCompatibilityAgent' : 'C:\\Program Files\\GCAC\\FullAgentGo'), 'installRoot'),
    configDir: normalizeWindowsPath(input.configDir ?? (compatibility ? 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\config' : 'C:\\ProgramData\\GCAC\\FullAgentGo\\config'), 'configDir'),
    dataDir: normalizeWindowsPath(input.dataDir ?? (compatibility ? 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\data' : 'C:\\ProgramData\\GCAC\\FullAgentGo\\data'), 'dataDir'),
    logDir: normalizeWindowsPath(input.logDir ?? (compatibility ? 'C:\\ProgramData\\GCAC\\WindowsCompatibilityAgent\\logs' : 'C:\\ProgramData\\GCAC\\FullAgentGo\\logs'), 'logDir'),
    managementPort: compatibility ? 18932 : 18930,
  };
}

function assertFixedWindowsAdcsProfile(input: CreateAgentInstallSessionInput): void {
  const provided = [
    ['serviceName', input.serviceName, WINDOWS_ADCS_PROFILE.serviceName],
    ['installRoot', input.installRoot, WINDOWS_ADCS_PROFILE.installRoot],
    ['configDir', input.configDir, WINDOWS_ADCS_PROFILE.configDir],
    ['dataDir', input.dataDir, WINDOWS_ADCS_PROFILE.dataDir],
    ['logDir', input.logDir, WINDOWS_ADCS_PROFILE.logDir],
  ] as const;
  for (const [field, value, expected] of provided) {
    if (value !== undefined && value !== expected) {
      throw new AppError('VALIDATION_FAILED', `Windows AD CS Agent 的 ${field} 必须使用固定隔离值`, { field, expected });
    }
  }
}

function normalizeLinuxInstallProfile(input: CreateAgentInstallSessionInput): Pick<AgentInstallSession, 'serviceName' | 'displayName' | 'installRoot' | 'configDir' | 'dataDir' | 'logDir' | 'managementPort'> {
  return {
    serviceName: normalizeServiceName(input.serviceName ?? 'gcac-linux-agent'),
    displayName: normalizeOptionalDisplayName(input.displayName) ?? 'GCAC Linux Go Full Agent',
    installRoot: normalizeUnixPath(input.installRoot ?? '/opt/gcac/linux-agent', 'installRoot'),
    configDir: normalizeUnixPath(input.configDir ?? '/etc/gcac/linux-agent', 'configDir'),
    dataDir: normalizeUnixPath(input.dataDir ?? '/var/lib/gcac/linux-agent', 'dataDir'),
    logDir: normalizeUnixPath(input.logDir ?? '/var/log/gcac/linux-agent', 'logDir'),
    managementPort: 18931,
  };
}

function normalizeServiceName(value: string): string {
  const normalized = normalizeRequired(value, 'serviceName');
  if (!/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', 'serviceName 格式不合法', { serviceName: value });
  }
  return normalized;
}

function normalizeOptionalDisplayName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 120) throw new AppError('VALIDATION_FAILED', 'displayName 不能超过 120 个字符');
  return normalized;
}

function normalizeWindowsPath(value: string, field: string): string {
  const normalized = normalizeRequired(value, field).replace(/\//g, '\\').replace(/\\+$/u, '');
  if (!/^[A-Za-z]:\\/.test(normalized)) throw new AppError('VALIDATION_FAILED', `${field} 必须是 Windows 绝对路径`, { field });
  return normalized;
}

function normalizeUnixPath(value: string, field: string): string {
  const normalized = normalizeRequired(value, field);
  if (!normalized.startsWith('/')) throw new AppError('VALIDATION_FAILED', `${field} 必须是 Linux 绝对路径`, { field });
  return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized;
}

function normalizeControlPlaneUrl(value: string): string {
  try {
    const parsed = new URL(normalizeRequired(value, 'controlPlaneUrl'));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return parsed.origin.replace(/\/+$/u, '');
  } catch {
    throw new AppError('VALIDATION_FAILED', 'controlPlaneUrl 格式不合法', { controlPlaneUrl: value });
  }
}

function createInstallBootstrapToken(): string {
  // 安装入口只暴露短期一次性数字码，内部仍只保存 SHA-256 摘要。
  return randomInt(10_000_000, 100_000_000).toString();
}

function normalizeCapabilityKey(value: string, field: string): string {
  const normalized = normalizeRequired(value, field).toLowerCase();
  if (!/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '能力键格式不合法', { field, value });
  }
  return normalized;
}

interface MockSafeCertificatePayload {
  kind: 'GCAC_AGENT_MOCK_SAFE_CERTIFICATE_V1';
  subjectCommonName: string;
  issuerCommonName: string;
  publicKeyPem: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  ca: boolean;
}

interface MockSafeCsrPayload {
  kind: 'GCAC_AGENT_MOCK_SAFE_CSR_V1';
  subjectCommonName: string;
  publicKeyPem: string;
}

function parseMockSafeCsr(csrPem: string): { csrPem: string; subjectCommonName: string; publicKeyPem: string } {
  const normalized = normalizePem(csrPem, 'CERTIFICATE REQUEST');
  const payload = parsePemJson<MockSafeCsrPayload>(normalized, 'CERTIFICATE REQUEST');
  if (payload.kind !== 'GCAC_AGENT_MOCK_SAFE_CSR_V1') throw new AppError('CERT_PARSE_FAILED', 'CSR 不是 GCAC Agent mock-safe 格式');
  const subjectCommonName = normalizeRequired(payload.subjectCommonName, 'subjectCommonName').toLowerCase();
  const publicKeyPem = normalizePublicKeyPem(payload.publicKeyPem);
  return { csrPem: normalized, subjectCommonName, publicKeyPem };
}

function createMockSafeCertificatePem(payload: Omit<MockSafeCertificatePayload, 'kind'>): string {
  return wrapPem('CERTIFICATE', JSON.stringify({ kind: 'GCAC_AGENT_MOCK_SAFE_CERTIFICATE_V1', ...payload }));
}

function parseMockSafeCertificate(certificatePem: string): MockSafeCertificatePayload & { fingerprintSha256: string } {
  const normalized = normalizePem(certificatePem, 'CERTIFICATE');
  const payload = parsePemJson<MockSafeCertificatePayload>(normalized, 'CERTIFICATE');
  if (payload.kind !== 'GCAC_AGENT_MOCK_SAFE_CERTIFICATE_V1') throw new AppError('CERT_PARSE_FAILED', '证书不是 GCAC Agent mock-safe 格式');
  return { ...payload, fingerprintSha256: sha256Hex(normalized) };
}

function parsePemJson<T>(pem: string, label: string): T {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s+/g, '');
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch (error) {
    throw new AppError('CERT_PARSE_FAILED', `${label} PEM 内容不能解析`, { reason: error instanceof Error ? error.message : String(error) });
  }
}

function normalizePem(value: string, label: string): string {
  const trimmed = normalizeRequired(value, label);
  const pattern = new RegExp(`^-----BEGIN ${label}-----\\n?[A-Za-z0-9_-]+\\n?-----END ${label}-----$`);
  if (!pattern.test(trimmed)) throw new AppError('CERT_PARSE_FAILED', `${label} PEM 格式不合法`);
  const body = trimmed
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s+/g, '');
  return wrapPem(label, Buffer.from(body, 'base64url').toString('utf8'));
}

function wrapPem(label: string, json: string): string {
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

function normalizePublicKeyPem(value: string): string {
  const trimmed = normalizeRequired(value, 'publicKeyPem');
  try {
    return createPublicKey(trimmed).export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    try {
      return createPublicKey(createPrivateKey(trimmed)).export({ type: 'spki', format: 'pem' }).toString();
    } catch (error) {
      throw new AppError('CERT_PARSE_FAILED', 'CSR publicKeyPem 不合法', { reason: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function createMockSafeAgentCsrPem(subjectCommonName: string): { csrPem: string; privateKeyPem: string; publicKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    csrPem: wrapPem('CERTIFICATE REQUEST', JSON.stringify({
      kind: 'GCAC_AGENT_MOCK_SAFE_CSR_V1',
      subjectCommonName: normalizeRequired(subjectCommonName, 'subjectCommonName').toLowerCase(),
      publicKeyPem,
    } satisfies MockSafeCsrPayload)),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem,
  };
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
