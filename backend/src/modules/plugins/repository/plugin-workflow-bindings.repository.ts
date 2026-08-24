import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { PluginWorkflowBindingRecord } from '../dto/plugin-workflow-bindings.dto.js';

export interface PluginWorkflowBindingsRepositoryPort {
  save(record: PluginWorkflowBindingRecord): Promise<PluginWorkflowBindingRecord>;
  find(pluginVersionId: string, capabilityKey: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined>;
  findByResource(pluginVersionId: string, workflowResourcePath: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined>;
  findLatestByPluginResource(tenantId: string, pluginId: string, workflowResourcePath: string, capabilityKey?: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined>;
  listCurrent(tenantId: string): Promise<PluginWorkflowBindingRecord[]>;
  list(pluginVersionId: string): Promise<PluginWorkflowBindingRecord[]>;
  listAll(): Promise<PluginWorkflowBindingRecord[]>;
}

export class PluginWorkflowBindingsRepository implements PluginWorkflowBindingsRepositoryPort {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async save(record: PluginWorkflowBindingRecord): Promise<PluginWorkflowBindingRecord> {
    await this.db.query(`insert into unified_plugin_workflow_bindings
      (plugin_version_id,owner_type,owner_id,capability_key,workflow_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (plugin_version_id,capability_key,workflow_key) do update set
        owner_type=excluded.owner_type,
        owner_id=excluded.owner_id`, [
      record.pluginVersionId, record.ownerType ?? 'SYSTEM', record.ownerId ?? null, record.capabilityKey, record.workflowKey,
      record.workflowResourcePath, record.workflowTemplateId, record.workflowVersionId, record.workflowContentSha256, record.createdAt,
    ]);
    return (await this.find(record.pluginVersionId, record.capabilityKey, record.workflowKey)) ?? record;
  }

  async find(pluginVersionId: string, capabilityKey: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const rows = (await this.db.query<WorkflowBindingRow>(`
      select *
        from unified_plugin_workflow_bindings
       where plugin_version_id=$1
         and capability_key=$2
         and ($3::text is null or workflow_key=$3)
       order by workflow_key
    `, [pluginVersionId, capabilityKey, workflowKey ?? null])).rows;
    return oneOrFailOnAmbiguous(rows, { pluginVersionId, capabilityKey, workflowKey });
  }

  async findByResource(pluginVersionId: string, workflowResourcePath: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const rows = (await this.db.query<WorkflowBindingRow>(`
      select *
        from unified_plugin_workflow_bindings
       where plugin_version_id=$1
         and workflow_resource_path=$2
         and ($3::text is null or workflow_key=$3)
       order by workflow_key
    `, [pluginVersionId, workflowResourcePath, workflowKey ?? null])).rows;
    return oneOrFailOnAmbiguous(rows, { pluginVersionId, workflowResourcePath, workflowKey });
  }

  async findLatestByPluginResource(tenantId: string, pluginId: string, workflowResourcePath: string, capabilityKey?: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const rows = (await this.db.query<WorkflowBindingRow>(`
      select distinct on (binding.workflow_key) binding.*
        from unified_plugin_workflow_bindings binding
        join unified_plugin_versions plugin on plugin.id = binding.plugin_version_id
       where plugin.tenant_id = $1
         and plugin.plugin_id = $2
         and binding.workflow_resource_path = $3
         and ($4::text is null or binding.capability_key = $4)
         and ($5::text is null or binding.workflow_key = $5)
       order by binding.workflow_key, plugin.created_at desc, binding.created_at desc
    `, [tenantId, pluginId, workflowResourcePath, capabilityKey ?? null, workflowKey ?? null])).rows;
    return oneOrFailOnAmbiguous(rows, { tenantId, pluginId, workflowResourcePath, capabilityKey, workflowKey }, true);
  }

  async listCurrent(tenantId: string): Promise<PluginWorkflowBindingRecord[]> {
    const rows = (await this.db.query<WorkflowBindingRow>(`
      with current_plugin_versions as (
        select id,
               row_number() over (partition by plugin_id order by created_at desc, id desc) position
          from unified_plugin_versions
         where tenant_id = $1
           and status = 'ENABLED'
      )
      select distinct on (binding.workflow_resource_path, binding.workflow_template_id, binding.workflow_key) binding.*
        from unified_plugin_workflow_bindings binding
        join current_plugin_versions plugin
          on plugin.id = binding.plugin_version_id
         and plugin.position = 1
       order by binding.workflow_resource_path, binding.workflow_template_id, binding.workflow_key, binding.capability_key
    `, [tenantId])).rows;
    return rows.map(toRecord);
  }

  async list(pluginVersionId: string): Promise<PluginWorkflowBindingRecord[]> {
    const rows = (await this.db.query<WorkflowBindingRow>(
      'select * from unified_plugin_workflow_bindings where plugin_version_id=$1 order by capability_key, workflow_key',
      [pluginVersionId],
    )).rows;
    return rows.map(toRecord);
  }

  async listAll(): Promise<PluginWorkflowBindingRecord[]> {
    const rows = (await this.db.query<WorkflowBindingRow>(`
      select binding.*, plugin.plugin_id as plugin_id
        from unified_plugin_workflow_bindings binding
        join unified_plugin_versions plugin
          on plugin.id = binding.plugin_version_id
       order by plugin.plugin_id, binding.workflow_resource_path, binding.created_at, binding.capability_key, binding.workflow_key
    `)).rows;
    return rows.map(toRecord);
  }
}

interface WorkflowBindingRow extends Record<string, unknown> {
  plugin_version_id: string;
  plugin_id?: string;
  owner_type?: 'SYSTEM' | 'TENANT';
  owner_id?: string;
  capability_key: string;
  workflow_key: string;
  workflow_resource_path: string;
  workflow_template_id: string;
  workflow_version_id: string;
  workflow_content_sha256: string;
  created_at: string;
}

function toRecord(row: WorkflowBindingRow): PluginWorkflowBindingRecord {
  return {
    pluginVersionId: row.plugin_version_id,
    ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
    ownerType: row.owner_type ?? 'SYSTEM',
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    capabilityKey: row.capability_key,
    workflowKey: row.workflow_key,
    workflowResourcePath: row.workflow_resource_path,
    workflowTemplateId: row.workflow_template_id,
    workflowVersionId: row.workflow_version_id,
    workflowContentSha256: row.workflow_content_sha256,
    createdAt: row.created_at,
  };
}

function oneOrFailOnAmbiguous(
  rows: WorkflowBindingRow[],
  details: Record<string, unknown>,
  latest = false,
): PluginWorkflowBindingRecord | undefined {
  if (rows.length > 1) {
    throw new AppError('VALIDATION_FAILED', 'Capability 对应多个 Workflow，必须提供明确 workflowKey', {
      code: 'PLUGIN_WORKFLOW_KEY_REQUIRED',
      latest,
      ...details,
      workflowKeys: rows.map((row) => row.workflow_key),
    });
  }
  return rows[0] ? toRecord(rows[0]) : undefined;
}
