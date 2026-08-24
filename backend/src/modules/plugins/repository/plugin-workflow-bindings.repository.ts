import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { PluginWorkflowBindingRecord } from '../dto/plugin-workflow-bindings.dto.js';

export interface PluginWorkflowBindingsRepositoryPort {
  save(record: PluginWorkflowBindingRecord): Promise<PluginWorkflowBindingRecord>;
  find(pluginVersionId: string, capabilityKey: string): Promise<PluginWorkflowBindingRecord | undefined>;
  findByResource(pluginVersionId: string, workflowResourcePath: string): Promise<PluginWorkflowBindingRecord | undefined>;
  findLatestByPluginResource(tenantId: string, pluginId: string, workflowResourcePath: string): Promise<PluginWorkflowBindingRecord | undefined>;
  listCurrent(tenantId: string): Promise<PluginWorkflowBindingRecord[]>;
  list(pluginVersionId: string): Promise<PluginWorkflowBindingRecord[]>;
  listAll(): Promise<PluginWorkflowBindingRecord[]>;
}

export class PluginWorkflowBindingsRepository implements PluginWorkflowBindingsRepositoryPort {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async save(record: PluginWorkflowBindingRecord): Promise<PluginWorkflowBindingRecord> {
    await this.db.query(`insert into unified_plugin_workflow_bindings
      (plugin_version_id,owner_type,owner_id,capability_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (plugin_version_id,capability_key) do update set
        owner_type=excluded.owner_type,
        owner_id=excluded.owner_id`, [
      record.pluginVersionId, record.ownerType ?? 'SYSTEM', record.ownerId ?? null, record.capabilityKey,
      record.workflowResourcePath, record.workflowTemplateId, record.workflowVersionId, record.workflowContentSha256, record.createdAt,
    ]);
    return (await this.find(record.pluginVersionId, record.capabilityKey)) ?? record;
  }

  async find(pluginVersionId: string, capabilityKey: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const row = (await this.db.query<WorkflowBindingRow>(
      'select * from unified_plugin_workflow_bindings where plugin_version_id=$1 and capability_key=$2',
      [pluginVersionId, capabilityKey],
    )).rows[0];
    return row ? toRecord(row) : undefined;
  }

  async findByResource(pluginVersionId: string, workflowResourcePath: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const row = (await this.db.query<WorkflowBindingRow>(
      'select * from unified_plugin_workflow_bindings where plugin_version_id=$1 and workflow_resource_path=$2',
      [pluginVersionId, workflowResourcePath],
    )).rows[0];
    return row ? toRecord(row) : undefined;
  }

  async findLatestByPluginResource(tenantId: string, pluginId: string, workflowResourcePath: string): Promise<PluginWorkflowBindingRecord | undefined> {
    const row = (await this.db.query<WorkflowBindingRow>(`
      select binding.*
        from unified_plugin_workflow_bindings binding
        join unified_plugin_versions plugin on plugin.id = binding.plugin_version_id
       where plugin.tenant_id = $1
         and plugin.plugin_id = $2
         and binding.workflow_resource_path = $3
       order by plugin.created_at desc, binding.created_at desc
       limit 1
    `, [tenantId, pluginId, workflowResourcePath])).rows[0];
    return row ? toRecord(row) : undefined;
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
      select distinct on (binding.workflow_resource_path, binding.workflow_template_id) binding.*
        from unified_plugin_workflow_bindings binding
        join current_plugin_versions plugin
          on plugin.id = binding.plugin_version_id
         and plugin.position = 1
       order by binding.workflow_resource_path, binding.workflow_template_id, binding.capability_key
    `, [tenantId])).rows;
    return rows.map(toRecord);
  }

  async list(pluginVersionId: string): Promise<PluginWorkflowBindingRecord[]> {
    const rows = (await this.db.query<WorkflowBindingRow>(
      'select * from unified_plugin_workflow_bindings where plugin_version_id=$1 order by capability_key',
      [pluginVersionId],
    )).rows;
    return rows.map(toRecord);
  }

  async listAll(): Promise<PluginWorkflowBindingRecord[]> {
    try {
      const rows = (await this.db.query<WorkflowBindingRow>(`
        select binding.*, plugin.plugin_id as plugin_id
          from unified_plugin_workflow_bindings binding
          join unified_plugin_versions plugin
            on plugin.id = binding.plugin_version_id
         order by plugin.plugin_id, binding.workflow_resource_path, binding.created_at, binding.capability_key
      `)).rows;
      return rows.map(toRecord);
    } catch (error) {
      // 兼容尚未执行插件工作流绑定迁移的旧测试库和旧部署库；正式库执行迁移后不走此分支。
      if (isMissingBindingTableError(error)) return [];
      throw error;
    }
  }
}

interface WorkflowBindingRow extends Record<string, unknown> {
  plugin_version_id: string;
  plugin_id?: string;
  owner_type?: 'SYSTEM' | 'TENANT';
  owner_id?: string;
  capability_key: string;
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
    workflowResourcePath: row.workflow_resource_path,
    workflowTemplateId: row.workflow_template_id,
    workflowVersionId: row.workflow_version_id,
    workflowContentSha256: row.workflow_content_sha256,
    createdAt: row.created_at,
  };
}

function isMissingBindingTableError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '42P01');
}
