import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAssetsRepository } from '../repository/assets.repository.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';
import { PgUnifiedPluginsRepository } from '../../plugins/repository/unified-plugins.repository.js';
import { ManagedTargetContextResolver } from './managed-target-context.resolver.js';
import { PgAgentsRepository } from '../../agents/repository/agents.repository.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import { ManagedTargetPluginQueryService } from '../../plugins/application/managed-target-plugin-query.service.js';
import { currentApplicationExecutionResolver } from './current-application-execution-resolver.js';

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
      const managedTargetContext = await this.resolveManagedTargetContext(tenantId, asset);
      const validation = await new WorkflowDeploymentInputSaveService(this.db).validate({
        applicationAsset: asset,
        workflowExecution: identity.binding,
        currentBinding: identity.binding,
        managedTargetContext,
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
    const generation = await this.nextScanGeneration();
    const strategy = asset.deploymentStrategy;
    const bindingId = strategy?.type === 'WORKFLOW'
      ? strategy.workflow?.workflowExecutionBindingId
      : strategy?.type === 'MANAGED_TARGET'
        ? strategy.managedTarget?.workflowExecutionBindingId
        : undefined;
    if (bindingId) {
      const result = await this.checkWorkflowBinding(tenantId, applicationAssetId, bindingId, generation);
      await this.removeStaleSources(tenantId, applicationAssetId, generation, result.sourceType, result.sourceId);
      return [result];
    }
    if (strategy?.type === 'MANAGED_TARGET' && (strategy.managedTarget?.executionMode ?? 'PLUGIN') === 'PLUGIN') {
      const result = await this.checkPluginAssignment(tenantId, applicationAssetId, generation);
      await this.removeStaleSources(tenantId, applicationAssetId, generation, result.sourceType, result.sourceId);
      return [result];
    }
    // 没有任何当前执行来源时，旧的 READY 快照不能继续代表当前配置。
    await this.removeStaleSources(tenantId, applicationAssetId, generation);
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

  /** 受管目标的宿主事实变化时，只重检引用该 Host 的应用。 */
  async recheckHost(tenantId: string, hostId: string): Promise<ApplicationExecutionCompatibility[]> {
    return this.recheckManagedTargetsByRelation(tenantId, 'device_id', hostId);
  }

  /** FrameworkInstance 的版本、状态或发现事实变化时，只重检引用它的应用。 */
  async recheckFrameworkInstance(tenantId: string, frameworkInstanceId: string): Promise<ApplicationExecutionCompatibility[]> {
    return this.recheckManagedTargetsByRelation(tenantId, 'framework_instance_id', frameworkInstanceId);
  }

  /** Site 的绑定事实变化时，只重检引用它的应用。 */
  async recheckSiteAsset(tenantId: string, siteAssetId: string): Promise<ApplicationExecutionCompatibility[]> {
    return this.recheckManagedTargetsByRelation(tenantId, 'site_id', siteAssetId);
  }

  /** DeviceAsset 的连接能力变化时，只重检引用它的应用。 */
  async recheckDeviceAsset(tenantId: string, deviceAssetId: string): Promise<ApplicationExecutionCompatibility[]> {
    return this.recheckManagedTargetsByRelation(tenantId, 'device_asset_id', deviceAssetId);
  }

  /** 云账号资产的凭据、状态或作用域变化时，只重检引用它的应用。 */
  async recheckCloudAccountAsset(tenantId: string, cloudAccountAssetId: string): Promise<ApplicationExecutionCompatibility[]> {
    return this.recheckManagedTargetsByRelation(tenantId, 'asset_id', cloudAccountAssetId);
  }

  /** Agent 状态、版本或能力快照变化时，只重检其 Host 下的应用。 */
  async recheckAgent(tenantId: string, agentId: string): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ managed_target_id: string }>(`
      select distinct target.id as managed_target_id
        from pg_managed_targets target
        join pg_hosts host
          on host.tenant_id=target.tenant_id
         and host.id=target.device_id
       where target.tenant_id=$1
         and target.deleted_at is null
         and host.deleted_at is null
         and host.agent_id=$2
    `, [tenantId, agentId])).rows;
    const results: ApplicationExecutionCompatibility[] = [];
    for (const row of rows) results.push(...await this.recheckManagedTarget(tenantId, row.managed_target_id));
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
        left join pg_application_asset_targets app_target
          on app_target.tenant_id=asset.tenant_id
         and app_target.application_asset_id=asset.id
         and app_target.status <> 'DELETED'
        left join pg_managed_targets target
          on target.tenant_id=asset.tenant_id
         and target.id=coalesce(
           app_target.managed_target_id,
           asset.metadata->'deploymentStrategy'->'managedTarget'->>'managedTargetId'
         )
         and target.deleted_at is null
        left join plugin_capability_assignments assignment
          on assignment.tenant_id=asset.tenant_id
         and assignment.status='ACTIVE'
         and assignment.capability_key='certificate.deploy'
         and (
           (assignment.owner_type in ('APPLICATION_ASSET','SERVICE_ASSET') and assignment.owner_id=asset.id)
           or (assignment.owner_type='MANAGED_TARGET' and assignment.owner_id=target.id)
           or (assignment.owner_type='DEVICE' and assignment.owner_id=target.device_id)
           or (assignment.owner_type='CLOUD_ACCOUNT_ASSET' and assignment.owner_id=target.asset_id)
         )
        left join unified_plugin_bindings binding
          on binding.tenant_id=assignment.tenant_id and binding.id=assignment.plugin_binding_id and binding.status='ACTIVE'
       where asset.deleted_at is null
         and asset.metadata->'deploymentStrategy'->>'type' = 'MANAGED_TARGET'
         and coalesce(asset.metadata->'deploymentStrategy'->'managedTarget'->>'executionMode', 'PLUGIN') = 'PLUGIN'
         and (coalesce(assignment.plugin_id, binding.plugin_id)=$2 or exists (
           select 1 from workflow_execution_bindings inherited_binding
            where inherited_binding.tenant_id=asset.tenant_id
              and inherited_binding.plugin_id=$2
              and inherited_binding.id=coalesce(
                asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId',
                asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId'
              )
         ))
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
   * 关联来源只取应用实际可继承的 Assignment 和 WorkflowExecutionBinding，不扫描租户应用列表。
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
            union
            select assignment.tenant_id
              from plugin_capability_assignments assignment
              left join unified_plugin_bindings binding
                on binding.tenant_id=assignment.tenant_id and binding.id=assignment.plugin_binding_id
             where coalesce(assignment.plugin_id, binding.plugin_id)=$1
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
    const managedTargetId = asset.deploymentStrategy?.type === 'MANAGED_TARGET'
      ? asset.deploymentStrategy.managedTarget?.managedTargetId
      : undefined;
    const row = (await this.db.query<{
      assignment_id: string; binding_id: string; binding_version: number; plugin_id: string | null;
    }>(`
      select assignment.id as assignment_id, binding.id as binding_id, binding.version as binding_version,
             coalesce(assignment.plugin_id, binding.plugin_id) as plugin_id
        from plugin_capability_assignments assignment
        join unified_plugin_bindings binding
          on binding.tenant_id=assignment.tenant_id and binding.id=assignment.plugin_binding_id
       where assignment.tenant_id=$1 and assignment.status='ACTIVE' and binding.status='ACTIVE'
         and assignment.capability_key='certificate.deploy'
         and (
           (assignment.owner_type in ('APPLICATION_ASSET','SERVICE_ASSET') and assignment.owner_id=$2)
           or (assignment.owner_type='MANAGED_TARGET' and assignment.owner_id=$3)
           or (assignment.owner_type='DEVICE' and assignment.owner_id=(
             select device_id from pg_managed_targets where tenant_id=$1 and id=$3 and deleted_at is null
           ))
           or (assignment.owner_type='CLOUD_ACCOUNT_ASSET' and assignment.owner_id=(
             select asset_id from pg_managed_targets where tenant_id=$1 and id=$3 and deleted_at is null
           ))
         )
       order by case assignment.owner_type when 'APPLICATION_ASSET' then 0 when 'SERVICE_ASSET' then 0 when 'MANAGED_TARGET' then 1 else 2 end, assignment.updated_at desc
       limit 1
    `, [tenantId, applicationAssetId, managedTargetId ?? null])).rows[0];
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
      if (!managedTargetId) throw new AppError('APPLICATION_EXECUTION_REFERENCE_INVALID', '应用资产缺少 ManagedTarget', { applicationAssetId });
      const capabilityKey = 'certificate.deploy';
      // 兼容性扫描必须复用部署输入投影：它会解析当前有效能力、所有继承层和跨版本迁移，
      // 与创建部署计划的输入解析保持完全一致，避免卡片状态与实际预检分叉。
      const query = new ManagedTargetPluginQueryService(this.db);
      const effective = await query.getEffectiveCapability({ tenantId, managedTargetId, capabilityKey, applicationAssetId });
      if (effective.binding.pluginVersionId !== effective.plugin.pluginVersionId) {
        // 版本不匹配时，自动更新应用的插件绑定到最新版本，而不是阻止部署
        console.log(`[ApplicationExecutionCompatibility] 自动更新插件绑定版本: ${effective.binding.pluginVersionId} -> ${effective.plugin.pluginVersionId}`, {
          applicationAssetId,
          managedTargetId,
          bindingId: effective.binding.pluginBindingId,
        });
        // 更新 unified_plugin_bindings 表中的 plugin_version_id
        await this.db.query(`
          update unified_plugin_bindings
             set plugin_version_id=$1, updated_at=now()
           where tenant_id=$2 and id=$3
        `, [effective.plugin.pluginVersionId, tenantId, effective.binding.pluginBindingId]);
        // 更新 effective.binding 对象，使后续逻辑使用新版本
        effective.binding.pluginVersionId = effective.plugin.pluginVersionId;
      }
      const projection = await query.projectApplicationAssetPluginInputs({
        tenantId,
        managedTargetId,
        capabilityKey,
        pluginVersionId: effective.plugin.pluginVersionId,
        applicationAsset: {
          id: asset.id,
          address: asset.address,
          ...(asset.sniName ? { sniName: asset.sniName } : {}),
          ...(asset.verifyUrl ? { verifyUrl: asset.verifyUrl } : {}),
          port: asset.port,
          protocol: asset.protocol,
          ...(asset.displayName ? { displayName: asset.displayName } : {}),
        },
      });
      const status: ApplicationExecutionCompatibilityStatus = projection.saveable ? 'READY' : 'UPDATE_REQUIRED';
      const result = {
        ...base,
        sourceId: effective.source.assignmentId,
        referenceVersion: Math.max(asset.version, effective.binding.version),
        status,
        issues: projection.issues.map((issue) => ({ code: issue.code, path: issue.path, slot: issue.slot, category: issue.category })),
        checkedPluginVersionId: effective.plugin.pluginVersionId,
      };
      await this.save(tenantId, result);
      return result;
    } catch (error) {
      const result = { ...base, status: 'UNSUPPORTED' as const, issues: [{ code: compatibilityErrorCode(error) }] };
      await this.save(tenantId, result);
      return result;
    }
  }

  private async recheckManagedTargetsByRelation(
    tenantId: string,
    relation: 'device_id' | 'framework_instance_id' | 'site_id' | 'device_asset_id' | 'asset_id',
    relationId: string,
  ): Promise<ApplicationExecutionCompatibility[]> {
    const rows = (await this.db.query<{ managed_target_id: string }>(`
      select id as managed_target_id
        from pg_managed_targets
       where tenant_id=$1 and deleted_at is null and (
         ${relation}=$2
         ${relation === 'framework_instance_id' ? `or exists (
           select 1 from pg_site_assets site
            where site.tenant_id=pg_managed_targets.tenant_id
              and site.id=pg_managed_targets.site_id
              and site.framework_instance_id=$2
              and site.deleted_at is null
         )` : ''}
       )
    `, [tenantId, relationId])).rows;
    const results: ApplicationExecutionCompatibility[] = [];
    for (const row of rows) results.push(...await this.recheckManagedTarget(tenantId, row.managed_target_id));
    return results;
  }

  private async resolveManagedTargetContext(tenantId: string, asset: Awaited<ReturnType<PgAssetsRepository['getServiceAsset']>>) {
    if (!asset) return undefined;
    const strategy = asset.deploymentStrategy;
    const managedTargetId = strategy?.type === 'MANAGED_TARGET' ? strategy.managedTarget?.managedTargetId : undefined;
    if (!managedTargetId) return undefined;
    return new ManagedTargetContextResolver(
      new PgAssetsRepository(this.db),
      new PgAgentsRepository(this.db),
      new PgDeviceAssetsRepository(this.db),
    ).resolveTopology(tenantId, managedTargetId);
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

  private async removeStaleSources(
    tenantId: string,
    applicationAssetId: string,
    scanGeneration: number,
    sourceType?: ApplicationExecutionCompatibility['sourceType'],
    sourceId?: string,
  ): Promise<void> {
    const params: Array<string | number> = [tenantId, applicationAssetId, scanGeneration];
    const sourceClause = sourceType && sourceId
      ? 'and not (source_type=$4 and source_id=$5)'
      : '';
    if (sourceClause && sourceType && sourceId) params.push(sourceType, sourceId);
    await this.db.query(`
      delete from application_execution_compatibility
       where tenant_id=$1
         and application_asset_id=$2
         and scan_generation <= $3
         ${sourceClause}
    `, params);
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
