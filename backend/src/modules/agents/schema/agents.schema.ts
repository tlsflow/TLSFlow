import type { AgentStatus, CompatibilityLevel } from '../../../shared/enums/core.enums.js';

export type AgentTaskStatus = 'queued' | 'leased' | 'acked' | 'succeeded' | 'failed' | 'rejected';
export type EnrollmentTokenStatus = 'active' | 'expired' | 'exhausted' | 'revoked';
export type AgentUpgradeStatus = 'planned' | 'accepted' | 'succeeded' | 'failed' | 'rolled_back' | 'manual_required';

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
  hostname: string;
  version: string;
  osType: string;
  arch?: string;
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

export interface AgentHeartbeat {
  tenantId: string;
  agentId: string;
  status: AgentStatus;
  version: string;
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
  targetVersion: string;
  status: AgentUpgradeStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
}
