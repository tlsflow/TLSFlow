import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  CredentialDelivery,
  CredentialKind,
  CredentialProfileEntity,
  CredentialStatus,
} from '../../../persistence/entities/credential-profile.entity.js';
import type { SecretScopeType } from '../../../shared/security-types.js';

export class CredentialsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async save(record: CredentialProfileEntity): Promise<CredentialProfileEntity> {
    await this.db.query(
      `insert into credential_profiles (
        id, tenant_id, name, kind, scope_type, scope_id, username, delivery, secret_slots,
        metadata, status, version, created_by, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
      on conflict (id) do update set
        name=excluded.name, scope_type=excluded.scope_type, scope_id=excluded.scope_id,
        username=excluded.username, delivery=excluded.delivery, secret_slots=excluded.secret_slots,
        metadata=excluded.metadata, status=excluded.status, version=excluded.version, updated_at=excluded.updated_at`,
      [
        record.id,
        record.tenantId,
        record.name,
        record.kind,
        record.scopeType,
        record.scopeId ?? null,
        record.username ?? null,
        JSON.stringify(record.delivery ?? {}),
        JSON.stringify(record.secretSlots),
        JSON.stringify(record.metadata),
        record.status,
        record.version,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return record;
  }

  async get(tenantId: string, id: string): Promise<CredentialProfileEntity | undefined> {
    const row = (await this.db.query<CredentialProfileRow>(
      'select * from credential_profiles where tenant_id=$1 and id=$2',
      [tenantId, id],
    )).rows[0];
    return row ? toEntity(row) : undefined;
  }

  async list(tenantId: string): Promise<CredentialProfileEntity[]> {
    const rows = (await this.db.query<CredentialProfileRow>(
      'select * from credential_profiles where tenant_id=$1 order by lower(name), id',
      [tenantId],
    )).rows;
    return rows.map(toEntity);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      'delete from credential_profiles where tenant_id=$1 and id=$2 returning id',
      [tenantId, id],
    );
    return result.rows.length > 0;
  }

  async listUsage(tenantId: string, credentialId: string): Promise<Array<{
    type: 'PLUGIN_BINDING' | 'DEVICE' | 'DEPLOYMENT_PLAN';
    id: string;
    name?: string;
    detail?: Record<string, unknown>;
  }>> {
    const bindings = await this.db.query<{ id: string; plugin_version_id: string; mode: string }>(
      `select id, plugin_version_id, mode
         from unified_plugin_bindings
        where tenant_id=$1
          and exists (
            select 1
              from jsonb_each(input_bindings->'credentials') as binding_slot
             where binding_slot.value->>'credentialId'=$2
          )
        order by id`,
      [tenantId, credentialId],
    );
    const devices = await this.db.query<{ service_asset_id: string; display_name: string }>(
      `select device.service_asset_id, asset.display_name
         from pg_device_assets device
         join pg_service_assets asset on asset.tenant_id=device.tenant_id and asset.id=device.service_asset_id
        where device.tenant_id=$1 and device.credential_id=$2 and asset.deleted_at is null
        order by device.service_asset_id`,
      [tenantId, credentialId],
    );
    const planTargets = await this.db.query<{ document_id: string; deployment_plan_id: string }>(
      `select document_id, payload->>'deploymentPlanId' as deployment_plan_id
         from pg_documents
        where namespace='deployment-plans:targets'
          and payload->>'tenantId'=$1
          and jsonb_path_exists(
            payload,
            '$.strategyPayload.workflowRequest.credentials.* ? (@.credentialId == $credentialId)',
            jsonb_build_object('credentialId', to_jsonb($2::text))
          )
        order by document_id`,
      [tenantId, credentialId],
    );
    return [
      ...bindings.rows.map((row) => ({ type: 'PLUGIN_BINDING' as const, id: row.id, detail: { pluginVersionId: row.plugin_version_id, mode: row.mode } })),
      ...devices.rows.map((row) => ({ type: 'DEVICE' as const, id: row.service_asset_id, name: row.display_name })),
      ...planTargets.rows.map((row) => ({ type: 'DEPLOYMENT_PLAN' as const, id: row.deployment_plan_id, detail: { targetId: row.document_id } })),
    ];
  }

  async countOtherProfilesUsingSecretRef(tenantId: string, credentialId: string, secretRef: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `select count(*)::text as count
         from credential_profiles profile
        where profile.tenant_id=$1 and profile.id<>$2
          and exists (select 1 from jsonb_each_text(profile.secret_slots) slot where slot.value=$3)`,
      [tenantId, credentialId, secretRef],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

interface CredentialProfileRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  name: string;
  kind: CredentialKind;
  scope_type: SecretScopeType;
  scope_id: string | null;
  username: string | null;
  delivery: CredentialDelivery;
  secret_slots: Record<string, string>;
  metadata: Record<string, unknown>;
  status: CredentialStatus;
  version: number;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function toEntity(row: CredentialProfileRow): CredentialProfileEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    kind: row.kind,
    scopeType: row.scope_type,
    scopeId: row.scope_id ?? undefined,
    username: row.username ?? undefined,
    delivery: Object.keys(row.delivery ?? {}).length > 0 ? row.delivery : undefined,
    secretSlots: row.secret_slots ?? {},
    metadata: row.metadata ?? {},
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
