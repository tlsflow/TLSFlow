import type { AgentStatus, CompatibilityLevel } from '../../../shared/enums/core.enums.js';
import type { AgentCapabilitySnapshot, AgentDescriptor, AgentHeartbeat, AgentRegistration, AgentTaskEnvelope, AgentTaskLogEntry, AgentUpgradePlan, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';
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
  certificateFingerprint?: string;
  certificateExpiresAt?: string;
}

export interface AgentHeartbeatInput {
  agentId: string;
  status?: AgentStatus;
  version: string;
  taskSummary?: AgentHeartbeat['taskSummary'];
}

export interface AgentCapabilitySnapshotInput {
  agentId: string;
  compatibilityLevel?: CompatibilityLevel;
  capabilities: AgentCapabilitySnapshot['capabilities'];
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

export interface SubmitAgentTaskLogInput {
  agentId: string;
  taskId: string;
  sequence: number;
  level?: AgentTaskLogEntry['level'];
  message: string;
  emittedAt?: string;
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

export interface EnrollmentTokenDto extends EnrollmentToken {
  token?: string;
}
export interface AgentRegistrationDto extends AgentRegistration {}
export interface AgentDescriptorDto extends AgentDescriptor {}
export interface AgentCapabilitySnapshotDto extends AgentCapabilitySnapshot {}
export interface AgentTaskEnvelopeDto extends AgentTaskEnvelope {}
export interface AgentTaskLogEntryDto extends AgentTaskLogEntry {}
export interface AgentVersionReleaseDto extends AgentVersionRelease {}
export interface AgentUpgradePlanDto extends AgentUpgradePlan {}

export interface AgentCapabilityProjection {
  agentId: string;
  declarations: CapabilityDeclaration[];
}
