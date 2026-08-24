import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  CloudAccountAsset,
  CreateCloudAccountAssetInput,
  UpdateCloudAccountAssetInput,
} from '../dto/providers.dto.js';
import { ProviderExtensionRegistry, stableScopeHash } from '../domain/provider-extension.js';
import type { DatabasePort } from '../../../database/database-port.js';

export class CloudAccountAssetsApplicationService {
  constructor(
    private readonly db: DatabasePort,
    private readonly providers: ProviderExtensionRegistry,
  ) {}

  async create(tenantId: string, input: CreateCloudAccountAssetInput): Promise<CloudAccountAsset> {
    this.providers.requireDefinition(input.providerKey);
    validateCredentialRef(input.credentialRef);
    const scope = input.scope ?? {};
    const identity = `${input.providerKey}:${input.accountId ?? ''}:${stableScopeHash(scope)}`;
    const duplicate = await this.db.query<{ id: string }>(
      `select id from pg_cloud_account_assets
       where tenant_id=$1 and identity_key=$2 and deleted_at is null limit 1`,
      [tenantId, identity],
    );
    if (duplicate.rows[0]) throw new AppError('RESOURCE_VERSION_CONFLICT', '相同云账号作用域已经存在', { assetId: duplicate.rows[0].id });
    const now = new Date().toISOString();
    const asset: CloudAccountAsset = {
      id: newId('caa'),
      tenantId,
      assetKind: 'cloud.account',
      providerKey: input.providerKey,
      displayName: input.displayName.trim(),
      accountId: input.accountId?.trim() || undefined,
      credentialRef: input.credentialRef.trim(),
      scope,
      status: 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(
      `insert into pg_cloud_account_assets
       (id, tenant_id, asset_kind, provider_key, display_name, account_id, credential_ref,
        scope, identity_key, status, metadata, created_at, updated_at, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::timestamptz,$12::timestamptz,$13)`,
      [
        asset.id, asset.tenantId, asset.assetKind, asset.providerKey, asset.displayName,
        asset.accountId ?? null, asset.credentialRef, JSON.stringify(asset.scope), identity,
        asset.status, JSON.stringify(asset.metadata), asset.createdAt, asset.version,
      ],
    );
    return asset;
  }

  async list(tenantId: string): Promise<{ items: CloudAccountAsset[]; page: number; pageSize: number; total: number }> {
    const rows = await this.db.query<CloudAccountAssetRow>(
      `select * from pg_cloud_account_assets where tenant_id=$1 and deleted_at is null order by updated_at desc`,
      [tenantId],
    );
    const items = rows.rows.map(toAsset);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  async get(tenantId: string, id: string): Promise<CloudAccountAsset> {
    const result = await this.db.query<CloudAccountAssetRow>(
      `select * from pg_cloud_account_assets where tenant_id=$1 and id=$2 and deleted_at is null`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', '云账号资产不存在', { id });
    return toAsset(row);
  }

  async update(tenantId: string, id: string, input: UpdateCloudAccountAssetInput): Promise<CloudAccountAsset> {
    const current = await this.get(tenantId, id);
    if (input.credentialRef !== undefined) validateCredentialRef(input.credentialRef);
    const updated: CloudAccountAsset = {
      ...current,
      ...input,
      displayName: input.displayName?.trim() || current.displayName,
      credentialRef: input.credentialRef?.trim() || current.credentialRef,
      scope: input.scope ?? current.scope,
      metadata: input.metadata ?? current.metadata,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    const identity = `${updated.providerKey}:${updated.accountId ?? ''}:${stableScopeHash(updated.scope)}`;
    const duplicate = await this.db.query<{ id: string }>(
      `select id from pg_cloud_account_assets
       where tenant_id=$1 and identity_key=$2 and id<>$3 and deleted_at is null limit 1`,
      [tenantId, identity, id],
    );
    if (duplicate.rows[0]) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '相同云账号作用域已经存在', { assetId: duplicate.rows[0].id });
    }
    await this.db.query(
      `update pg_cloud_account_assets
       set display_name=$3, account_id=$4, credential_ref=$5, scope=$6::jsonb, identity_key=$7,
           status=$8, metadata=$9::jsonb, updated_at=$10::timestamptz, version=$11
       where tenant_id=$1 and id=$2 and deleted_at is null`,
      [
        tenantId, id, updated.displayName, updated.accountId ?? null, updated.credentialRef,
        JSON.stringify(updated.scope), identity, updated.status, JSON.stringify(updated.metadata),
        updated.updatedAt, updated.version,
      ],
    );
    return updated;
  }

  async delete(tenantId: string, id: string): Promise<CloudAccountAsset> {
    const current = await this.get(tenantId, id);
    const deletedAt = new Date().toISOString();
    const deleted = { ...current, status: 'DELETED' as const, deletedAt, updatedAt: deletedAt, version: current.version + 1 };
    await this.db.query(
      `update pg_cloud_account_assets set status='DELETED', deleted_at=$3::timestamptz, updated_at=$3::timestamptz, version=$4
       where tenant_id=$1 and id=$2`,
      [tenantId, id, deletedAt, deleted.version],
    );
    return deleted;
  }
}

interface CloudAccountAssetRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  asset_kind: string;
  provider_key: string;
  display_name: string;
  account_id?: string | null;
  credential_ref: string;
  scope: Record<string, unknown>;
  status: CloudAccountAsset['status'];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
}

function toAsset(row: CloudAccountAssetRow): CloudAccountAsset {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assetKind: 'cloud.account',
    providerKey: row.provider_key,
    displayName: row.display_name,
    accountId: row.account_id ?? undefined,
    credentialRef: row.credential_ref,
    scope: row.scope ?? {},
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    version: row.version,
  };
}

function validateCredentialRef(value: string): void {
  if (!value.trim().startsWith('secret://') && !value.trim().startsWith('credential://')) {
    throw new AppError('VALIDATION_FAILED', '云账号凭据必须使用 SecretRef 或 CredentialRef', { field: 'credentialRef' });
  }
}
