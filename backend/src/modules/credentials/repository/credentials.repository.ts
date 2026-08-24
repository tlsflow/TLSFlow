import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  CredentialDelivery,
  CredentialKind,
  CredentialProfileEntity,
  CredentialStatus,
} from '../../../persistence/entities/credential-profile.entity.js';
import type { SecretScopeType } from '../../../shared/security-types.js';

export type CredentialUsageType =
  | 'PLUGIN_BINDING'
  | 'DEVICE'
  | 'DEPLOYMENT_PLAN'
  | 'ACME_RENEWAL_POLICY'
  | 'CLOUD_ACCOUNT_ASSET'
  | 'BROWSER_CREDENTIAL_SESSION';

export interface CredentialUsageItem {
  type: CredentialUsageType;
  id: string;
  name?: string;
  detail?: Record<string, unknown>;
}

export class CredentialsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async save(record: CredentialProfileEntity): Promise<CredentialProfileEntity> {
    await this.db.query(
      `insert into credential_profiles (
        id, tenant_id, name, kind, scope_type, scope_id, username, delivery, secret_slots,
        metadata, status, version, created_by, created_at, updated_at, expires_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
      on conflict (id) do update set
        name=excluded.name, scope_type=excluded.scope_type, scope_id=excluded.scope_id,
        username=excluded.username, delivery=excluded.delivery, secret_slots=excluded.secret_slots,
        metadata=excluded.metadata, status=excluded.status, version=excluded.version,
        updated_at=excluded.updated_at, expires_at=excluded.expires_at`,
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
        record.expiresAt ?? null,
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

  async listUsage(tenantId: string, credentialId: string): Promise<CredentialUsageItem[]> {
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
    const acmePolicies = await this.db.query<{
      id: string;
      certificate_asset_id: string | null;
      certificate_name: string | null;
    }>(
      `select policy.id, policy.certificate_asset_id, asset.name as certificate_name
         from pg_acme_renewal_policies policy
         left join pg_certificate_assets asset
           on asset.tenant_id=policy.tenant_id and asset.id=policy.certificate_asset_id
        where policy.tenant_id=$1
          and policy.maintenance_window->>'dnsCredentialId'=$2
          and (asset.id is null or asset.status<>'deleted')
        order by policy.id`,
      [tenantId, credentialId],
    );
    const cloudAccounts = await this.db.query<{
      id: string;
      display_name: string;
      provider_key: string;
      account_id: string | null;
    }>(
      `select id, display_name, provider_key, account_id
         from pg_cloud_account_assets
        where tenant_id=$1
          and deleted_at is null
          and (credential_ref=('credential://' || $2) or credential_ref like ('credential://' || $2 || '#%'))
        order by id`,
      [tenantId, credentialId],
    );
    const browserSessions = await this.db.query<{
      id: string;
      login_url: string | null;
      asset_id: string;
      status: string;
      expires_at: string | Date;
    }>(
      `select id, login_url, asset_id, status, expires_at
         from browser_credential_sessions
        where tenant_id=$1
          and credential_profile_id=$2
          and status in ('created', 'ready', 'acquiring')
          and expires_at>now()
        order by id`,
      [tenantId, credentialId],
    );
    return [
      ...bindings.rows.map((row) => ({ type: 'PLUGIN_BINDING' as const, id: row.id, detail: { pluginVersionId: row.plugin_version_id, mode: row.mode } })),
      ...devices.rows.map((row) => ({ type: 'DEVICE' as const, id: row.service_asset_id, name: row.display_name })),
      ...planTargets.rows.map((row) => ({ type: 'DEPLOYMENT_PLAN' as const, id: row.deployment_plan_id, detail: { targetId: row.document_id } })),
      ...acmePolicies.rows.map((row) => ({
        type: 'ACME_RENEWAL_POLICY' as const,
        id: row.id,
        ...(row.certificate_name ? { name: row.certificate_name } : {}),
        detail: row.certificate_asset_id ? { certificateAssetId: row.certificate_asset_id } : undefined,
      })),
      ...cloudAccounts.rows.map((row) => ({
        type: 'CLOUD_ACCOUNT_ASSET' as const,
        id: row.id,
        name: row.display_name,
        detail: {
          providerKey: row.provider_key,
          ...(row.account_id ? { accountId: row.account_id } : {}),
        },
      })),
      ...browserSessions.rows.map((row) => ({
        type: 'BROWSER_CREDENTIAL_SESSION' as const,
        id: row.id,
        ...(row.login_url ? { name: row.login_url } : {}),
        detail: {
          assetId: row.asset_id,
          status: row.status,
          expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        },
      })),
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
  expires_at: string | Date | null;
}

function toEntity(row: CredentialProfileRow): CredentialProfileEntity {
  const metadataExpiry = typeof row.metadata?.expiresAt === 'string' ? row.metadata.expiresAt : undefined;
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
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : metadataExpiry,
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
