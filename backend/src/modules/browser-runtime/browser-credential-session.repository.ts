import type { DatabasePort } from '../../database/database-port.js';
import { PgliteDatabase } from '../../database/pglite-database.js';

export type BrowserCredentialSessionStatus = 'created' | 'ready' | 'acquiring' | 'succeeded' | 'failed' | 'expired' | 'closed';

export interface BrowserCredentialSessionRecord {
  id: string;
  tenantId: string;
  assetId: string;
  pluginVersionId: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  capabilityKey: 'credential.acquire';
  runtimeSessionId: string;
  oneTimeUrlHash: string;
  idempotencyKeyHash?: string;
  status: BrowserCredentialSessionStatus;
  credentialProfileId?: string;
  expiresAt: string;
  createdBy: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export class BrowserCredentialSessionRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async save(record: BrowserCredentialSessionRecord): Promise<BrowserCredentialSessionRecord> {
    await this.db.query(`
      insert into browser_credential_sessions (
        id, tenant_id, asset_id, plugin_version_id, workflow_template_id, workflow_version_id,
        capability_key, runtime_session_id, one_time_url_hash, idempotency_key_hash, status, credential_profile_id,
        expires_at, created_by, last_error_code, last_error_message, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      on conflict (id) do update set
        status=excluded.status,
        credential_profile_id=excluded.credential_profile_id,
        last_error_code=excluded.last_error_code,
        last_error_message=excluded.last_error_message,
        updated_at=excluded.updated_at
    `, [
      record.id,
      record.tenantId,
      record.assetId,
      record.pluginVersionId,
      record.workflowTemplateId,
      record.workflowVersionId,
      record.capabilityKey,
      record.runtimeSessionId,
      record.oneTimeUrlHash,
      record.idempotencyKeyHash ?? null,
      record.status,
      record.credentialProfileId ?? null,
      record.expiresAt,
      record.createdBy,
      record.lastErrorCode ?? null,
      record.lastErrorMessage ?? null,
      record.createdAt,
      record.updatedAt,
    ]);
    return record;
  }

  async get(tenantId: string, id: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const row = (await this.db.query<SessionRow>(
      'select * from browser_credential_sessions where tenant_id=$1 and id=$2',
      [tenantId, id],
    )).rows[0];
    return row ? map(row) : undefined;
  }

  async findByIdempotencyKeyHash(tenantId: string, createdBy: string, idempotencyKeyHash: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const row = (await this.db.query<SessionRow>(
      'select * from browser_credential_sessions where tenant_id=$1 and created_by=$2 and idempotency_key_hash=$3 order by created_at desc limit 1',
      [tenantId, createdBy, idempotencyKeyHash],
    )).rows[0];
    return row ? map(row) : undefined;
  }

  async claimForAcquire(tenantId: string, id: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const row = (await this.db.query<SessionRow>(`
      update browser_credential_sessions
         set status='acquiring', updated_at=now()
       where tenant_id=$1
         and id=$2
         and status in ('created','ready')
         and expires_at > now()
      returning *
    `, [tenantId, id])).rows[0];
    return row ? map(row) : undefined;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<BrowserCredentialSessionRecord, 'status' | 'credentialProfileId' | 'lastErrorCode' | 'lastErrorMessage'>>,
  ): Promise<BrowserCredentialSessionRecord | undefined> {
    const row = (await this.db.query<SessionRow>(`
      update browser_credential_sessions
         set status=coalesce($3, status),
             credential_profile_id=coalesce($4, credential_profile_id),
             last_error_code=coalesce($5, last_error_code),
             last_error_message=coalesce($6, last_error_message),
             updated_at=now()
       where tenant_id=$1 and id=$2
      returning *
    `, [
      tenantId,
      id,
      patch.status ?? null,
      patch.credentialProfileId ?? null,
      patch.lastErrorCode ?? null,
      patch.lastErrorMessage ?? null,
    ])).rows[0];
    return row ? map(row) : undefined;
  }

  async consumeTemporaryUrl(tenantId: string, id: string, oneTimeUrlHash: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const row = (await this.db.query<SessionRow>(`
      update browser_credential_sessions
         set one_time_url_hash='consumed:' || one_time_url_hash,
             updated_at=now()
       where tenant_id=$1
         and id=$2
         and one_time_url_hash=$3
         and status in ('created','ready')
         and expires_at > now()
      returning *
    `, [tenantId, id, oneTimeUrlHash])).rows[0];
    return row ? map(row) : undefined;
  }
}

interface SessionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  asset_id: string;
  plugin_version_id: string;
  workflow_template_id: string;
  workflow_version_id: string;
  capability_key: 'credential.acquire';
  runtime_session_id: string;
  one_time_url_hash: string;
  idempotency_key_hash: string | null;
  status: BrowserCredentialSessionStatus;
  credential_profile_id: string | null;
  expires_at: string | Date;
  created_by: string;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function map(row: SessionRow): BrowserCredentialSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assetId: row.asset_id,
    pluginVersionId: row.plugin_version_id,
    workflowTemplateId: row.workflow_template_id,
    workflowVersionId: row.workflow_version_id,
    capabilityKey: 'credential.acquire',
    runtimeSessionId: row.runtime_session_id,
    oneTimeUrlHash: row.one_time_url_hash,
    ...(row.idempotency_key_hash ? { idempotencyKeyHash: row.idempotency_key_hash } : {}),
    status: row.status,
    ...(row.credential_profile_id ? { credentialProfileId: row.credential_profile_id } : {}),
    expiresAt: toIso(row.expires_at),
    createdBy: row.created_by,
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
