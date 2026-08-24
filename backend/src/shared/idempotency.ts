import { createHash } from 'node:crypto';
import { AppError } from '../common/errors/app-error.js';
import { canonicalize } from './canonical-json.js';
import { newId } from './id.js';
import type { DatabasePort } from '../database/database-port.js';

export interface IdempotencyScope {
  actionType: string;
  resourceType: string;
  resourceId: string;
}

export interface IdempotencyRecord {
  id: string;
  tenantId: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  responseSummary: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

interface IdempotencyRecordRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  action_type: string;
  resource_type: string;
  resource_id: string;
  idempotency_key: string;
  request_hash: string;
  status_code: number;
  response_summary: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export function requestHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}

export async function findIdempotencyRecord(
  db: DatabasePort,
  tenantId: string,
  scope: IdempotencyScope,
  idempotencyKey: string,
): Promise<IdempotencyRecord | undefined> {
  await deleteExpiredIdempotencyRecord(db, tenantId, scope, idempotencyKey);
  const result = await db.query<IdempotencyRecordRow>(
    `select * from idempotency_records
     where tenant_id=$1 and action_type=$2 and resource_type=$3 and resource_id=$4 and idempotency_key=$5
       and expires_at > now()
     limit 1`,
    [tenantId, scope.actionType, scope.resourceType, scope.resourceId, idempotencyKey],
  );
  return result.rows[0] ? mapIdempotencyRecord(result.rows[0]) : undefined;
}

export async function saveIdempotencyRecord(
  db: DatabasePort,
  input: {
    tenantId: string;
    scope: IdempotencyScope;
    idempotencyKey: string;
    requestHash: string;
    statusCode: number;
    responseSummary: Record<string, unknown>;
    ttlSeconds?: number;
  },
): Promise<IdempotencyRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000).toISOString();
  const result = await db.query<IdempotencyRecordRow>(
    `insert into idempotency_records
      (id, tenant_id, action_type, resource_type, resource_id, idempotency_key, request_hash, status_code, response_summary, created_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz,$11::timestamptz)
     returning *`,
    [
      newId('idem'), input.tenantId, input.scope.actionType, input.scope.resourceType, input.scope.resourceId,
      input.idempotencyKey, input.requestHash, input.statusCode, JSON.stringify(input.responseSummary), now.toISOString(), expiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('SYSTEM_INTERNAL_ERROR', '幂等记录写入后无法读取');
  return mapIdempotencyRecord(row);
}

export function assertSameRequest(record: IdempotencyRecord, hash: string, idempotencyKey: string): void {
  if (record.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_CONFLICT', '幂等键对应了不同请求体', {
      idempotencyKey,
      expectedRequestHash: record.requestHash,
      actualRequestHash: hash,
    });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === '23505' || (typeof value.message === 'string' && value.message.includes('unique constraint'));
}

function mapIdempotencyRecord(row: IdempotencyRecordRow): IdempotencyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actionType: row.action_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    statusCode: row.status_code,
    responseSummary: row.response_summary ?? {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function deleteExpiredIdempotencyRecord(
  db: DatabasePort,
  tenantId: string,
  scope: IdempotencyScope,
  idempotencyKey: string,
): Promise<void> {
  await db.query(
    `delete from idempotency_records
     where tenant_id=$1 and action_type=$2 and resource_type=$3 and resource_id=$4 and idempotency_key=$5
       and expires_at <= now()`,
    [tenantId, scope.actionType, scope.resourceType, scope.resourceId, idempotencyKey],
  );
}
