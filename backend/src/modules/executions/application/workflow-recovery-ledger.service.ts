import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';

export type WorkflowLedgerStatus = 'ACTIVE' | 'COMPLETED' | 'ROLLBACK_RUNNING' | 'ROLLED_BACK' | 'MANUAL_INTERVENTION';
export type WorkflowRecoveryClassification = 'RESUMABLE' | 'ROLLBACK_REQUIRED' | 'MANUAL_INTERVENTION';

export interface WorkflowRecoveryLedgerRecord {
  id: string;
  tenantId: string;
  executionRunId: string;
  executionStepId: string;
  deploymentPlanTargetId?: string;
  pluginVersionId: string;
  workflowVersionId: string;
  capabilityKey: string;
  targetHash: string;
  planHash: string;
  inputHash: string;
  status: WorkflowLedgerStatus;
  recoveryClassification: WorkflowRecoveryClassification;
  completedStepIds: string[];
  compensationStepIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCheckpointRecord {
  id: string;
  tenantId: string;
  ledgerId: string;
  checkpointName: string;
  workflowStepName: string;
  capture: Record<string, unknown>;
  captureHash: string;
  requiredForRollback: boolean;
  createdAt: string;
}

export class WorkflowRecoveryLedgerService {
  constructor(private readonly db: DatabasePort = new PgliteDatabase(), private readonly clock: () => Date = () => new Date()) {}

  async begin(input: {
    tenantId: string;
    executionRunId: string;
    executionStepId: string;
    deploymentPlanTargetId?: string;
    pluginVersionId: string;
    workflowVersionId: string;
    capabilityKey: string;
    target: unknown;
    plan: unknown;
    runtimeInput: unknown;
  }): Promise<WorkflowRecoveryLedgerRecord> {
    const targetHash = sha256(input.target);
    const planHash = sha256(input.plan);
    const inputHash = sha256(input.runtimeInput);
    return await this.db.transaction(async (tx) => {
      const existing = await findLedger(tx, input.tenantId, input.executionRunId, input.executionStepId);
      if (existing) {
        assertLedgerIdentity(existing, { ...input, targetHash, planHash, inputHash });
        return existing;
      }
      const now = this.clock().toISOString();
      const record: WorkflowRecoveryLedgerRecord = {
        id: `wfledger_${randomUUID()}`,
        tenantId: input.tenantId,
        executionRunId: input.executionRunId,
        executionStepId: input.executionStepId,
        deploymentPlanTargetId: input.deploymentPlanTargetId,
        pluginVersionId: input.pluginVersionId,
        workflowVersionId: input.workflowVersionId,
        capabilityKey: input.capabilityKey,
        targetHash,
        planHash,
        inputHash,
        status: 'ACTIVE',
        recoveryClassification: 'RESUMABLE',
        completedStepIds: [],
        compensationStepIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await tx.query(`insert into plugin_workflow_ledgers
        (id,tenant_id,execution_run_id,execution_step_id,deployment_plan_target_id,plugin_version_id,workflow_version_id,capability_key,target_hash,plan_hash,input_hash,status,recovery_classification,completed_step_ids,compensation_step_ids,created_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17)`, [
        record.id, record.tenantId, record.executionRunId, record.executionStepId, record.deploymentPlanTargetId ?? null,
        record.pluginVersionId, record.workflowVersionId, record.capabilityKey, record.targetHash, record.planHash, record.inputHash,
        record.status, record.recoveryClassification, '[]', '[]', record.createdAt, record.updatedAt,
      ]);
      return record;
    });
  }

  async recordCheckpoint(input: {
    tenantId: string;
    ledgerId: string;
    checkpointName: string;
    workflowStepName: string;
    capture: Record<string, unknown>;
    captureHash: string;
    requiredForRollback: boolean;
  }): Promise<WorkflowCheckpointRecord> {
    assertCheckpointSafe(input.capture);
    const computedHash = sha256(input.capture);
    if (computedHash !== input.captureHash) throw new AppError('VALIDATION_FAILED', 'checkpoint 哈希不一致，拒绝写入', { checkpointName: input.checkpointName });
    return await this.db.transaction(async (tx) => {
      const ledger = await getLedger(tx, input.tenantId, input.ledgerId);
      if (ledger.status !== 'ACTIVE' && ledger.status !== 'ROLLBACK_RUNNING') {
        throw new AppError('VALIDATION_FAILED', '当前恢复账本状态不允许写入 checkpoint', { ledgerId: ledger.id, status: ledger.status });
      }
      const existing = await findCheckpoint(tx, input.ledgerId, input.checkpointName);
      if (existing) {
        if (existing.captureHash !== input.captureHash) throw new AppError('VALIDATION_FAILED', '同名 checkpoint 内容发生变化，拒绝覆盖', { checkpointName: input.checkpointName });
        return existing;
      }
      const record: WorkflowCheckpointRecord = {
        id: `wfcheckpoint_${randomUUID()}`,
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        checkpointName: input.checkpointName,
        workflowStepName: input.workflowStepName,
        capture: input.capture,
        captureHash: input.captureHash,
        requiredForRollback: input.requiredForRollback,
        createdAt: this.clock().toISOString(),
      };
      await tx.query(`insert into plugin_workflow_checkpoints
        (id,tenant_id,ledger_id,checkpoint_name,workflow_step_name,capture,capture_hash,required_for_rollback,created_at)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [
        record.id, record.tenantId, record.ledgerId, record.checkpointName, record.workflowStepName,
        JSON.stringify(record.capture), record.captureHash, record.requiredForRollback, record.createdAt,
      ]);
      return record;
    });
  }

  async markStepCompleted(tenantId: string, ledgerId: string, workflowStepName: string, compensation = false): Promise<WorkflowRecoveryLedgerRecord> {
    return await this.db.transaction(async (tx) => {
      const ledger = await getLedger(tx, tenantId, ledgerId);
      const values = compensation ? ledger.compensationStepIds : ledger.completedStepIds;
      const next = values.includes(workflowStepName) ? values : [...values, workflowStepName];
      const updatedAt = this.clock().toISOString();
      await tx.query(`update plugin_workflow_ledgers set ${compensation ? 'compensation_step_ids' : 'completed_step_ids'}=$1::jsonb,updated_at=$2 where id=$3 and tenant_id=$4`, [JSON.stringify(next), updatedAt, ledgerId, tenantId]);
      return { ...ledger, ...(compensation ? { compensationStepIds: next } : { completedStepIds: next }), updatedAt };
    });
  }

  async finish(tenantId: string, ledgerId: string, status: Exclude<WorkflowLedgerStatus, 'ACTIVE'>): Promise<WorkflowRecoveryLedgerRecord> {
    const recoveryClassification: WorkflowRecoveryClassification = status === 'COMPLETED' || status === 'ROLLED_BACK' ? 'RESUMABLE' : 'MANUAL_INTERVENTION';
    const updatedAt = this.clock().toISOString();
    const row = (await this.db.query<LedgerRow>(`update plugin_workflow_ledgers set status=$1,recovery_classification=$2,updated_at=$3 where id=$4 and tenant_id=$5 returning *`, [status, recoveryClassification, updatedAt, ledgerId, tenantId])).rows[0];
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', '恢复账本不存在', { ledgerId });
    return toLedger(row);
  }

  async classifyInterrupted(input: { tenantId: string; ledgerId: string; runningStepId?: string; runningStepIdempotent: boolean }): Promise<WorkflowRecoveryLedgerRecord> {
    return await this.db.transaction(async (tx) => {
      const ledger = await getLedger(tx, input.tenantId, input.ledgerId);
      const checkpoints = await listCheckpoints(tx, input.tenantId, ledger.id);
      const hasRollbackCheckpoint = checkpoints.some((checkpoint) => checkpoint.requiredForRollback);
      const classification: WorkflowRecoveryClassification = input.runningStepId && !input.runningStepIdempotent
        ? hasRollbackCheckpoint ? 'ROLLBACK_REQUIRED' : 'MANUAL_INTERVENTION'
        : 'RESUMABLE';
      const status: WorkflowLedgerStatus = classification === 'MANUAL_INTERVENTION' ? 'MANUAL_INTERVENTION' : ledger.status;
      const updatedAt = this.clock().toISOString();
      await tx.query('update plugin_workflow_ledgers set recovery_classification=$1,status=$2,updated_at=$3 where id=$4 and tenant_id=$5', [classification, status, updatedAt, ledger.id, input.tenantId]);
      return { ...ledger, recoveryClassification: classification, status, updatedAt };
    });
  }

  async get(tenantId: string, ledgerId: string): Promise<{ ledger: WorkflowRecoveryLedgerRecord; checkpoints: WorkflowCheckpointRecord[] }> {
    return await this.db.transaction(async (tx) => ({
      ledger: await getLedger(tx, tenantId, ledgerId),
      checkpoints: await listCheckpoints(tx, tenantId, ledgerId),
    }));
  }

  async getCheckpoint(tenantId: string, checkpointId: string): Promise<WorkflowCheckpointRecord> {
    return await this.db.transaction(async (tx) => {
      const checkpoint = await findCheckpointById(tx, tenantId, checkpointId);
      if (!checkpoint) throw new AppError('RESOURCE_NOT_FOUND', 'checkpoint 不存在', { checkpointId });
      return checkpoint;
    });
  }
}

interface LedgerRow extends Record<string, unknown> {
  id: string; tenant_id: string; execution_run_id: string; execution_step_id: string; deployment_plan_target_id?: string;
  plugin_version_id: string; workflow_version_id: string; capability_key: string; target_hash: string; plan_hash: string; input_hash: string;
  status: WorkflowLedgerStatus; recovery_classification: WorkflowRecoveryClassification; completed_step_ids: string[]; compensation_step_ids: string[];
  created_at: string; updated_at: string;
}

interface CheckpointRow extends Record<string, unknown> {
  id: string; tenant_id: string; ledger_id: string; checkpoint_name: string; workflow_step_name: string;
  capture: Record<string, unknown>; capture_hash: string; required_for_rollback: boolean; created_at: string;
}

async function findLedger(db: DatabasePort, tenantId: string, runId: string, stepId: string): Promise<WorkflowRecoveryLedgerRecord | undefined> {
  const row = (await db.query<LedgerRow>('select * from plugin_workflow_ledgers where tenant_id=$1 and execution_run_id=$2 and execution_step_id=$3', [tenantId, runId, stepId])).rows[0];
  return row ? toLedger(row) : undefined;
}

async function getLedger(db: DatabasePort, tenantId: string, ledgerId: string): Promise<WorkflowRecoveryLedgerRecord> {
  const row = (await db.query<LedgerRow>('select * from plugin_workflow_ledgers where tenant_id=$1 and id=$2', [tenantId, ledgerId])).rows[0];
  if (!row) throw new AppError('RESOURCE_NOT_FOUND', '恢复账本不存在', { ledgerId });
  return toLedger(row);
}

async function findCheckpoint(db: DatabasePort, ledgerId: string, checkpointName: string): Promise<WorkflowCheckpointRecord | undefined> {
  const row = (await db.query<CheckpointRow>('select * from plugin_workflow_checkpoints where ledger_id=$1 and checkpoint_name=$2', [ledgerId, checkpointName])).rows[0];
  return row ? toCheckpoint(row) : undefined;
}

async function findCheckpointById(db: DatabasePort, tenantId: string, checkpointId: string): Promise<WorkflowCheckpointRecord | undefined> {
  const row = (await db.query<CheckpointRow>('select * from plugin_workflow_checkpoints where tenant_id=$1 and id=$2', [tenantId, checkpointId])).rows[0];
  return row ? toCheckpoint(row) : undefined;
}

async function listCheckpoints(db: DatabasePort, tenantId: string, ledgerId: string): Promise<WorkflowCheckpointRecord[]> {
  return (await db.query<CheckpointRow>('select * from plugin_workflow_checkpoints where tenant_id=$1 and ledger_id=$2 order by created_at,id', [tenantId, ledgerId])).rows.map(toCheckpoint);
}

function toLedger(row: LedgerRow): WorkflowRecoveryLedgerRecord {
  return {
    id: row.id, tenantId: row.tenant_id, executionRunId: row.execution_run_id, executionStepId: row.execution_step_id,
    deploymentPlanTargetId: row.deployment_plan_target_id, pluginVersionId: row.plugin_version_id, workflowVersionId: row.workflow_version_id,
    capabilityKey: row.capability_key, targetHash: row.target_hash, planHash: row.plan_hash, inputHash: row.input_hash,
    status: row.status, recoveryClassification: row.recovery_classification, completedStepIds: row.completed_step_ids ?? [],
    compensationStepIds: row.compensation_step_ids ?? [], createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toCheckpoint(row: CheckpointRow): WorkflowCheckpointRecord {
  return {
    id: row.id, tenantId: row.tenant_id, ledgerId: row.ledger_id, checkpointName: row.checkpoint_name,
    workflowStepName: row.workflow_step_name, capture: row.capture ?? {}, captureHash: row.capture_hash,
    requiredForRollback: row.required_for_rollback, createdAt: row.created_at,
  };
}

function assertLedgerIdentity(existing: WorkflowRecoveryLedgerRecord, expected: { pluginVersionId: string; workflowVersionId: string; capabilityKey: string; targetHash: string; planHash: string; inputHash: string }): void {
  const mismatch = existing.pluginVersionId !== expected.pluginVersionId
    || existing.workflowVersionId !== expected.workflowVersionId
    || existing.capabilityKey !== expected.capabilityKey
    || existing.targetHash !== expected.targetHash
    || existing.planHash !== expected.planHash
    || existing.inputHash !== expected.inputHash;
  if (mismatch) throw new AppError('IDEMPOTENCY_CONFLICT', '恢复账本固定版本或输入哈希不一致', { ledgerId: existing.id });
}

function assertCheckpointSafe(value: unknown, path = 'capture'): void {
  if (Buffer.isBuffer(value)) throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许保存二进制内容', { path });
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|secret:\/\//i.test(value)) throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许保存秘密或私钥', { path });
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertCheckpointSafe(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/(password|token|privateKey|authorization|credential|secret|pfx|jks|content)/i.test(key)) throw new AppError('VALIDATION_FAILED', 'checkpoint 包含敏感字段', { path: `${path}.${key}` });
      assertCheckpointSafe(child, `${path}.${key}`);
    }
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
