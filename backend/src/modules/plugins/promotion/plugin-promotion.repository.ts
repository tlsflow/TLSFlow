import type { DatabasePort } from '../../../database/database-port.js';
import type { PluginPromotionRecord } from './plugin-promotion.dto.js';

export class PluginPromotionRepository {
  constructor(private readonly db: DatabasePort) {}

  async save(record: PluginPromotionRecord): Promise<PluginPromotionRecord> {
    await this.db.query(`insert into plugin_promotion_records
      (id,tenant_id,source_plugin_binding_id,target_plugin_binding_id,device_asset_id,application_asset_id,status,
       preview_snapshot,created_resources,error_code,error_message,created_at,updated_at,completed_at,revoked_at,version)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
      on conflict (id) do update set target_plugin_binding_id=excluded.target_plugin_binding_id,
       device_asset_id=excluded.device_asset_id,application_asset_id=excluded.application_asset_id,status=excluded.status,
       preview_snapshot=excluded.preview_snapshot,created_resources=excluded.created_resources,error_code=excluded.error_code,
       error_message=excluded.error_message,updated_at=excluded.updated_at,completed_at=excluded.completed_at,
       revoked_at=excluded.revoked_at,version=excluded.version`, [
      record.id, record.tenantId, record.sourcePluginBindingId, record.targetPluginBindingId ?? null,
      record.deviceAssetId ?? null, record.applicationAssetId ?? null, record.status,
      JSON.stringify(record.previewSnapshot), JSON.stringify(record.createdResources), record.errorCode ?? null,
      record.errorMessage ?? null, record.createdAt, record.updatedAt, record.completedAt ?? null,
      record.revokedAt ?? null, record.version,
    ]);
    return record;
  }

  async get(tenantId: string, id: string): Promise<PluginPromotionRecord | undefined> {
    const row = (await this.db.query<PromotionRow>('select * from plugin_promotion_records where tenant_id=$1 and id=$2', [tenantId, id])).rows[0];
    return row ? toRecord(row) : undefined;
  }
}

interface PromotionRow extends Record<string, unknown> {
  id: string; tenant_id: string; source_plugin_binding_id: string; target_plugin_binding_id?: string;
  device_asset_id?: string; application_asset_id?: string; status: PluginPromotionRecord['status'];
  preview_snapshot: PluginPromotionRecord['previewSnapshot']; created_resources: Record<string, unknown>;
  error_code?: string; error_message?: string; created_at: string; updated_at: string;
  completed_at?: string; revoked_at?: string; version: number;
}

function toRecord(row: PromotionRow): PluginPromotionRecord {
  return {
    id: row.id, tenantId: row.tenant_id, sourcePluginBindingId: row.source_plugin_binding_id,
    targetPluginBindingId: row.target_plugin_binding_id ?? undefined, deviceAssetId: row.device_asset_id ?? undefined,
    applicationAssetId: row.application_asset_id ?? undefined, status: row.status, previewSnapshot: row.preview_snapshot,
    createdResources: row.created_resources ?? {}, errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined, revokedAt: row.revoked_at ?? undefined, version: row.version,
  };
}
