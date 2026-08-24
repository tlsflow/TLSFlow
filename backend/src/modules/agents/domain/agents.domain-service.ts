import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityDeclaration } from '../../../shared/contracts/capability-contracts.js';
import { newId } from '../../../shared/id.js';
import type { AgentCapabilitySnapshotInput, CreateEnrollmentTokenInput, PublishAgentVersionInput, RegisterAgentInput, SubmitAgentTaskLogInput } from '../dto/agents.dto.js';
import type { AgentCapabilitySnapshot, AgentDescriptor, AgentRegistration, AgentTaskLogEntry, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';

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
      hostname,
      version,
      osType,
      arch: input.arch?.trim(),
      labels: [...new Set((input.labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean))],
    };
  }

  assertEnrollmentAllowed(token: EnrollmentToken, input: RegisterAgentInput): void {
    const now = Date.now();
    if (token.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '注册令牌不可用', { status: token.status });
    if (new Date(token.expiresAt).getTime() < now) throw new AppError('AUTH_FORBIDDEN', '注册令牌已过期', { tokenId: token.id });
    if (token.usedCount >= token.maxUses) throw new AppError('AUTH_FORBIDDEN', '注册令牌使用次数已耗尽', { tokenId: token.id });
    const role = normalizeOptionalKey(input.role ?? 'full_agent');
    const zone = normalizeOptionalKey(input.zone ?? 'default');
    if (!token.allowedRoles.includes(role)) throw new AppError('AUTH_FORBIDDEN', '注册令牌 role 不匹配', { role });
    if (!token.allowedZones.includes(zone)) throw new AppError('AUTH_FORBIDDEN', '注册令牌 zone 不匹配', { zone });
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
}

function hashToken(token: string): string {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) hash = ((hash << 5) - hash + token.charCodeAt(index)) | 0;
  return `tok_${Math.abs(hash).toString(16)}`;
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((item) => normalizeOptionalKey(item)).filter(Boolean))];
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
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '能力键格式不合法', { field, value });
  }
  return normalized;
}
