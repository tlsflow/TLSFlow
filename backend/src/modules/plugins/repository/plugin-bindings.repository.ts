import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityAssignmentV1, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';

export class PluginBindingsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async saveBinding(record: PluginBindingV1): Promise<PluginBindingV1> {
    await this.db.query(`insert into unified_plugin_bindings
      (id,tenant_id,plugin_id,plugin_version_id,mode,input_bindings,managed_context,status,version,created_at,updated_at)
      values ($1,$2,coalesce($3, (select plugin_id from unified_plugin_versions where id=$4)),$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)
      on conflict (id) do update set plugin_id=excluded.plugin_id,input_bindings=excluded.input_bindings,
      managed_context=excluded.managed_context,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`, [
      record.id, record.tenantId, record.pluginId ?? null, record.pluginVersionId, record.mode, JSON.stringify(record.inputBindings),
      record.managedContext ? JSON.stringify(record.managedContext) : null, record.status, record.version, record.createdAt, record.updatedAt,
    ]);
    return (await this.getBinding(record.id)) ?? record;
  }

  async updateBinding(record: PluginBindingV1, expectedVersion: number): Promise<PluginBindingV1> {
    const result = await this.db.query<{ id: string }>(`update unified_plugin_bindings
      set input_bindings=$3::jsonb, managed_context=$4::jsonb, status=$5, version=$6, updated_at=$7
      where tenant_id=$1 and id=$2 and version=$8
      returning id`, [
      record.tenantId, record.id, JSON.stringify(record.inputBindings), record.managedContext ? JSON.stringify(record.managedContext) : null,
      record.status, record.version, record.updatedAt, expectedVersion,
    ]);
    if (result.rows.length === 0) throw new AppError('RESOURCE_VERSION_CONFLICT', 'PluginBinding 版本冲突', { bindingId: record.id, expectedVersion });
    return record;
  }

  async getBinding(id: string): Promise<PluginBindingV1 | undefined> {
    const row = (await this.db.query<BindingRow>('select * from unified_plugin_bindings where id=$1', [id])).rows[0];
    return row ? binding(row) : undefined;
  }

  async getBindingForUpdate(tenantId: string, id: string): Promise<PluginBindingV1 | undefined> {
    const row = (await this.db.query<BindingRow>(
      'select * from unified_plugin_bindings where tenant_id=$1 and id=$2 for update',
      [tenantId, id],
    )).rows[0];
    return row ? binding(row) : undefined;
  }

  async saveAssignment(record: CapabilityAssignmentV1): Promise<CapabilityAssignmentV1> {
    await this.db.query(`insert into plugin_capability_assignments
      (id,tenant_id,owner_type,owner_id,capability_key,plugin_id,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at)
      values ($1,$2,$3,$4,$5,coalesce($6, (select plugin_id from unified_plugin_versions where id=$7)),$7,$8,$9,$10,$11,$12)
      on conflict (tenant_id,owner_type,owner_id,capability_key) do update set plugin_id=excluded.plugin_id,plugin_version_id=excluded.plugin_version_id,
      plugin_binding_id=excluded.plugin_binding_id,precedence=excluded.precedence,status=excluded.status,updated_at=excluded.updated_at`, [
      record.id, record.tenantId, record.ownerType, record.ownerId, record.capabilityKey, record.pluginId ?? null, record.pluginVersionId,
      record.pluginBindingId, record.precedence, record.status, record.createdAt, record.updatedAt,
    ]);
    return record;
  }

  async disableAssignment(
    tenantId: string,
    ownerType: CapabilityAssignmentV1['ownerType'],
    ownerId: string,
    capabilityKey: string,
    updatedAt: string,
  ): Promise<void> {
    await this.db.query(
      `update plugin_capability_assignments
       set status='DISABLED', updated_at=$5
       where tenant_id=$1 and owner_type=$2 and owner_id=$3 and capability_key=$4 and status='ACTIVE'`,
      [tenantId, ownerType, ownerId, capabilityKey, updatedAt],
    );
  }

  async listAssignments(tenantId: string, capabilityKey: string): Promise<CapabilityAssignmentV1[]> {
    const rows = (await this.db.query<AssignmentRow>(
      'select * from plugin_capability_assignments where tenant_id=$1 and capability_key=$2 and status=$3',
      [tenantId, capabilityKey, 'ACTIVE'],
    )).rows;
    return rows.map(assignment);
  }

  async listOwnerAssignments(tenantId: string, ownerType: CapabilityAssignmentV1['ownerType'], ownerId: string): Promise<CapabilityAssignmentV1[]> {
    const rows = (await this.db.query<AssignmentRow>(
      `select * from plugin_capability_assignments
       where tenant_id=$1 and owner_type=$2 and owner_id=$3
       order by capability_key`,
      [tenantId, ownerType, ownerId],
    )).rows;
    return rows.map(assignment);
  }
}

interface BindingRow extends Record<string, unknown> {
  id: string; tenant_id: string; plugin_id?: string; plugin_version_id: string; mode: PluginBindingV1['mode']; input_bindings: PluginBindingV1['inputBindings'];
  managed_context?: PluginBindingV1['managedContext']; status: PluginBindingV1['status'];
  version: number; created_at: string; updated_at: string;
}
interface AssignmentRow extends Record<string, unknown> {
  id: string; tenant_id: string; owner_type: CapabilityAssignmentV1['ownerType']; owner_id: string; capability_key: string;
  plugin_id?: string; plugin_version_id: string; plugin_binding_id: string; precedence: CapabilityAssignmentV1['precedence']; status: CapabilityAssignmentV1['status'];
  created_at: string; updated_at: string;
}
function binding(row: BindingRow): PluginBindingV1 { return { id: row.id, tenantId: row.tenant_id, ...(row.plugin_id ? { pluginId: row.plugin_id } : {}), pluginVersionId: row.plugin_version_id, mode: row.mode, inputBindings: row.input_bindings, managedContext: row.managed_context, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assignment(row: AssignmentRow): CapabilityAssignmentV1 { return { id: row.id, tenantId: row.tenant_id, ownerType: row.owner_type, ownerId: row.owner_id, capabilityKey: row.capability_key, ...(row.plugin_id ? { pluginId: row.plugin_id } : {}), pluginVersionId: row.plugin_version_id, pluginBindingId: row.plugin_binding_id, precedence: row.precedence, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
