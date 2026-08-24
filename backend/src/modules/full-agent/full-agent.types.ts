import type { AgentCapabilitySnapshot, AgentTaskEnvelope, AgentTaskLogEntry } from '../agents/schema/agents.schema.js';

export type LocalTaskStatus = 'received' | 'recovering' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'rejected';
export type ProviderPermission = 'file.read' | 'file.write' | 'process.exec' | 'service.control' | 'secret.read' | 'backup.write';

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
  status: 'succeeded' | 'failed' | 'timeout' | 'dry_run' | 'rejected';
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

export interface ProviderDescriptor {
  name: string;
  version: string;
  actions: string[];
  requiredCapabilities: string[];
  permissions: ProviderPermission[];
}

export interface ProviderResultLike {
  success: boolean;
  status?: StepExecutionResultLike['status'];
  stdout?: string;
  stderr?: string;
  detail?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderContext {
  task: AgentTaskEnvelope;
  action: string;
  dryRun: boolean;
  tempDir: string;
  capabilities: DetectedCapabilities;
  secrets: SecretSession;
  backup: BackupManager;
  verify: VerifyManager;
  rollback: RollbackManager;
  executor: MockLocalExecutorContract;
  log(level: AgentTaskLogEntry['level'], message: string, detail?: Record<string, unknown>): void;
}

export interface ProviderRuntimeInput {
  task: AgentTaskEnvelope;
  dryRun?: boolean;
  capabilities: DetectedCapabilities;
  timeoutMs?: number;
}

export interface ProviderRuntimeLog {
  level: AgentTaskLogEntry['level'];
  message: string;
  detail?: Record<string, unknown>;
}

export interface ProviderRuntimeExecution {
  result: StepExecutionResultLike;
  logs: ProviderRuntimeLog[];
}

export interface MockProvider {
  descriptor: ProviderDescriptor;
  execute(context: ProviderContext): ProviderResultLike;
}

export interface SecretSession {
  put(ref: string, value: string): void;
  get(ref: string): string | undefined;
  cleanup(): SecretCleanupReport;
  snapshot(): Record<string, string>;
}

export interface SecretCleanupReport {
  cachedSecretCount: number;
  tempPlaintextCount: number;
  cleaned: boolean;
}

export interface MockLocalExecutorContract {
  execute(input: MockExecutionInput): StepExecutionResultLike;
}

export interface BackupManifest {
  backupId: string;
  taskId: string;
  createdAt: string;
  items: Array<{
    kind: 'file' | 'config' | 'binding' | 'keystore';
    target: string;
    digest: string;
  }>;
  rollbackActions: Array<{
    type: 'restore_mock_artifact' | 'restore_file_artifact';
    target: string;
    digest: string;
    backupPath?: string;
    existed?: boolean;
  }>;
  checksum: string;
}

export interface BackupResult {
  success: boolean;
  manifest?: BackupManifest;
  errorCode?: string;
  errorMessage?: string;
}

export interface VerifyReport {
  success: boolean;
  checkedAt: string;
  checks: Array<{
    name: string;
    success: boolean;
    detail?: Record<string, unknown>;
  }>;
  errorCode?: string;
  errorMessage?: string;
}

export interface RollbackResult {
  status: 'rolled_back' | 'manual_intervention_required' | 'skipped';
  success: boolean;
  rolledBackAt: string;
  restoredTargets: string[];
  verify?: VerifyReport;
  errorCode?: string;
  errorMessage?: string;
}

export interface UpgradePlanLike {
  planId: string;
  targetVersion: string;
  packageSha256: string;
  signature: string;
  rollbackVersion: string;
  maintenanceWindowOpen?: boolean;
  simulate?: 'success' | 'hash_mismatch' | 'signature_invalid' | 'startup_failure';
}

export interface UpgradeResult {
  status: 'succeeded' | 'rejected' | 'rolled_back';
  currentVersion: string;
  targetVersion: string;
  rollbackVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  detail: Record<string, unknown>;
}

export interface BackupManager {
  createManifest(task: AgentTaskEnvelope, targets: string[]): BackupResult;
  verifyManifest(manifest: BackupManifest): boolean;
}

export interface VerifyManager {
  verify(input: { taskId: string; simulate?: unknown; expectedFingerprint?: string }): VerifyReport;
}

export interface RollbackManager {
  rollback(manifest: BackupManifest | undefined, verifyAfterRollback?: boolean): RollbackResult;
}
