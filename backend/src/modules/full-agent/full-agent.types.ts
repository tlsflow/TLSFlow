import type { AgentCapabilitySnapshot, AgentTaskEnvelope, AgentTaskLogEntry } from '../agents/schema/agents.schema.js';

export type LocalTaskStatus = 'received' | 'recovering' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'rejected';

export interface FullAgentConfig {
  tenantId: string;
  agentKey: string;
  hostname: string;
  version: string;
  osType: string;
  arch: string;
  dataDir: string;
  dryRunDefault: boolean;
  heartbeatIntervalSeconds: number;
  capabilityVersionSeed?: string;
}

export interface FullAgentIdentity {
  agentId: string;
  agentKey: string;
  role: 'full_agent';
  tenantId: string;
  hostname: string;
  version: string;
  osType: string;
  arch: string;
  registeredAt: string;
  capabilityVersion?: string;
}

export interface LocalTask {
  taskId: string;
  idempotencyKey: string;
  executionRunId: string;
  executionStepId: string;
  payloadFingerprint: string;
  status: LocalTaskStatus;
  leaseId?: string;
  result?: StepExecutionResultLike;
  receivedAt: string;
  updatedAt: string;
}

export interface LocalTaskLedgerSnapshot {
  tasks: LocalTask[];
}

export interface MockExecutionInput {
  task: AgentTaskEnvelope;
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface StepExecutionResultLike {
  executionRunId: string;
  executionStepId: string;
  taskId: string;
  success: boolean;
  status: 'succeeded' | 'failed' | 'timeout' | 'dry_run';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  detail: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface CapabilityDetectorFixture {
  osType?: string;
  arch?: string;
  processExec?: boolean;
  fileWrite?: boolean;
  serviceControl?: boolean;
  runtime?: 'node' | 'go' | 'rust' | 'unknown';
  extraCapabilities?: Array<{
    capabilityKey: string;
    value: unknown;
    confidence?: number;
    evidence?: Record<string, unknown>;
  }>;
}

export interface DetectedCapabilities {
  capabilityVersion: string;
  compatibilityLevel: 'L3' | 'L4';
  capabilities: AgentCapabilitySnapshot['capabilities'];
}

export interface ControlPlaneTaskLogInput {
  taskId: string;
  sequence: number;
  level?: AgentTaskLogEntry['level'];
  message: string;
}

export interface FullAgentRunOnceResult {
  identity: FullAgentIdentity;
  heartbeat: unknown;
  task?: LocalTask;
  execution?: StepExecutionResultLike;
  submittedResult?: AgentTaskEnvelope;
  logs: AgentTaskLogEntry[];
}
