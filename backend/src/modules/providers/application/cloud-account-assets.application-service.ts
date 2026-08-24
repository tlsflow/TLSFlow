import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  CloudAccountAsset,
  CreateCloudAccountAssetInput,
  UpdateCloudAccountAssetInput,
} from '../dto/providers.dto.js';
import { stableScopeHash } from '../domain/provider-shared.js';
import type { DatabasePort } from '../../../database/database-port.js';
import {
  assertSameRequest,
  findIdempotencyRecord,
  isUniqueViolation,
  requestHash,
  saveIdempotencyRecord,
  type IdempotencyScope,
} from '../../../shared/idempotency.js';

export interface CloudAccountAssetBindingProvisionInput {
  tenantId: string;
  asset: CloudAccountAsset;
  requestedPluginVersionId?: string;
  prepared?: unknown;
}

export interface CloudAccountAssetBindingProvisionerContract {
  prepare?: (input: Pick<CloudAccountAssetBindingProvisionInput, 'tenantId' | 'asset' | 'requestedPluginVersionId'>) => Promise<unknown>;
  provision(
    tx: DatabasePort,
    input: CloudAccountAssetBindingProvisionInput,
  ): Promise<unknown>;
}

export class CloudAccountAssetsApplicationService {
  private bindingProvisioner?: CloudAccountAssetBindingProvisionerContract;

  constructor(
    private readonly db: DatabasePort,
    // ProviderKey 只是 Cloud Service 的不透明引用，厂商目录由插件/Runner 负责。
    // 保留第二参数是为了兼容现有应用装配，宿主资产 CRUD 不再调用它做产品路由。
    private readonly _providerCatalog?: unknown,
  ) {}

  /** 中文说明：由应用装配注入 CloudAccountAsset -> PluginBinding 的事务内实现。 */
  setBindingProvisioner(provisioner: CloudAccountAssetBindingProvisionerContract): void {
    this.bindingProvisioner = provisioner;
  }

  async create(tenantId: string, input: CreateCloudAccountAssetInput): Promise<CloudAccountAsset> {
    const providerKey = normalizeRequiredString(input.providerKey, 'providerKey');
    validateCredentialRef(input.credentialRef);
    const scope = input.scope ?? {};
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencyScope = createScope('create', 'collection');
    const hash = idempotencyKey ? requestHash({
      operation: 'create', providerKey, pluginVersionId: input.pluginVersionId?.trim() || undefined,
      displayName: input.displayName.trim(), accountId: input.accountId?.trim() || undefined,
      credentialRef: input.credentialRef.trim(), scope, metadata: input.metadata ?? {},
    }) : undefined;
    const preparedBinding = this.bindingProvisioner?.prepare
      ? await this.bindingProvisioner.prepare({
        tenantId,
        asset: {
          id: '__PENDING__',
          tenantId,
          assetKind: 'cloud.account',
          providerKey,
          displayName: input.displayName.trim(),
          accountId: input.accountId?.trim() || undefined,
          credentialRef: input.credentialRef.trim(),
          scope,
          status: 'ACTIVE',
          metadata: input.metadata ?? {},
          createdAt: '',
          updatedAt: '',
          version: 1,
        },
        ...(input.pluginVersionId?.trim() ? { requestedPluginVersionId: input.pluginVersionId.trim() } : {}),
      })
      : undefined;
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await this.replayAsset(tx, tenantId, idempotencyScope, idempotencyKey, hash);
        if (replay) return replay;
        const identity = `${providerKey}:${input.accountId?.trim() ?? ''}:${stableScopeHash(scope)}`;
        const duplicate = await tx.query<{ id: string }>(
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
          providerKey,
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
        await tx.query(
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
        if (this.bindingProvisioner) {
          await this.bindingProvisioner.provision(tx, {
            tenantId,
            asset,
            ...(preparedBinding !== undefined ? { prepared: preparedBinding } : {}),
            ...(input.pluginVersionId?.trim() ? { requestedPluginVersionId: input.pluginVersionId.trim() } : {}),
          });
        }
        if (idempotencyKey && hash) await saveAssetIdempotency(tx, tenantId, idempotencyScope, idempotencyKey, hash, 201, asset);
        return asset;
      });
    } catch (error) {
      return this.replayAfterIdempotencyRace(error, tenantId, idempotencyScope, idempotencyKey, hash);
    }
  }

  async list(tenantId: string): Promise<{ items: CloudAccountAsset[]; page: number; pageSize: number; total: number }> {
    const rows = await this.db.query<CloudAccountAssetRow>(
      `select * from pg_cloud_account_assets where tenant_id=$1 and deleted_at is null order by updated_at desc`,
      [tenantId],
    );
    const items = rows.rows.map(toAsset);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  /** 中文说明：只返回凭据槽位引用，不读取或返回任何密文。 */
  async resolveCredentialSecretRef(tenantId: string, credentialId: string, slot?: string): Promise<string> {
    const row = (await this.db.query<{ secret_slots: Record<string, unknown> }>(
      'select secret_slots from credential_profiles where tenant_id=$1 and id=$2 and status=\'active\'',
      [tenantId, credentialId],
    )).rows[0];
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', '云账号凭据不存在或已停用', { credentialId });
    const slots = row.secret_slots ?? {};
    const candidates = slot ? [slots[slot]] : Object.values(slots);
    const secretRef = candidates.find((value): value is string => typeof value === 'string' && value.startsWith('secret://'));
    if (!secretRef) throw new AppError('VALIDATION_FAILED', '云账号凭据没有可用 SecretRef', { credentialId, slot });
    return secretRef;
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
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new AppError('VALIDATION_FAILED', 'expectedVersion 必须是正整数', { field: 'expectedVersion' });
    }
    if (input.credentialRef !== undefined) validateCredentialRef(input.credentialRef);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencyScope = createScope('update', id);
    const { idempotencyKey: _ignored, expectedVersion: _expectedVersion, ...requestInput } = input;
    const hash = idempotencyKey ? requestHash({ operation: 'update', id, input: requestInput }) : undefined;
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await this.replayAsset(tx, tenantId, idempotencyScope, idempotencyKey, hash);
        if (replay) return replay;
        const current = await this.getWithDb(tx, tenantId, id);
        if (current.version !== input.expectedVersion) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', '云账号资产版本冲突', {
            assetId: id,
            expectedVersion: input.expectedVersion,
            actualVersion: current.version,
          });
        }
        const updated: CloudAccountAsset = {
          ...current,
          ...requestInput,
          displayName: input.displayName?.trim() || current.displayName,
          credentialRef: input.credentialRef?.trim() || current.credentialRef,
          scope: input.scope ?? current.scope,
          metadata: input.metadata ?? current.metadata,
          updatedAt: new Date().toISOString(),
          version: current.version + 1,
        };
        const identity = `${updated.providerKey}:${updated.accountId ?? ''}:${stableScopeHash(updated.scope)}`;
        const duplicate = await tx.query<{ id: string }>(
          `select id from pg_cloud_account_assets
           where tenant_id=$1 and identity_key=$2 and id<>$3 and deleted_at is null limit 1`,
          [tenantId, identity, id],
        );
        if (duplicate.rows[0]) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', '相同云账号作用域已经存在', { assetId: duplicate.rows[0].id });
        }
        const result = await tx.query<CloudAccountAssetRow>(
          `update pg_cloud_account_assets
           set display_name=$3, account_id=$4, credential_ref=$5, scope=$6::jsonb, identity_key=$7,
               status=$8, metadata=$9::jsonb, updated_at=$10::timestamptz, version=$11
           where tenant_id=$1 and id=$2 and deleted_at is null and version=$12
           returning *`,
          [
            tenantId, id, updated.displayName, updated.accountId ?? null, updated.credentialRef,
            JSON.stringify(updated.scope), identity, updated.status, JSON.stringify(updated.metadata),
            updated.updatedAt, updated.version, input.expectedVersion,
          ],
        );
        if (!result.rows[0]) throw new AppError('RESOURCE_VERSION_CONFLICT', '云账号资产版本冲突', { assetId: id, expectedVersion: input.expectedVersion });
        const saved = toAsset(result.rows[0]);
        if (idempotencyKey && hash) await saveAssetIdempotency(tx, tenantId, idempotencyScope, idempotencyKey, hash, 200, saved);
        return saved;
      });
    } catch (error) {
      return this.replayAfterIdempotencyRace(error, tenantId, idempotencyScope, idempotencyKey, hash);
    }
  }

  async delete(tenantId: string, id: string, idempotencyKey?: string): Promise<CloudAccountAsset> {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    const idempotencyScope = createScope('delete', id);
    const hash = normalizedKey ? requestHash({ operation: 'delete', id }) : undefined;
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await this.replayAsset(tx, tenantId, idempotencyScope, normalizedKey, hash);
        if (replay) return replay;
        const current = await this.getWithDb(tx, tenantId, id);
        const deletedAt = new Date().toISOString();
        const deleted = { ...current, status: 'DELETED' as const, deletedAt, updatedAt: deletedAt, version: current.version + 1 };
        const result = await tx.query<CloudAccountAssetRow>(
          `update pg_cloud_account_assets set status='DELETED', deleted_at=$3::timestamptz, updated_at=$3::timestamptz, version=$4
           where tenant_id=$1 and id=$2 and deleted_at is null
           returning *`,
          [tenantId, id, deletedAt, deleted.version],
        );
        if (!result.rows[0]) throw new AppError('RESOURCE_VERSION_CONFLICT', '云账号资产版本冲突', { assetId: id });
        const saved = toAsset(result.rows[0]);
        if (normalizedKey && hash) await saveAssetIdempotency(tx, tenantId, idempotencyScope, normalizedKey, hash, 200, saved);
        return saved;
      });
    } catch (error) {
      return this.replayAfterIdempotencyRace(error, tenantId, idempotencyScope, normalizedKey, hash);
    }
  }

  private async getWithDb(db: DatabasePort, tenantId: string, id: string): Promise<CloudAccountAsset> {
    const result = await db.query<CloudAccountAssetRow>(
      `select * from pg_cloud_account_assets where tenant_id=$1 and id=$2 and deleted_at is null`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', '云账号资产不存在', { id });
    return toAsset(row);
  }

  private async replayAsset(
    db: DatabasePort,
    tenantId: string,
    scope: IdempotencyScope,
    idempotencyKey: string | undefined,
    hash: string | undefined,
  ): Promise<CloudAccountAsset | undefined> {
    if (!idempotencyKey || !hash) return undefined;
    const record = await findIdempotencyRecord(db, tenantId, scope, idempotencyKey);
    if (!record) return undefined;
    assertSameRequest(record, hash, idempotencyKey);
    return assetFromSummary(record.responseSummary);
  }

  private async replayAfterIdempotencyRace(
    error: unknown,
    tenantId: string,
    scope: IdempotencyScope,
    idempotencyKey: string | undefined,
    hash: string | undefined,
  ): Promise<CloudAccountAsset> {
    if (!idempotencyKey || !hash || !isUniqueViolation(error)) throw error;
    const record = await findIdempotencyRecord(this.db, tenantId, scope, idempotencyKey);
    if (!record) throw error;
    assertSameRequest(record, hash, idempotencyKey);
    return assetFromSummary(record.responseSummary);
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
  if (!value.trim().startsWith('credential://')) {
    throw new AppError('VALIDATION_FAILED', '云账号凭据必须使用 CredentialRef', { field: 'credentialRef' });
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 不能为空', { field: 'idempotencyKey' });
  return normalized;
}

function createScope(action: string, resourceId: string): IdempotencyScope {
  return { actionType: `cloud-account-asset.${action}`, resourceType: 'cloudAccountAsset', resourceId };
}

async function saveAssetIdempotency(
  db: DatabasePort,
  tenantId: string,
  scope: IdempotencyScope,
  idempotencyKey: string,
  hash: string,
  statusCode: number,
  asset: CloudAccountAsset,
): Promise<void> {
  await saveIdempotencyRecord(db, {
    tenantId,
    scope,
    idempotencyKey,
    requestHash: hash,
    statusCode,
    responseSummary: asset as unknown as Record<string, unknown>,
  });
}

function assetFromSummary(value: Record<string, unknown>): CloudAccountAsset {
  if (typeof value.id !== 'string' || typeof value.tenantId !== 'string' || value.assetKind !== 'cloud.account'
    || typeof value.providerKey !== 'string' || typeof value.displayName !== 'string'
    || typeof value.credentialRef !== 'string' || typeof value.version !== 'number') {
    throw new AppError('SYSTEM_INTERNAL_ERROR', '幂等响应摘要不是有效的云账号资产');
  }
  return value as unknown as CloudAccountAsset;
}
