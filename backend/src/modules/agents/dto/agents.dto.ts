import type { AgentStatus, CompatibilityLevel } from '../../../shared/enums/core.enums.js';
import type { AgentCapabilitySnapshot, AgentCertificate, AgentCertificateAuthority, AgentCertificateSigningRequest, AgentDescriptor, AgentGatewayExtension, AgentHeartbeat, AgentInstallSession, AgentRegistration, AgentTaskEnvelope, AgentTaskLogCursor, AgentTaskLogEntry, AgentUpgradePlan, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';
import type { CapabilityDeclaration } from '../../../shared/contracts/capability-contracts.js';

export interface CreateEnrollmentTokenInput {
  allowedRoles?: string[];
  allowedZones?: string[];
  maxUses?: number;
  ttlSeconds?: number;
  createdBy: string;
}

export interface RegisterAgentInput {
  agentKey: string;
  hostname: string;
  version: string;
  osType: string;
  arch?: string;
  labels?: string[];
  enrollmentToken?: string;
  role?: string;
  zone?: string;
  zoneIds?: string[];
  adapters?: string[];
  capabilities?: string[];
  resourceLimits?: Record<string, unknown>;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
  certificateFingerprint?: string;
  certificateExpiresAt?: string;
}

export interface AgentHeartbeatInput {
  agentId: string;
  status?: AgentStatus;
  version: string;
  taskSummary?: AgentHeartbeat['taskSummary'];
  adapters?: string[];
  capabilities?: string[];
  resourceLimits?: Record<string, unknown>;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
}

export interface AgentCapabilitySnapshotInput {
  agentId: string;
  compatibilityLevel?: CompatibilityLevel;
  capabilities: AgentCapabilitySnapshot['capabilities'];
  adapters?: string[];
  resourceLimits?: Record<string, unknown>;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
}

export interface EnqueueAgentTaskInput {
  agentId: string;
  executionRunId: string;
  executionStepId: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export interface AckAgentTaskInput {
  agentId: string;
  taskId: string;
  leaseId: string;
}

export interface SubmitAgentTaskResultInput {
  agentId: string;
  taskId: string;
  leaseId: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
}

export interface CreateAgentSessionInput {
  agentId: string;
  certificateFingerprint: string;
}

export interface CreateAgentCertificateSigningRequestInput {
  agentId: string;
  csrPem: string;
  requestedTtlDays?: number;
}

export interface SignAgentCertificateInput {
  agentId: string;
  csrId: string;
  ttlDays?: number;
  issuedBy: string;
}

export interface RotateAgentCertificateInput {
  agentId: string;
  csrPem: string;
  ttlDays?: number;
  issuedBy: string;
}

export interface RevokeAgentCertificateInput {
  agentId: string;
  certificateId: string;
  reason?: string;
  revokedBy: string;
}

export interface SubmitAgentTaskLogInput {
  agentId: string;
  taskId: string;
  sequence: number;
  level?: AgentTaskLogEntry['level'];
  message: string;
  emittedAt?: string;
}

export interface SubmitAgentTaskLogsInput {
  agentId: string;
  taskId: string;
  logs: Array<Omit<SubmitAgentTaskLogInput, 'agentId' | 'taskId'>>;
}

export interface PublishAgentVersionInput {
  version: string;
  platform: string;
  arch?: string;
  minCompatibilityLevel?: string;
  downloadUrl: string;
  checksumSha256: string;
  signature: string;
  rollbackVersion?: string;
  rolloutPercent?: number;
  createdBy: string;
}

export interface CheckAgentUpgradeInput {
  agentId: string;
}

export interface SubmitAgentUpgradeResultInput {
  agentId: string;
  planId: string;
  success: boolean;
  rolledBack?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface DisableAgentInput {
  agentId: string;
  reason?: string;
  revokeCertificate?: boolean;
  actorId: string;
}

export interface CreateWindowsPowerShellInstallSessionInput {
  zone?: string;
  serviceName?: string;
  displayName?: string;
  installRoot?: string;
  configDir?: string;
  dataDir?: string;
  logDir?: string;
  startAfterInstall?: boolean;
}

export interface CreateLinuxGoInstallSessionInput {
  zone?: string;
  agentKey?: string;
  serviceName?: string;
  displayName?: string;
  installRoot?: string;
  configDir?: string;
  dataDir?: string;
  logDir?: string;
}

export interface EnrollmentTokenDto extends EnrollmentToken {
  token?: string;
}
export interface AgentRegistrationDto extends AgentRegistration {}
export interface AgentDescriptorDto extends AgentDescriptor {}
export interface AgentGatewayExtensionDto extends AgentGatewayExtension {}
export interface AgentCapabilitySnapshotDto extends AgentCapabilitySnapshot {}
export interface AgentCertificateSigningRequestDto extends AgentCertificateSigningRequest {}
export interface AgentCertificateAuthorityDto extends AgentCertificateAuthority {}
export interface AgentCertificateDto extends AgentCertificate {}
export interface AgentTaskEnvelopeDto extends AgentTaskEnvelope {}
export interface AgentTaskLogEntryDto extends AgentTaskLogEntry {}
export interface AgentTaskLogCursorDto extends AgentTaskLogCursor {}
export interface AgentVersionReleaseDto extends AgentVersionRelease {}
export interface AgentUpgradePlanDto extends AgentUpgradePlan {}
export interface AgentInstallSessionDto extends AgentInstallSession {}

export interface AgentCertificateIssueResult {
  csr: AgentCertificateSigningRequest;
  certificate: AgentCertificate;
  ca: AgentCertificateAuthority;
}

export interface AgentCertificateRotateResult extends AgentCertificateIssueResult {
  previousCertificate?: AgentCertificate;
}

export interface AgentTaskLogAckResult {
  agentId: string;
  taskId: string;
  acceptedSequences: number[];
  duplicateSequences: number[];
  rejectedSequences: number[];
  ackedSequence: number;
  lastAckedSequence: number;
}

export interface AgentLifecycleProjection {
  status: AgentStatus;
  disabled: boolean;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  certificateRevoked: boolean;
  canHeartbeat: boolean;
  canPullTasks: boolean;
}

export interface AgentTaskQueueProjection {
  agentId: string;
  counts: Record<AgentTaskEnvelope['status'], number>;
  tasks: AgentTaskEnvelope[];
}

export interface AgentUpgradePreview {
  status: 'available' | 'manual_required' | 'not_required';
  reason: string;
  targetVersion?: string;
  releaseId?: string;
  downloadUrl?: string;
  checksumSha256?: string;
  signature?: string;
  rollbackVersion?: string;
  existingPlan?: AgentUpgradePlan;
}

export interface AgentUpgradeSuggestionProjection {
  agentId: string;
  currentVersion: string;
  suggestion: AgentUpgradePreview;
}

export interface AgentInstallSessionBootstrapProjection {
  sessionId: string;
  platform: 'windows_powershell_service' | 'linux_go_systemd';
  expiresAt: string;
  bootstrapUrl: string;
  manifestUrl: string;
  installCommand: string;
  enrollmentToken?: string;
  serviceName: string;
  displayName: string;
  installRoot: string;
  configDir: string;
  dataDir?: string;
  logDir: string;
  agentKey: string;
  tenantId?: string;
  zone: string;
  enrollmentTokenPreview: string;
  bundleUrl?: string;
}

export interface AgentDetailProjection {
  agent: AgentRegistration;
  lifecycle: AgentLifecycleProjection;
  latestHeartbeat?: AgentHeartbeat;
  capabilitySnapshot?: AgentCapabilitySnapshot;
  capabilities: AgentCapabilityProjection;
  taskQueue: AgentTaskQueueProjection;
  upgradeSuggestion: AgentUpgradeSuggestionProjection;
  recentErrors: AgentTaskLogEntry[];
}

export interface AgentCapabilityProjection {
  agentId: string;
  declarations: CapabilityDeclaration[];
}
