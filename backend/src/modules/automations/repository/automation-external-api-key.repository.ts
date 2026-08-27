import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { AutomationExternalApiKeyEntity } from '../schema/automations.schema.js';

type Row = Record<string, unknown>;

function mapKey(row: Row): AutomationExternalApiKeyEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    automationId: String(row.automation_id),
    keyPrefix: String(row.key_prefix),
    keyHash: String(row.key_hash),
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    revokedAt: row.revoked_at ? (row.revoked_at instanceof Date ? row.revoked_at.toISOString() : String(row.revoked_at)) : undefined,
  };
}

export class AutomationExternalApiKeyRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  transaction<T>(work: (repository: AutomationExternalApiKeyRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((transaction) => work(new AutomationExternalApiKeyRepository(transaction)));
  }

  async revokeActive(tenantId: string, automationId: string, revokedAt: string): Promise<void> {
    await this.db.query(
      `update automation_external_api_keys set revoked_at = $1
       where tenant_id = $2 and automation_id = $3 and revoked_at is null`,
      [revokedAt, tenantId, automationId],
    );
  }

  async create(entity: AutomationExternalApiKeyEntity): Promise<AutomationExternalApiKeyEntity> {
    await this.db.query(
      `insert into automation_external_api_keys
       (id, tenant_id, automation_id, key_prefix, key_hash, created_by, created_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entity.id, entity.tenantId, entity.automationId, entity.keyPrefix, entity.keyHash, entity.createdBy, entity.createdAt, entity.revokedAt ?? null],
    );
    return structuredClone(entity);
  }

  async findActiveByHash(keyHash: string): Promise<AutomationExternalApiKeyEntity | undefined> {
    const result = await this.db.query<Row>(
      `select * from automation_external_api_keys where key_hash = $1 and revoked_at is null`,
      [keyHash],
    );
    return result.rows[0] ? mapKey(result.rows[0]) : undefined;
  }
}
