import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { CapabilityAssignmentV1, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';

export class PluginBindingsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async saveBinding(record: PluginBindingV1): Promise<PluginBindingV1> {
    await this.db.query(`insert into unified_plugin_bindings
      (id,tenant_id,plugin_version_id,mode,variable_bindings,credential_bindings,secret_bindings,certificate_artifact_bindings,connection_bindings,managed_context,status,version,created_at,updated_at)
      values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
      on conflict (id) do update set variable_bindings=excluded.variable_bindings,credential_bindings=excluded.credential_bindings,secret_bindings=excluded.secret_bindings,
      certificate_artifact_bindings=excluded.certificate_artifact_bindings,connection_bindings=excluded.connection_bindings,
      managed_context=excluded.managed_context,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`, [
      record.id, record.tenantId, record.pluginVersionId, record.mode, JSON.stringify(record.variableBindings),
      JSON.stringify(record.credentialBindings), JSON.stringify(record.secretBindings), JSON.stringify(record.certificateArtifactBindings), JSON.stringify(record.connectionBindings),
      record.managedContext ? JSON.stringify(record.managedContext) : null, record.status, record.version, record.createdAt, record.updatedAt,
    ]);
    return record;
  }

  async getBinding(id: string): Promise<PluginBindingV1 | undefined> {
    const row = (await this.db.query<BindingRow>('select * from unified_plugin_bindings where id=$1', [id])).rows[0];
    return row ? binding(row) : undefined;
  }

  async saveAssignment(record: CapabilityAssignmentV1): Promise<CapabilityAssignmentV1> {
    await this.db.query(`insert into plugin_capability_assignments
      (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (tenant_id,owner_type,owner_id,capability_key) do update set plugin_version_id=excluded.plugin_version_id,
      plugin_binding_id=excluded.plugin_binding_id,precedence=excluded.precedence,status=excluded.status,updated_at=excluded.updated_at`, [
      record.id, record.tenantId, record.ownerType, record.ownerId, record.capabilityKey, record.pluginVersionId,
      record.pluginBindingId, record.precedence, record.status, record.createdAt, record.updatedAt,
    ]);
    return record;
  }

  async listAssignments(tenantId: string, capabilityKey: string): Promise<CapabilityAssignmentV1[]> {
    const rows = (await this.db.query<AssignmentRow>(
      'select * from plugin_capability_assignments where tenant_id=$1 and capability_key=$2 and status=$3',
      [tenantId, capabilityKey, 'ACTIVE'],
    )).rows;
    return rows.map(assignment);
  }
}

interface BindingRow extends Record<string, unknown> {
  id: string; tenant_id: string; plugin_version_id: string; mode: PluginBindingV1['mode']; variable_bindings: Record<string, unknown>;
  credential_bindings: PluginBindingV1['credentialBindings']; secret_bindings: Record<string, string>; certificate_artifact_bindings: PluginBindingV1['certificateArtifactBindings'];
  connection_bindings: Record<string, unknown>; managed_context?: PluginBindingV1['managedContext']; status: PluginBindingV1['status'];
  version: number; created_at: string; updated_at: string;
}
interface AssignmentRow extends Record<string, unknown> {
  id: string; tenant_id: string; owner_type: CapabilityAssignmentV1['ownerType']; owner_id: string; capability_key: string;
  plugin_version_id: string; plugin_binding_id: string; precedence: CapabilityAssignmentV1['precedence']; status: CapabilityAssignmentV1['status'];
  created_at: string; updated_at: string;
}
function binding(row: BindingRow): PluginBindingV1 { return { id: row.id, tenantId: row.tenant_id, pluginVersionId: row.plugin_version_id, mode: row.mode, variableBindings: row.variable_bindings ?? {}, credentialBindings: row.credential_bindings ?? {}, secretBindings: row.secret_bindings ?? {}, certificateArtifactBindings: row.certificate_artifact_bindings ?? {}, connectionBindings: row.connection_bindings ?? {}, managedContext: row.managed_context, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assignment(row: AssignmentRow): CapabilityAssignmentV1 { return { id: row.id, tenantId: row.tenant_id, ownerType: row.owner_type, ownerId: row.owner_id, capabilityKey: row.capability_key, pluginVersionId: row.plugin_version_id, pluginBindingId: row.plugin_binding_id, precedence: row.precedence, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
