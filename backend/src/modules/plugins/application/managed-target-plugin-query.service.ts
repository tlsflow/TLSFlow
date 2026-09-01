import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAgentsRepository } from '../../agents/repository/agents.repository.js';
import { ManagedTargetContextResolver, type ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import { PgDevicesRepository } from '../../devices/repository/devices.repository.js';
import { canonicalProductFamilyForOsType } from '../../devices/domain/canonical-product-family.js';
import { PluginCapabilityRegistry } from '../capabilities/plugin-capability.registry.js';
import { evaluatePluginCompatibility, type PluginCompatibilityContext } from '../capabilities/plugin-compatibility.evaluator.js';
import type { PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { ApplicationOnboardingDeploymentDefaultsV1 } from '../onboarding/application-onboarding-recipe.dto.js';
import { PluginLocaleService } from '../locales/plugin-locale.service.js';
import { PluginBindingsRepository } from '../repository/plugin-bindings.repository.js';
import { PluginWorkflowBindingsRepository } from '../repository/plugin-workflow-bindings.repository.js';
import { PgUnifiedPluginsRepository } from '../repository/unified-plugins.repository.js';
import { DeploymentCapabilityResolver, type ResolvedDeploymentCapability } from './deployment-capability.resolver.js';
import { PluginBindingsApplicationService } from './plugin-bindings.application-service.js';
import { compareSemanticVersions, UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';
import type { CreateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { buildPluginCertificateArtifactBindings } from '../artifacts/plugin-certificate-artifact-binding.js';
import { deploymentAssetContextBuilder } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { DeploymentInputBindingSaveService } from '../../deployment-inputs/application/deployment-input-binding-save.service.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { DeploymentInputProjectionService } from '../../deployment-inputs/application/deployment-input-projection.service.js';
import type { DeploymentInputProjectionV1 } from '../../deployment-inputs/dto/deployment-input-projection.dto.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';
import { migrateInputBindingsToContract } from '../../deployment-inputs/application/input-binding-contract-migrator.js';
import { PgCertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import { PgBindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import { certificateFormats } from '../../certificates/schema/certificates.schema.js';
import { GCAC_VERSION } from '../../../common/version.js';
import { ApplicationOnboardingRecipeLoader } from '../../application-onboarding/recipe/application-onboarding-recipe.loader.js';
import { readCertificateLocation } from '../../deployment-inputs/dto/certificate-location.dto.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { ApplicationExecutionCompatibilityService } from '../../assets/application/application-execution-compatibility.service.js';

type ExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface SaveManagedTargetPluginOverrideInput {
  managedTargetId: string;
  metadata?: Record<string, unknown>;
  certificateFormatId?: string;
  executionMode?: 'PLUGIN' | 'WORKFLOW_OVERRIDE';
  expectedTargetVersion?: number;
  capabilityKey?: string;
  pluginOverride?: {
    pluginId?: string;
    pluginVersionId?: string;
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
  private readonly onboardingRecipes = new ApplicationOnboardingRecipeLoader();

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
      ...managedTargetCapabilityOwnerRefs(context),
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
    const workflowBindings = new PluginWorkflowBindingsRepository(this.db);
    const items = await Promise.all(versions.map(async (plugin) => {
      const evaluated = evaluateCompatiblePlugin(
        plugin,
        input.capabilityKey,
        context.availableExecutionLocations,
        compatibility,
        this.resolvePluginDisplayName(plugin, input.locale ?? 'zh-CN'),
      );
      if (!evaluated.compatible || await hasPublishedWorkflowBinding(plugin, input.capabilityKey, workflowBindings)) return evaluated;
      return {
        ...evaluated,
        compatible: false,
        executionLocations: [],
        reasons: deduplicateReasons([
          ...evaluated.reasons,
          { dimension: 'workflow', expected: ['published'], actual: 'missing' },
        ]),
      };
    }));
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
    const result = await this.db.transaction(async (tx) => {
      const services = this.createServices(tx);
      const context = await services.contexts.resolve(input.tenantId, input.value.managedTargetId);
      this.assertTargetCapability(context, input.value.capabilityKey ?? 'certificate.deploy');
      const applicationAsset = await services.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
      if (!applicationAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
      const certificateBinding = await findManagedTargetCertificateBinding(services.certificateBindings, input.tenantId, context.managedTarget.id);
      const approvalRequired = applicationAsset.deploymentStrategy?.approvalRequired === true;

      const capabilityKey = input.value.capabilityKey ?? 'certificate.deploy';
      const overridePlugin = input.value.pluginOverride
        ? input.value.pluginOverride.pluginId && services.plugins.getCurrentEnabledVersion
          ? await services.plugins.getCurrentEnabledVersion(input.tenantId, input.value.pluginOverride.pluginId)
          : input.value.pluginOverride.pluginVersionId
            ? await services.plugins.getVersion(input.value.pluginOverride.pluginVersionId)
            : undefined
        : undefined;
      const overrideContract = overridePlugin
        ? this.contractLoader.fromPlugin(overridePlugin, capabilityKey)
        : undefined;
      const overrideUsesFixedPkcs12 = overrideContract ? hasRequiredPkcs12Output(overrideContract) : false;
      const deploymentDefaults = overridePlugin
        ? this.resolvePluginDeploymentDefaults(overridePlugin, capabilityKey)
        : undefined;
      const submittedCertificateFormatId = input.value.certificateFormatId?.trim() || undefined;
      const preparedDefaults = deploymentDefaults && overridePlugin
        ? await this.prepareApplicationOnboardingDefaults({
          tenantId: input.tenantId,
          pluginVersionId: overridePlugin.id,
          defaults: deploymentDefaults,
          certificateFormatId: overrideUsesFixedPkcs12 ? undefined : submittedCertificateFormatId,
          inputBindings: input.value.pluginOverride?.inputBindings,
        })
        : undefined;
      // 插件接入配方声明的证书格式是插件合同的一部分，不能被旧资产或页面提交值覆盖。
      let certificateFormatId = preparedDefaults?.certificateFormatId
        ?? submittedCertificateFormatId
        ?? (applicationAsset.deploymentStrategy?.type === 'MANAGED_TARGET'
          ? applicationAsset.deploymentStrategy.managedTarget?.certificateFormatId
          : undefined);
      if (!certificateFormatId && hasKeyStoreOutput(overrideContract)) {
        certificateFormatId = await this.resolveKeyStoreCertificateFormatId(input.tenantId, certificateBinding, context);
      }
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
        : await services.assets.createApplicationAssetTarget(input.tenantId, {
          applicationAssetId: input.applicationAssetId,
          managedTargetId: context.managedTarget.id,
          ...(input.value.metadata ? { metadata: input.value.metadata } : {}),
        });

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
          deploymentStrategy: { type: 'MANAGED_TARGET', approvalRequired, managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode, workflowExecutionBindingId: binding.id } },
        });
        return { target, executionMode, workflowExecutionBinding: binding, effectiveCapability: undefined };
      }
      if (input.value.workflowExecution) throw new AppError('EXECUTION_SOURCE_CONFLICT', '插件模式不得提交工作流执行配置');
      const previousWorkflowBindingId = applicationAsset.deploymentStrategy?.type === 'MANAGED_TARGET'
        ? applicationAsset.deploymentStrategy.managedTarget?.workflowExecutionBindingId
        : undefined;
      if (previousWorkflowBindingId) {
        let previous: WorkflowExecutionBinding | undefined;
        try {
          previous = await services.workflowBindings.get(input.tenantId, previousWorkflowBindingId);
        } catch (error) {
          // 历史清理可能已经删除绑定，但资产策略尚未同步；插件模式会完整覆盖该策略，不能被这个脏引用阻断。
          if (!(error instanceof AppError) || error.errorCode !== 'RESOURCE_NOT_FOUND') throw error;
        }
        if (previous?.status === 'ACTIVE') await services.workflowBindings.disable(input.tenantId, previous.id, previous.version);
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
          ...managedTargetCapabilityOwnerRefs(context),
          managedTargetId: context.managedTarget.id,
          executionLocations: context.availableExecutionLocations,
          compatibility,
        });
        const plugin = await services.plugins.getVersion(inherited.pluginVersionId);
        const inheritedDefaults = this.resolvePluginDeploymentDefaults(plugin, capabilityKey);
        const inheritedContract = this.contractLoader.fromPlugin(plugin, capabilityKey);
        const inheritedUsesFixedPkcs12 = hasRequiredPkcs12Output(inheritedContract);
        if ((inheritedUsesFixedPkcs12 || !certificateFormatId) && inheritedDefaults?.certificateFormat) {
          certificateFormatId = await this.resolveCertificateFormatId(input.tenantId, inheritedDefaults.certificateFormat);
        }
        if (!certificateFormatId && hasKeyStoreOutput(inheritedContract)) {
          certificateFormatId = await this.resolveKeyStoreCertificateFormatId(input.tenantId, certificateBinding, context);
        }
        if (certificateFormatId) {
          const artifacts = buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId);
          const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
            ...managedTargetOwnerRefs(context),
            managedTargetId: context.managedTarget.id,
          });
          const contract = this.contractLoader.fromPlugin(plugin, capabilityKey);
          const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates, plugin.id, contract);
          const submitted = emptyInputBindingsV1();
          submitted.artifacts = artifacts;
          const validation = this.bindingSaves.validate({
            pluginVersionId: plugin.id,
            contract,
            assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context, certificateBinding }),
            resourceOwnerDefault: layers.owner,
            deviceDefault: layers.device,
            targetOverride: layers.target,
            submitted,
          });
          if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
          const binding = await services.bindings.createBinding(input.tenantId, {
            pluginVersionId: inherited.pluginVersionId,
            mode: 'MANAGED',
            inputBindings: validation.assetOverride,
            managedContext: managedTargetBindingContext(context),
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
          ...managedTargetCapabilityOwnerRefs(context),
          managedTargetId: context.managedTarget.id,
          applicationAssetId: input.applicationAssetId,
          executionLocations: context.availableExecutionLocations,
          compatibility,
        });
        await services.assets.updateServiceAsset(input.tenantId, input.applicationAssetId, {
          deploymentStrategy: { type: 'MANAGED_TARGET', approvalRequired, managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode: 'PLUGIN' } },
        });
        return { target, executionMode: 'PLUGIN', effectiveCapability: summarizeCapability(resolved) };
      }
      const plugin = overridePlugin;
      if (!plugin) throw new AppError('APPLICATION_CURRENT_PLUGIN_UNAVAILABLE', '应用当前插件不可用', { applicationAssetId: input.applicationAssetId, capabilityKey });
      const requestedInputBindings = input.value.pluginOverride.inputBindings ?? emptyInputBindingsV1();
      const contract = overrideContract ?? this.contractLoader.fromPlugin(plugin, capabilityKey);
      const preparedInput = preparedDefaults ?? {
        inputBindings: requestedInputBindings,
        ...(certificateFormatId ? { certificateFormatId } : {}),
      };
      certificateFormatId = preparedInput.certificateFormatId ?? certificateFormatId;
      if (!certificateFormatId && hasKeyStoreOutput(contract)) {
        certificateFormatId = await this.resolveKeyStoreCertificateFormatId(input.tenantId, certificateBinding, context);
      }
      const fixedArtifactFormat = hasRequiredPkcs12Output(contract);
      const artifacts = fixedArtifactFormat && certificateFormatId
        ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId)
        : Object.keys(preparedInput.inputBindings.artifacts).length > 0
        ? preparedInput.inputBindings.artifacts
        : certificateFormatId
          ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId)
          : {};
      const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
        ...managedTargetOwnerRefs(context),
        managedTargetId: context.managedTarget.id,
        applicationAssetId: input.applicationAssetId,
      });
      const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates, plugin.id, contract);
      const validation = this.bindingSaves.validate({
        pluginVersionId: plugin.id,
        contract,
        assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context, certificateBinding }),
        resourceOwnerDefault: layers.owner,
        deviceDefault: layers.device,
        targetOverride: layers.target,
        currentAssetOverride: layers.asset,
        submitted: { ...preparedInput.inputBindings, artifacts },
      });
      if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
      const evaluated = evaluateCompatiblePlugin(plugin, capabilityKey, context.availableExecutionLocations, compatibility);
      if (!evaluated.compatible) {
        throw new AppError('CAPABILITY_MISSING', '插件与受管目标不兼容', {
          code: 'PLUGIN_INCOMPATIBLE',
          pluginVersionId: plugin.id,
          reasons: evaluated.reasons,
        });
      }
      const hasAssetOverride = hasBindingValues(validation.assetOverride);
      const inheritedSameVersion = layers.target?.pluginVersionId === plugin.id || layers.device?.pluginVersionId === plugin.id;
      const binding = hasAssetOverride || !inheritedSameVersion
        ? await this.saveBinding(services.bindings, input.tenantId, context, { ...input.value.pluginOverride, pluginVersionId: plugin.id, inputBindings: validation.assetOverride })
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
        ...managedTargetCapabilityOwnerRefs(context),
        managedTargetId: context.managedTarget.id,
        applicationAssetId: input.applicationAssetId,
        executionLocations: context.availableExecutionLocations,
        compatibility,
      });
      await services.assets.updateServiceAsset(input.tenantId, input.applicationAssetId, {
        deploymentStrategy: { type: 'MANAGED_TARGET', approvalRequired, managedTarget: { managedTargetId: context.managedTarget.id, certificateFormatId, executionMode: 'PLUGIN' } },
      });
      return { target, executionMode: 'PLUGIN', effectiveCapability: summarizeCapability(resolved) };
    });
    this.scheduleCompatibilityRecheck(input.tenantId, input.applicationAssetId);
    return result;
  }

  /**
   * 应用接入向导使用的通用默认值入口。
   * 宿主不解释插件变量，只把配方声明转换为标准 Binding；
   * 证书格式通过 format + configName 定位宿主配置，避免插件资源携带环境相关 ID。
   */
  async applyApplicationOnboardingDefaults(input: {
    tenantId: string;
    applicationAssetId: string;
    managedTargetId: string;
    metadata?: Record<string, unknown>;
    pluginVersionId: string;
    defaults: ApplicationOnboardingDeploymentDefaultsV1;
    inputBindings?: InputBindingsV1;
  }) {
    const prepared = await this.prepareApplicationOnboardingDefaults(input);
    return this.saveApplicationAssetTarget({
      tenantId: input.tenantId,
      applicationAssetId: input.applicationAssetId,
      value: {
        managedTargetId: input.managedTargetId,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        capabilityKey: input.defaults.capabilityKey,
        ...(prepared.certificateFormatId ? { certificateFormatId: prepared.certificateFormatId } : {}),
        pluginOverride: {
          pluginVersionId: input.pluginVersionId,
          inputBindings: prepared.inputBindings,
        },
      },
    });
  }

  /** 中文说明：事务提交后异步刷新兼容性，不能把事务客户端交给后台任务。 */
  private scheduleCompatibilityRecheck(tenantId: string, applicationAssetId: string): void {
    void new ApplicationExecutionCompatibilityService(this.db)
      .recheckApplication(tenantId, applicationAssetId)
      .catch((error: unknown) => {
        structuredLogger.warn('应用执行兼容性异步重检失败', {
          tenantId,
          applicationAssetId,
          error: error instanceof Error ? error.message : String(error),
        }, { module: 'managed-target-plugin-query' });
      });
  }

  async projectApplicationOnboardingDefaults(input: {
    tenantId: string;
    managedTargetId: string;
    pluginVersionId: string;
    defaults: ApplicationOnboardingDeploymentDefaultsV1;
    applicationAsset: {
      id: string;
      address: string;
      sniName?: string;
      verifyUrl?: string;
      port: number;
      protocol: string;
      displayName?: string;
    };
    inputBindings?: InputBindingsV1;
  }): Promise<DeploymentInputProjectionV1> {
    const prepared = await this.prepareApplicationOnboardingDefaults(input);
    return this.projectApplicationAssetPluginInputs({
      tenantId: input.tenantId,
      managedTargetId: input.managedTargetId,
      capabilityKey: input.defaults.capabilityKey,
      pluginVersionId: input.pluginVersionId,
      ...(prepared.certificateFormatId ? { certificateFormatId: prepared.certificateFormatId } : {}),
      applicationAsset: input.applicationAsset,
      inputBindings: prepared.inputBindings,
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
      verifyUrl?: string;
      port: number;
      protocol: string;
      displayName?: string;
    };
    inputBindings?: InputBindingsV1;
  }): Promise<DeploymentInputProjectionV1> {
    const services = this.createServices(this.db);
    const context = await services.contexts.resolve(input.tenantId, input.managedTargetId);
    const certificateBinding = await findManagedTargetCertificateBinding(services.certificateBindings, input.tenantId, context.managedTarget.id);
    const capabilityKey = input.capabilityKey ?? 'certificate.deploy';
    this.assertTargetCapability(context, capabilityKey);
    const compatibility = await this.createCompatibilityContext(services.devices, input.tenantId, context, capabilityKey);
    const applicationAssetId = input.applicationAsset.id === 'draft' ? undefined : input.applicationAsset.id;
    const capability = input.pluginVersionId
      ? undefined
      : await services.capabilities.resolve({
        tenantId: input.tenantId,
        capabilityKey,
        ...managedTargetCapabilityOwnerRefs(context),
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
    const contract = this.contractLoader.fromPlugin(plugin, capabilityKey);
    const deploymentDefaults = this.resolvePluginDeploymentDefaults(plugin, capabilityKey);
    const fixedArtifactFormat = hasRequiredPkcs12Output(contract);
    const preparedInput = deploymentDefaults
      ? await this.prepareApplicationOnboardingDefaults({
        tenantId: input.tenantId,
        pluginVersionId: plugin.id,
        defaults: deploymentDefaults,
        // IIS 等固定 PKCS#12 插件必须从接入配方解析 PFX，忽略旧资产提交的格式 ID。
        certificateFormatId: fixedArtifactFormat ? undefined : input.certificateFormatId,
        inputBindings: requestedInputBindings,
      })
      : {
        inputBindings: requestedInputBindings,
        ...(input.certificateFormatId?.trim() ? { certificateFormatId: input.certificateFormatId.trim() } : {}),
      };
    let preparedCertificateFormatId = preparedInput.certificateFormatId;
    if (!preparedCertificateFormatId && hasKeyStoreOutput(contract)) {
      preparedCertificateFormatId = await this.resolveKeyStoreCertificateFormatId(input.tenantId, certificateBinding, context);
    }
    const artifacts = fixedArtifactFormat && preparedCertificateFormatId
      ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, preparedCertificateFormatId)
      : Object.keys(preparedInput.inputBindings.artifacts).length > 0
      ? preparedInput.inputBindings.artifacts
      : preparedCertificateFormatId
        ? buildPluginCertificateArtifactBindings(plugin, capabilityKey, preparedCertificateFormatId)
        : {};
    const candidates = await services.bindings.listAssignmentCandidates(input.tenantId, capabilityKey, {
      ...managedTargetOwnerRefs(context),
      managedTargetId: context.managedTarget.id,
      ...(applicationAssetId ? { applicationAssetId } : {}),
    });
    const layers = await this.loadBindingLayers(services.bindings, input.tenantId, candidates, plugin.id, contract);
    const validation = this.bindingSaves.validate({
      pluginVersionId: plugin.id,
      contract,
      assetContext: deploymentAssetContextBuilder.build({
        applicationAsset: input.applicationAsset,
        managedTargetContext: context,
        certificateBinding,
      }),
      resourceOwnerDefault: layers.owner,
      deviceDefault: layers.device,
      targetOverride: layers.target,
      currentAssetOverride: layers.asset,
      submitted: { ...preparedInput.inputBindings, artifacts },
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
    if (!input.pluginVersionId) throw new AppError('APPLICATION_CURRENT_PLUGIN_UNAVAILABLE', '应用当前插件版本未解析');
    const managedContext = managedTargetBindingContext(context);
    if (input.pluginBindingId) {
      const current = await bindings.getTenantBinding(tenantId, input.pluginBindingId);
      if (current.pluginVersionId !== input.pluginVersionId) {
        // 插件版本是不可变执行边界。切换版本必须创建新的 Binding，旧 Binding 保留供历史执行和审计使用。
        return bindings.createBinding(tenantId, {
          pluginVersionId: input.pluginVersionId,
          mode: 'MANAGED',
          inputBindings: input.inputBindings ?? emptyInputBindingsV1(),
          managedContext,
        });
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
    pluginVersionId?: string,
    contract?: DeploymentInputContractV1,
  ) {
    const layers: { owner?: { pluginVersionId: string; inputBindings: InputBindingsV1 }; device?: { pluginVersionId: string; inputBindings: InputBindingsV1 }; target?: { pluginVersionId: string; inputBindings: InputBindingsV1 }; asset?: { pluginVersionId: string; inputBindings: InputBindingsV1 } } = {};
    for (const assignment of assignments) {
      const binding = await bindings.getTenantBinding(tenantId, assignment.pluginBindingId);
      const shouldMigrate = Boolean(
        pluginVersionId
        && contract
        && assignment.ownerType !== 'APPLICATION_ASSET'
        && assignment.pluginVersionId !== pluginVersionId,
      );
      const layer = {
        pluginVersionId: assignment.ownerType === 'APPLICATION_ASSET'
          ? assignment.pluginVersionId
          : pluginVersionId ?? assignment.pluginVersionId,
        inputBindings: shouldMigrate
          ? migrateInputBindingsToContract(contract!, binding.inputBindings)
          : binding.inputBindings,
      };
      if (assignment.ownerType === 'CLOUD_ACCOUNT_ASSET') layers.owner = layer;
      else if (assignment.ownerType === 'DEVICE') layers.device = layer;
      else if (assignment.ownerType === 'MANAGED_TARGET') layers.target = layer;
      else layers.asset = layer;
    }
    return layers;
  }

  private async prepareApplicationOnboardingDefaults(input: {
    tenantId: string;
    pluginVersionId: string;
    defaults: ApplicationOnboardingDeploymentDefaultsV1;
    certificateFormatId?: string;
    inputBindings?: InputBindingsV1;
  }): Promise<{ inputBindings: InputBindingsV1; certificateFormatId?: string }> {
    const inputBindings = emptyInputBindingsV1();
    inputBindings.variables = structuredClone(input.defaults.variables ?? {});
    inputBindings.connections = structuredClone(input.defaults.connections ?? {}) as never;
    inputBindings.credentials = structuredClone(input.defaults.credentials ?? {});
    mergeInputBindings(inputBindings, input.inputBindings);
    const submittedCertificateFormatId = Object.values(input.inputBindings?.artifacts ?? {})
      .map((binding) => binding.certificateFormatId?.trim())
      .find((value): value is string => Boolean(value));
    const certificateFormatId = input.certificateFormatId?.trim()
      ?? (input.defaults.certificateFormat
        ? await this.resolveCertificateFormatId(input.tenantId, input.defaults.certificateFormat)
        : undefined)
      ?? submittedCertificateFormatId;
    return { inputBindings, ...(certificateFormatId ? { certificateFormatId } : {}) };
  }

  private resolvePluginDeploymentDefaults(
    plugin: UnifiedPluginVersionRecord,
    capabilityKey: string,
  ): ApplicationOnboardingDeploymentDefaultsV1 | undefined {
    const recipes = this.onboardingRecipes.loadOptional(plugin);
    return recipes?.find((item) => item.recipe.deploymentDefaults?.capabilityKey === capabilityKey)?.recipe.deploymentDefaults;
  }

  private async createCompatibilityContext(
    devices: PgDevicesRepository,
    tenantId: string,
    context: ResolvedManagedTargetContext,
    capabilityKey: string,
  ): Promise<Omit<PluginCompatibilityContext, 'executionLocation'>> {
    this.assertTargetCapability(context, capabilityKey);
    const device = context.host ? await devices.get(tenantId, context.host.id) : undefined;
    return {
      productFamily: context.deviceAsset?.deviceFamily
        ?? context.cloudAccountAsset?.providerKey
        ?? (context.host ? canonicalProductFamilyForOsType(context.host.osType) : undefined)
        ?? device?.productFamily,
      frameworkType: context.frameworkType,
      targetType: context.managedTarget.targetType,
      managementMethod: context.cloudAccountAsset ? 'PLUGIN' : normalizeManagementMethod(device?.managementMethod ?? context.host?.managementMode),
      artifactContract: this.capabilityRegistry.require(capabilityKey).actionContractId,
      productVersion: context.deviceAsset?.softwareVersion ?? device?.softwareVersion,
      hostVersion: GCAC_VERSION,
      hostFeatures: readStringArray(context.deviceAsset?.capabilityProfile.hostFeatures)
        ?? process.env.GCAC_HOST_FEATURES?.split(',').map((item) => item.trim()).filter(Boolean),
      runtimeVersions: {
        ...(context.agent?.descriptor.version ? { AGENT: context.agent.descriptor.version } : {}),
        ...(readStringValue(context.deviceAsset?.capabilityProfile.gatewayVersion) ? { GATEWAY: readStringValue(context.deviceAsset?.capabilityProfile.gatewayVersion) } : {}),
      },
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
      certificateBindings: new PgBindingsRepository(assets, db),
    };
  }

  private async resolveCertificateFormatId(
    tenantId: string,
    selector: NonNullable<ApplicationOnboardingDeploymentDefaultsV1['certificateFormat']>,
  ): Promise<string> {
    const format = selector.format.toLowerCase();
    if (!(certificateFormats as readonly string[]).includes(format)) {
      throw new AppError('VALIDATION_FAILED', '应用接入默认值引用了不支持的证书格式', {
        code: 'ONBOARDING_DEFAULT_CERTIFICATE_FORMAT_INVALID',
        format: selector.format,
      });
    }
    const repository = new PgCertificatesRepository(this.db);
    const query = { page: 1, pageSize: 5000, filter: {} };
    const tenantFormats = (await repository.listFormats(query, tenantId)).items;
    const globalFormats = (await repository.listFormats(query)).items.filter((item) => !item.tenantId);
    const selected = [...tenantFormats, ...globalFormats].find((item) => !item.certificateVersionId
      && item.format === format
      && item.parameters?.configName === selector.configName);
    if (!selected) {
      throw new AppError('RESOURCE_NOT_FOUND', '应用接入默认值引用的证书格式配置不存在', {
        code: 'ONBOARDING_DEFAULT_CERTIFICATE_FORMAT_NOT_FOUND',
        format,
        configName: selector.configName,
      });
    }
    return selected.id;
  }

  private async resolveKeyStoreCertificateFormatId(
    tenantId: string,
    certificateBinding: CertificateBindingDto | undefined,
    context: ResolvedManagedTargetContext,
  ): Promise<string> {
    const location = readCertificateLocation(context.managedTarget.metadata, context.managedTarget.updatedAt);
    const keystoreType = certificateBinding?.keystoreType ?? location?.keystoreType;
    const normalizedType = keystoreType?.trim().toUpperCase();
    const selector = normalizedType === 'JKS'
      ? { format: 'jks', configName: '宿主默认 JKS 容器' }
      : normalizedType === 'PKCS12'
        ? { format: 'pfx', configName: '宿主默认 PFX 容器' }
        : undefined;
    if (!selector) {
      throw new AppError('VALIDATION_FAILED', 'KeyStore 类型缺失或不受支持，无法自动绑定证书产物', {
        code: 'KEYSTORE_TYPE_REQUIRED',
        keystoreType,
      });
    }
    return this.resolveCertificateFormatId(tenantId, selector);
  }
}

export async function findManagedTargetCertificateBinding(
  repository: PgBindingsRepository,
  tenantId: string,
  managedTargetId: string,
): Promise<CertificateBindingDto | undefined> {
  const page = await repository.listCertificateBindings(tenantId, { page: 1, pageSize: 5000, filter: {} });
  return page.items
    .filter((binding) => binding.managedTargetId === managedTargetId)
    .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))[0];
}

function toTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasBindingValues(bindings: InputBindingsV1): boolean {
  return Object.keys(bindings.variables).length > 0
    || Object.keys(bindings.connections).length > 0
    || Object.keys(bindings.credentials).length > 0
    || Object.keys(bindings.artifacts).length > 0;
}

function hasRequiredPkcs12Output(contract: DeploymentInputContractV1): boolean {
  return Object.values(contract.artifacts).some((definition) => Object.values(definition.artifactContract?.outputs ?? {})
    .some((output) => output.required !== false && String(output.role ?? '').trim().toLowerCase() === 'pkcs12_bundle'));
}

function hasKeyStoreOutput(contract: DeploymentInputContractV1 | undefined): boolean {
  if (!contract) return false;
  return Object.values(contract.artifacts).some((definition) => Object.values(definition.artifactContract?.outputs ?? {})
    .some((output) => String(output.role ?? '').trim().toLowerCase() === 'keystore'));
}

function mergeInputBindings(target: InputBindingsV1, patch?: InputBindingsV1): void {
  if (!patch) return;
  Object.assign(target.variables, structuredClone(patch.variables));
  Object.assign(target.credentials, structuredClone(patch.credentials));
  Object.assign(target.artifacts, structuredClone(patch.artifacts));
  for (const [slot, connection] of Object.entries(patch.connections)) {
    target.connections[slot] = mergeConnectionBinding(target.connections[slot] ?? {}, connection);
  }
}

function mergeConnectionBinding(
  base: InputBindingsV1['connections'][string],
  override: InputBindingsV1['connections'][string],
): InputBindingsV1['connections'][string] {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = (merged as Record<string, unknown>)[key];
      (merged as Record<string, unknown>)[key] = {
        ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
        ...structuredClone(value),
      };
    } else {
      (merged as Record<string, unknown>)[key] = structuredClone(value);
    }
  }
  return merged;
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
    evaluation: evaluatePluginCompatibility(plugin.manifest, { ...context, executionLocation }, capability),
  }));
  const compatibleLocations = evaluations.filter((item) => item.evaluation.compatible).map((item) => item.executionLocation);
  const compatibilityStatus = evaluations.some((item) => item.evaluation.status === 'COMPATIBLE')
    ? 'COMPATIBLE'
    : evaluations.some((item) => item.evaluation.status === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'INCOMPATIBLE';
  if (candidateLocations.length > 0 && compatibleLocations.length === 0) {
    reasons.push(...evaluations.flatMap((item) => item.evaluation.reasons));
  }
  return {
    pluginVersionId: plugin.id,
    pluginId: plugin.pluginId,
    version: plugin.version,
    runtime: plugin.runtime,
    packageSha256: plugin.packageSha256,
    manifestSha256: plugin.manifestSha256,
    resourceSha256: plugin.resourceSha256,
    displayNameKey: plugin.manifest.displayNameKey,
    displayName,
    compatible: reasons.length === 0 && compatibleLocations.length > 0,
    compatibilityStatus,
    compatibility: evaluations.find((item) => item.evaluation.compatible)?.evaluation ?? evaluations[0]?.evaluation,
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

async function hasPublishedWorkflowBinding(
  plugin: UnifiedPluginVersionRecord,
  capabilityKey: string,
  bindings: PluginWorkflowBindingsRepository,
): Promise<boolean> {
  const workflowPath = plugin.manifest.resources.workflows?.[capabilityKey];
  if (!workflowPath || typeof plugin.resources[workflowPath] !== 'string') return false;
  return (await bindings.find(plugin.id, capabilityKey, capabilityKey)) !== undefined;
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
      packageSha256: resolved.plugin.packageSha256,
      manifestSha256: resolved.plugin.manifestSha256,
      resourceSha256: resolved.plugin.resourceSha256,
    },
    binding: {
      pluginBindingId: resolved.binding.id,
      pluginVersionId: resolved.binding.pluginVersionId,
      hostId: resolved.binding.managedContext?.hostId,
      serviceAssetId: resolved.binding.managedContext?.serviceAssetId,
      cloudAccountAssetId: resolved.binding.managedContext?.cloudAccountAssetId,
      managedTargetId: resolved.binding.managedContext?.managedTargetId,
      status: resolved.binding.status,
      version: resolved.binding.version,
    },
    executionLocation: resolved.executionLocation,
    compatible: resolved.compatibility.compatible,
    compatibilityStatus: resolved.compatibility.status ?? (resolved.compatibility.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE'),
    compatibilityInputs: resolved.compatibility.inputs,
    reasons: resolved.compatibility.reasons,
  };
}

function normalizeManagementMethod(value: string | undefined): 'AGENT' | 'PLUGIN' | 'MANUAL' {
  const normalized = value?.toUpperCase();
  if (normalized?.includes('AGENT')) return 'AGENT';
  if (normalized?.includes('PLUGIN') || normalized?.includes('API')) return 'PLUGIN';
  return 'MANUAL';
}

function managedTargetCapabilityOwnerRefs(context: ResolvedManagedTargetContext): { hostId?: string; cloudAccountAssetId?: string; applicationAssetId?: string } {
  if (context.serviceAsset) return { applicationAssetId: context.serviceAsset.id };
  if (context.cloudAccountAsset) return { cloudAccountAssetId: context.cloudAccountAsset.id };
  if (context.host) return { hostId: context.host.id };
  throw new AppError('VALIDATION_FAILED', '受管目标没有可解析的资源所有者', {
    code: 'MANAGED_TARGET_OWNER_UNAVAILABLE',
    managedTargetId: context.managedTarget.id,
  });
}

function managedTargetOwnerRefs(context: ResolvedManagedTargetContext): { deviceId?: string; cloudAccountAssetId?: string; applicationAssetId?: string } {
  if (context.serviceAsset) return { applicationAssetId: context.serviceAsset.id };
  if (context.cloudAccountAsset) return { cloudAccountAssetId: context.cloudAccountAsset.id };
  if (context.host) return { deviceId: context.host.id };
  throw new AppError('VALIDATION_FAILED', '受管目标没有可解析的资源所有者', {
    code: 'MANAGED_TARGET_OWNER_UNAVAILABLE',
    managedTargetId: context.managedTarget.id,
  });
}

function managedTargetBindingContext(context: ResolvedManagedTargetContext): NonNullable<PluginBindingV1['managedContext']> {
  if (context.serviceAsset) return { serviceAssetId: context.serviceAsset.id, managedTargetId: context.managedTarget.id };
  if (context.cloudAccountAsset) return { cloudAccountAssetId: context.cloudAccountAsset.id, managedTargetId: context.managedTarget.id };
  if (context.host) return { hostId: context.host.id, managedTargetId: context.managedTarget.id };
  throw new AppError('VALIDATION_FAILED', '受管目标没有可解析的资源所有者', {
    code: 'MANAGED_TARGET_OWNER_UNAVAILABLE',
    managedTargetId: context.managedTarget.id,
  });
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
  return result.length > 0 ? result : undefined;
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
