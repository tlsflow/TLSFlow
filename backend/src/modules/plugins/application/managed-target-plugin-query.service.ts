import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAgentsRepository } from '../../agents/repository/agents.repository.js';
import { ManagedTargetContextResolver, type ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import { PgDevicesRepository } from '../../devices/repository/devices.repository.js';
import { PluginCapabilityRegistry } from '../capabilities/plugin-capability.registry.js';
import { evaluatePluginCompatibility, type PluginCompatibilityContext } from '../capabilities/plugin-compatibility.evaluator.js';
import type { PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { PluginLocaleService } from '../locales/plugin-locale.service.js';
import { PluginBindingsRepository } from '../repository/plugin-bindings.repository.js';
import { PgUnifiedPluginsRepository } from '../repository/unified-plugins.repository.js';
import { DeploymentCapabilityResolver, type ResolvedDeploymentCapability } from './deployment-capability.resolver.js';
import { PluginBindingsApplicationService } from './plugin-bindings.application-service.js';
import { compareSemanticVersions, UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';
import type { CreateWorkflowExecutionBindingInput } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { buildPluginCertificateArtifactBindings } from '../artifacts/plugin-certificate-artifact-binding.js';
import { deploymentAssetContextBuilder } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { DeploymentInputBindingSaveService } from '../../deployment-inputs/application/deployment-input-binding-save.service.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { DeploymentInputProjectionService } from '../../deployment-inputs/application/deployment-input-projection.service.js';
import type { DeploymentInputProjectionV1 } from '../../deployment-inputs/dto/deployment-input-projection.dto.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';

type ExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface SaveManagedTargetPluginOverrideInput {
  managedTargetId: string;
  certificateFormatId?: string;
  executionMode?: 'PLUGIN' | 'WORKFLOW_OVERRIDE';
  expectedTargetVersion?: number;
  capabilityKey?: string;
  pluginOverride?: {
    pluginVersionId: string;
    pluginBindingId?: string;
    expectedBindingVersion?: number;
    inputBindings?: InputBindingsV1;
  };
  workflowExecution?: CreateWorkflowExecutionBindingInput & { bindingId?: string; expectedVersion?: number };
}

export class ManagedTargetPluginQueryService {
  private readonly capabilityRegistry = new PluginCapabilityRegistry();
  private readonly pluginLocales = new PluginLocaleService();
  private readonly contractLoader = new DeploymentInputContractLoader();
  private readonly bindingSaves = new DeploymentInputBindingSaveService();
  private readonly inputProjections = new DeploymentInputProjectionService();

  constructor(private readonly db: DatabasePort) {}

  async getEffectiveCapability(input: {
    tenantId: string;
    managedTargetId: string;
    capabilityKey: string;
    applicationAssetId?: string;
  }) {
    const services = this.createServices(this.db);
    const context = await services.contexts.resolve(input.tenantId, input.managedTargetId);
    const compatibility = await this.createCompatibilityContext(services.devices, input.tenantId, context, input.capabilityKey);
    const resolved = await services.capabilities.resolve({
      ...input,
      hostId: context.host.id,
      executionLocations: context.availableExecutionLocations,
      compatibility,
    });
    return summarizeCapability(resolved);
  }

  async listCompatiblePlugins(input: {
    tenantId: string;
    managedTargetId: string;
    capabilityKey: string;
    applicationAssetId?: string;
    locale?: string;
  }) {
    const services = this.createServices(this.db);
    const context = await services.contexts.resolve(input.tenantId, input.managedTargetId);
    this.assertTargetCapability(context, input.capabilityKey);
    const compatibility = await this.createCompatibilityContext(services.devices, input.tenantId, context, input.capabilityKey);
    const versions = selectLatestEnabledManagedVersions(await services.plugins.listAccessibleVersions(input.tenantId));
    const items = versions.map((plugin) => evaluateCompatiblePlugin(
      plugin,
      input.capabilityKey,
      context.availableExecutionLocations,
      compatibility,
      this.resolvePluginDisplayName(plugin, input.locale ?? 'zh-CN'),
    ));
    return { items };
  }

  private resolvePluginDisplayName(plugin: UnifiedPluginVersionRecord, locale: string): string | undefined {
    const bundle = this.pluginLocales.validate(plugin.manifest, plugin.resources, [plugin.manifest.displayNameKey]);
    return bundle ? this.pluginLocales.resolve(bundle, locale, plugin.manifest.displayNameKey) : undefined;
  }

  async saveApplicationAssetTarget(input: {
    tenantId: string;
    applicationAssetId: string;
    value: SaveManagedTargetPluginOverrideInput;
  }) {
    return this.db.transaction(async (tx) => {
      const services = this.createServices(tx);
      const context = await services.contexts.resolve(input.tenantId, input.value.managedTargetId);
      this.assertTargetCapability(context, input.value.capabilityKey ?? 'certificate.deploy');
      const applicationAsset = await services.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
      if (!applicationAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });

      const certificateFormatId = input.value.certificateFormatId !== undefined
        ? input.value.certificateFormatId
        : applicationAsset.deploymentStrategy?.type === 'MANAGED_TARGET'
          ? applicationAsset.deploymentStrategy.managedTarget?.certificateFormatId
          : undefined;
      const currentTarget = await services.assets.getApplicationAssetTargetByApplicationAssetId(input.tenantId, input.applicationAssetId);
      if (input.value.expectedTargetVersion !== undefined && currentTarget?.version !== input.value.expectedTargetVersion) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', 'ApplicationAssetTarget 版本冲突', {
          applicationAssetId: input.applicationAssetId,
          expectedVersion: input.value.expectedTargetVersion,
          actualVersion: currentTarget?.version,
        });
      }
      const target = currentTarget
        ? await services.assets.updateApplicationAssetTarget(input.tenantId, currentTarget.id, { managedTargetId: context.managedTarget.id, status: 'ACTIVE' })
        : await services.assets.createApplicationAssetTarget(input.tenantId, { applicationAssetId: input.applicationAssetId, managedTargetId: context.managedTarget.id });

      const capabilityKey = input.value.capabilityKey ?? 'certificate.deploy';
      const executionMode = input.value.executionMode ?? 'PLUGIN';
      if (executionMode === 'WORKFLOW_OVERRIDE') {
        if (input.value.pluginOverride) throw new AppError('EXECUTION_SOURCE_CONFLICT', '工作流覆盖模式不得同时提交插件覆盖');
        const workflowInput = input.value.workflowExecution;
        if (!workflowInput) throw new AppError('VALIDATION_FAILED', '工作流覆盖模式必须提交工作流执行配置');
        const executionLocation = workflowInput.runner === 'GATEWAY' ? 'GATEWAY' : 'CONTROL_PLANE';
        if (!context.availableExecutionLocations.includes(executionLocation)) {
          throw new AppError('WORKFLOW_RUNNER_INCOMPATIBLE', '工作流 Runner 与 ManagedTarget 可执行位置不兼容', { executionLocation, availableExecutionLocations: context.availableExecutionLocations });
        }
        const { bindingId, expectedVersion, ...createInput } = workflowInput;
        if (createInput.tenantId !== input.tenantId) throw new AppError('VALIDATION_FAILED', 'WorkflowExecutionBinding tenantId 不匹配');
        const currentBinding = bindingId ? await services.workflowBindings.get(input.tenantId, bindingId) : undefined;
        const validation = await new WorkflowDeploymentInputSaveService(tx).validate({ applicationAsset, managedTargetContext: context, workflowExecution: createInput, currentBinding });
        if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
        createInput.inputBindings = validation.assetOverride;
        const binding = bindingId
          ? await services.workflowBindings.update(input.tenantId, bindingId, { ...createInput, expectedVersion: expectedVersion ?? 0 })
          : await services.workflowBindings.create(createInput);
        await services.bindings.disableOwnerAssignment(input.tenantId, { ownerType: 'APPLICATION_ASSET', ownerId: input.applicationAssetId, capabilityKey });
        await services.assets.updateServiceAsset(input.tenantId, input.applicationAssetId, {
          deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode, workflowExecutionBindingId: binding.id } },
        });
        return { target, executionMode, workflowExecutionBinding: binding, effectiveCapability: undefined };
      }
      if (input.value.workflowExecution) throw new AppError('EXECUTION_SOURCE_CONFLICT', '插件模式不得提交工作流执行配置');
      const previousWorkflowBindingId = applicationAsset.deploymentStrategy?.type === 'MANAGED_TARGET'
        ? applicationAsset.deploymentStrategy.managedTarget?.workflowExecutionBindingId
        : undefined;
      if (previousWorkflowBindingId) {
        const previous = await services.workflowBindings.get(input.tenantId, previousWorkflowBindingId);
        if (previous.status === 'ACTIVE') await services.workflowBindings.disable(input.tenantId, previous.id, previous.version);
      }
      const compatibility = await this.createCompatibilityContext(services.devices, input.tenantId, context, capabilityKey);
      if (!input.value.pluginOverride) {
        await services.bindings.disableOwnerAssignment(input.tenantId, {
          ownerType: 'APPLICATION_ASSET',
          ownerId: input.applicationAssetId,
          capabilityKey,
        });
        const inherited = await services.capabilities.resolve({
          tenantId: input.tenantId,
          capabilityKey,
          hostId: context.host.id,
          managedTargetId: context.managedTarget.id,
          executionLocations: context.availableExecutionLocations,
          compatibility,
        });
        if (certificateFormatId?.trim()) {
          const plugin = await services.plugins.getVersion(inherited.pluginVersionId);
          const artifacts = buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId.trim());
          const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
            deviceId: context.host.id,
            managedTargetId: context.managedTarget.id,
          });
          const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates);
          const submitted = emptyInputBindingsV1();
          submitted.artifacts = artifacts;
          const validation = this.bindingSaves.validate({
            pluginVersionId: plugin.id,
            contract: this.contractLoader.fromPlugin(plugin, capabilityKey),
            assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context }),
            deviceDefault: layers.device,
            targetOverride: layers.target,
            submitted,
          });
          if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
          const binding = await services.bindings.createBinding(input.tenantId, {
            pluginVersionId: inherited.pluginVersionId,
            mode: 'MANAGED',
            inputBindings: validation.assetOverride,
            managedContext: { hostId: context.host.id, managedTargetId: context.managedTarget.id },
          });
          await services.bindings.assignCapability(input.tenantId, {
            ownerType: 'APPLICATION_ASSET',
            ownerId: input.applicationAssetId,
            capabilityKey,
            pluginVersionId: inherited.pluginVersionId,
            pluginBindingId: binding.id,
            precedence: 'ASSET_OVERRIDE',
          });
        }
        const resolved = await services.capabilities.resolve({
          tenantId: input.tenantId,
          capabilityKey,
          hostId: context.host.id,
          managedTargetId: context.managedTarget.id,
          applicationAssetId: input.applicationAssetId,
          executionLocations: context.availableExecutionLocations,
          compatibility,
        });
        await services.assets.updateServiceAsset(input.tenantId, input.applicationAssetId, {
          deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode: 'PLUGIN' } },
        });
        return { target, executionMode: 'PLUGIN', effectiveCapability: summarizeCapability(resolved) };
      }
      const plugin = await services.plugins.getVersion(input.value.pluginOverride.pluginVersionId);
      const evaluated = evaluateCompatiblePlugin(plugin, capabilityKey, context.availableExecutionLocations, compatibility);
      if (!evaluated.compatible) {
        throw new AppError('CAPABILITY_MISSING', '插件与受管目标不兼容', {
          code: 'PLUGIN_INCOMPATIBLE',
          pluginVersionId: plugin.id,
          reasons: evaluated.reasons,
        });
      }
      const requestedInputBindings = input.value.pluginOverride.inputBindings ?? emptyInputBindingsV1();
      const artifacts = Object.keys(requestedInputBindings.artifacts).length > 0
        ? requestedInputBindings.artifacts
        : certificateFormatId?.trim()
          ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId.trim())
          : {};
      const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
        deviceId: context.host.id,
        managedTargetId: context.managedTarget.id,
        applicationAssetId: input.applicationAssetId,
      });
      const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates);
      const contract = this.contractLoader.fromPlugin(plugin, capabilityKey);
      const validation = this.bindingSaves.validate({
        pluginVersionId: plugin.id,
        contract,
        assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context }),
        deviceDefault: layers.device,
        targetOverride: layers.target,
        currentAssetOverride: layers.asset,
        submitted: { ...requestedInputBindings, artifacts },
      });
      if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
      const hasAssetOverride = hasBindingValues(validation.assetOverride);
      const inheritedSameVersion = layers.target?.pluginVersionId === plugin.id || layers.device?.pluginVersionId === plugin.id;
      const binding = hasAssetOverride || !inheritedSameVersion
        ? await this.saveBinding(services.bindings, input.tenantId, context, { ...input.value.pluginOverride, inputBindings: validation.assetOverride })
        : undefined;
      if (!binding) {
        await services.bindings.disableOwnerAssignment(input.tenantId, { ownerType: 'APPLICATION_ASSET', ownerId: input.applicationAssetId, capabilityKey });
      } else {
      await services.bindings.assignCapability(input.tenantId, {
        ownerType: 'APPLICATION_ASSET',
        ownerId: input.applicationAssetId,
        capabilityKey,
        pluginVersionId: plugin.id,
        pluginBindingId: binding.id,
        precedence: 'ASSET_OVERRIDE',
      });
      }
      const resolved = await services.capabilities.resolve({
        tenantId: input.tenantId,
        capabilityKey,
        hostId: context.host.id,
        managedTargetId: context.managedTarget.id,
        applicationAssetId: input.applicationAssetId,
        executionLocations: context.availableExecutionLocations,
        compatibility,
      });
      await services.assets.updateServiceAsset(input.tenantId, input.applicationAssetId, {
        deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode: 'PLUGIN' } },
      });
      return { target, executionMode: 'PLUGIN', effectiveCapability: summarizeCapability(resolved) };
    });
  }

  async projectApplicationAssetPluginInputs(input: {
    tenantId: string;
    managedTargetId: string;
    capabilityKey?: string;
    pluginVersionId?: string;
    certificateFormatId?: string;
    applicationAsset: {
      id: string;
      address: string;
      sniName?: string;
      port: number;
      protocol: string;
      displayName?: string;
    };
    inputBindings?: InputBindingsV1;
  }): Promise<DeploymentInputProjectionV1> {
    const services = this.createServices(this.db);
    const context = await services.contexts.resolve(input.tenantId, input.managedTargetId);
    const capabilityKey = input.capabilityKey ?? 'certificate.deploy';
    this.assertTargetCapability(context, capabilityKey);
    const compatibility = await this.createCompatibilityContext(services.devices, input.tenantId, context, capabilityKey);
    const applicationAssetId = input.applicationAsset.id === 'draft' ? undefined : input.applicationAsset.id;
    const capability = input.pluginVersionId
      ? undefined
      : await services.capabilities.resolve({
        tenantId: input.tenantId,
        capabilityKey,
        hostId: context.host.id,
        managedTargetId: context.managedTarget.id,
        applicationAssetId,
        executionLocations: context.availableExecutionLocations,
        compatibility,
      });
    const plugin = await services.plugins.getVersion(input.pluginVersionId ?? capability!.pluginVersionId);
    const evaluated = evaluateCompatiblePlugin(plugin, capabilityKey, context.availableExecutionLocations, compatibility);
    if (!evaluated.compatible) {
      throw new AppError('CAPABILITY_MISSING', '插件与受管目标不兼容', {
        code: 'PLUGIN_INCOMPATIBLE',
        pluginVersionId: plugin.id,
        reasons: evaluated.reasons,
      });
    }

    const requestedInputBindings = input.inputBindings ?? emptyInputBindingsV1();
    const artifacts = Object.keys(requestedInputBindings.artifacts).length > 0
      ? requestedInputBindings.artifacts
      : input.certificateFormatId?.trim()
        ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, input.certificateFormatId.trim())
        : {};
    const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
      deviceId: context.host.id,
      managedTargetId: context.managedTarget.id,
      ...(applicationAssetId ? { applicationAssetId } : {}),
    });
    const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates);
    const contract = this.contractLoader.fromPlugin(plugin, capabilityKey);
    const validation = this.bindingSaves.validate({
      pluginVersionId: plugin.id,
      contract,
      assetContext: deploymentAssetContextBuilder.build({
        applicationAsset: input.applicationAsset,
        managedTargetContext: context,
      }),
      deviceDefault: layers.device,
      targetOverride: layers.target,
      currentAssetOverride: layers.asset,
      submitted: { ...requestedInputBindings, artifacts },
    });
    return this.inputProjections.project({
      contract,
      resolvedInput: validation.resolved,
      effectiveBinding: validation.effectiveBinding,
    });
  }

  private async saveBinding(
    bindings: PluginBindingsApplicationService,
    tenantId: string,
    context: ResolvedManagedTargetContext,
    input: NonNullable<SaveManagedTargetPluginOverrideInput['pluginOverride']>,
  ): Promise<PluginBindingV1> {
    const managedContext = { hostId: context.host.id, managedTargetId: context.managedTarget.id };
    if (input.pluginBindingId) {
      const current = await bindings.getTenantBinding(tenantId, input.pluginBindingId);
      if (current.pluginVersionId !== input.pluginVersionId) {
        throw new AppError('VALIDATION_FAILED', 'PluginBinding 不能切换到其他插件版本', { pluginBindingId: current.id });
      }
      if (input.expectedBindingVersion === undefined) {
        throw new AppError('VALIDATION_FAILED', '更新 PluginBinding 必须提供 expectedBindingVersion');
      }
      return bindings.updateBinding(tenantId, current.id, {
        expectedVersion: input.expectedBindingVersion,
        inputBindings: input.inputBindings,
        managedContext,
        status: 'ACTIVE',
      });
    }
    return bindings.createBinding(tenantId, {
      pluginVersionId: input.pluginVersionId,
      mode: 'MANAGED',
      inputBindings: input.inputBindings ?? emptyInputBindingsV1(),
      managedContext,
    });
  }

  private async loadBindingLayers(
    bindings: PluginBindingsApplicationService,
    tenantId: string,
    assignments: Awaited<ReturnType<PluginBindingsApplicationService['listAssignmentCandidates']>>,
  ) {
    const layers: { device?: { pluginVersionId: string; inputBindings: InputBindingsV1 }; target?: { pluginVersionId: string; inputBindings: InputBindingsV1 }; asset?: { pluginVersionId: string; inputBindings: InputBindingsV1 } } = {};
    for (const assignment of assignments) {
      const binding = await bindings.getTenantBinding(tenantId, assignment.pluginBindingId);
      const layer = { pluginVersionId: assignment.pluginVersionId, inputBindings: binding.inputBindings };
      if (assignment.ownerType === 'DEVICE') layers.device = layer;
      else if (assignment.ownerType === 'MANAGED_TARGET') layers.target = layer;
      else layers.asset = layer;
    }
    return layers;
  }

  private async createCompatibilityContext(
    devices: PgDevicesRepository,
    tenantId: string,
    context: ResolvedManagedTargetContext,
    capabilityKey: string,
  ): Promise<Omit<PluginCompatibilityContext, 'executionLocation'>> {
    this.assertTargetCapability(context, capabilityKey);
    const device = await devices.get(tenantId, context.host.id);
    return {
      productFamily: device?.productFamily,
      frameworkType: context.frameworkType,
      targetType: context.managedTarget.targetType,
      managementMethod: normalizeManagementMethod(device?.managementMethod ?? context.host.managementMode),
      artifactContract: this.capabilityRegistry.require(capabilityKey).actionContractId,
    };
  }

  private assertTargetCapability(context: ResolvedManagedTargetContext, capabilityKey: string): void {
    if (!context.managedTarget.supportedCapabilities.includes(capabilityKey)) {
      throw new AppError('CAPABILITY_MISSING', '受管目标未声明目标能力', { managedTargetId: context.managedTarget.id, capabilityKey });
    }
  }

  private createServices(db: DatabasePort) {
    const assets = new PgAssetsRepository(db);
    const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
    const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
    return {
      assets,
      bindings,
      plugins,
      devices: new PgDevicesRepository(db),
      contexts: new ManagedTargetContextResolver(assets, new PgAgentsRepository(db), new PgDeviceAssetsRepository(db)),
      capabilities: new DeploymentCapabilityResolver(bindings, plugins),
      workflowBindings: new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(db)),
    };
  }
}

function hasBindingValues(bindings: InputBindingsV1): boolean {
  return Object.keys(bindings.variables).length > 0
    || Object.keys(bindings.connections).length > 0
    || Object.keys(bindings.credentials).length > 0
    || Object.keys(bindings.artifacts).length > 0;
}

function evaluateCompatiblePlugin(
  plugin: UnifiedPluginVersionRecord,
  capabilityKey: string,
  availableExecutionLocations: ExecutionLocation[],
  context: Omit<PluginCompatibilityContext, 'executionLocation'>,
  displayName?: string,
) {
  const capability = plugin.manifest.capabilities.find((item) => item.key === capabilityKey);
  const reasons: Array<{ dimension: string; expected: string[]; actual?: string }> = [];
  if (plugin.status !== 'ENABLED') reasons.push({ dimension: 'status', expected: ['ENABLED'], actual: plugin.status });
  if (plugin.scope !== 'MANAGED' && plugin.scope !== 'BOTH') reasons.push({ dimension: 'scope', expected: ['MANAGED', 'BOTH'], actual: plugin.scope });
  if (!capability) reasons.push({ dimension: 'capabilityKey', expected: [capabilityKey] });
  const candidateLocations = capability
    ? availableExecutionLocations.filter((location) => capability.executionLocations.includes(location))
    : [];
  if (capability && candidateLocations.length === 0) {
    reasons.push({ dimension: 'executionLocation', expected: capability.executionLocations, actual: availableExecutionLocations.join(',') });
  }
  const evaluations = candidateLocations.map((executionLocation) => ({
    executionLocation,
    evaluation: evaluatePluginCompatibility(plugin.manifest, { ...context, executionLocation }),
  }));
  const compatibleLocations = evaluations.filter((item) => item.evaluation.compatible).map((item) => item.executionLocation);
  if (candidateLocations.length > 0 && compatibleLocations.length === 0) {
    reasons.push(...evaluations.flatMap((item) => item.evaluation.reasons));
  }
  return {
    pluginVersionId: plugin.id,
    pluginId: plugin.pluginId,
    version: plugin.version,
    runtime: plugin.runtime,
    displayNameKey: plugin.manifest.displayNameKey,
    displayName,
    compatible: reasons.length === 0 && compatibleLocations.length > 0,
    executionLocations: compatibleLocations,
    reasons: deduplicateReasons(reasons),
  };
}

function selectLatestEnabledManagedVersions(versions: UnifiedPluginVersionRecord[]): UnifiedPluginVersionRecord[] {
  const latestVersions = new Map<string, UnifiedPluginVersionRecord>();
  for (const plugin of versions) {
    if (plugin.status !== 'ENABLED' || (plugin.scope !== 'MANAGED' && plugin.scope !== 'BOTH')) continue;
    const current = latestVersions.get(plugin.pluginId);
    if (!current || compareSemanticVersions(plugin.version, current.version) > 0) latestVersions.set(plugin.pluginId, plugin);
  }
  return [...latestVersions.values()].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

function summarizeCapability(resolved: ResolvedDeploymentCapability) {
  return {
    capabilityKey: resolved.assignment.capabilityKey,
    source: {
      ownerType: resolved.assignment.ownerType,
      ownerId: resolved.assignment.ownerId,
      precedence: resolved.assignment.precedence,
      assignmentId: resolved.assignment.id,
    },
    plugin: {
      pluginVersionId: resolved.pluginVersionId,
      pluginId: resolved.plugin.pluginId,
      version: resolved.plugin.version,
      runtime: resolved.pluginRuntime,
    },
    binding: {
      pluginBindingId: resolved.binding.id,
      hostId: resolved.binding.managedContext?.hostId,
      managedTargetId: resolved.binding.managedContext?.managedTargetId,
      status: resolved.binding.status,
      version: resolved.binding.version,
    },
    executionLocation: resolved.executionLocation,
    compatible: resolved.compatibility.compatible,
    reasons: resolved.compatibility.reasons,
  };
}

function normalizeManagementMethod(value: string | undefined): 'AGENT' | 'PLUGIN' | 'MANUAL' {
  const normalized = value?.toUpperCase();
  if (normalized?.includes('AGENT')) return 'AGENT';
  if (normalized?.includes('PLUGIN') || normalized?.includes('API')) return 'PLUGIN';
  return 'MANUAL';
}

function deduplicateReasons<T extends { dimension: string; expected: string[]; actual?: string }>(reasons: T[]): T[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
