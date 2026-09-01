import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAssetsRepository } from '../repository/assets.repository.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { ProductionDeploymentInputResolverService } from '../../deployment-inputs/application/production-deployment-input-resolver.service.js';
import { deploymentAssetContextBuilder } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { PgUnifiedPluginsRepository } from '../../plugins/repository/unified-plugins.repository.js';
import { currentApplicationExecutionResolver } from './current-application-execution-resolver.js';
import { emptyInputBindingsV1, INPUT_BINDINGS_API_VERSION, type InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export type ApplicationExecutionCompatibilityStatus = 'READY' | 'UPDATE_REQUIRED' | 'UNSUPPORTED';

export interface ApplicationExecutionCompatibility {
  applicationAssetId: string;
  sourceType: 'WORKFLOW_EXECUTION_BINDING' | 'PLUGIN_CAPABILITY_ASSIGNMENT';
  sourceId: string;
  status: ApplicationExecutionCompatibilityStatus;
  issues: Array<{ code: string; path?: string; slot?: string; category?: string }>;
  checkedPluginVersionId?: string;
  checkedWorkflowVersionId?: string;
  referenceVersion: number;
  scanGeneration: number;
  checkedAt: string;
}

/**
 * 用与计划编译相同的当前链和输入合同复检资产。这里绝不保存 Secret 值，
 * 只保存可供界面定位的槽位、路径和错误码。
 */
export class ApplicationExecutionCompatibilityService {
  constructor(private readonly db: DatabasePort) {}

  async checkWorkflowBinding(tenantId: string, applicationAssetId: string, workflowExecutionBindingId: string, scanGeneration?: number): Promise<ApplicationExecutionCompatibility> {
    const assets = new PgAssetsRepository(this.db);
    const asset = await assets.getServiceAsset(tenantId, applicationAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId });
    const bindings = new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(this.db));
    const assetReferenceVersion = asset.version;
    const generation = scanGeneration ?? await this.nextScanGeneration();
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
        referenceVersion: Math.max(assetReferenceVersion, identity.binding.version),
        scanGeneration: generation,
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
        referenceVersion: assetReferenceVersion,
        scanGeneration: generation,
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

  async getForApplications(tenantId: string, applicationAssetIds: string[]): Promise<Map<string, ApplicationExecutionCompatibility[]>> {
    const ids = [...new Set(applicationAssetIds.filter(Boolean))];
    const result = new Map<string, ApplicationExecutionCompatibility[]>();
    if (ids.length === 0) return result;
    const rows = (await this.db.query<CompatibilityRow>(`
      select * from application_execution_compatibility
       where tenant_id=$1 and application_asset_id = any($2::text[])
       order by checked_at desc, source_type, source_id
    `, [tenantId, ids])).rows;
    for (const row of rows) {
      const current = result.get(row.application_asset_id) ?? [];
      current.push(map(row));
      result.set(row.application_asset_id, current);
    }
    return result;
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
    if (bindingId) return [await this.checkWorkflowBinding(tenantId, applicationAssetId, bindingId, await this.nextScanGeneration())];
    if (strategy?.type === 'MANAGED_TARGET' && (strategy.managedTarget?.executionMode ?? 'PLUGIN') === 'PLUGIN') {
      return [await this.checkPluginAssignment(tenantId, applicationAssetId, await this.nextScanGeneration())];
    }
    return [];
  }

  /** 重检引用某个 ManagedTarget 的应用，只按目标关联反查，不扫描租户全部应用。 */
  async recheckManagedTarget(tenantId: string, managedTargetId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ application_asset_id: string }>(`
      select distinct asset.id as application_asset_id
        from pg_service_assets asset
        left join pg_application_asset_targets target
          on target.tenant_id=asset.tenant_id
         and target.application_asset_id=asset.id
         and target.managed_target_id=$2
       where asset.tenant_id=$1
         and asset.deleted_at is null
         and (
           target.id is not null
           or asset.metadata->'deploymentStrategy'->'managedTarget'->>'managedTargetId'=$2
         )
    `, [tenantId, managedTargetId])).rows;
    const results: ApplicationExecutionCompatibility[] = [];
    for (const row of rows) results.push(...await this.recheckApplication(tenantId, row.application_asset_id));
    return results;
  }

  async recheckPlugin(tenantId: string, pluginId: string): Promise<ApplicationExecutionCompatibility[]> {
    // 来源判定必须复用当前解析规则；租户自有版本覆盖同 ID 的 BUILTIN 版本时，
    // 只能重检当前租户，不能误把用户插件当成全局内置插件。
    const versions = await new PgUnifiedPluginsRepository(this.db).listAccessibleVersions(tenantId);
    const source = currentApplicationExecutionResolver.resolvePluginVersion(tenantId, pluginId, versions)?.source ?? 'USER';
    const rows = (await this.db.query<{ application_asset_id: string; binding_id: string; tenant_id: string }>(`
      select asset.id as application_asset_id, asset.tenant_id,
             coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                      asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId') as binding_id
        from pg_service_assets asset
        join workflow_execution_bindings binding
          on binding.tenant_id=asset.tenant_id
         and binding.id=coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                                 asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId')
       where asset.deleted_at is null
         and binding.plugin_id=$2
         and ($3::text = 'BUILTIN' or asset.tenant_id=$1)
    `, [tenantId, pluginId, source ?? 'USER'])).rows;
    const workflowResults = await this.checkInBatches(rows, 100, await this.nextScanGeneration());
    const pluginRows = (await this.db.query<{ application_asset_id: string; tenant_id: string }>(`
      select distinct asset.id as application_asset_id, asset.tenant_id
        from pg_service_assets asset
        join plugin_capability_assignments assignment
          on assignment.tenant_id=asset.tenant_id
         and assignment.owner_type in ('APPLICATION_ASSET','SERVICE_ASSET')
         and assignment.owner_id=asset.id
         and assignment.status='ACTIVE'
        join unified_plugin_bindings binding
          on binding.tenant_id=assignment.tenant_id and binding.id=assignment.plugin_binding_id and binding.status='ACTIVE'
       where asset.deleted_at is null and assignment.plugin_id=$2
         and ($3::text = 'BUILTIN' or asset.tenant_id=$1)
    `, [tenantId, pluginId, source ?? 'USER'])).rows;
    const generation = await this.nextScanGeneration();
    const pluginResults: ApplicationExecutionCompatibility[] = [];
    for (let offset = 0; offset < pluginRows.length; offset += 100) {
      const batch = pluginRows.slice(offset, offset + 100);
      const checked = await Promise.all(batch.map((row) => this.checkPluginAssignment(row.tenant_id, row.application_asset_id, generation)));
      pluginResults.push(...checked);
    }
    return [...workflowResults, ...pluginResults];
  }

  /**
   * 按插件关联反查租户后再重检，禁止为了一个插件扫描租户内全部应用。
   * 关联来源只取应用/服务资产的直接 Assignment 和 WorkflowExecutionBinding。
   */
  async recheckPluginForAssociatedTenants(pluginId: string, tenantId?: string): Promise<ApplicationExecutionCompatibility[]> {
    const tenantIds = tenantId
      ? [tenantId]
      : (await this.db.query<{ tenant_id: string }>(`
          select distinct tenant_id from (
            select tenant_id
              from plugin_capability_assignments
             where plugin_id=$1
               and owner_type in ('APPLICATION_ASSET','SERVICE_ASSET')
            union
            select tenant_id
              from workflow_execution_bindings
             where plugin_id=$1
          ) associated
          order by tenant_id
        `, [pluginId])).rows.map((row) => row.tenant_id);
    const results: ApplicationExecutionCompatibility[] = [];
    for (const currentTenantId of tenantIds) {
      results.push(...await this.recheckPlugin(currentTenantId, pluginId));
    }
    return results;
  }

  async recheckWorkflowTemplate(tenantId: string, workflowTemplateId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ application_asset_id: string; binding_id: string; tenant_id: string }>(`
      select asset.id as application_asset_id, asset.tenant_id,
             coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                      asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId') as binding_id
        from pg_service_assets asset
        join workflow_execution_bindings binding
          on binding.tenant_id=asset.tenant_id
         and binding.id=coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                                 asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId')
       where asset.tenant_id=$1 and asset.deleted_at is null and binding.workflow_template_id=$2
    `, [tenantId, workflowTemplateId])).rows;
    return this.checkInBatches(rows, 100, await this.nextScanGeneration());
  }

  private async checkInBatches(rows: Array<{ application_asset_id: string; binding_id: string; tenant_id: string }>, batchSize: number, scanGeneration: number): Promise<ApplicationExecutionCompatibility[]> {
    const results: ApplicationExecutionCompatibility[] = [];
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const checked = await Promise.all(batch.map(async (row) => {
        return this.checkWorkflowBinding(row.tenant_id, row.application_asset_id, row.binding_id, scanGeneration);
      }));
      results.push(...checked.filter((item): item is ApplicationExecutionCompatibility => Boolean(item)));
    }
    return results;
  }

  private async nextScanGeneration(): Promise<number> {
    const row = (await this.db.query<{ generation: string | number }>(
      `select nextval('application_execution_compatibility_scan_generation_seq') as generation`,
    )).rows[0];
    return Number(row?.generation ?? Date.now());
  }

  private async checkPluginAssignment(tenantId: string, applicationAssetId: string, scanGeneration: number): Promise<ApplicationExecutionCompatibility> {
    const asset = await new PgAssetsRepository(this.db).getServiceAsset(tenantId, applicationAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId });
    const row = (await this.db.query<{
      assignment_id: string; binding_id: string; binding_version: number; plugin_id: string | null;
    }>(`
      select assignment.id as assignment_id, binding.id as binding_id, binding.version as binding_version,
             coalesce(assignment.plugin_id, binding.plugin_id) as plugin_id
        from plugin_capability_assignments assignment
        join unified_plugin_bindings binding
          on binding.tenant_id=assignment.tenant_id and binding.id=assignment.plugin_binding_id
       where assignment.tenant_id=$1 and assignment.owner_type in ('APPLICATION_ASSET','SERVICE_ASSET')
         and assignment.owner_id=$2 and assignment.status='ACTIVE' and binding.status='ACTIVE'
       order by case when assignment.owner_type='APPLICATION_ASSET' then 0 else 1 end, assignment.updated_at desc
       limit 1
    `, [tenantId, applicationAssetId])).rows[0];
    const sourceId = row?.assignment_id ?? applicationAssetId;
    const base = {
      applicationAssetId,
      sourceType: 'PLUGIN_CAPABILITY_ASSIGNMENT' as const,
      sourceId,
      referenceVersion: Math.max(asset.version, Number(row?.binding_version ?? 0)),
      scanGeneration,
      checkedAt: new Date().toISOString(),
    };
    try {
      if (!row?.plugin_id) throw new AppError('APPLICATION_EXECUTION_REFERENCE_INVALID', '插件稳定身份缺失', { applicationAssetId });
      const versions = await new PgUnifiedPluginsRepository(this.db).listAccessibleVersions(tenantId);
      const plugin = currentApplicationExecutionResolver.resolvePluginVersion(tenantId, row.plugin_id, versions);
      if (!plugin) throw new AppError('APPLICATION_CURRENT_PLUGIN_UNAVAILABLE', '当前插件不可用', { pluginId: row.plugin_id });
      const capabilityKey = (await this.db.query<{ capability_key: string }>(
        `select capability_key from plugin_capability_assignments where id=$1`, [row.assignment_id],
      )).rows[0]?.capability_key;
      if (!capabilityKey) throw new AppError('APPLICATION_EXECUTION_REFERENCE_INVALID', '插件能力身份缺失', { assignmentId: row.assignment_id });
      const contract = new DeploymentInputContractLoader().fromPlugin(plugin, capabilityKey);
      const binding = await this.db.query<{ input_bindings: unknown }>(
        `select input_bindings from unified_plugin_bindings where id=$1 and tenant_id=$2`, [row.binding_id, tenantId],
      );
      const projection = new ProductionDeploymentInputResolverService().resolveProjectionResult({
        phase: 'configure',
        contract,
        assetContext: deploymentAssetContextBuilder.build({ applicationAsset: asset }),
        bindingLayers: { assetOverride: { pluginVersionId: plugin.id, inputBindings: normalizeInputBindings(binding.rows[0]?.input_bindings) } },
      });
      const status: ApplicationExecutionCompatibilityStatus = projection.resolvedInput.executable ? 'READY' : 'UPDATE_REQUIRED';
      const result = { ...base, status, issues: projection.resolvedInput.issues.map((issue) => ({ code: issue.code, path: issue.path, slot: issue.slot, category: issue.category })), checkedPluginVersionId: plugin.id };
      await this.save(tenantId, result);
      return result;
    } catch (error) {
      const result = { ...base, status: 'UNSUPPORTED' as const, issues: [{ code: compatibilityErrorCode(error) }] };
      await this.save(tenantId, result);
      return result;
    }
  }

  private async save(tenantId: string, value: ApplicationExecutionCompatibility): Promise<void> {
    await this.db.query(`
      insert into application_execution_compatibility
        (tenant_id,application_asset_id,source_type,source_id,status,issues,checked_plugin_version_id,checked_workflow_version_id,checked_at,reference_version,scan_generation,version)
      values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz,$10,$11,1)
      on conflict (tenant_id,application_asset_id,source_type,source_id) do update set
        status=excluded.status,issues=excluded.issues,checked_plugin_version_id=excluded.checked_plugin_version_id,
        checked_workflow_version_id=excluded.checked_workflow_version_id,checked_at=excluded.checked_at,
        reference_version=excluded.reference_version,scan_generation=excluded.scan_generation,
        version=application_execution_compatibility.version+1
      where application_execution_compatibility.scan_generation < excluded.scan_generation
         or (application_execution_compatibility.scan_generation = excluded.scan_generation
             and application_execution_compatibility.reference_version <= excluded.reference_version)
    `, [tenantId, value.applicationAssetId, value.sourceType, value.sourceId, value.status, JSON.stringify(value.issues), value.checkedPluginVersionId ?? null, value.checkedWorkflowVersionId ?? null, value.checkedAt, value.referenceVersion, value.scanGeneration]);
  }
}

interface CompatibilityRow extends Record<string, unknown> {
  application_asset_id: string;
  source_type: 'WORKFLOW_EXECUTION_BINDING' | 'PLUGIN_CAPABILITY_ASSIGNMENT';
  source_id: string;
  status: ApplicationExecutionCompatibilityStatus;
  issues: ApplicationExecutionCompatibility['issues'];
  checked_plugin_version_id: string | null;
  checked_workflow_version_id: string | null;
  checked_at: string | Date;
  reference_version: number;
  scan_generation: number;
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
    referenceVersion: Number(row.reference_version ?? 0),
    scanGeneration: Number(row.scan_generation ?? 0),
    checkedAt: new Date(row.checked_at).toISOString(),
  };
}

function compatibilityErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'APPLICATION_EXECUTION_COMPATIBILITY_CHECK_FAILED';
  const details = error.details;
  if (details && typeof details === 'object' && 'code' in details && typeof details.code === 'string') return details.code;
  return error.errorCode;
}

function normalizeInputBindings(value: unknown): InputBindingsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyInputBindingsV1();
  const record = value as Record<string, unknown>;
  return {
    apiVersion: INPUT_BINDINGS_API_VERSION,
    variables: isRecord(record.variables) ? record.variables : {},
    connections: isRecord(record.connections) ? record.connections as InputBindingsV1['connections'] : {},
    credentials: isRecord(record.credentials) ? record.credentials as InputBindingsV1['credentials'] : {},
    artifacts: isRecord(record.artifacts) ? record.artifacts as InputBindingsV1['artifacts'] : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
