import { newId } from '../../shared/id.js';
import type { LegacyAgentProfile, LegacyTask, ScriptPackageManifest, ScriptPackageResult, ScriptPackageResultIngest } from './legacy-agent.types.js';
import { ScriptPackageService } from './script-package.service.js';

export type LegacyDispatchStatus = 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'manual_unverified';
export type LegacyCheckpointKind = 'queued' | 'dispatched' | 'running' | 'result_received' | 'verified' | 'manual_unverified' | 'failed';

export interface LegacyCheckpoint {
  kind: LegacyCheckpointKind;
  at: string;
  actorId?: string;
  evidenceRef?: string;
  auditRef?: string;
  message?: string;
}

export interface LegacyTaskRecord {
  id: string;
  tenantId: string;
  agentId: string;
  task: LegacyTask;
  status: LegacyDispatchStatus;
  leaseId?: string;
  result?: LegacyTaskResult;
  checkpoints: LegacyCheckpoint[];
  createdAt: string;
  updatedAt: string;
}

export interface LegacyTaskResult {
  taskId: string;
  status: 'success' | 'failed' | 'partial' | 'manual_unverified';
  evidenceRef?: string;
  auditRef: string;
  operator: string;
  logs?: string[];
}

export interface ScriptPackageResultRecord {
  packageId: string;
  manifestId: string;
  targetId: string;
  ingest: ScriptPackageResultIngest;
  result: ScriptPackageResult;
  checkpoints: LegacyCheckpoint[];
  createdAt: string;
}

export class LegacyTaskDispatcher {
  private readonly tasks = new Map<string, LegacyTaskRecord>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly scriptResults = new Map<string, ScriptPackageResultRecord>();

  constructor(private readonly scriptPackageService = new ScriptPackageService()) {}

  dispatch(profile: LegacyAgentProfile, task: LegacyTask, now = new Date()): LegacyTaskRecord {
    const existingId = this.idempotencyIndex.get(task.idempotencyKey);
    if (existingId) return this.tasks.get(existingId)!;

    const createdAt = now.toISOString();
    const record: LegacyTaskRecord = {
      id: newId('legacy_task'),
      tenantId: profile.tenantId,
      agentId: profile.agentId,
      task,
      status: 'queued',
      checkpoints: [checkpoint('queued', createdAt, { actorId: profile.agentId })],
      createdAt,
      updatedAt: createdAt,
    };
    this.tasks.set(record.id, record);
    this.idempotencyIndex.set(task.idempotencyKey, record.id);
    return record;
  }

  acknowledge(recordId: string, agentId: string, leaseId: string, now = new Date()): LegacyTaskRecord {
    const record = this.requireTask(recordId);
    if (record.agentId !== agentId) throw new Error('LegacyTask agent 不匹配');
    if (record.leaseId && record.leaseId !== leaseId) throw new Error('LegacyTask lease 冲突');
    if (record.status !== 'queued') return record;
    return this.save({
      ...record,
      leaseId,
      status: 'dispatched',
      checkpoints: [...record.checkpoints, checkpoint('dispatched', now.toISOString(), { actorId: agentId })],
      updatedAt: now.toISOString(),
    });
  }

  markRunning(recordId: string, leaseId: string, now = new Date()): LegacyTaskRecord {
    const record = this.requireLease(recordId, leaseId);
    if (record.status === 'running') return record;
    if (record.status !== 'dispatched') throw new Error(`LegacyTask 状态不允许运行: ${record.status}`);
    return this.save({
      ...record,
      status: 'running',
      checkpoints: [...record.checkpoints, checkpoint('running', now.toISOString())],
      updatedAt: now.toISOString(),
    });
  }

  complete(recordId: string, leaseId: string, result: LegacyTaskResult, now = new Date()): LegacyTaskRecord {
    const record = this.requireLease(recordId, leaseId);
    if (record.result) return record;
    const receivedAt = now.toISOString();
    const finalKind = result.status === 'success' && result.evidenceRef ? 'verified' : result.status === 'failed' ? 'failed' : 'manual_unverified';
    const finalStatus = finalKind === 'verified' ? 'completed' : finalKind === 'failed' ? 'failed' : 'manual_unverified';
    return this.save({
      ...record,
      status: finalStatus,
      result,
      checkpoints: [
        ...record.checkpoints,
        checkpoint('result_received', receivedAt, { actorId: result.operator, evidenceRef: result.evidenceRef, auditRef: result.auditRef }),
        checkpoint(finalKind, receivedAt, { actorId: result.operator, evidenceRef: result.evidenceRef, auditRef: result.auditRef }),
      ],
      updatedAt: receivedAt,
    });
  }

  ingestScriptPackageResult(manifest: ScriptPackageManifest, result: ScriptPackageResult, now = new Date()): ScriptPackageResultRecord {
    const existing = this.scriptResults.get(result.packageId);
    if (existing) return existing;
    const ingest = this.scriptPackageService.ingestResult(manifest, result);
    const createdAt = now.toISOString();
    const finalKind = ingest.verificationState === 'verified' ? 'verified' : ingest.verificationState === 'failed' ? 'failed' : 'manual_unverified';
    const record: ScriptPackageResultRecord = {
      packageId: result.packageId,
      manifestId: result.manifestId,
      targetId: result.targetId,
      ingest,
      result,
      checkpoints: [
        checkpoint('result_received', createdAt, { actorId: result.operator, evidenceRef: result.evidenceRef, auditRef: result.auditRef }),
        checkpoint(finalKind, createdAt, { actorId: result.operator, evidenceRef: result.evidenceRef, auditRef: result.auditRef }),
      ],
      createdAt,
    };
    this.scriptResults.set(result.packageId, record);
    return record;
  }

  get(recordId: string): LegacyTaskRecord | undefined {
    return this.tasks.get(recordId);
  }

  getScriptPackageResult(packageId: string): ScriptPackageResultRecord | undefined {
    return this.scriptResults.get(packageId);
  }

  private requireTask(recordId: string): LegacyTaskRecord {
    const record = this.tasks.get(recordId);
    if (!record) throw new Error('LegacyTask 不存在');
    return record;
  }

  private requireLease(recordId: string, leaseId: string): LegacyTaskRecord {
    const record = this.requireTask(recordId);
    if (record.leaseId !== leaseId) throw new Error('LegacyTask lease 无效');
    return record;
  }

  private save(record: LegacyTaskRecord): LegacyTaskRecord {
    this.tasks.set(record.id, record);
    return record;
  }
}

function checkpoint(kind: LegacyCheckpointKind, at: string, extra: Omit<LegacyCheckpoint, 'kind' | 'at'> = {}): LegacyCheckpoint {
  return { kind, at, ...extra };
}
