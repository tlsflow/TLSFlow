import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';

export interface PluginResourceLockRecord {
  id: string;
  tenantId: string;
  resourceKey: string;
  mode: 'READ' | 'WRITE';
  ownerRunId: string;
  ownerStepId: string;
  fencingToken: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export class PluginResourceLockService {
  constructor(private readonly db: DatabasePort = new PgliteDatabase(), private readonly clock: () => Date = () => new Date()) {}

  async acquire(input: { tenantId: string; resourceKey: string; mode: 'READ' | 'WRITE'; ownerRunId: string; ownerStepId: string; ttlSeconds: number }): Promise<PluginResourceLockRecord> {
    validateLockInput(input);
    return await this.db.transaction(async (tx) => {
      const now = this.clock();
      const existingOwner = (await tx.query<LockRow>('select * from plugin_resource_locks where tenant_id=$1 and resource_key=$2 and owner_run_id=$3 and owner_step_id=$4', [input.tenantId, input.resourceKey, input.ownerRunId, input.ownerStepId])).rows[0];
      if (existingOwner && new Date(existingOwner.expires_at) > now) return toRecord(existingOwner);
      const active = (await tx.query<LockRow>('select * from plugin_resource_locks where tenant_id=$1 and resource_key=$2 and expires_at > $3', [input.tenantId, input.resourceKey, now.toISOString()])).rows;
      const conflicts = input.mode === 'WRITE' ? active.length > 0 : active.some((lock) => lock.lock_mode === 'WRITE');
      if (conflicts) throw new AppError('RESOURCE_VERSION_CONFLICT', '设备资源锁冲突', { resourceKey: input.resourceKey, mode: input.mode });
      const tokenRow = (await tx.query<{ next_token: number }>('select coalesce(max(fencing_token),0)+1 as next_token from plugin_resource_locks where tenant_id=$1 and resource_key=$2', [input.tenantId, input.resourceKey])).rows[0];
      if (existingOwner) await tx.query('delete from plugin_resource_locks where id=$1', [existingOwner.id]);
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();
      const record: PluginResourceLockRecord = {
        id: `plock_${randomUUID()}`, tenantId: input.tenantId, resourceKey: input.resourceKey, mode: input.mode,
        ownerRunId: input.ownerRunId, ownerStepId: input.ownerStepId, fencingToken: Number(tokenRow?.next_token ?? 1),
        expiresAt, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      await tx.query(`insert into plugin_resource_locks
        (id,tenant_id,resource_key,lock_mode,owner_run_id,owner_step_id,fencing_token,expires_at,created_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [record.id, record.tenantId, record.resourceKey, record.mode, record.ownerRunId, record.ownerStepId, record.fencingToken, record.expiresAt, record.createdAt, record.updatedAt]);
      return record;
    });
  }

  async renew(input: { tenantId: string; lockId: string; ownerRunId: string; ownerStepId: string; ttlSeconds: number }): Promise<PluginResourceLockRecord> {
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 5 || input.ttlSeconds > 3600) throw new AppError('VALIDATION_FAILED', '资源锁 TTL 必须在 5 到 3600 秒之间');
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();
    const row = (await this.db.query<LockRow>(`update plugin_resource_locks set expires_at=$1,updated_at=$2
      where tenant_id=$3 and id=$4 and owner_run_id=$5 and owner_step_id=$6 and expires_at>$2 returning *`, [expiresAt, now.toISOString(), input.tenantId, input.lockId, input.ownerRunId, input.ownerStepId])).rows[0];
    if (!row) throw new AppError('RESOURCE_VERSION_CONFLICT', '资源锁已过期或所有者不匹配', { lockId: input.lockId });
    return toRecord(row);
  }

  async release(input: { tenantId: string; lockId: string; ownerRunId: string; ownerStepId: string }): Promise<void> {
    await this.db.query('delete from plugin_resource_locks where tenant_id=$1 and id=$2 and owner_run_id=$3 and owner_step_id=$4', [input.tenantId, input.lockId, input.ownerRunId, input.ownerStepId]);
  }
}

interface LockRow extends Record<string, unknown> {
  id: string; tenant_id: string; resource_key: string; lock_mode: 'READ' | 'WRITE'; owner_run_id: string; owner_step_id: string;
  fencing_token: number; expires_at: string; created_at: string; updated_at: string;
}

function toRecord(row: LockRow): PluginResourceLockRecord {
  return { id: row.id, tenantId: row.tenant_id, resourceKey: row.resource_key, mode: row.lock_mode, ownerRunId: row.owner_run_id, ownerStepId: row.owner_step_id, fencingToken: Number(row.fencing_token), expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function validateLockInput(input: { tenantId: string; resourceKey: string; ttlSeconds: number }): void {
  if (!input.tenantId.trim() || !input.resourceKey.trim()) throw new AppError('VALIDATION_FAILED', '资源锁租户和键不能为空');
  if (!/^tenant:[^:]+:(device|managed-target|standalone):[^:]+$/.test(input.resourceKey)) throw new AppError('VALIDATION_FAILED', '资源锁键不符合宿主受限格式', { resourceKey: input.resourceKey });
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 5 || input.ttlSeconds > 3600) throw new AppError('VALIDATION_FAILED', '资源锁 TTL 必须在 5 到 3600 秒之间');
}
