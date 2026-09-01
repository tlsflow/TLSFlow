import { AppError } from '../../../common/errors/app-error.js';
import type { ManagedDeviceDetailDto, ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';
import { DevicePlatformRegistry } from '../domain/device-platform.registry.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import { DeviceAssetsDomainService } from '../../device-assets/domain/device-assets.domain-service.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { PluginPackageResourcesService } from '../../plugins/application/plugin-package-resources.service.js';
import { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from '../../plugins/repository/plugin-bindings.repository.js';
import type { PluginFormSchemaV1 } from '../../plugins/forms/plugin-form.dto.js';
import type { DevicePresentationSchemaV1 } from '../../plugins/presentations/plugin-presentation.dto.js';
import type { PluginPackageFormResource, PluginPackagePresentationResource } from '../../plugins/application/plugin-package-resource-schema.service.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowExecutionAuthorization } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { CreateManagedDeviceOnboardingDto } from '../dto/devices.dto.js';
import { compareSemanticVersions } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { PgDevicesRepository, type DeviceDetailInclude, type DevicesRepository } from '../repository/devices.repository.js';
import { pluginRuntimeGuard, type PluginRuntimeGuardService } from '../../plugins/runtime/plugin-runtime-guard.service.js';
import { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import { RuntimeCredentialResolver } from '../../credentials/application/runtime-credential-resolver.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { DeploymentAssetContextBuilder } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { ProductionDeploymentInputResolverService } from '../../deployment-inputs/application/production-deployment-input-resolver.service.js';
import { migrateInputBindingsToContract } from '../../deployment-inputs/application/input-binding-contract-migrator.js';
import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import type { CapabilityAssignmentV1 } from '../../plugins/dto/plugin-bindings.dto.js';

/** 中文说明：所有非设备插件资源通过此端口接入，宿主不按厂商写分支。 */
export interface PluginResourceOnboardingPort {
  supports: (plugin: UnifiedPluginVersionRecord) => boolean;
  onboard: (tenantId: string, plugin: UnifiedPluginVersionRecord, values: Record<string, unknown>, actorId: string) => Promise<Record<string, unknown>>;
}

export class DevicesApplicationService {
  constructor(
    private readonly repository: DevicesRepository = new PgDevicesRepository(),
    private readonly platformRegistry = new DevicePlatformRegistry(),
    private readonly agents?: AgentsApplicationService,
    private readonly db: DatabasePort = new PgliteDatabase(),
    private readonly unifiedPlugins?: UnifiedPluginsApplicationService,
    private readonly packageResources = new PluginPackageResourcesService(),
    private readonly pluginBindings?: PluginBindingsApplicationService,
    private readonly pluginWorkflows?: PluginWorkflowPublisherService,
    private readonly workflows?: WorkflowTemplatesApplicationService,
    private readonly runtimeGuard: PluginRuntimeGuardService = pluginRuntimeGuard,
    private readonly discoveryProjector?: StandardDeviceDiscoveryProjector,
    private readonly deploymentInputResolver = new ProductionDeploymentInputResolverService(),
    private readonly pluginResourceOnboarding?: PluginResourceOnboardingPort,
  ) {}

  async list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    // 列表升级摘要来自数据库；只同步一次本地制品 Release，不再逐条读取 Agent 详情。
    try {
      await this.agents?.prepareUpgradeSummary?.(tenantId);
    } catch (error) {
      // 本地制品同步失败不应阻断设备列表；没有摘要时前端只隐藏升级入口。
      structuredLogger.warn('设备列表 Agent 升级摘要同步失败', {
        errorMessage: error instanceof Error ? error.message : String(error),
      }, { module: 'devices', tenantId });
    }
    return this.repository.list(tenantId, query);
  }

  async get(tenantId: string, deviceId: string, locale = 'zh-CN', includes?: ReadonlySet<DeviceDetailInclude>, siteFrameworkId?: string): Promise<ManagedDeviceDetailDto> {
    const device = await this.repository.get(tenantId, deviceId, { includes, siteFrameworkId });
    if (!device) throw new AppError('RESOURCE_NOT_FOUND', '设备不存在', { deviceId });
    if (device.extension.type === 'AGENT' && device.extension.agentId && this.agents) {
      return enrichAgentDetail(device, await this.agents.getAgentDetail(tenantId, device.extension.agentId, {
        includeLogs: includes === undefined || includes.has('logs'),
      }));
    }
    if (device.extension.type !== 'PLUGIN' || !device.extension.pluginVersionId || !device.extension.pluginBindingId || !this.unifiedPlugins) return device;
    const { currentPlugin } = await this.resolveEffectivePluginVersion(tenantId, device.extension.pluginVersionId);
    const [pluginResources, assignmentRows] = await Promise.all([
      this.unifiedPlugins.getVersionWithUiResourcesForTenant(tenantId, currentPlugin.id, locale),
      this.db.query<{ capability_key: string }>(
        `select capability_key from plugin_capability_assignments
         where tenant_id=$1 and owner_type='DEVICE' and owner_id=$2 and plugin_binding_id=$3 and status='ACTIVE'
         order by capability_key`,
        [tenantId, device.id, device.extension.pluginBindingId],
      ),
    ]);
    const { version: plugin, ui } = pluginResources;
    const declaredCapabilities = new Set(plugin.manifest.capabilities.map((capability) => capability.key));
    const capabilities = [...new Set(assignmentRows.rows.map((row) => row.capability_key))]
      .filter((capabilityKey) => declaredCapabilities.has(capabilityKey));
    const presentation = asDevicePresentation(ui.presentations.device);
    const effectiveDevice = applyEffectivePluginVersion(device, plugin.version);
    const localizedResources = applyResourceLabels(effectiveDevice, presentation, ui.locale?.messages ?? {});
    return {
      ...effectiveDevice,
      ...localizedResources,
      allowedActions: [...new Set([...effectiveDevice.allowedActions, ...capabilities])],
      capabilities,
      pluginUi: {
        pluginVersionId: plugin.id,
        pluginBindingId: device.extension.pluginBindingId,
        pluginId: plugin.pluginId,
        version: plugin.version,
        source: plugin.source,
        capabilities,
        presentation: presentation ? {
          ...presentation,
          actions: presentation.actions.filter((action) => capabilities.includes(action.capabilityKey)),
        } as unknown as Record<string, unknown> : undefined,
        messages: ui.locale?.messages ?? {},
      },
    };
  }

  /**
   * 设备只保存接入时的 Binding；运行期按稳定 pluginId 解析当前已启用版本。
   * 设备的历史来源只用于读取旧 Binding，不能阻止内置当前版本替换用户旧版本。
   * 没有可用新版本时回退到历史版本，保证旧设备仍能查看和执行已有能力。
   */
  private async resolveEffectivePluginVersion(tenantId: string, assignedPluginVersionId: string): Promise<{
    assignedPlugin: UnifiedPluginVersionRecord;
    currentPlugin: UnifiedPluginVersionRecord;
  }> {
    if (!this.unifiedPlugins) throw new AppError('CAPABILITY_MISSING', '统一插件服务未注册');
    const assignedPlugin = await this.unifiedPlugins.getVersionForTenant(tenantId, assignedPluginVersionId);
    let candidates = (await this.unifiedPlugins.listAccessibleVersions(tenantId))
      .filter((version) => version.pluginId === assignedPlugin.pluginId
        && version.status === 'ENABLED')
      .sort((left, right) => Number(right.source === 'BUILTIN') - Number(left.source === 'BUILTIN')
        || compareSemanticVersions(right.version, left.version)
        || right.updatedAt.localeCompare(left.updatedAt)
        || right.id.localeCompare(left.id));
    // listAccessibleVersions 为目录展示按 pluginId 去重；若目录实现暂未返回当前项，
    // 回查租户可见的内置和用户版本集合，仍按同一规则解析。
    if (candidates.length === 0) {
      const [builtinVersions, tenantVersions] = await Promise.all([
        this.unifiedPlugins.listBuiltinVersions(),
        this.unifiedPlugins.listVersions(tenantId),
      ]);
      candidates = [...builtinVersions, ...tenantVersions]
        .filter((version) => version.pluginId === assignedPlugin.pluginId
          && version.status === 'ENABLED')
        .sort((left, right) => Number(right.source === 'BUILTIN') - Number(left.source === 'BUILTIN')
          || compareSemanticVersions(right.version, left.version)
          || right.updatedAt.localeCompare(left.updatedAt)
          || right.id.localeCompare(left.id));
    }
    return { assignedPlugin, currentPlugin: candidates[0] ?? assignedPlugin };
  }

  listOnboardingPlatforms(): DeviceOnboardingPlatformDescriptor[] {
    return this.platformRegistry.list();
  }

  async onboard(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string, requestId: string, installBaseUrl?: string) {
    if (input.platformKey !== 'plugin') {
      const platform = this.platformRegistry.requireSupported(input.platformKey);
      if (!this.agents) throw new AppError('CAPABILITY_MISSING', 'Agent 安装服务未注册');
      const installPlatform = resolveAgentInstallPlatform(platform.handlerKey);
      const installSession = await this.agents.createAgentInstallSession(tenantId, {
        platform: installPlatform,
        ...(platform.platformFamily ? { platformFamily: platform.platformFamily } : {}),
        role: 'full_agent',
      }, requestId, installBaseUrl ?? 'http://localhost');
      return {
        onboardingKind: 'AGENT_INSTALL' as const,
        installSession: {
          ...installSession,
          installCommand: resolveDeviceInstallCommand(platform.installCommandProfile, installSession.bootstrapUrl, installSession.installCommand),
        },
      };
    }
    return this.onboardPluginDevice(tenantId, input, actorId);
  }

  async executeCapability(
    tenantId: string,
    deviceId: string,
    capabilityKey: string,
    actorId = 'system_devices',
    requestId = 'device-action',
    authorization?: WorkflowExecutionAuthorization,
  ) {
    if (!['device.connection.test', 'device.identity.detect', 'device.discover', 'certificate.discover', 'credential.health-check'].includes(capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '该设备动作必须通过部署计划执行', { capabilityKey });
    }
    const device = await this.get(tenantId, deviceId);
    if (device.extension.type === 'AGENT') {
      if (capabilityKey !== 'device.discover') {
        throw new AppError('CAPABILITY_MISSING', 'Agent 设备不支持该设备动作', { deviceId, capabilityKey });
      }
      if (!this.agents) throw new AppError('CAPABILITY_MISSING', 'Agent 服务未注册');
      return this.agents.refreshStandardDiscovery(tenantId, device.extension.agentId, actorId, requestId);
    }
    if (!this.pluginBindings || !this.pluginWorkflows || !this.workflows) throw new AppError('CAPABILITY_MISSING', '插件工作流执行服务未注册');
    if (capabilityKey !== 'device.connection.test'
      && (device.livenessSignals?.length ?? 0) > 0
      && device.livenessStatus !== 'ONLINE') {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', device.livenessStatus === 'OFFLINE' ? '设备已离线，不能执行该操作' : '设备存活状态尚未确认，不能执行该操作', {
        deviceId,
        capabilityKey,
        livenessStatus: device.livenessStatus,
        reasonCode: device.livenessReasonCode,
      });
    }
    if (device.extension.type !== 'PLUGIN' || !device.extension.pluginBindingId) throw new AppError('CAPABILITY_MISSING', '设备未绑定统一插件');
    let assignment = await this.pluginBindings.resolveAssignment(tenantId, capabilityKey, { deviceId: device.id });
    // 健康检测是在已有设备上新增的只读能力。历史设备不会自动拥有新指派，
    // 但只要当前绑定的插件已经声明该能力，就在首次检测时补齐指派。
    if (!assignment && capabilityKey === 'credential.health-check') {
      assignment = await this.provisionHistoricalHealthAssignment(tenantId, device);
    }
    if (!assignment || assignment.pluginBindingId !== device.extension.pluginBindingId) {
      throw new AppError('CAPABILITY_MISSING', '设备未分配该插件能力', { capabilityKey });
    }
    const { currentPlugin } = this.unifiedPlugins
      ? await this.resolveEffectivePluginVersion(tenantId, assignment.pluginVersionId)
      : { currentPlugin: undefined };
    if (currentPlugin && !currentPlugin.manifest.capabilities.some((capability) => capability.key === capabilityKey)) {
      throw new AppError('CAPABILITY_MISSING', '当前插件版本未声明该设备能力', {
        capabilityKey,
        pluginVersionId: currentPlugin.id,
      });
    }
    const effectivePluginVersionId = currentPlugin?.id ?? assignment.pluginVersionId;
    const [binding, workflow] = await Promise.all([
      this.pluginBindings.getTenantBinding(tenantId, assignment.pluginBindingId),
      this.pluginWorkflows.require(effectivePluginVersionId, capabilityKey),
    ]);
    const [deviceAsset, workflowVersion] = await Promise.all([
      new PgDeviceAssetsRepository(this.db).get(tenantId, device.extension.deviceAssetId),
      this.workflows.getVersion(workflow.workflowVersionId),
    ]);
    if (!deviceAsset) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在', { deviceAssetId: device.extension.deviceAssetId });
    assertNormalDslWorkflowVersion(workflowVersion);
    const contract = new DeploymentInputContractLoader().fromWorkflowVersion(workflowVersion);
    // 先按当前插件契约过滤历史 Binding，再解析凭据，避免已删除的旧凭据槽位阻塞新版本。
    const effectiveInputBindings = currentPlugin
      ? migrateInputBindingsToContract(contract, binding.inputBindings)
      : binding.inputBindings;
    const credentials = await new RuntimeCredentialResolver(new CredentialsRepository(this.db)).resolveBindings(
      tenantId,
      effectiveInputBindings.credentials,
    );
    const bindingLayers = {
      // 设备 Binding 属于历史插件版本；只把仍由当前契约声明的输入继承到新版本，避免旧字段阻塞执行。
      deviceDefault: {
        pluginVersionId: effectivePluginVersionId,
        inputBindings: effectiveInputBindings,
      },
    };
    const resolvedInput = this.deploymentInputResolver.resolve({
      phase: 'execute',
      contract,
      assetContext: new DeploymentAssetContextBuilder().buildForDevice(deviceAsset),
      bindingLayers,
      credentialSnapshots: credentials,
      artifactSnapshots: {},
    });
    if (!resolvedInput.executable) throw new AppError('VALIDATION_FAILED', '设备插件能力输入未通过统一校验', { issues: resolvedInput.issues });
    const result = await this.runtimeGuard.execute({
      tenantId, pluginVersionId: effectivePluginVersionId, capabilityKey,
      gatewayId: undefined,
    }, async () => this.workflows!.execute({
      templateVersionId: workflow.workflowVersionId,
      mode: 'real_test',
      resolvedInput,
      tenantId,
      ...(authorization ? { authorization } : {}),
    }));
    if (result.status !== 'success') {
      const failedStep = findFailedWorkflowStep(result.stepResults);
      // 凭据健康检测属于高频监控；结果进入脱敏检测记录，不能污染普通设备执行日志。
      if (capabilityKey !== 'credential.health-check') {
        structuredLogger.error('设备插件能力执行失败', {
          deviceId: device.id,
          deviceAssetId: device.extension.deviceAssetId,
          pluginVersionId: effectivePluginVersionId,
          pluginBindingId: assignment.pluginBindingId,
          capabilityKey,
          workflowRunId: result.id,
          workflowStatus: result.status,
          failedStepName: failedStep?.name,
          failedStepType: failedStep?.type,
          failedStepStage: failedStep?.stage,
          errorCode: failedStep?.errorCode,
          errorMessage: failedStep?.errorMessage,
        }, {
          tenantId,
          module: 'devices',
          resourceType: 'managedDevice',
          resourceId: device.id,
        });
      }
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '设备插件能力执行失败', {
        capabilityKey,
        workflowRunId: result.id,
        status: result.status,
        failedStepName: failedStep?.name,
        errorCode: failedStep?.errorCode,
        errorMessage: failedStep?.errorMessage,
      });
    }
    if (!['device.discover', 'certificate.discover'].includes(capabilityKey)) return result;
    if (!this.discoveryProjector) throw new AppError('CAPABILITY_MISSING', '标准设备发现投影器未注册');
    try {
      const discovery = findWorkflowExtractedValue(result.stepResults, 'discovery');
      if (!discovery) {
        throw new AppError('PLUGIN_DISCOVERY_SCHEMA_INVALID', '设备发现工作流未输出标准 discovery 结果', {
          capabilityKey,
          workflowRunId: result.id,
        });
      }
      const projection = await this.discoveryProjector.project({
        tenantId,
        deviceAssetId: device.extension.deviceAssetId,
        hostId: device.id,
        pluginVersionId: effectivePluginVersionId,
        pluginBindingId: assignment.pluginBindingId,
      }, discovery);
      return { ...result, projection };
    } catch (error) {
      const errorDetails = error instanceof AppError ? {
        errorCode: error.errorCode,
        errorMessage: error.message,
        errorDetails: error.details,
      } : {
        errorType: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : '未知错误',
      };
      structuredLogger.error('设备发现结果投影失败', {
        ...errorDetails,
        deviceId: device.id,
        deviceAssetId: device.extension.deviceAssetId,
        pluginVersionId: assignment.pluginVersionId,
        pluginBindingId: assignment.pluginBindingId,
        capabilityKey,
        workflowRunId: result.id,
      }, {
        tenantId,
        module: 'devices',
        resourceType: 'managedDevice',
        resourceId: device.id,
      });
      throw error;
    }
  }

  private async provisionHistoricalHealthAssignment(
    tenantId: string,
    device: ManagedDeviceDetailDto,
  ): Promise<CapabilityAssignmentV1 | undefined> {
    if (device.extension.type !== 'PLUGIN'
      || !device.extension.pluginVersionId
      || !device.extension.pluginBindingId
      || !this.unifiedPlugins
      || !this.pluginBindings) return undefined;
    const { assignedPlugin, currentPlugin } = await this.resolveEffectivePluginVersion(tenantId, device.extension.pluginVersionId);
    if (!currentPlugin.manifest.capabilities.some((capability) => capability.key === 'credential.health-check')) return undefined;
    const binding = await this.pluginBindings.getTenantBinding(tenantId, device.extension.pluginBindingId);
    // 重新发现可能已把设备资产推进到当前版本，而 Binding 仍保留历史版本；此时只要稳定
    // pluginId 一致即可补齐当前能力指派，不能用历史版本 ID 阻断健康检测。
    if (binding.pluginVersionId !== assignedPlugin.id) {
      const bindingPlugin = await this.unifiedPlugins.getVersionForTenant(tenantId, binding.pluginVersionId);
      if (bindingPlugin.pluginId !== assignedPlugin.pluginId) return undefined;
    }
    return this.pluginBindings.assignCapability(tenantId, {
      ownerType: 'DEVICE',
      ownerId: device.id,
      capabilityKey: 'credential.health-check',
      // Assignment 必须和 Binding 使用同一个版本 ID。运行时随后会按稳定
      // pluginId 解析当前启用版本，因此历史 Binding 不需要被强行改写。
      pluginVersionId: binding.pluginVersionId,
      pluginBindingId: binding.id,
      precedence: 'DEVICE_DEFAULT',
    });
  }

  private async onboardPluginDevice(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string) {
    if (!this.unifiedPlugins) throw new AppError('CAPABILITY_MISSING', '统一插件服务未注册');
    const pluginVersionId = required(input.pluginVersionId, 'pluginVersionId');
    const plugin = await this.unifiedPlugins.getVersion(pluginVersionId);
    if ((plugin.source !== 'BUILTIN' && plugin.tenantId !== tenantId) || plugin.status !== 'ENABLED') {
      throw new AppError('RESOURCE_NOT_FOUND', '可用插件版本不存在', { pluginVersionId });
    }
    if (plugin.runtime !== 'WORKFLOW_DSL' || !['MANAGED', 'BOTH'].includes(plugin.scope)) {
      throw new AppError('VALIDATION_FAILED', '插件不支持受控设备模式', { pluginVersionId, runtime: plugin.runtime, scope: plugin.scope });
    }
    const capabilityKeys = plugin.manifest.capabilities.map((item) => item.key);
    if (this.pluginResourceOnboarding?.supports(plugin)) {
      const resources = this.packageResources.validate(plugin.manifest, plugin.resources);
      const form = asPluginForm(resources.forms.cloud ?? resources.forms.device);
      if (!form || !['MANAGED', 'BOTH'].includes(form.mode)) {
        throw new AppError('VALIDATION_FAILED', '插件缺少 Managed 资源表单', { pluginVersionId });
      }
      validatePluginResourceForm(form, input.formValues ?? {});
      // 资源插件返回值由调用方按 onboardingKind 解释；这里保持既有设备接入方法的公开推断类型兼容。
      return await this.pluginResourceOnboarding.onboard(tenantId, plugin, input.formValues ?? {}, actorId) as never;
    }
    if (!capabilityKeys.includes('device.connection.test') || !capabilityKeys.includes('device.discover')) {
      throw new AppError('CAPABILITY_MISSING', '设备插件必须声明连接测试和发现能力', { pluginVersionId });
    }
    const form = asPluginForm(this.packageResources.validate(plugin.manifest, plugin.resources).forms.device);
    if (!form || !['MANAGED', 'BOTH'].includes(form.mode)) {
      throw new AppError('VALIDATION_FAILED', '设备插件缺少 Managed 设备表单', { pluginVersionId });
    }
    const deviceFamily = resolvePluginDeviceFamily(plugin);
    const onboardingContract = new DeploymentInputContractLoader().fromPlugin(plugin, 'device.connection.test');
    const mapped = mapPluginDeviceForm(form, input.formValues ?? {}, onboardingContract);
    const domain = new DeviceAssetsDomainService();
    const onboarding = await this.db.transaction(async (tx) => {
      const deviceRepository = new PgDeviceAssetsRepository(tx);
      const bindingService = new PluginBindingsApplicationService(new PluginBindingsRepository(tx));
      const device = await deviceRepository.createInTransaction(tx, tenantId, domain.normalizeCreate({
        displayName: mapped.displayName,
        managementAddress: mapped.address,
        managementPort: mapped.port,
        deviceFamily,
        authMode: mapped.authMode,
        tlsVerify: mapped.tlsVerify,
        caSecretId: mapped.caSecretRef,
        gatewayId: mapped.gatewayId,
      }));
      const binding = await bindingService.createBinding(tenantId, {
        pluginVersionId,
        mode: 'MANAGED',
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          variables: mapped.variables,
          credentials: mapped.credentials,
          artifacts: {},
          connections: mapped.connections as never,
        },
        managedContext: { hostId: device.hostId },
      });
      await tx.query(
        `update pg_device_assets set plugin_version_id=$1, plugin_binding_id=$2, product_family=$3, metadata=$4::jsonb, updated_at=$5
         where tenant_id=$6 and service_asset_id=$7`,
        [pluginVersionId, binding.id, deviceFamily, JSON.stringify({ onboardedBy: actorId }), new Date().toISOString(), tenantId, device.id],
      );
      const assignments = [];
      for (const capability of plugin.manifest.capabilities) {
        assignments.push(await bindingService.assignCapability(tenantId, {
          ownerType: 'DEVICE', ownerId: device.hostId, capabilityKey: capability.key,
          pluginVersionId, pluginBindingId: binding.id, precedence: 'DEVICE_DEFAULT',
        }));
      }
      return { onboardingKind: 'PLUGIN_MANAGED' as const, device, binding, assignments };
    });
    try {
      await this.executeCapability(tenantId, onboarding.device.hostId, 'device.connection.test');
      if (capabilityKeys.includes('device.identity.detect')) {
        await this.executeCapability(tenantId, onboarding.device.hostId, 'device.identity.detect');
      }
      const discovery = await this.executeCapability(tenantId, onboarding.device.hostId, 'device.discover');
      return { ...onboarding, discovery };
    } catch (error) {
      const errorCode = error instanceof AppError ? error.errorCode : 'SYSTEM_INTERNAL_ERROR';
      const failedAt = new Date().toISOString();
      await this.db.transaction(async (tx) => {
        await tx.query(
          `update pg_device_assets set last_error_code=$1, updated_at=$2, version=version+1
           where tenant_id=$3 and service_asset_id=$4`,
          [errorCode, failedAt, tenantId, onboarding.device.id],
        );
        await tx.query(
          `update pg_service_assets
           set status='UNKNOWN', metadata=metadata || $1::jsonb, updated_at=$2, version=version+1
           where tenant_id=$3 and id=$4`,
          [JSON.stringify({ onboardingState: 'FAILED', onboardingErrorCode: errorCode, onboardingFailedAt: failedAt }), failedAt, tenantId, onboarding.device.id],
        );
      });
      throw error;
    }
  }
}

function applyEffectivePluginVersion(device: ManagedDeviceDetailDto, version: string): ManagedDeviceDetailDto {
  return {
    ...device,
    controlVersion: version,
    informationSections: device.informationSections.map((section) => section.key === 'networkAppliance'
      ? {
          ...section,
          fields: section.fields.map((field) => field.key === 'pluginVersion' ? { ...field, value: version } : field),
        }
      : section),
    extensionSummary: {
      ...device.extensionSummary,
      pluginVersion: version,
    },
  };
}

function applyResourceLabels(
  device: ManagedDeviceDetailDto,
  presentation: DevicePresentationSchemaV1 | undefined,
  messages: Record<string, string>,
): Pick<ManagedDeviceDetailDto, 'frameworks' | 'sites'> {
  const frameworkLabels = new Map((presentation?.resourceLabels?.frameworks ?? []).map((item) => [item.frameworkType, item]));
  const siteLabels = new Map((presentation?.resourceLabels?.sites ?? []).map((item) => [`${item.frameworkType}\u0000${item.siteType}`, item]));
  return {
    frameworks: device.frameworks.map((framework) => {
      const frameworkType = optionalString(framework.frameworkType);
      const label = frameworkType ? frameworkLabels.get(frameworkType) : undefined;
      return label ? {
        ...framework,
        presentation: { typeLabelKey: label.labelKey, typeLabel: messages[label.labelKey] },
      } : framework;
    }),
    sites: device.sites.map((site) => {
      const label = siteLabels.get(`${site.frameworkType}\u0000${site.kind}`);
      return label ? {
        ...site,
        presentation: {
          groupKey: label.groupKey,
          groupLabelKey: label.groupLabelKey,
          typeLabelKey: label.typeLabelKey,
          groupLabel: messages[label.groupLabelKey],
          typeLabel: messages[label.typeLabelKey],
        },
      } : { ...site, presentation: undefined };
    }),
  };
}

function asDevicePresentation(resource: PluginPackagePresentationResource | undefined): DevicePresentationSchemaV1 | undefined {
  return resource && 'schemaVersion' in resource && resource.schemaVersion === 'gcac.device-presentation/v1'
    ? resource
    : undefined;
}

function asPluginForm(resource: PluginPackageFormResource | undefined): PluginFormSchemaV1 | undefined {
  return resource && 'schemaVersion' in resource && resource.schemaVersion === 'gcac.plugin-form/v1'
    ? resource
    : undefined;
}

function validatePluginResourceForm(form: PluginFormSchemaV1, values: Record<string, unknown>): void {
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const value = values[field.key] ?? field.defaultValue;
    if (field.required && isEmpty(value)) {
      throw new AppError('VALIDATION_FAILED', '插件资源表单必填字段不能为空', { field: field.key });
    }
  }
}

function resolveAgentInstallPlatform(handlerKey: string | undefined): 'windows_go' | 'windows_compatibility' | 'linux_go' {
  switch (handlerKey) {
    case 'WINDOWS_GO': return 'windows_go';
    case 'WINDOWS_COMPATIBILITY': return 'windows_compatibility';
    case 'LINUX_GO': return 'linux_go';
    default: throw new AppError('VALIDATION_FAILED', '设备平台没有对应的 Agent 安装材料类型', { handlerKey });
  }
}

function resolveDeviceInstallCommand(
  profile: DeviceOnboardingPlatformDescriptor['installCommandProfile'],
  bootstrapUrl: string,
  defaultCommand: string,
): string {
  if (profile !== 'WINDOWS_POWERSHELL_2') return defaultCommand;
  const scriptPath = "(Join-Path ([System.IO.Path]::GetTempPath()) 'gcac-agent-install.ps1')";
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(New-Object System.Net.WebClient).DownloadFile('${bootstrapUrl}', ${scriptPath}); & ${scriptPath}"`;
}

export function resolvePluginDeviceFamily(plugin: UnifiedPluginVersionRecord): string {
  const productFamilies = resolvePluginDeviceFamilies(plugin);
  if (productFamilies.length !== 1) {
    throw new AppError('VALIDATION_FAILED', '设备插件必须声明唯一产品族', {
      pluginVersionId: plugin.id,
      pluginId: plugin.pluginId,
      productFamilyCount: productFamilies.length,
    });
  }
  return productFamilies[0]!;
}

/**
 * 应用接入向导按插件 Manifest 的兼容产品族筛选已有设备。
 * 一个接入平台可以兼容多个产品族；设备注册本身仍由 resolvePluginDeviceFamily
 * 维持“一台设备一个产品族”的存储约束。
 */
export function resolvePluginDeviceFamilies(plugin: UnifiedPluginVersionRecord): string[] {
  const productFamilies = [...new Set(
    (plugin.manifest.compatibility?.productFamilies ?? [])
      .filter((productFamily) => productFamily.trim().length > 0),
  )];
  if (productFamilies.length === 0) {
    throw new AppError('VALIDATION_FAILED', '插件必须声明至少一个兼容产品族', {
      pluginVersionId: plugin.id,
      pluginId: plugin.pluginId,
    });
  }
  return productFamilies;
}

function findWorkflowExtractedValue(
  steps: Array<{ extracted: Record<string, unknown>; children?: Array<{ extracted: Record<string, unknown>; children?: unknown[] }> }>,
  key: string,
): unknown {
  for (const step of [...steps].reverse()) {
    if (step.extracted[key] !== undefined) return step.extracted[key];
    const childValue = findWorkflowExtractedValue((step.children ?? []) as typeof steps, key);
    if (childValue !== undefined) return childValue;
  }
  return undefined;
}

function findFailedWorkflowStep<T extends { status: string; children?: T[] }>(steps: T[]): T | undefined {
  for (const step of steps) {
    const failedChild = findFailedWorkflowStep(step.children ?? []);
    if (failedChild) return failedChild;
    if (step.status === 'failed') return step;
  }
  return undefined;
}

interface MappedPluginDeviceForm {
  displayName: string;
  address: string;
  port: number;
  authMode: string;
  tlsVerify: boolean;
  gatewayId?: string;
  caSecretRef?: string;
  connections: Record<string, unknown>;
  variables: Record<string, unknown>;
  credentials: Record<string, { credentialId: string }>;
  secrets: Record<string, string>;
}

function mapPluginDeviceForm(
  form: PluginFormSchemaV1,
  values: Record<string, unknown>,
  contract: DeploymentInputContractV1,
): MappedPluginDeviceForm {
  const variables: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const standardValues = new Map<string, unknown>();
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const value = values[field.key] ?? field.defaultValue;
    if (field.required && isEmpty(value)) throw new AppError('VALIDATION_FAILED', '插件表单必填字段不能为空', { field: field.key });
    if (value === undefined || value === null || value === '') continue;
    if (field.type === 'credential_ref' && typeof value !== 'string') {
      throw new AppError('VALIDATION_FAILED', 'credentialId 必须是字符串', { field: field.key });
    }
    if (!field.standardField) {
      if (contract.variables[field.key] && field.type !== 'credential_ref' && field.type !== 'secret_ref') variables[field.key] = value;
      continue;
    }
    standardValues.set(field.standardField, value);
    if (field.type === 'credential_ref') {
      continue;
    } else if (field.type === 'secret_ref') {
      if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', 'SecretRef 必须是字符串', { field: field.key });
      secrets[field.standardField] = value;
    }
  }
  const address = requiredString(standardValues.get('connection.address'), 'connection.address');
  const displayName = requiredString(standardValues.get('device.displayName'), 'device.displayName');
  const port = Number(standardValues.get('connection.port') ?? 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('VALIDATION_FAILED', '设备管理端口无效', { field: 'connection.port' });
  const connectionEntries = Object.entries(contract.connections);
  if (connectionEntries.length !== 1) {
    throw new AppError('VALIDATION_FAILED', 'Managed 设备接入契约必须声明唯一连接槽', { connectionSlots: connectionEntries.map(([slot]) => slot) });
  }
  const [connectionSlot, connectionDefinition] = connectionEntries[0]!;
  const tlsEnabled = standardValues.get('tls.enabled') !== false;
  const ignoreCertificateErrors = standardValues.has('tls.ignoreCertificateErrors')
    ? standardValues.get('tls.ignoreCertificateErrors') === true
    : standardValues.get('tls.verifyPeer') === false;
  // 明文 HTTP 不进行证书校验；只有 HTTPS 才把“忽略证书错误”映射为 verifyPeer=false。
  const tlsVerify = tlsEnabled ? !ignoreCertificateErrors : true;
  const connection: {
    host?: string;
    port?: number;
    tls?: { enabled?: boolean; verifyPeer?: boolean; serverName?: string };
  } = {};
  if (connectionDefinition.host.bindingPolicy !== 'fixed') connection.host = address;
  if (connectionDefinition.port.bindingPolicy !== 'fixed') connection.port = port;
  if (connectionDefinition.tls) {
    connection.tls = {};
    if (connectionDefinition.tls.enabled && connectionDefinition.tls.enabled.bindingPolicy !== 'fixed') connection.tls.enabled = tlsEnabled;
    if (connectionDefinition.tls.verifyPeer.bindingPolicy !== 'fixed') connection.tls.verifyPeer = tlsVerify;
    const serverName = optionalString(standardValues.get('tls.serverName'));
    if (serverName && connectionDefinition.tls.serverName?.bindingPolicy !== 'fixed') connection.tls.serverName = serverName;
  }
  // TLS 例外授权是普通 Binding 输入，但只在 HTTPS 且关闭证书校验时成立。
  if (contract.variables.allowInsecureTls) variables.allowInsecureTls = tlsEnabled && ignoreCertificateErrors;
  const credentials: Record<string, { credentialId: string }> = {};
  const credentialId = optionalString(standardValues.get('authentication.credentialId'));
  const credentialSlot = connectionDefinition.credentialSlot
    ?? (Object.keys(contract.credentials).length === 1 ? Object.keys(contract.credentials)[0] : undefined);
  if (credentialId && credentialSlot) credentials[credentialSlot] = { credentialId };
  return {
    displayName,
    address,
    port,
    authMode: String(standardValues.get('authentication.mode') ?? 'PLUGIN'),
    tlsVerify,
    gatewayId: optionalString(standardValues.get('connection.gatewayId')),
    caSecretRef: optionalString(standardValues.get('tls.caSecretRef')),
    connections: { [connectionSlot]: connection },
    variables,
    credentials,
    secrets,
  };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNormalDslWorkflowVersion(version: { id: string; executionMode?: string; content: { kind?: unknown } }): void {
  if (version.executionMode === 'PLUGIN_RUNNER' || version.content.kind === 'PluginWorkflow') {
    throw new AppError('PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN', '包级 PluginWorkflow 已禁止；设备能力必须通过普通 DSL WorkflowVersion 执行', {
      workflowVersionId: version.id,
      executionMode: version.executionMode,
      kind: version.content.kind,
    });
  }
}

function enrichAgentDetail(device: ManagedDeviceDetailDto, projection: AgentDetailProjection): ManagedDeviceDetailDto {
  const { agent, latestHeartbeat, health, taskQueue, upgradeSuggestion } = projection;
  const descriptor = agent.descriptor;
  const agentSection = {
    key: 'agent',
    fields: [
      { key: 'agentId', value: agent.id, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentKey', value: agent.agentKey, valueType: 'TEXT' as const, copyable: true },
      { key: 'hostname', value: descriptor.hostname, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentVersion', value: descriptor.version, valueType: 'TEXT' as const },
      { key: 'osType', value: descriptor.osType, valueType: 'TEXT' as const },
      { key: 'osVersion', value: descriptor.osVersion ?? null, valueType: 'TEXT' as const },
      { key: 'architecture', value: descriptor.arch ?? null, valueType: 'TEXT' as const },
      { key: 'ipAddress', value: descriptor.ipAddress ?? null, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentRole', value: agent.role ?? null, valueType: 'TEXT' as const },
      { key: 'agentStatus', value: agent.status, valueType: 'STATUS' as const },
      { key: 'registeredAt', value: agent.registeredAt, valueType: 'DATETIME' as const },
      { key: 'lastHeartbeatAt', value: latestHeartbeat?.receivedAt ?? health.lastHeartbeatAt ?? null, valueType: 'DATETIME' as const },
    ],
  };
  const runtimeSection = {
    key: 'runtime',
    fields: [
      { key: 'healthStatus', value: health.status, valueType: 'STATUS' as const },
      { key: 'offline', value: health.offline, valueType: 'BOOLEAN' as const },
      { key: 'pendingTaskCount', value: taskQueue.counts.queued, valueType: 'NUMBER' as const },
      { key: 'runningTaskCount', value: taskQueue.counts.leased + taskQueue.counts.acked, valueType: 'NUMBER' as const },
      { key: 'upgradeStatus', value: upgradeSuggestion.suggestion.status, valueType: 'STATUS' as const },
      { key: 'targetVersion', value: upgradeSuggestion.suggestion.targetVersion ?? null, valueType: 'TEXT' as const },
    ],
  };
  const runtimeLogs = projection.runtimeLogs.map((log) => ({
    id: log.id,
    eventType: `agent.${log.category}`,
    result: log.level,
    summary: log.summary,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { category: log.category, level: log.level, requestId: log.requestId, redacted: log.redacted },
  }));
  const errorLogs = projection.recentErrors.map((log) => ({
    id: log.id,
    eventType: 'agent.task.error',
    result: log.level,
    summary: log.message,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { taskId: log.taskId, requestId: log.requestId, redacted: log.redacted },
  }));
  return {
    ...device,
    allowedActions: [...new Set([...device.allowedActions, 'device.discover'])],
    overview: {
      ...device.overview,
      deviceType: 'AGENT',
      managementMode: 'AGENT',
      status: device.health,
      updatedAt: agent.updatedAt,
    },
    informationSections: [device.informationSections[0] ?? { key: 'common', fields: [] }, agentSection, runtimeSection],
    logs: [...runtimeLogs, ...errorLogs].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    extension: { type: 'AGENT', agentId: agent.id, agentType: agent.role },
    extensionSummary: {
      ...device.extensionSummary,
      agentId: agent.id,
      descriptor,
    },
  };
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}
