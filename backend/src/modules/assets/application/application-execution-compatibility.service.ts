import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAssetsRepository } from '../repository/assets.repository.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';

export type ApplicationExecutionCompatibilityStatus = 'READY' | 'UPDATE_REQUIRED' | 'UNSUPPORTED';

export interface ApplicationExecutionCompatibility {
  applicationAssetId: string;
  sourceType: 'WORKFLOW_EXECUTION_BINDING';
  sourceId: string;
  status: ApplicationExecutionCompatibilityStatus;
  issues: Array<{ code: string; path?: string; slot?: string; category?: string }>;
  checkedPluginVersionId?: string;
  checkedWorkflowVersionId?: string;
  checkedAt: string;
}

/**
 * 用与计划编译相同的当前链和输入合同复检资产。这里绝不保存 Secret 值，
 * 只保存可供界面定位的槽位、路径和错误码。
 */
export class ApplicationExecutionCompatibilityService {
  constructor(private readonly db: DatabasePort) {}

  async checkWorkflowBinding(tenantId: string, applicationAssetId: string, workflowExecutionBindingId: string): Promise<ApplicationExecutionCompatibility> {
    const assets = new PgAssetsRepository(this.db);
    const asset = await assets.getServiceAsset(tenantId, applicationAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId });
    const bindings = new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(this.db));
    try {
      const identity = await bindings.getExecutionIdentity(tenantId, workflowExecutionBindingId);
      const validation = await new WorkflowDeploymentInputSaveService(this.db).validate({
        applicationAsset: asset,
        workflowExecution: identity.binding,
        currentBinding: identity.binding,
      });
      const status: ApplicationExecutionCompatibilityStatus = validation.saveable ? 'READY' : 'UPDATE_REQUIRED';
      const result: ApplicationExecutionCompatibility = {
        applicationAssetId,
        sourceType: 'WORKFLOW_EXECUTION_BINDING',
        sourceId: workflowExecutionBindingId,
        status,
        issues: validation.issues.map((issue) => ({ code: issue.code, path: issue.path, slot: issue.slot, category: issue.category })),
        checkedPluginVersionId: identity.chain.pluginVersionId,
        checkedWorkflowVersionId: identity.chain.workflowVersionId,
        checkedAt: new Date().toISOString(),
      };
      await this.save(tenantId, result);
      return result;
    } catch (error) {
      const result: ApplicationExecutionCompatibility = {
        applicationAssetId,
        sourceType: 'WORKFLOW_EXECUTION_BINDING',
        sourceId: workflowExecutionBindingId,
        status: 'UNSUPPORTED',
        issues: [{ code: compatibilityErrorCode(error) }],
        checkedAt: new Date().toISOString(),
      };
      await this.save(tenantId, result);
      return result;
    }
  }

  async getForApplication(tenantId: string, applicationAssetId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<CompatibilityRow>(`
      select * from application_execution_compatibility
       where tenant_id=$1 and application_asset_id=$2
       order by checked_at desc, source_type, source_id
    `, [tenantId, applicationAssetId])).rows;
    return rows.map(map);
  }

  async recheckApplication(tenantId: string, applicationAssetId: string): Promise<ApplicationExecutionCompatibility[]> {
    const asset = await new PgAssetsRepository(this.db).getServiceAsset(tenantId, applicationAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId });
    const strategy = asset.deploymentStrategy;
    const bindingId = strategy?.type === 'WORKFLOW'
      ? strategy.workflow?.workflowExecutionBindingId
      : strategy?.type === 'MANAGED_TARGET'
        ? strategy.managedTarget?.workflowExecutionBindingId
        : undefined;
    if (!bindingId) return [];
    return [await this.checkWorkflowBinding(tenantId, applicationAssetId, bindingId)];
  }

  async recheckPlugin(tenantId: string, pluginId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ application_asset_id: string; binding_id: string }>(`
      select asset.id as application_asset_id,
             coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                      asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId') as binding_id
        from pg_service_assets asset
        join workflow_execution_bindings binding
          on binding.tenant_id=asset.tenant_id
         and binding.id=coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                                 asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId')
       where asset.tenant_id=$1 and asset.deleted_at is null and binding.plugin_id=$2
    `, [tenantId, pluginId])).rows;
    return Promise.all(rows.map((row) => this.checkWorkflowBinding(tenantId, row.application_asset_id, row.binding_id)));
  }

  async recheckWorkflowTemplate(tenantId: string, workflowTemplateId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ application_asset_id: string; binding_id: string }>(`
      select asset.id as application_asset_id,
             coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                      asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId') as binding_id
        from pg_service_assets asset
        join workflow_execution_bindings binding
          on binding.tenant_id=asset.tenant_id
         and binding.id=coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                                 asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId')
       where asset.tenant_id=$1 and asset.deleted_at is null and binding.workflow_template_id=$2
    `, [tenantId, workflowTemplateId])).rows;
    return Promise.all(rows.map((row) => this.checkWorkflowBinding(tenantId, row.application_asset_id, row.binding_id)));
  }

  private async save(tenantId: string, value: ApplicationExecutionCompatibility): Promise<void> {
    await this.db.query(`
      insert into application_execution_compatibility
        (tenant_id,application_asset_id,source_type,source_id,status,issues,checked_plugin_version_id,checked_workflow_version_id,checked_at,version)
      values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz,1)
      on conflict (tenant_id,application_asset_id,source_type,source_id) do update set
        status=excluded.status,issues=excluded.issues,checked_plugin_version_id=excluded.checked_plugin_version_id,
        checked_workflow_version_id=excluded.checked_workflow_version_id,checked_at=excluded.checked_at,
        version=application_execution_compatibility.version+1
    `, [tenantId, value.applicationAssetId, value.sourceType, value.sourceId, value.status, JSON.stringify(value.issues), value.checkedPluginVersionId ?? null, value.checkedWorkflowVersionId ?? null, value.checkedAt]);
  }
}

interface CompatibilityRow extends Record<string, unknown> {
  application_asset_id: string;
  source_type: 'WORKFLOW_EXECUTION_BINDING';
  source_id: string;
  status: ApplicationExecutionCompatibilityStatus;
  issues: ApplicationExecutionCompatibility['issues'];
  checked_plugin_version_id: string | null;
  checked_workflow_version_id: string | null;
  checked_at: string | Date;
}

function map(row: CompatibilityRow): ApplicationExecutionCompatibility {
  return {
    applicationAssetId: row.application_asset_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: row.status,
    issues: Array.isArray(row.issues) ? row.issues : [],
    ...(row.checked_plugin_version_id ? { checkedPluginVersionId: row.checked_plugin_version_id } : {}),
    ...(row.checked_workflow_version_id ? { checkedWorkflowVersionId: row.checked_workflow_version_id } : {}),
    checkedAt: new Date(row.checked_at).toISOString(),
  };
}

function compatibilityErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'APPLICATION_EXECUTION_COMPATIBILITY_CHECK_FAILED';
  const details = error.details;
  if (details && typeof details === 'object' && 'code' in details && typeof details.code === 'string') return details.code;
  return error.errorCode;
}
