import type { AgentStatus, CompatibilityLevel } from '../../../shared/enums/core.enums.js';

export type AgentTaskStatus = 'queued' | 'leased' | 'acked' | 'succeeded' | 'failed' | 'rejected';
export type EnrollmentTokenStatus = 'active' | 'expired' | 'exhausted' | 'revoked';
export type AgentUpgradeStatus =
  | 'planned'
  | 'approved'
  | 'dispatching'
  | 'accepted'
  | 'running'
  | 'retrying'
  | 'transport_failed'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'rejected'
  | 'unknown'
  | 'manual_required';
export type AgentCertificateSigningRequestStatus = 'pending' | 'signed' | 'rejected' | 'superseded';
export type AgentCertificateStatus = 'active' | 'rotated' | 'revoked' | 'expired';
export type AgentInstallSessionPlatform = 'windows_go_service' | 'windows_compatibility_service' | 'windows_adcs_service' | 'linux_go_systemd';
export type AgentInstallSessionRole = 'full_agent' | 'gateway' | 'adcs_agent';

export interface EnrollmentToken {
  id: string;
  tenantId: string;
  tokenHash: string;
  tokenPreview: string;
  allowedRoles: string[];
  allowedZones: string[];
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  status: EnrollmentTokenStatus;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  auditRef?: string;
}

export interface AgentDescriptor {
  agentKey: string;
  machineId?: string;
  hostname: string;
  /** Windows AD CS 本机 CA 显示名称，用于 issuing backend 的业务命名。 */
  caName?: string;
  version: string;
  osType: string;
  arch?: string;
  ipAddress?: string;
  /**
   * Agent 仅用于管理 TCP 健康探测的 HTTP 端点。
   * 它不提供任务执行入口，所有动作仍必须通过控制面任务队列。
   */
  managementEndpoint?: string;
  linuxDistribution?: string;
  osVersion?: string;
  labels: string[];
}

export interface AgentGatewayExtension {
  zoneIds: string[];
  adapters: string[];
  capabilities: string[];
  resourceLimits: Record<string, unknown>;
  currentLoad: number;
  maxConcurrentTasks: number;
  successRate: number;
  status: 'online' | 'offline' | 'disabled' | 'revoked' | 'upgrading';
  lastHeartbeatAt?: string;
  capabilitySetId?: string;
}

export interface AgentRegistration {
  id: string;
  tenantId: string;
  agentKey: string;
  descriptor: AgentDescriptor;
  role?: string;
  zone?: string;
  gateway?: AgentGatewayExtension;
  enrollmentTokenId?: string;
  certificateFingerprint?: string;
  certificateExpiresAt?: string;
  status: AgentStatus;
  registeredAt: string;
  updatedAt: string;
  lastRequestId?: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  certificateRevoked?: boolean;
  version: number;
}

export interface AgentSession {
  id: string;
  tenantId: string;
  agentId: string;
  status: 'active' | 'closed';
  certificateFingerprint: string;
  certificateExpiresAt?: string;
  createdAt: string;
  lastSeenAt: string;
  requestId: string;
}

export interface AgentCertificateSigningRequest {
  id: string;
  tenantId: string;
  agentId: string;
  csrPem: string;
  csrSha256: string;
  subjectCommonName: string;
  publicKeyPem: string;
  requestedTtlDays: number;
  status: AgentCertificateSigningRequestStatus;
  createdAt: string;
  createdBy: string;
  signedCertificateId?: string;
  signedAt?: string;
  requestId: string;
}

export interface AgentCertificateAuthority {
  id: string;
  subjectCommonName: string;
  certificatePem: string;
  fingerprintSha256: string;
  notBefore: string;
  notAfter: string;
}

export interface AgentCertificate {
  id: string;
  tenantId: string;
  agentId: string;
  csrId: string;
  serialNumber: string;
  certificatePem: string;
  certificateChainPem: string;
  issuerCertificatePem: string;
  fingerprintSha256: string;
  subjectCommonName: string;
  issuerCommonName: string;
  notBefore: string;
  notAfter: string;
  status: AgentCertificateStatus;
  issuedAt: string;
  issuedBy: string;
  rotatedFromCertificateId?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
}

export interface AgentHeartbeat {
  tenantId: string;
  agentId: string;
  status: AgentStatus;
  version: string;
  runtimeHealth?: AgentRuntimeHealth;
  gateway?: AgentGatewayExtension;
  taskSummary: {
    running: number;
    queued: number;
    succeeded?: number;
    failed?: number;
  };
  receivedAt: string;
  requestId: string;
}

export interface AgentCapabilitySnapshot {
  id: string;
  tenantId: string;
  agentId: string;
  compatibilityLevel?: CompatibilityLevel;
  capabilities: Array<{
    capabilityKey: string;
    value: unknown;
    confidence: number;
    evidence?: Record<string, unknown>;
  }>;
  reportedAt: string;
  requestId: string;
}

export interface AgentTaskLogEntry {
  id: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  sequence: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  redacted: boolean;
  emittedAt: string;
  requestId: string;
}

export interface AgentRuntimeHealth {
  modelVersion: string;
  status: 'healthy' | 'degraded' | 'failed' | 'unknown';
  pendingResultCount?: number;
  recoverableTaskCount?: number;
  lastRecoveryAt?: string;
  lastTaskPollAt?: string;
  lastTaskResultAt?: string;
  lastSelfCheckAt?: string;
  lastError?: string;
  degradedReasons?: string[];
  failureCounts?: {
    heartbeat?: number;
    taskPoll?: number;
    recovery?: number;
  };
}

export interface AgentRuntimeLogEntry {
  id: string;
  tenantId: string;
  agentId: string;
  category: 'manual_rescan' | 'heartbeat' | 'capability_report';
  level: 'debug' | 'info' | 'warn' | 'error';
  summary: string;
  detail?: Record<string, unknown>;
  redacted: boolean;
  emittedAt: string;
  requestId: string;
}

export interface AgentTaskLogCursor {
  tenantId: string;
  agentId: string;
  taskId: string;
  lastAckedSequence: number;
  updatedAt: string;
  requestId: string;
}

export interface AgentTaskEnvelope {
  id: string;
  tenantId: string;
  agentId: string;
  executionRunId: string;
  executionStepId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: AgentTaskStatus;
  leaseId?: string;
  ackedAt?: string;
  resultAt?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  requestId: string;
}

export interface AgentVersionRelease {
  id: string;
  tenantId: string;
  version: string;
  platform: string;
  arch?: string;
  /** UpgradeEnvelope 使用的稳定产品线标识；旧 Release 没有时按 Agent 注册事实推导。 */
  productLine?: 'windows-go-full' | 'linux-go-full' | 'windows-compat-full' | 'gateway';
  /** 制品签名使用的独立 keyId；旧字段 signature 仍保留作为签名值兼容。 */
  signatureKeyId?: string;
  artifactSignature?: string;
  artifactSize?: number;
  minCompatibilityLevel?: string;
  downloadUrl: string;
  checksumSha256: string;
  signature: string;
  rollbackVersion?: string;
  rolloutPercent: number;
  status: 'active' | 'paused' | 'revoked';
  createdAt: string;
  createdBy: string;
}

export interface AgentUpgradePlan {
  id: string;
  tenantId: string;
  agentId: string;
  releaseId: string;
  transactionId?: string;
  releaseDigest?: string;
  currentVersion?: string;
  targetVersion: string;
  idempotencyKey?: string;
  actorId?: string;
  approvalRef?: string;
  policyRef?: string;
  attempt?: number;
  status: AgentUpgradeStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
}

export interface AgentInstallSession {
  id: string;
  tenantId: string;
  platform: AgentInstallSessionPlatform;
  bootstrapTokenHash: string;
  bootstrapTokenPreview: string;
  enrollmentToken: string;
  agentKey: string;
  controlPlaneUrl: string;
  zone: string;
  role: AgentInstallSessionRole;
  startAfterInstall: boolean;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedByIp?: string;
  serviceName: string;
  displayName: string;
  installRoot: string;
  configDir: string;
  dataDir: string;
  logDir: string;
  managementPort?: number;
  relayAllowedTargets?: string[];
  relayAllowedPorts?: number[];
}
