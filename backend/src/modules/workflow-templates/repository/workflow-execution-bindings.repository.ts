import { randomUUID } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { CreateWorkflowExecutionBindingInput, UpdateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../dto/workflow-execution-bindings.dto.js';

export class WorkflowExecutionBindingsRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateWorkflowExecutionBindingInput): Promise<WorkflowExecutionBinding> {
    const now = new Date().toISOString();
    const id = `wfeb_${randomUUID()}`;
    const row = (await this.db.query<BindingRow>(`insert into workflow_execution_bindings
      (id,tenant_id,workflow_template_id,workflow_version_selection,workflow_version_id,runner,gateway_id,input_bindings,status,version,created_at,updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'ACTIVE',1,$9::timestamptz,$9::timestamptz) returning *`,
    [id,input.tenantId,input.workflowTemplateId,input.workflowVersionSelection,input.workflowVersionId ?? null,input.runner,input.gatewayId ?? null,JSON.stringify(input.inputBindings),now])).rows[0]!;
    return map(row);
  }

  async find(tenantId: string, id: string): Promise<WorkflowExecutionBinding | undefined> {
    const row = (await this.db.query<BindingRow>('select * from workflow_execution_bindings where tenant_id=$1 and id=$2',[tenantId,id])).rows[0];
    return row ? map(row) : undefined;
  }

  async update(tenantId: string, id: string, input: UpdateWorkflowExecutionBindingInput): Promise<WorkflowExecutionBinding | undefined> {
    const current = await this.find(tenantId,id); if (!current || current.version !== input.expectedVersion) return undefined;
    const next = { ...current, ...input, version: current.version + 1, updatedAt: new Date().toISOString() };
    const row=(await this.db.query<BindingRow>(`update workflow_execution_bindings set workflow_template_id=$4,workflow_version_selection=$5,workflow_version_id=$6,runner=$7,gateway_id=$8,input_bindings=$9::jsonb,status=$10,version=version+1,updated_at=$11::timestamptz where tenant_id=$1 and id=$2 and version=$3 returning *`,[tenantId,id,input.expectedVersion,next.workflowTemplateId,next.workflowVersionSelection,next.workflowVersionId ?? null,next.runner,next.gatewayId ?? null,JSON.stringify(next.inputBindings),next.status,next.updatedAt])).rows[0];
    return row ? map(row) : undefined;
  }
}

interface BindingRow extends Record<string, unknown> { id:string;tenant_id:string;workflow_template_id:string;workflow_version_selection:'PINNED'|'LATEST_PUBLISHED';workflow_version_id:string|null;runner:'CONTROL_PLANE'|'GATEWAY';gateway_id:string|null;input_bindings:WorkflowExecutionBinding['inputBindings'];status:'ACTIVE'|'DISABLED';version:number;created_at:string|Date;updated_at:string|Date }
function map(row: BindingRow): WorkflowExecutionBinding { return { id:row.id,tenantId:row.tenant_id,workflowTemplateId:row.workflow_template_id,workflowVersionSelection:row.workflow_version_selection,workflowVersionId:row.workflow_version_id ?? undefined,runner:row.runner,gatewayId:row.gateway_id ?? undefined,inputBindings:row.input_bindings,status:row.status,version:row.version,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString() }; }
