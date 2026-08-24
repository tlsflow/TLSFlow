import { randomUUID } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { CreateWorkflowExecutionBindingInput, UpdateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../dto/workflow-execution-bindings.dto.js';

export interface WorkflowExecutionBindingChain {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  pluginTenantId: string;
  pluginSource: 'BUILTIN' | 'USER';
  pluginRuntime: 'AGENT_PLAN' | 'WORKFLOW_DSL';
  pluginStatus: string;
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  capabilityDeclared: boolean;
  workflowTemplateId: string;
  workflowTemplateOrigin?: string;
  workflowVersionId: string;
  workflowVersionTemplateId?: string;
  workflowVersionStatus?: string;
  workflowContentSha256: string;
  workflowVersionContentHash?: string;
}

export class WorkflowExecutionBindingsRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateWorkflowExecutionBindingInput): Promise<WorkflowExecutionBinding> {
    const now = new Date().toISOString();
    const id = `wfeb_${randomUUID()}`;
    await this.db.query(`insert into workflow_execution_bindings
      (id,tenant_id,plugin_version_id,capability_key,workflow_template_id,workflow_version_selection,workflow_version_id,runner,gateway_id,input_bindings,status,version,created_at,updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'ACTIVE',1,$11::timestamptz,$11::timestamptz)`,
    [id,input.tenantId,input.pluginVersionId,input.capabilityKey,input.workflowTemplateId,input.workflowVersionSelection,input.workflowVersionId,input.runner,input.gatewayId ?? null,JSON.stringify(input.inputBindings),now]);
    const created = await this.find(input.tenantId, id);
    if (!created) throw new Error(`workflow execution binding was not created: ${id}`);
    return created;
  }

  async find(tenantId: string, id: string): Promise<WorkflowExecutionBinding | undefined> {
    const row = (await this.db.query<BindingRow>('select * from workflow_execution_bindings where tenant_id=$1 and id=$2',[tenantId,id])).rows[0];
    return row ? map(row) : undefined;
  }

  async update(tenantId: string, id: string, input: UpdateWorkflowExecutionBindingInput): Promise<WorkflowExecutionBinding | undefined> {
    const current = await this.find(tenantId,id); if (!current || current.version !== input.expectedVersion) return undefined;
    const next = { ...current, ...input, version: current.version + 1, updatedAt: new Date().toISOString() };
    const result = await this.db.query(`update workflow_execution_bindings set plugin_version_id=$4,capability_key=$5,workflow_template_id=$6,workflow_version_selection=$7,workflow_version_id=$8,runner=$9,gateway_id=$10,input_bindings=$11::jsonb,status=$12,version=version+1,updated_at=$13::timestamptz where tenant_id=$1 and id=$2 and version=$3 returning id`,[tenantId,id,input.expectedVersion,next.pluginVersionId,next.capabilityKey,next.workflowTemplateId,next.workflowVersionSelection,next.workflowVersionId,next.runner,next.gatewayId ?? null,JSON.stringify(next.inputBindings),next.status,next.updatedAt]);
    if (result.rows.length === 0) return undefined;
    return this.find(tenantId, id);
  }

  async findFixedWorkflowChain(input: Pick<CreateWorkflowExecutionBindingInput, 'tenantId' | 'pluginVersionId' | 'capabilityKey' | 'workflowTemplateId' | 'workflowVersionId'>): Promise<WorkflowExecutionBindingChain | undefined> {
    const row = (await this.db.query<WorkflowExecutionBindingChainRow>(`
      select
        plugin.id as plugin_version_id,
        plugin.plugin_id,
        plugin.plugin_version,
        plugin.tenant_id as plugin_tenant_id,
        plugin.source as plugin_source,
        plugin.runtime as plugin_runtime,
        plugin.status as plugin_status,
        plugin.package_sha256,
        plugin.manifest_sha256,
        plugin.resource_sha256,
        exists (
          select 1
            from jsonb_array_elements(coalesce(plugin.manifest->'capabilities', '[]'::jsonb)) declared
           where declared->>'key' = $3
        ) as capability_declared,
        workflow_binding.workflow_template_id,
        template.payload->>'origin' as workflow_template_origin,
        workflow_binding.workflow_version_id,
        version.payload->>'templateId' as workflow_version_template_id,
        version.payload->>'status' as workflow_version_status,
        workflow_binding.workflow_content_sha256,
        version.payload->>'contentHash' as workflow_version_content_hash
      from unified_plugin_workflow_bindings workflow_binding
      join unified_plugin_versions plugin
        on plugin.id = workflow_binding.plugin_version_id
      left join pg_documents template
        on template.namespace = 'workflow.templates'
       and template.document_id = workflow_binding.workflow_template_id
      left join pg_documents version
        on version.namespace = 'workflow.template_versions'
       and version.document_id = workflow_binding.workflow_version_id
     where (plugin.tenant_id = $1 or plugin.source = 'BUILTIN')
       and workflow_binding.plugin_version_id = $2
       and workflow_binding.capability_key = $3
       and workflow_binding.workflow_template_id = $4
       and workflow_binding.workflow_version_id = $5
    `, [input.tenantId, input.pluginVersionId, input.capabilityKey, input.workflowTemplateId, input.workflowVersionId])).rows[0];
    return row ? mapChain(row) : undefined;
  }
}

interface BindingRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  plugin_version_id: string;
  capability_key: string;
  workflow_template_id: string;
  workflow_version_selection: 'FIXED';
  workflow_version_id: string;
  runner: 'CONTROL_PLANE' | 'GATEWAY';
  gateway_id: string | null;
  input_bindings: WorkflowExecutionBinding['inputBindings'];
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
}

interface WorkflowExecutionBindingChainRow extends Record<string, unknown> {
  plugin_version_id: string;
  plugin_id: string;
  plugin_version: string;
  plugin_tenant_id: string;
  plugin_source: 'BUILTIN' | 'USER';
  plugin_runtime: 'AGENT_PLAN' | 'WORKFLOW_DSL';
  plugin_status: string;
  package_sha256: string;
  manifest_sha256: string;
  resource_sha256: Record<string, string>;
  capability_declared: boolean;
  workflow_template_id: string;
  workflow_template_origin: string | null;
  workflow_version_id: string;
  workflow_version_template_id: string | null;
  workflow_version_status: string | null;
  workflow_content_sha256: string;
  workflow_version_content_hash: string | null;
}

function map(row: BindingRow): WorkflowExecutionBinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pluginVersionId: row.plugin_version_id,
    capabilityKey: row.capability_key,
    workflowTemplateId: row.workflow_template_id,
    workflowVersionSelection: row.workflow_version_selection,
    workflowVersionId: row.workflow_version_id,
    runner: row.runner,
    gatewayId: row.gateway_id ?? undefined,
    inputBindings: row.input_bindings,
    status: row.status,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapChain(row: WorkflowExecutionBindingChainRow): WorkflowExecutionBindingChain {
  return {
    pluginVersionId: row.plugin_version_id,
    pluginId: row.plugin_id,
    pluginVersion: row.plugin_version,
    pluginTenantId: row.plugin_tenant_id,
    pluginSource: row.plugin_source,
    pluginRuntime: row.plugin_runtime,
    pluginStatus: row.plugin_status,
    packageSha256: row.package_sha256,
    manifestSha256: row.manifest_sha256,
    resourceSha256: row.resource_sha256 ?? {},
    capabilityDeclared: row.capability_declared,
    workflowTemplateId: row.workflow_template_id,
    ...(row.workflow_template_origin ? { workflowTemplateOrigin: row.workflow_template_origin } : {}),
    workflowVersionId: row.workflow_version_id,
    ...(row.workflow_version_template_id ? { workflowVersionTemplateId: row.workflow_version_template_id } : {}),
    ...(row.workflow_version_status ? { workflowVersionStatus: row.workflow_version_status } : {}),
    workflowContentSha256: row.workflow_content_sha256,
    ...(row.workflow_version_content_hash ? { workflowVersionContentHash: row.workflow_version_content_hash } : {}),
  };
}
