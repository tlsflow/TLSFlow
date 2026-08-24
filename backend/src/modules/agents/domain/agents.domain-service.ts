import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityDeclaration } from '../../../shared/contracts/capability-contracts.js';
import { newId } from '../../../shared/id.js';
import type { AgentCapabilitySnapshotInput, CreateEnrollmentTokenInput, PublishAgentVersionInput, RegisterAgentInput, SubmitAgentRuntimeLogInput, SubmitAgentTaskLogInput } from '../dto/agents.dto.js';
import type { AgentCapabilitySnapshot, AgentCertificate, AgentCertificateAuthority, AgentCertificateSigningRequest, AgentDescriptor, AgentGatewayExtension, AgentRegistration, AgentRuntimeLogEntry, AgentTaskLogEntry, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';

const MOCK_SAFE_CA_COMMON_NAME = 'GCAC Agent Mock Safe CA';

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
      version,
      osType,
      arch: input.arch?.trim(),
      ipAddress: input.ipAddress?.trim(),
      linuxDistribution: input.linuxDistribution?.trim(),
      osVersion: input.osVersion?.trim(),
      labels: [...new Set((input.labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean))],
    };
  }

  normalizeGatewayOnRegister(input: RegisterAgentInput, existing?: AgentGatewayExtension): AgentGatewayExtension | undefined {
    const role = normalizeOptionalKey(input.role ?? '');
    const gatewaySignal = role === 'gateway' || hasGatewaySignal(input) || Boolean(existing);
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
    if (agent.role !== 'gateway' && !agent.gateway) return undefined;
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
    if (agent.role !== 'gateway' && !agent.gateway) return undefined;
    return this.normalizeGatewayExtension({
      existing: agent.gateway,
      zoneIds: agent.gateway?.zoneIds ?? (agent.zone ? [agent.zone] : []),
      adapters: input.adapters,
      capabilities: input.capabilities.map((item) => item.capabilityKey),
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
    if (!/^https:\/\//.test(input.downloadUrl)) throw new AppError('VALIDATION_FAILED', '升级包 downloadUrl 必须是 HTTPS');
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new AppError('VALIDATION_FAILED', 'checksumSha256 必须是 SHA-256 十六进制');
    if (!input.signature.trim()) throw new AppError('VALIDATION_FAILED', 'signature 必填');
    const rolloutPercent = input.rolloutPercent ?? 100;
    if (rolloutPercent < 0 || rolloutPercent > 100) throw new AppError('VALIDATION_FAILED', 'rolloutPercent 必须在 0-100 之间');
    const now = new Date().toISOString();
    return {
      id: newId('agrel'),
      tenantId,
      version: input.version,
      platform: input.platform.toUpperCase(),
      arch: input.arch,
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
      adapters: normalizeGatewayRouteChannels(input.adapters ?? input.existing?.adapters ?? defaultGatewayRouteChannels()),
      capabilities: normalizeList(input.capabilities ?? input.existing?.capabilities ?? defaultGatewayCapabilities()),
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

function defaultGatewayRouteChannels(): string[] {
  return ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task'];
}

function defaultGatewayCapabilities(): string[] {
  return ['gateway.probe.tcp', 'gateway.probe.http', 'gateway.probe.agent', 'gateway.forward.agent_task'];
}

function normalizeGatewayRouteChannels(values: string[]): string[] {
  return normalizeList(values.map((value) => {
    const normalized = normalizeOptionalKey(value);
    if (['http', 'https', 'curl', 'probe.http'].includes(normalized)) return 'probe.http';
    if (['tcp', 'tls', 'probe.tcp'].includes(normalized)) return 'probe.tcp';
    if (['agent', 'probe.agent'].includes(normalized)) return 'probe.agent';
    if (['agent_task', 'forward.agent_task', 'gateway.forward.agent_task'].includes(normalized)) return 'forward.agent_task';
    if (['direct_control', 'forward.direct_control', 'gateway.forward.direct_control'].includes(normalized)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 旧 Direct Control 能力已退役，只允许 forward.agent_task', { value });
    }
    return normalized;
  }));
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

function hasGatewaySignal(input: RegisterAgentInput): boolean {
  const adapters = normalizeList(input.adapters ?? []);
  const capabilities = normalizeList(input.capabilities ?? []);
  return adapters.some((item) => item.startsWith('probe.') || item.startsWith('forward.'))
    || capabilities.some((item) => item.startsWith('gateway.'));
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
