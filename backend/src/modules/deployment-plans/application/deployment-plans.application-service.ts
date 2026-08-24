import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService, type WriteAuditInput } from '../../audits/audit.service.js';
import { ApprovalService } from '../../approvals/approval.service.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, RiskLevel } from '../../../shared/security-types.js';
import { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionRunDto, ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { CreateDeploymentPlanFromApplicationAssetInput, CreateDeploymentPlanInput, DeploymentGatewayRouteDto, DeploymentPlanDryRunCheckDto, DeploymentPlanDto, DeploymentPlanTargetDto, ExecuteDeploymentPlanInput, CancelDeploymentPlanInput, SubmitDeploymentPlanInput, DryRunDeploymentPlanInput, ReevaluateDeploymentPlanCapabilitiesInput, UpdateDeploymentPlanFromApplicationAssetInput } from '../dto/deployment-plans.dto.js';
import { DeploymentPlansDomainService } from '../domain/deployment-plans.domain-service.js';
import { DeploymentPlansRepository } from '../repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../schema/deployment-plans.schema.js';
import { GatewaysApplicationService } from '../../gateways/application/gateways.application-service.js';
import type { GatewayAdapterType, GatewayCandidate, ZoneRouteResult } from '../../gateway-agents/index.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import { PgBindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import type { ManagedTargetDto, ServiceAssetDto, SiteAssetDto } from '../../assets/dto/assets.dto.js';
import { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import { PgCertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { CertificateAssetEntity, CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { AgentsRepository } from '../../agents/repository/agents.repository.js';
import { PgAgentsRepository } from '../../agents/repository/agents.repository.js';
import { DeployableArtifactResolver } from './deployable-artifact-resolver.js';
import { DeploymentStrategyResolver } from './deployment-strategy-resolver.js';
import type { DeploymentArtifactSnapshotDto } from '../../executions/dto/executions.dto.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowDeploymentStrategyDto } from '../../assets/dto/assets.dto.js';
import { ManagedTargetContextResolver } from '../../assets/application/managed-target-context.resolver.js';
import type { DeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { DeploymentCapabilityResolver, type UnifiedPluginVersionReader } from '../../plugins/application/deployment-capability.resolver.js';
import { createDefaultPluginRuntimeAdapterRegistry, type PluginRuntimeAdapterRegistry } from './plugin-runtime-adapter.registry.js';
import { enrichWorkflowCertificateMaterial } from '../../certificates/artifacts/workflow-certificate-material.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import { RuntimeCredentialResolver } from '../../credentials/application/runtime-credential-resolver.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import type { SecretService } from '../../secrets/secret.service.js';
import {
  getDeploymentStrategyPluginBindingId,
  validateDeploymentStrategyPluginBinding,
} from '../../assets/application/deployment-strategy.service.js';

type ResolvedCreateTarget = CreateDeploymentPlanInput['targets'][number] & {
  certificateBindingId?: string;
  binding?: CertificateBindingDto;
  managedTarget?: ManagedTargetDto;
  siteAsset?: SiteAssetDto;
  strategyPayload?: Record<string, unknown>;
};

interface ResolvedCreatePlanInput {
  certificateVersionId: string;
  certificateFormatId?: string;
  selectionMode: 'EXPLICIT' | 'LATEST_AUTO';
  targets: ResolvedCreateTarget[];
}

interface WorkflowCertificateArtifactBinding {
  certificateFormatId: string;
  outputBindings: Record<string, string>;
}

export interface DeploymentPlansApplicationDependencies {
  repository?: DeploymentPlansRepository;
  executions?: ExecutionsApplicationService;
  approval?: ApprovalService;
  audit?: AuditService;
  domain?: DeploymentPlansDomainService;
  gateways?: GatewaysApplicationService;
  bindings?: BindingsRepository;
  assets?: AssetsRepository;
  agents?: AgentsRepository;
  certificates?: CertificatesRepository;
  certificatesApp?: CertificatesApplicationService;
  deploymentStrategyResolver?: DeploymentStrategyResolver;
  deviceAssets?: DeviceAssetsRepository;
  managedTargetContextResolver?: ManagedTargetContextResolver;
  workflows?: WorkflowTemplatesApplicationService;
  pluginBindings?: PluginBindingsApplicationService;
  unifiedPlugins?: UnifiedPluginVersionReader;
  pluginWorkflows?: PluginWorkflowPublisherService;
  credentials?: RuntimeCredentialResolver;
  secrets?: SecretService;
  database?: import('../../../database/database-port.js').DatabasePort;
  pluginRuntimeAdapters?: PluginRuntimeAdapterRegistry;
}

export class DeploymentPlansApplicationService {
  private readonly repository: DeploymentPlansRepository;
  private readonly audit: AuditService;
  private readonly approval: ApprovalService;
  private readonly domain: DeploymentPlansDomainService;
  private readonly executions: ExecutionsApplicationService;
  private readonly gateways: GatewaysApplicationService;
  private readonly bindings: BindingsRepository;
  private readonly assets: AssetsRepository;
  private readonly agents: AgentsRepository;
  private readonly certificates: CertificatesRepository;
  private readonly certificatesApp: CertificatesApplicationService;
  private readonly artifacts: DeployableArtifactResolver;
  private readonly deploymentStrategyResolver: DeploymentStrategyResolver;
  private readonly managedTargetContextResolver?: ManagedTargetContextResolver;
  private readonly workflows?: WorkflowTemplatesApplicationService;
  private readonly pluginBindings?: PluginBindingsApplicationService;
  private readonly deploymentCapabilityResolver?: DeploymentCapabilityResolver;
  private readonly pluginWorkflows?: PluginWorkflowPublisherService;
  private readonly credentials?: RuntimeCredentialResolver;
  private readonly pluginRuntimeAdapters: PluginRuntimeAdapterRegistry;

  constructor(dependencies: DeploymentPlansApplicationDependencies = {}) {
    this.repository = dependencies.repository ?? new DeploymentPlansRepository();
    this.audit = dependencies.audit ?? new AuditService();
    this.approval = dependencies.approval ?? new ApprovalService(undefined, this.audit);
    this.domain = dependencies.domain ?? new DeploymentPlansDomainService();
    this.executions = dependencies.executions ?? new ExecutionsApplicationService({ deploymentPlansRepository: this.repository, audit: this.audit });
    this.gateways = dependencies.gateways ?? new GatewaysApplicationService();
    this.assets = dependencies.assets ?? new PgAssetsRepository();
    this.bindings = dependencies.bindings ?? new PgBindingsRepository(this.assets);
    this.agents = dependencies.agents ?? new PgAgentsRepository();
    this.certificates = dependencies.certificates ?? new PgCertificatesRepository(new PgliteDatabase());
    this.certificatesApp = dependencies.certificatesApp ?? new CertificatesApplicationService({
      secrets: { resolveForService: async () => { throw new AppError('VALIDATION_FAILED', '未配置 Secrets 服务'); } } as never,
      repository: this.certificates,
    });
    this.artifacts = new DeployableArtifactResolver(this.certificates);
    this.deploymentStrategyResolver = dependencies.deploymentStrategyResolver ?? new DeploymentStrategyResolver();
    this.managedTargetContextResolver = dependencies.managedTargetContextResolver
      ?? (dependencies.deviceAssets ? new ManagedTargetContextResolver(this.assets, this.agents, dependencies.deviceAssets) : undefined);
    this.workflows = dependencies.workflows;
    this.pluginBindings = dependencies.pluginBindings;
    this.deploymentCapabilityResolver = dependencies.pluginBindings && dependencies.unifiedPlugins
      ? new DeploymentCapabilityResolver(dependencies.pluginBindings, dependencies.unifiedPlugins)
      : undefined;
    this.pluginWorkflows = dependencies.pluginWorkflows;
    this.credentials = dependencies.credentials ?? (dependencies.secrets && dependencies.database
      ? new RuntimeCredentialResolver(new CredentialsRepository(dependencies.database), dependencies.secrets)
      : undefined);
    this.pluginRuntimeAdapters = dependencies.pluginRuntimeAdapters ?? createDefaultPluginRuntimeAdapterRegistry();
  }

  getRepository(): DeploymentPlansRepository {
    return this.repository;
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.executions;
  }

  async list(input: { tenantId?: string } = {}): Promise<DeploymentPlanDto[]> {
    return Promise.all((await this.repository.listPlans(input.tenantId)).map((plan) => this.toDto(plan)));
  }

  async get(id: string, tenantId?: string): Promise<DeploymentPlanDto> {
    return this.toDto(await this.repository.getPlanOrThrow(id, tenantId));
  }

  async create(input: CreateDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    this.domain.assertCreateInput(input);
    const resolved = await this.resolveCreateInput(input);
    const normalizedInput: CreateDeploymentPlanInput = {
      ...input,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      selectionMode: resolved.selectionMode,
      targets: resolved.targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId ?? target.applicationAssetId,
        managedTargetId: target.managedTargetId ?? target.managedTarget?.id,
        siteAssetId: target.siteAssetId ?? target.siteAsset?.id,
        domain: target.domain ?? target.binding?.domainName ?? target.binding?.domain,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
        matchResult: target.matchResult,
        gatewayRoute: target.gatewayRoute,
        gatewayId: target.gatewayId,
        zoneId: target.zoneId,
        adapter: target.adapter,
        protocols: target.protocols,
        action: target.action,
        destructive: target.destructive,
        delegatedTargetId: target.delegatedTargetId,
        fallbackSuggestions: target.fallbackSuggestions,
        strategyPayload: target.strategyPayload,
      })),
    };
    const requestHash = this.domain.buildRequestHash(normalizedInput);
    const existing = await this.repository.findPlanByIdempotencyKey(input.tenantId, input.actorId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '部署计划幂等键冲突', { idempotencyKey: input.idempotencyKey });
      return this.toDto(existing);
    }

    const now = new Date().toISOString();
    const policy = this.domain.normalizePolicy(input.policy);
    const targetDrafts = await Promise.all(resolved.targets.map(async (target) => {
      const gatewayRoute = await this.normalizeGatewayRoute(target, input.tenantId, policy);
      return {
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId ?? target.applicationAssetId,
        executionTargetId: target.managedTarget?.id ?? target.managedTargetId ?? target.executionTargetId,
        executorType: this.domain.defaultExecutorType(target.executorType),
        requiredCapabilities: [...new Set<string>(target.requiredCapabilities ?? this.defaultCapabilities())],
        matchResult: this.normalizeRouteMatchResult(target.matchResult, gatewayRoute),
        gatewayRoute,
        strategyPayload: target.strategyPayload,
      };
    }));
    const hasCapabilityRisk = targetDrafts.some((target) => ['manual_required', 'degraded'].includes(String(target.matchResult?.status ?? '')));
    if (hasCapabilityRisk) {
      policy.approvalRequired = true;
      if (policy.riskLevel === 'low' || policy.riskLevel === 'medium') policy.riskLevel = 'high';
    }
    const snapshotHash = this.domain.buildSnapshotHash({
      id: newId('pln_preview'),
      tenantId: input.tenantId,
      name: input.name,
      planType: input.planType ?? 'UPDATE',
      selectionMode: resolved.selectionMode,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      idempotencyKey: input.idempotencyKey,
      policy,
      createdReason: input.createdReason ?? 'MANUAL',
      createdBy: input.actorId,
    }, targetDrafts);

    const plan = await this.repository.createPlan({
      id: newId('pln'),
      tenantId: input.tenantId,
      name: input.name,
      planType: input.planType ?? 'UPDATE',
      selectionMode: resolved.selectionMode,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      snapshotHash,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      policy,
      createdReason: input.createdReason ?? 'MANUAL',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    });
    await this.recordTransition('deploymentPlan', plan.id, undefined, 'DRAFT', 'plan.created', input.actorId, input.tenantId);

    for (const target of targetDrafts) {
      await this.repository.createTarget({
        id: newId('dpt'),
        tenantId: input.tenantId,
        deploymentPlanId: plan.id,
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
	        matchResult: target.matchResult ?? { status: 'assumed', reason: '编排层只记录能力需求，不做真实探测' },
	        gatewayRoute: target.gatewayRoute,
	        strategyPayload: target.strategyPayload,
	        status: 'READY',
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        version: 1,
      });
    }

    this.writeBackgroundAudit({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.create',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'success',
      riskLevel: this.approvalRiskLevel(policy.riskLevel),
      context,
      detail: {
        targetCount: input.targets.length,
        snapshotHash,
        selectionMode: resolved.selectionMode,
        certificateVersionId: resolved.certificateVersionId,
        certificateFormatId: resolved.certificateFormatId,
      },
    });

    return this.toDto(plan);
  }

  async createFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const draft = await this.buildCreateInputFromApplicationAsset(input);
    return this.create(draft, context);
  }

  async updateDraftFromApplicationAsset(input: UpdateDeploymentPlanFromApplicationAssetInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (plan.status === 'RUNNING') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', 'RUNNING 部署计划正在执行，不能编辑', { planId: plan.id, status: plan.status });
    }

    const draft = await this.buildCreateInputFromApplicationAsset(input);
    this.domain.assertCreateInput(draft);
    const resolved = await this.resolveCreateInput(draft);
    const normalizedInput: CreateDeploymentPlanInput = {
      ...draft,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      selectionMode: resolved.selectionMode,
      targets: resolved.targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId ?? target.applicationAssetId,
        managedTargetId: target.managedTargetId ?? target.managedTarget?.id,
        siteAssetId: target.siteAssetId ?? target.siteAsset?.id,
        domain: target.domain ?? target.binding?.domainName ?? target.binding?.domain,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
        matchResult: target.matchResult,
        gatewayRoute: target.gatewayRoute,
        gatewayId: target.gatewayId,
        zoneId: target.zoneId,
        adapter: target.adapter,
        protocols: target.protocols,
        action: target.action,
        destructive: target.destructive,
        delegatedTargetId: target.delegatedTargetId,
        fallbackSuggestions: target.fallbackSuggestions,
        strategyPayload: target.strategyPayload,
      })),
    };
    const requestHash = this.domain.buildRequestHash(normalizedInput);
    const policy = this.domain.normalizePolicy(draft.policy);
    const targetDrafts = await Promise.all(resolved.targets.map(async (target) => {
      const gatewayRoute = await this.normalizeGatewayRoute(target, draft.tenantId, policy);
      return {
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId ?? target.applicationAssetId,
        executionTargetId: target.managedTarget?.id ?? target.managedTargetId ?? target.executionTargetId,
        executorType: this.domain.defaultExecutorType(target.executorType),
        requiredCapabilities: [...new Set<string>(target.requiredCapabilities ?? this.defaultCapabilities())],
        matchResult: this.normalizeRouteMatchResult(target.matchResult, gatewayRoute),
        gatewayRoute,
        strategyPayload: target.strategyPayload,
      };
    }));
    const hasCapabilityRisk = targetDrafts.some((target) => ['manual_required', 'degraded'].includes(String(target.matchResult?.status ?? '')));
    if (hasCapabilityRisk) {
      policy.approvalRequired = true;
      if (policy.riskLevel === 'low' || policy.riskLevel === 'medium') policy.riskLevel = 'high';
    }
    const snapshotHash = this.domain.buildSnapshotHash({
      id: plan.id,
      tenantId: draft.tenantId,
      name: draft.name,
      planType: draft.planType ?? 'UPDATE',
      selectionMode: resolved.selectionMode,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      idempotencyKey: plan.idempotencyKey,
      policy,
      createdReason: plan.createdReason,
      createdBy: plan.createdBy,
    }, targetDrafts);

    const now = new Date().toISOString();
    const updated = await this.repository.updatePlan(plan.id, {
      name: draft.name,
      planType: draft.planType ?? plan.planType,
      selectionMode: resolved.selectionMode,
      certificateVersionId: resolved.certificateVersionId,
      certificateFormatId: resolved.certificateFormatId,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      approvalId: undefined,
      snapshotHash,
      requestHash,
      policy,
      updatedAt: now,
      updatedBy: draft.actorId,
    });

    await this.repository.deleteTargetsByPlan(plan.id, draft.tenantId);
    for (const target of targetDrafts) {
      await this.repository.createTarget({
        id: newId('dpt'),
        tenantId: draft.tenantId,
        deploymentPlanId: plan.id,
        certificateBindingId: target.certificateBindingId,
        applicationAssetId: target.applicationAssetId,
        serviceAssetId: target.serviceAssetId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
        matchResult: target.matchResult ?? { status: 'assumed', reason: '编排层只记录能力需求，不做真实探测' },
        gatewayRoute: target.gatewayRoute,
        strategyPayload: target.strategyPayload,
        status: 'READY',
        createdAt: now,
        updatedAt: now,
        createdBy: draft.actorId,
        version: 1,
      });
    }

    await this.recordTransition('deploymentPlan', plan.id, plan.status, 'DRAFT', 'plan.updated', draft.actorId, draft.tenantId);
    this.writeBackgroundAudit({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: draft.actorId,
      action: 'deployment_plan.update',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'success',
      riskLevel: this.approvalRiskLevel(policy.riskLevel),
      context,
      detail: {
        targetCount: draft.targets.length,
        snapshotHash,
        selectionMode: resolved.selectionMode,
        certificateVersionId: resolved.certificateVersionId,
        certificateFormatId: resolved.certificateFormatId,
      },
    });

    return this.toDto(updated);
  }

  private async buildCreateInputFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput): Promise<CreateDeploymentPlanInput> {
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const applicationAsset = await this.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
    if (!applicationAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    }
    if (applicationAsset.deploymentStrategy?.type === 'WORKFLOW') {
      const resolvedAsset = await this.validateStrategyPluginBinding(input.tenantId, applicationAsset);
      return this.buildWorkflowCreateInputFromApplicationAsset(input, resolvedAsset);
    }
    return this.buildManagedCreateInputFromApplicationAsset(input);
  }

  private async buildManagedCreateInputFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput): Promise<CreateDeploymentPlanInput> {
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const applicationAsset = await this.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
    if (!applicationAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    }
    const bindingTarget = await this.assets.getApplicationAssetTargetByApplicationAssetId(input.tenantId, input.applicationAssetId);
    if (!bindingTarget) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAssetTarget 不存在', { applicationAssetId: input.applicationAssetId });
    }
    const targetManagedTarget = await this.assets.getManagedTarget(input.tenantId, bindingTarget.managedTargetId);
    if (!targetManagedTarget) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: bindingTarget.managedTargetId });
    const targetSiteAsset = targetManagedTarget.siteId
      ? await this.assets.getSiteAsset(input.tenantId, targetManagedTarget.siteId)
      : undefined;

    const applicationAssetDetail = await this.assets.getServiceAssetDetail(input.tenantId, input.applicationAssetId);
    const candidates = this.resolveApplicationAssetBindingCandidates(
      applicationAssetDetail?.targetBindingDetail?.certificateBindings ?? [],
      input.applicationAssetId,
      targetManagedTarget,
      applicationAsset.address,
    );
    if (candidates.length !== 1) {
      throw new AppError(
        candidates.length === 0 ? 'RESOURCE_NOT_FOUND' : 'VALIDATION_FAILED',
        candidates.length === 0
          ? 'ApplicationAsset 未找到可部署的 CertificateBinding'
          : 'ApplicationAsset 命中多个 CertificateBinding，请补充更细粒度绑定关系',
        {
          tenantId: input.tenantId,
          applicationAssetId: input.applicationAssetId,
          applicationAddress: applicationAsset.address,
          managedTargetId: bindingTarget.managedTargetId,
          siteAssetId: targetManagedTarget.siteId,
          bindingKey: targetManagedTarget.bindingKey,
          bindingIds: candidates.map((item) => item.id),
          targetBindingDetailBindings: (applicationAssetDetail?.targetBindingDetail?.certificateBindings ?? []).map((item) => ({
            id: item.id,
            domain: item.domainName ?? item.domain,
            bindingKey: item.bindingKey,
            serviceAssetId: item.serviceAssetId,
            siteAssetId: item.siteAssetId,
            managedTargetId: item.managedTargetId,
          })),
        },
      );
    }

    const binding = await this.bindings.getCertificateBinding(input.tenantId, candidates[0]!.id);
    if (!binding) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId: candidates[0]!.id });
    }
    const managedTarget = binding.managedTargetId
      ? await this.assets.getManagedTarget(input.tenantId, binding.managedTargetId)
      : targetManagedTarget;
    const siteAsset = binding.siteAssetId
      ? await this.assets.getSiteAsset(input.tenantId, binding.siteAssetId)
      : targetSiteAsset;
    const selectionMode = input.selectionMode ?? (input.targetCertificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    const certificateVersionId = input.targetCertificateVersionId ?? undefined;
    const planName = `${applicationAsset.displayName ?? applicationAsset.address} 证书部署`;
    const strategyAsset = await this.validateStrategyPluginBinding(
      input.tenantId,
      applicationAssetDetail ?? applicationAsset,
    );
    const deploymentStrategy = strategyAsset.deploymentStrategy;
    const strategyType = deploymentStrategy?.type;
    const targetContext = await this.resolveManagedTargetContext(input.tenantId, managedTarget?.id ?? bindingTarget.managedTargetId);
    const readyBinding = binding;
    const certificateFormatId = input.certificateFormatId;
    const managedTargetId = deploymentStrategy?.type === 'MANAGED_TARGET'
      ? deploymentStrategy.managedTarget?.managedTargetId
      : bindingTarget.managedTargetId;
    const managedTargetContext = strategyType === 'MANAGED_TARGET'
      ? managedTargetId === targetContext.managedTarget.id
        ? targetContext
        : await this.resolveManagedTargetContext(input.tenantId, managedTargetId)
      : undefined;
    const baseStrategy = this.deploymentStrategyResolver.resolve({
      applicationAsset: strategyAsset,
      bindingTarget,
      certificateBinding: readyBinding,
      managedTargetContext,
    });
    const managedPluginStrategy = await this.compileManagedPluginRuntime(
      input.tenantId,
      strategyAsset,
      managedTargetContext,
      baseStrategy,
    );
    const identifiedStrategy = await this.attachPluginExecutionIdentity(strategyAsset, managedPluginStrategy);
    const resolvedStrategy = await this.attachWorkflowCredentialSnapshots(input.tenantId, identifiedStrategy);

    return {
      name: planName,
      certificateVersionId,
      certificateFormatId,
      selectionMode,
      targets: [{
        certificateBindingId: readyBinding.id,
        applicationAssetId: applicationAsset.id,
        serviceAssetId: applicationAsset.id,
        managedTargetId: resolvedStrategy.executionTargetId ?? bindingTarget.managedTargetId,
        siteAssetId: targetManagedTarget.siteId,
        domain: readyBinding.domainName ?? readyBinding.domain ?? applicationAsset.address,
        executionTargetId: resolvedStrategy.executionTargetId,
        executorType: resolvedStrategy.executorType as CreateDeploymentPlanInput['targets'][number]['executorType'],
        requiredCapabilities: resolvedStrategy.requiredCapabilities,
        gatewayRoute: resolvedStrategy.gatewayRoute,
        strategyPayload: resolvedStrategy.payload,
      }],
      planType: input.planType ?? 'UPDATE',
      policy: input.policy,
      createdReason: 'MANUAL',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
    };
  }

  private async validateStrategyPluginBinding(tenantId: string, asset: ServiceAssetDto): Promise<ServiceAssetDto> {
    const strategy = asset.deploymentStrategy;
    if (!strategy) return asset;
    const pluginBindingId = getDeploymentStrategyPluginBindingId(strategy);
    if (!pluginBindingId) return asset;
    if (!this.pluginBindings) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'PluginBinding 服务未接入，不能创建统一插件部署计划', {
        code: 'PLUGIN_BINDING_VALIDATOR_MISSING',
        pluginBindingId,
      });
    }
    const binding = await this.pluginBindings.getBinding(pluginBindingId);
    if (!binding || binding.tenantId !== tenantId) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署策略引用的 PluginBinding 不存在', { pluginBindingId });
    }
    const validated = validateDeploymentStrategyPluginBinding(strategy, binding);
    if (validated.type !== 'WORKFLOW' || !validated.workflow?.pluginBindingId) {
      return { ...asset, deploymentStrategy: validated };
    }
    if (!this.pluginWorkflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '插件 Workflow 发布服务未接入', { code: 'PLUGIN_WORKFLOW_RESOLVER_MISSING' });
    const workflowBinding = await this.pluginWorkflows.require(binding.pluginVersionId, 'certificate.deploy');
    const credentials = await this.snapshotCredentials(tenantId, binding.credentialBindings);
    return {
      ...asset,
      deploymentStrategy: {
        ...validated,
        workflow: {
          ...validated.workflow,
          workflowId: workflowBinding.workflowTemplateId,
          workflowVersionSelection: 'PINNED',
          workflowVersionId: workflowBinding.workflowVersionId,
          variableBindings: binding.variableBindings,
          credentials,
          connectionBindings: binding.connectionBindings as NonNullable<WorkflowDeploymentStrategyDto['connectionBindings']>,
          certificateArtifactBindings: binding.certificateArtifactBindings,
        },
      },
    };
  }

  private async attachPluginExecutionIdentity(
    asset: ServiceAssetDto,
    resolved: ReturnType<DeploymentStrategyResolver['resolve']>,
  ): Promise<ReturnType<DeploymentStrategyResolver['resolve']>> {
    const pluginBindingId = getDeploymentStrategyPluginBindingId(asset.deploymentStrategy!);
    if (!pluginBindingId || !this.pluginBindings) return resolved;
    const binding = await this.pluginBindings.getBinding(pluginBindingId);
    if (!binding) throw new AppError('RESOURCE_NOT_FOUND', '部署策略引用的 PluginBinding 不存在', { pluginBindingId });
    const workflowRequest = readRecord(resolved.payload.workflowRequest);
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        workflowRequest: workflowRequest ? {
          ...workflowRequest,
          pluginVersionId: binding.pluginVersionId,
          pluginBindingId,
          capabilityKey: 'certificate.deploy',
        } : workflowRequest,
      },
    };
  }

  private async compileManagedPluginRuntime(
    tenantId: string,
    asset: ServiceAssetDto,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>> | undefined,
    resolved: ReturnType<DeploymentStrategyResolver['resolve']>,
  ): Promise<ReturnType<DeploymentStrategyResolver['resolve']>> {
    if (asset.deploymentStrategy?.type !== 'MANAGED_TARGET' || !context) {
      return resolved;
    }
    if (!this.deploymentCapabilityResolver) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '设备插件部署编译服务未完整接入', {
        code: 'PLUGIN_DEPLOYMENT_COMPILER_MISSING',
        applicationAssetId: asset.id,
        managedTargetId: context.managedTarget.id,
      });
    }
    const capability = await this.deploymentCapabilityResolver.resolve({
      tenantId,
      capabilityKey: 'certificate.deploy',
      hostId: context.host.id,
      managedTargetId: context.managedTarget.id,
      applicationAssetId: asset.id,
      executionLocations: context.availableExecutionLocations,
      compatibility: {
        productFamily: context.deviceAsset?.deviceFamily ?? agentProductFamily(context.host.osType),
        frameworkType: context.frameworkType,
        targetType: context.managedTarget.targetType,
        managementMethod: context.agent ? 'AGENT' : context.deviceAsset ? 'PLUGIN' : 'MANUAL',
        artifactContract: 'certificate.deploy.v1',
      },
    });
    const workflow = capability.pluginRuntime === 'WORKFLOW_DSL'
      ? await this.requirePluginWorkflow(capability.pluginVersionId, capability.assignment.capabilityKey)
      : undefined;
    const credentials = workflow ? await this.snapshotCredentials(tenantId, capability.binding.credentialBindings) : {};
    const runtime = await this.pluginRuntimeAdapters.compile({
      capability,
      context,
      applicationAssetId: asset.id,
      certificateBindingId: readOptionalString(resolved.payload.certificateBindingId),
      workflow: workflow ? { workflowId: workflow.workflowTemplateId, workflowVersionId: workflow.workflowVersionId, credentials } : undefined,
    });
    return {
      ...resolved,
      executorType: runtime.executorType,
      executionTargetId: runtime.executionTargetId,
      requiredCapabilities: runtime.requiredCapabilities,
      gatewayRoute: runtime.gatewayRoute,
      payload: {
        ...resolved.payload,
        ...runtime.payload,
      },
    };
  }

  private requirePluginWorkflow(pluginVersionId: string, capabilityKey: string) {
    if (!this.pluginWorkflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '插件 Workflow 发布服务未接入', { code: 'PLUGIN_WORKFLOW_RESOLVER_MISSING' });
    return this.pluginWorkflows.require(pluginVersionId, capabilityKey);
  }

  private async snapshotCredentials(tenantId: string, bindings: Record<string, { credentialId: string }>) {
    if (Object.keys(bindings).length === 0) return {};
    if (!this.credentials) throw new AppError('SYSTEM_INTERNAL_ERROR', '部署计划凭据快照服务未接入');
    return this.credentials.resolveBindingsForPlan(tenantId, bindings);
  }

  private async attachWorkflowCredentialSnapshots(
    tenantId: string,
    resolved: ReturnType<DeploymentStrategyResolver['resolve']>,
  ): Promise<ReturnType<DeploymentStrategyResolver['resolve']>> {
    const workflowRequest = readRecord(resolved.payload.workflowRequest);
    if (!workflowRequest) return resolved;
    const credentialBindings = readCredentialBindings(workflowRequest.credentialBindings);
    if (Object.keys(credentialBindings).length === 0) return resolved;
    const { credentialBindings: _credentialBindings, ...requestWithoutBindings } = workflowRequest;
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        workflowRequest: {
          ...requestWithoutBindings,
          credentials: await this.snapshotCredentials(tenantId, credentialBindings),
        },
      },
    };
  }

  private async resolveManagedTargetContext(tenantId: string, managedTargetId?: string) {
    if (!managedTargetId) {
      throw new AppError('VALIDATION_FAILED', 'MANAGED_TARGET 策略缺少 managedTargetId', {
        code: 'MANAGED_TARGET_ID_REQUIRED',
      });
    }
    if (!this.managedTargetContextResolver) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '受管目标上下文解析器未接入', {
        code: 'MANAGED_TARGET_CONTEXT_RESOLVER_MISSING',
        managedTargetId,
      });
    }
    return this.managedTargetContextResolver.resolve(tenantId, managedTargetId);
  }

  private async buildWorkflowCreateInputFromApplicationAsset(
    input: CreateDeploymentPlanFromApplicationAssetInput,
    applicationAsset: ServiceAssetDto,
  ): Promise<CreateDeploymentPlanInput> {
    const strategy = applicationAsset.deploymentStrategy;
    const workflow = strategy?.workflow;
    if (strategy?.type !== 'WORKFLOW' || !workflow) {
      throw new AppError('VALIDATION_FAILED', '应用资产不是 WORKFLOW 部署策略', { applicationAssetId: applicationAsset.id });
    }
    if (!workflow.workflowId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少 workflowId', {
        code: 'DEPLOYMENT_STRATEGY_INVALID',
        applicationAssetId: applicationAsset.id,
      });
    }
    const certificateArtifactBindings = readWorkflowCertificateArtifactBindings(workflow.certificateArtifactBindings);
    if (Object.keys(certificateArtifactBindings).length === 0) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少证书产物绑定', {
        code: 'DEPLOYMENT_STRATEGY_INVALID',
        applicationAssetId: applicationAsset.id,
      });
    }
    const baseStrategy = this.deploymentStrategyResolver.resolve({
      applicationAsset,
    });
    const identifiedStrategy = await this.attachPluginExecutionIdentity(applicationAsset, baseStrategy);
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const resolvedStrategy = await this.attachWorkflowCredentialSnapshots(input.tenantId, identifiedStrategy);
    const selectionMode = input.selectionMode ?? (input.targetCertificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    const planName = `${applicationAsset.displayName ?? applicationAsset.address} 证书部署`;
    return {
      name: planName,
      certificateVersionId: input.targetCertificateVersionId,
      selectionMode,
      targets: [{
        applicationAssetId: applicationAsset.id,
        serviceAssetId: applicationAsset.id,
        domain: applicationAsset.address,
        executionTargetId: resolvedStrategy.executionTargetId ?? applicationAsset.id,
        executorType: resolvedStrategy.executorType as CreateDeploymentPlanInput['targets'][number]['executorType'],
        requiredCapabilities: resolvedStrategy.requiredCapabilities,
        gatewayRoute: resolvedStrategy.gatewayRoute,
        strategyPayload: resolvedStrategy.payload,
      }],
      planType: input.planType ?? 'UPDATE',
      policy: input.policy,
      createdReason: 'MANUAL',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
    };
  }

  private resolveApplicationAssetBindingCandidates(
    items: Array<Pick<CertificateBindingDto, 'id' | 'serviceAssetId' | 'siteAssetId' | 'managedTargetId' | 'bindingKey' | 'domainName' | 'domain'>>,
    applicationAssetId: string,
    bindingTarget: Pick<ManagedTargetDto, 'id' | 'siteId' | 'bindingKey'>,
    applicationAddress?: string,
  ): Array<Pick<CertificateBindingDto, 'id' | 'serviceAssetId' | 'siteAssetId' | 'managedTargetId' | 'bindingKey' | 'domainName' | 'domain'>> {
    const explicit = items.filter((item) => item.serviceAssetId === applicationAssetId);
    if (explicit.length > 0) return explicit;

    const normalizedAddress = this.normalizeCompareValue(applicationAddress);
    const normalizedBindingKey = this.normalizeCompareValue(bindingTarget.bindingKey);

    const matched = items.filter((item) => {
      if (item.managedTargetId !== bindingTarget.id) return false;
      if (item.siteAssetId !== bindingTarget.siteId) return false;

      const itemBindingKey = this.normalizeCompareValue(item.bindingKey);
      const itemDomain = this.normalizeCompareValue(item.domainName ?? item.domain);

      if (normalizedBindingKey && itemBindingKey === normalizedBindingKey) return true;
      if (normalizedAddress && itemDomain === normalizedAddress) return true;
      return !normalizedBindingKey && !normalizedAddress;
    });

    return matched;
  }

  private normalizeCompareValue(value: string | undefined): string {
    return String(value ?? '').trim().toLowerCase();
  }

  async submit(input: SubmitDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (plan.status === 'READY') return this.toDto(plan);

    if (plan.status === 'PENDING_APPROVAL') {
      if (!input.approvalId) return this.toDto(plan);
      await this.approval.consume(input.approvalId, this.approvalParameters(plan));
      const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
      return this.toDto(ready);
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DRAFT 或 PENDING_APPROVAL 计划允许提交', { planId: plan.id, status: plan.status });
    }

    if (this.requiresApproval(plan)) {
      if (input.approvalId) {
        await this.approval.consume(input.approvalId, this.approvalParameters(plan));
        const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
        return this.toDto(ready);
      }
      const approval = await this.approval.create({
        operationType: 'deployment.execute',
        resourceRefs: [{ type: 'deploymentPlan', id: plan.id }],
        riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
        parameters: this.approvalParameters(plan),
        requestedBy: input.actorId,
      }, context);
      const pending = await this.transitionPlan(plan, 'PENDING_APPROVAL', input.actorId, 'approval.requested', { approvalStatus: 'PENDING', approvalId: approval.id });
      await this.audit.write({
        eventType: AUDIT_EVENT_TYPES.APPROVAL_CREATED,
        actorType: 'user',
        actorId: input.actorId,
        action: 'deployment_plan.submit',
        resourceType: 'deploymentPlan',
        resourceId: plan.id,
        result: 'success',
        riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
        context,
        detail: { approvalId: approval.id },
      });
      return this.toDto(pending);
    }

    const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'plan.ready', { approvalStatus: 'NOT_REQUIRED' });
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.submit',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'success',
      riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
      context,
      detail: { status: 'READY' },
    });
    return this.toDto(ready);
  }

  async execute(input: ExecuteDeploymentPlanInput, context: RequestContext = {}): Promise<{ plan: DeploymentPlanDto; run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    let plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (this.requiresApproval(plan)) {
      const approvalId = input.approvalId ?? plan.approvalId;
      if (!approvalId) {
        await this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'missing approval');
        throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '高风险部署执行必须提供已批准审批单', { planId: plan.id });
      }
      try {
        await this.approval.consume(approvalId, this.approvalParameters(plan));
      } catch (error) {
        await this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'approval invalid');
        throw error;
      }
      if (plan.status === 'DRAFT' || plan.status === 'PENDING_APPROVAL') {
        plan = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId });
      }
    }

    if (!['READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 READY 或已结束的计划允许执行/重新执行', { planId: plan.id, status: plan.status });
    }
    const originalCertificateVersionId = plan.certificateVersionId;
    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可执行目标', { planId: plan.id });
    const effective = await this.resolveEffectivePlanMaterial(plan, targets, input.actorId);
    plan = effective.plan;
    if (effective.certificateVersionId !== originalCertificateVersionId) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '自动选择最新证书时，当前最新版本已变化，必须先重新执行一次 Dry-run 影响预览', {
        planId: plan.id,
        previousCertificateVersionId: originalCertificateVersionId,
        currentCertificateVersionId: effective.certificateVersionId,
      });
    }
    await this.assertLatestDryRunPassed(plan, input.tenantId);
    const running = await this.transitionPlan(plan, 'RUNNING', input.actorId, 'execution.started');
    const deploymentArtifactByTargetId = await this.buildDeploymentArtifactByTargetIds(plan, targets, effective.certificateVersionId);
    const created = await this.executions.createApplyRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      deploymentArtifactByTargetId,
      agentPayloadByTargetId: await this.buildAgentPayloadByTargetIds(plan, targets, deploymentArtifactByTargetId, effective.certificateVersionId),
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    return { plan: await this.toDto(running), ...created };
  }

  async dryRun(input: DryRunDeploymentPlanInput, context: RequestContext = {}): Promise<{ plan: DeploymentPlanDto; run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    let plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未运行或已结束的计划允许 dry-run', { planId: plan.id, status: plan.status });
    }

    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可 dry-run 目标', { planId: plan.id });
    const effective = await this.resolveEffectivePlanMaterial(plan, targets, input.actorId);
    plan = effective.plan;
    const deploymentArtifactByTargetId = await this.buildDeploymentArtifactByTargetIds(plan, targets, effective.certificateVersionId);
    const agentPayloadByTargetId = await this.buildAgentPayloadByTargetIds(plan, targets, deploymentArtifactByTargetId, effective.certificateVersionId);
    const created = await this.executions.createDryRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'dry_run',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      deploymentArtifactByTargetId,
      agentPayloadByTargetId,
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);
    const stepsWithInitialChecks = await this.attachInitialDryRunChecks(created.steps, targets, deploymentArtifactByTargetId, agentPayloadByTargetId, input.actorId, input.tenantId);
    return { plan: await this.toDto(plan), ...created, steps: stepsWithInitialChecks };
  }

  async cancel(input: CancelDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    for (const run of await this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id })) {
      if (['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
        await this.executions.cancelRun(run.id, input.actorId, input.tenantId);
      }
    }
    const cancelled = await this.transitionPlan(plan, 'CANCELLED', input.actorId, 'plan.cancelled');
    this.writeBackgroundAudit({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.cancel',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'success',
      riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
      context,
      detail: { reason: input.reason },
    });
    return this.toDto(cancelled);
  }

  async deleteDraft(input: CancelDeploymentPlanInput, _context: RequestContext = {}): Promise<{ deleted: true; planId: string; deletedRuns: number; deletedSteps: number; deletedTargets: number; deletedTransitions: number; deletedApprovals: number; deletedAudits: number }> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    const targets = await this.repository.listTargetsByPlan(plan.id, input.tenantId);
    const { runIds, stepIds } = await this.executions.getRepository().deleteRunsByDeploymentPlan(input.tenantId, plan.id);
    const targetIds = targets.map((target) => target.id);
    const deletedTransitions = await this.repository.deleteTransitionsByEntityIds([plan.id, ...targetIds, ...runIds, ...stepIds], input.tenantId);
    const approvalIds = await this.approval.deleteByDeploymentPlan(plan.id, plan.approvalId);
    const deletedAudits = await this.audit.deleteByResources([
      { resourceType: 'deploymentPlan', resourceId: plan.id },
      ...targetIds.map((resourceId) => ({ resourceType: 'deploymentPlanTarget', resourceId })),
      ...runIds.map((resourceId) => ({ resourceType: 'executionRun', resourceId })),
      ...stepIds.map((resourceId) => ({ resourceType: 'executionStep', resourceId })),
      ...approvalIds.map((resourceId) => ({ resourceType: 'approval', resourceId })),
    ]);

    await this.repository.deleteTargetsByPlan(plan.id, input.tenantId);
    await this.repository.deletePlan(plan.id);
    return {
      deleted: true,
      planId: plan.id,
      deletedRuns: runIds.length,
      deletedSteps: stepIds.length,
      deletedTargets: targets.length,
      deletedTransitions,
      deletedApprovals: approvalIds.length,
      deletedAudits,
    };
  }

  async reevaluateCapabilities(input: ReevaluateDeploymentPlanCapabilitiesInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未正式执行的计划允许重算能力匹配', { planId: plan.id, status: plan.status });
    }
    const targets = new Map((await this.repository.listTargetsByPlan(plan.id, input.tenantId)).map((target) => [target.id, target]));
    let blockedCount = 0;
    let approvalRequired = false;
    for (const result of input.targetResults) {
      const target = targets.get(result.targetId);
      if (!target) throw new AppError('RESOURCE_NOT_FOUND', '部署计划目标不存在', { targetId: result.targetId });
      const status = String(result.matchResult.status ?? '');
      if (status === 'blocked') blockedCount += 1;
      if (status === 'manual_required' || status === 'degraded') approvalRequired = true;
      await this.repository.updateTarget(target.id, {
        matchResult: result.matchResult,
        status: status === 'blocked' ? 'FAILED' : 'READY',
        updatedAt: new Date().toISOString(),
        updatedBy: input.actorId,
      });
    }
    const patch: Partial<DeploymentPlanEntity> = { updatedAt: new Date().toISOString(), updatedBy: input.actorId };
    if (approvalRequired) {
      patch.policy = {
        ...plan.policy,
        approvalRequired: true,
        riskLevel: plan.policy.riskLevel === 'low' || plan.policy.riskLevel === 'medium' ? 'high' : plan.policy.riskLevel,
      };
    }
    const updated = await this.repository.updatePlan(plan.id, patch);
    this.writeBackgroundAudit({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.capability.reevaluate',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: blockedCount > 0 ? 'denied' : 'success',
      riskLevel: approvalRequired ? 'high' : this.approvalRiskLevel(updated.policy.riskLevel),
      context,
      detail: { targetCount: input.targetResults.length, blockedCount, approvalRequired },
    });
    return this.toDto(updated);
  }

  async markRunFailedForTest(runId: string, actorId: string, tenantId?: string): Promise<ExecutionRunDto> {
    return this.executions.markFailedForTest(runId, actorId, tenantId);
  }

  private async resolveCreateInput(input: CreateDeploymentPlanInput): Promise<ResolvedCreatePlanInput> {
    const selectionMode = input.selectionMode ?? (input.certificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    const resolvedTargets = await Promise.all(input.targets.map((target) => this.resolveTarget(input.tenantId, target)));
    const versionIds = await Promise.all(resolvedTargets.map((target) => target.binding
      ? this.resolveCertificateVersionId({
          tenantId: input.tenantId,
          selectionMode,
          requestedCertificateVersionId: input.certificateVersionId,
          requestedCertificateFormatId: input.certificateFormatId,
          binding: target.binding,
          requestedDomain: target.domain,
        })
      : this.resolveWorkflowCertificateVersionId({
          selectionMode,
          requestedCertificateVersionId: input.certificateVersionId,
        })));
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length !== 1) {
      throw new AppError('VALIDATION_FAILED', '当前部署计划模型只支持单一 certificateVersionId，请按域名或版本拆分计划', { certificateVersionIds: uniqueVersionIds });
    }
    return {
      selectionMode,
      certificateVersionId: uniqueVersionIds[0]!,
      certificateFormatId: input.certificateFormatId,
      targets: resolvedTargets,
    };
  }

  private async resolveTarget(tenantId: string | undefined, target: CreateDeploymentPlanInput['targets'][number]): Promise<ResolvedCreateTarget> {
    if (!tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    if (target.executorType === 'WORKFLOW' && !target.certificateBindingId) {
      return { ...target };
    }
    if (target.certificateBindingId) {
      const binding = await this.tryGetBinding(tenantId, target.certificateBindingId);
      if (!binding) {
        throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { certificateBindingId: target.certificateBindingId });
      }
      const managedTarget = binding.managedTargetId ? await this.assets.getManagedTarget(tenantId, binding.managedTargetId) : undefined;
      const siteAsset = binding.siteAssetId ? await this.assets.getSiteAsset(tenantId, binding.siteAssetId) : undefined;
      return { ...target, certificateBindingId: binding.id, binding, managedTarget, siteAsset };
    }

    const managedTarget = target.managedTargetId ? await this.assets.getManagedTarget(tenantId, target.managedTargetId) : undefined;
    if (target.managedTargetId && !managedTarget) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: target.managedTargetId });
    }
    const siteAsset = target.siteAssetId
      ? await this.assets.getSiteAsset(tenantId, target.siteAssetId)
      : managedTarget?.siteId
        ? await this.assets.getSiteAsset(tenantId, managedTarget.siteId)
        : undefined;
    if (target.siteAssetId && !siteAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: target.siteAssetId });
    }
    const binding = await this.resolveBindingForTarget(tenantId, target, managedTarget, siteAsset);
    return {
      ...target,
      certificateBindingId: binding.id,
      managedTargetId: managedTarget?.id ?? target.managedTargetId,
      siteAssetId: siteAsset?.id ?? target.siteAssetId,
      binding,
      managedTarget,
      siteAsset,
    };
  }

  private async resolveBindingForTarget(
    tenantId: string,
    target: CreateDeploymentPlanInput['targets'][number],
    managedTarget?: ManagedTargetDto,
    siteAsset?: SiteAssetDto,
  ): Promise<CertificateBindingDto> {
    const filters: Array<Record<string, string>> = [];
    if (managedTarget?.id ?? target.managedTargetId) filters.push({ managedTargetId: managedTarget?.id ?? target.managedTargetId! });
    if (siteAsset?.id ?? target.siteAssetId) filters.push({ siteAssetId: siteAsset?.id ?? target.siteAssetId! });

    const candidates = new Map<string, CertificateBindingDto>();
    for (const filter of filters) {
      const page = await this.bindings.listCertificateBindings(tenantId, { page: 1, pageSize: 5000, filter });
      for (const item of page.items) candidates.set(item.id, item);
    }
    const filtered = [...candidates.values()].filter((binding) => {
      if (target.domain) {
        const bindingDomain = normalizeDomain(binding.domainName ?? binding.domain);
        if (bindingDomain !== normalizeDomain(target.domain)) return false;
      }
      return true;
    });

    if (filtered.length === 1) return filtered[0]!;
    if (filtered.length > 1) {
      throw new AppError('VALIDATION_FAILED', '目标命中多个 CertificateBinding，请补充 domain 或直接传 certificateBindingId', {
        managedTargetId: managedTarget?.id ?? target.managedTargetId,
        siteAssetId: siteAsset?.id ?? target.siteAssetId,
        bindingIds: filtered.map((item) => item.id),
      });
    }
    throw new AppError('RESOURCE_NOT_FOUND', '未找到与目标匹配的 CertificateBinding', {
      managedTargetId: managedTarget?.id ?? target.managedTargetId,
      siteAssetId: siteAsset?.id ?? target.siteAssetId,
      domain: target.domain,
    });
  }

  private async tryGetBinding(tenantId: string, bindingId: string): Promise<CertificateBindingDto | undefined> {
    try {
      return await this.bindings.getCertificateBinding(tenantId, bindingId);
    } catch (error) {
      if (isMissingRelationError(error)) return undefined;
      throw error;
    }
  }

  private async resolveCertificateVersionId(input: {
    tenantId?: string;
    selectionMode: 'EXPLICIT' | 'LATEST_AUTO';
    requestedCertificateVersionId?: string;
    requestedCertificateFormatId?: string;
    binding: CertificateBindingDto;
    requestedDomain?: string;
  }): Promise<string> {
    if (input.selectionMode === 'EXPLICIT') {
      if (!input.requestedCertificateVersionId) {
        throw new AppError('VALIDATION_FAILED', 'EXPLICIT 模式必须指定 certificateVersionId');
      }
      await this.assertCertificateVersionDeployable(
        input.requestedCertificateVersionId,
        input.binding,
        input.requestedDomain,
        input.requestedCertificateFormatId,
      );
      return input.requestedCertificateVersionId;
    }
    return this.findLatestDeployableCertificateVersionId(input.binding, input.requestedDomain);
  }

  private async resolveWorkflowCertificateVersionId(input: {
    selectionMode: 'EXPLICIT' | 'LATEST_AUTO';
    requestedCertificateVersionId?: string;
  }): Promise<string> {
    if (!input.requestedCertificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 部署计划必须指定 certificateVersionId', { selectionMode: input.selectionMode });
    }
    const version = await this.certificates.getVersion(input.requestedCertificateVersionId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.requestedCertificateVersionId });
    if (!this.isDeployableVersion(version)) {
      throw new AppError('VALIDATION_FAILED', '证书版本不可部署', {
        certificateVersionId: input.requestedCertificateVersionId,
        status: version.status,
        deployable: version.deployable,
        notAfter: version.notAfter,
      });
    }
    return input.requestedCertificateVersionId;
  }

  private async assertCertificateVersionDeployable(
    certificateVersionId: string,
    binding: CertificateBindingDto,
    requestedDomain?: string,
    requestedCertificateFormatId?: string,
  ): Promise<void> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    const asset = await this.certificates.getAsset(version.certificateAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: version.certificateAssetId });
    if (!this.isDeployableVersion(version)) {
      throw new AppError('VALIDATION_FAILED', '证书版本不可部署', { certificateVersionId, status: version.status, deployable: version.deployable, notAfter: version.notAfter });
    }
    if (!this.coversBindingDomain(binding, version, asset, requestedDomain)) {
      throw new AppError('VALIDATION_FAILED', '证书版本域名与绑定域名不匹配', { certificateVersionId, domain: requestedDomain ?? binding.domainName ?? binding.domain });
    }
    const frameworkType = this.resolveSupportedFrameworkType(await this.resolveManagedTargetContextFromBinding(binding.tenantId, binding));
    if (requestedCertificateFormatId) {
      await this.assertExplicitCertificateFormatDeployable(certificateVersionId, requestedCertificateFormatId, frameworkType);
      return;
    }
    if (frameworkType === 'web.nginx') {
      return;
    }
    const hasCompatibleFormat = await this.hasCompatibleWindowsIisFormat(certificateVersionId);
    if (!hasCompatibleFormat) {
      throw new AppError('VALIDATION_FAILED', '当前不存在可用于 Windows IIS 的证书格式配置', { certificateVersionId, requiredFormat: 'pfx' });
    }
  }

  private async assertExplicitCertificateFormatDeployable(
    certificateVersionId: string,
    certificateFormatId: string,
    frameworkType: 'web.iis' | 'web.nginx',
  ): Promise<void> {
    const format = await this.certificates.getFormat(certificateFormatId);
    if (!format) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId });
    }
    if (format.certificateVersionId && format.certificateVersionId !== certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', '证书格式配置不属于当前证书版本', {
        certificateVersionId,
        certificateFormatId,
        formatCertificateVersionId: format.certificateVersionId,
      });
    }
    if (frameworkType === 'web.iis' && (format.format !== 'pfx' || format.containsPrivateKey !== true)) {
      throw new AppError('VALIDATION_FAILED', 'Windows IIS 目前只支持带私钥的 PFX 格式配置', {
        certificateVersionId,
        certificateFormatId,
        format: format.format,
        containsPrivateKey: format.containsPrivateKey,
      });
    }
    if (frameworkType === 'web.nginx' && !this.isDeployableLinuxNginxFormat(format)) {
      throw new AppError('VALIDATION_FAILED', 'Linux NGINX 证书部署必须使用可生成 PEM 证书文件与私钥文件的格式配置', {
        certificateVersionId,
        certificateFormatId,
        format: format.format,
        containsPrivateKey: format.containsPrivateKey,
        parameters: format.parameters,
      });
    }
  }

  private async findLatestDeployableCertificateVersionId(binding: CertificateBindingDto, requestedDomain?: string): Promise<string> {
    const versionsPage = await this.certificates.listVersions({ page: 1, pageSize: 5000, filter: {} });
    const matched: Array<{ version: CertificateVersionEntity; asset: CertificateAssetEntity }> = [];
    for (const version of versionsPage.items) {
      const asset = await this.certificates.getAsset(version.certificateAssetId);
      if (!asset) continue;
      if (!this.isDeployableVersion(version)) continue;
      if (!this.coversBindingDomain(binding, version, asset, requestedDomain)) continue;
      matched.push({ version, asset });
    }
    matched.sort((left, right) => {
      const notAfter = compareTimeDesc(left.version.notAfter, right.version.notAfter);
      if (notAfter !== 0) return notAfter;
      const versionNo = right.version.versionNo - left.version.versionNo;
      if (versionNo !== 0) return versionNo;
      return compareTimeDesc(left.version.createdAt, right.version.createdAt);
    });
    const selected = matched[0];
    if (!selected) {
      throw new AppError('RESOURCE_NOT_FOUND', '未找到匹配绑定域名的最新可部署 PFX 证书版本', {
        domain: requestedDomain ?? binding.domainName ?? binding.domain,
        bindingId: binding.id,
      });
    }
    return selected.version.id;
  }

  private async buildDeploymentArtifactByTargetIds(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    effectiveCertificateVersionId = plan.certificateVersionId,
  ): Promise<Map<string, DeploymentArtifactSnapshotDto>> {
    const output = new Map<string, DeploymentArtifactSnapshotDto>();
    for (const target of targets) {
      output.set(target.id, await this.resolveDeploymentArtifactForTarget(target, effectiveCertificateVersionId, plan.certificateFormatId, plan.tenantId));
    }
    return output;
  }

  private async resolveLiveWorkflowStrategyPayloadForTarget(target: DeploymentPlanTargetEntity): Promise<Record<string, unknown>> {
    const snapshotPayload = target.strategyPayload ?? {};
    if (target.executorType !== 'WORKFLOW') return snapshotPayload;
    const workflowSnapshot = readRecord(snapshotPayload.workflowRequest);
    if (readOptionalString(workflowSnapshot?.pluginBindingId)) return snapshotPayload;
    const applicationAssetId = target.applicationAssetId
      ?? readOptionalString(workflowSnapshot?.applicationAssetId)
      ?? readOptionalString(snapshotPayload.applicationAssetId);
    if (!target.tenantId || !applicationAssetId) return snapshotPayload;
    const applicationAsset = await this.assets.getServiceAsset(target.tenantId, applicationAssetId);
    if (!applicationAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'WORKFLOW 部署目标引用的应用资产不存在', {
        deploymentPlanTargetId: target.id,
        applicationAssetId,
      });
    }
    const workflow = applicationAsset.deploymentStrategy?.workflow;
    if (applicationAsset.deploymentStrategy?.type !== 'WORKFLOW' || !workflow) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 部署目标引用的应用资产已不再使用 WORKFLOW 策略', {
        deploymentPlanTargetId: target.id,
        applicationAssetId,
      });
    }
    const resolvedVersionId = await this.resolveRuntimeWorkflowVersionId(workflow);
    const resolvedStrategy = this.deploymentStrategyResolver.resolve({ applicationAsset });
    const resolvedRequest = readRecord(resolvedStrategy.payload.workflowRequest) ?? {};
    return {
      ...resolvedStrategy.payload,
      workflowRequest: {
        ...resolvedRequest,
        workflowVersionSelection: workflow.workflowVersionSelection ?? (workflow.workflowVersionId ? 'PINNED' : 'LATEST_PUBLISHED'),
        workflowVersionId: resolvedVersionId,
        applicationAssetId: applicationAsset.id,
      },
    };
  }

  private async resolveRuntimeWorkflowVersionId(workflow: WorkflowDeploymentStrategyDto): Promise<string> {
    const selection = workflow.workflowVersionSelection ?? (workflow.workflowVersionId ? 'PINNED' : 'LATEST_PUBLISHED');
    if (selection === 'PINNED') {
      if (!workflow.workflowVersionId) {
        throw new AppError('VALIDATION_FAILED', 'WORKFLOW 固定版本策略缺少 workflowVersionId', {
          code: 'WORKFLOW_VERSION_REQUIRED',
          workflowId: workflow.workflowId,
        });
      }
      return workflow.workflowVersionId;
    }
    if (!this.workflows) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本服务未接入，不能解析最新工作流版本', {
        code: 'WORKFLOW_VERSION_RESOLVER_MISSING',
        workflowId: workflow.workflowId,
      });
    }
    if (!workflow.workflowId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 最新版本策略缺少 workflowId', { code: 'WORKFLOW_ID_REQUIRED' });
    }
    const latest = await this.workflows.getRuntimePublishedVersion(workflow.workflowId);
    if (!latest) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 最新版本策略找不到已发布版本', {
        code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
        workflowId: workflow.workflowId,
      });
    }
    return latest.id;
  }

  private async buildAgentPayloadByTargetIds(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    deploymentArtifactByTargetId?: Map<string, DeploymentArtifactSnapshotDto>,
    effectiveCertificateVersionId = plan.certificateVersionId,
  ): Promise<Map<string, Record<string, unknown>>> {
    const output = new Map<string, Record<string, unknown>>();
    for (const target of targets) {
      const artifact = deploymentArtifactByTargetId?.get(target.id)
        ?? await this.resolveDeploymentArtifactForTarget(target, effectiveCertificateVersionId, plan.certificateFormatId, plan.tenantId);
      if (!artifact) continue;
	      const payload = await this.buildAgentPayloadForTarget(target, artifact, plan.tenantId);
	      const strategyPayload = await this.resolveLiveWorkflowStrategyPayloadForTarget(target);
	      if (payload || Object.keys(strategyPayload).length > 0) output.set(target.id, { ...strategyPayload, ...(payload ?? {}) });
    }
    return output;
  }

  private async resolveEffectivePlanMaterial(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    actorId: string,
  ): Promise<{ plan: DeploymentPlanEntity; certificateVersionId: string }> {
    if (plan.selectionMode !== 'LATEST_AUTO') {
      return { plan, certificateVersionId: plan.certificateVersionId };
    }
    const certificateVersionId = await this.resolveLatestAutoCertificateVersionId(plan, targets);
    if (certificateVersionId === plan.certificateVersionId) {
      return { plan, certificateVersionId };
    }
    const updatedAt = new Date().toISOString();
    const updated = await this.repository.updatePlan(plan.id, {
      certificateVersionId,
      snapshotHash: this.domain.buildSnapshotHash({
        ...plan,
        certificateVersionId,
      }, targets),
      updatedAt,
      updatedBy: actorId,
    });
    return { plan: updated, certificateVersionId };
  }

  private async resolveLatestAutoCertificateVersionId(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
  ): Promise<string> {
    const versionIds = await Promise.all(targets.map(async (target) => {
      const tenantId = target.tenantId ?? plan.tenantId;
      if (!tenantId) {
        throw new AppError('VALIDATION_FAILED', 'LATEST_AUTO 部署目标缺少 tenantId，无法解析最新证书版本', {
          deploymentPlanId: plan.id,
          deploymentPlanTargetId: target.id,
        });
      }
      if (!target.certificateBindingId) {
        throw new AppError('RESOURCE_NOT_FOUND', 'LATEST_AUTO 部署目标缺少 CertificateBinding，无法解析最新证书版本', {
          deploymentPlanId: plan.id,
          deploymentPlanTargetId: target.id,
        });
      }
      const binding = await this.tryGetBinding(tenantId, target.certificateBindingId);
      if (!binding) {
        throw new AppError('RESOURCE_NOT_FOUND', 'LATEST_AUTO 部署目标缺少 CertificateBinding，无法解析最新证书版本', {
          deploymentPlanId: plan.id,
          deploymentPlanTargetId: target.id,
          certificateBindingId: target.certificateBindingId,
        });
      }
      return this.resolveCertificateVersionId({
        tenantId,
        selectionMode: 'LATEST_AUTO',
        requestedCertificateFormatId: plan.certificateFormatId,
        binding,
      });
    }));
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length !== 1) {
      throw new AppError('VALIDATION_FAILED', '当前部署计划模型只支持单一最新证书版本，请按域名或版本拆分计划', {
        deploymentPlanId: plan.id,
        certificateVersionIds: uniqueVersionIds,
      });
    }
    return uniqueVersionIds[0]!;
  }

  private async resolveDeploymentArtifactForTarget(
    target: DeploymentPlanTargetEntity,
    certificateVersionId: string,
    certificateFormatId?: string,
    tenantId?: string,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const resolvedTenantId = target.tenantId ?? tenantId;
    if (!resolvedTenantId) {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少 tenantId，无法解析部署材料', {
        deploymentPlanTargetId: target.id,
        deploymentPlanId: target.deploymentPlanId,
      });
    }
    const strategyPayload = await this.resolveLiveWorkflowStrategyPayloadForTarget(target);
    const workflowBindings = readWorkflowCertificateArtifactBindings(readRecord(strategyPayload.workflowRequest)?.certificateArtifactBindings);
    const agentBindingId = readOptionalString(readRecord(readRecord(strategyPayload.deploymentStrategy)?.agent)?.pluginBindingId);
    const agentBinding = agentBindingId && this.pluginBindings
      ? await this.pluginBindings.getTenantBinding(resolvedTenantId, agentBindingId)
      : undefined;
    const artifactBindings = Object.keys(agentBinding?.certificateArtifactBindings ?? {}).length > 0
      ? agentBinding!.certificateArtifactBindings
      : workflowBindings;
    if (Object.keys(artifactBindings).length > 0) {
      return this.resolveWorkflowDeploymentArtifact(certificateVersionId, artifactBindings);
    }
    if (!target.certificateBindingId) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署目标缺少 CertificateBinding，无法解析部署材料', {
        deploymentPlanTargetId: target.id,
        tenantId: resolvedTenantId,
      });
    }
    const binding = await this.tryGetBinding(resolvedTenantId, target.certificateBindingId);
    if (!binding) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署目标缺少 CertificateBinding，无法解析部署材料', {
        deploymentPlanTargetId: target.id,
        certificateBindingId: target.certificateBindingId,
        tenantId: resolvedTenantId,
      });
    }
    const frameworkType = this.resolveSupportedFrameworkType(await this.resolveManagedTargetContextFromBinding(resolvedTenantId, binding, target));
    return this.resolveDeploymentArtifact(certificateVersionId, certificateFormatId, frameworkType);
  }

  private async resolveDeploymentArtifact(
    certificateVersionId: string,
    certificateFormatId?: string,
    frameworkType: 'web.iis' | 'web.nginx' = 'web.iis',
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    const format = certificateFormatId
      ? await this.certificates.getFormat(certificateFormatId)
      : frameworkType === 'web.iis'
        ? await this.artifacts.resolveWindowsIisPfx(certificateVersionId)
        : undefined;
    if (!format) {
      if (frameworkType === 'web.nginx') {
        throw new AppError('VALIDATION_FAILED', 'Linux NGINX 当前必须显式指定 certificateFormatId，且格式需可生成 PEM 证书文件与私钥文件', {
          certificateVersionId,
          frameworkType,
        });
      }
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId });
    }
    if (frameworkType === 'web.iis' && (format.format !== 'pfx' || format.containsPrivateKey !== true)) {
      throw new AppError('VALIDATION_FAILED', 'Windows IIS 目前只支持带私钥的 PFX 格式配置', {
        certificateFormatId,
        format: format.format,
        containsPrivateKey: format.containsPrivateKey,
      });
    }
    if (frameworkType === 'web.nginx' && !this.isDeployableLinuxNginxFormat(format)) {
      throw new AppError('VALIDATION_FAILED', 'Linux NGINX 当前要求导出格式必须可生成 PEM 证书文件与私钥文件', {
        certificateFormatId,
        format: format.format,
        containsPrivateKey: format.containsPrivateKey,
        parameters: format.parameters,
      });
    }
    const generated = await this.certificatesApp.generateDeploymentArtifactFromFormat({
      certificateVersionId,
      certificateFormatId: format.id,
      createdBy: 'system',
    });
    return {
      certificateVersionId,
      certificateFormatId: format.id,
      format: generated.format,
      containsPrivateKey: generated.containsPrivateKey,
      certificatePem: generated.certificatePem,
      privateKeyPem: generated.privateKeyPem,
      pfxBase64: generated.pfxBase64,
      pfxPassword: generated.pfxPassword,
      files: generated.files.map((file) => ({ ...file, name: file.key })),
      expectedFingerprintSha256: version.fingerprintSha256,
      warnings: generated.warnings,
    };
  }

  private async resolveWorkflowDeploymentArtifact(
    certificateVersionId: string,
    bindings: Record<string, WorkflowCertificateArtifactBinding>,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    const workflowCertificateMaterials: Record<string, Record<string, unknown>> = {};
    let first: DeploymentArtifactSnapshotDto | undefined;
    const warnings: string[] = [];
    for (const [variableName, binding] of Object.entries(bindings)) {
      const generated = await this.certificatesApp.generateDeploymentArtifactFromFormat({
        certificateVersionId,
        certificateFormatId: binding.certificateFormatId,
        createdBy: 'system',
      });
      const files = generated.files.map((file) => ({ ...file, name: file.key }));
      const baseMaterial = enrichWorkflowCertificateMaterial({
        certificateVersionId,
        certificateFormatId: generated.certificateFormatId,
        format: generated.format,
        containsPrivateKey: generated.containsPrivateKey,
        fingerprintSha256: version.fingerprintSha256,
        expectedFingerprintSha256: version.fingerprintSha256,
        pem: generated.certificatePem,
        certificatePem: generated.certificatePem,
        privateKey: generated.privateKeyPem,
        privateKeyPem: generated.privateKeyPem,
        pfx: generated.pfxBase64,
        pfxBase64: generated.pfxBase64,
        pfxPassword: generated.pfxPassword,
        files,
      });
      const outputs: Record<string, Record<string, unknown>> = {};
      for (const [slotName, outputKey] of Object.entries(binding.outputBindings)) {
        const file = files.find((item) => item.key === outputKey || item.name === outputKey);
        const virtualOutput = resolveStandardCertificateOutput(baseMaterial, outputKey);
        if (!file && !virtualOutput) {
          throw new AppError('VALIDATION_FAILED', '证书产物输出项不存在', {
            certificateVersionId,
            certificateFormatId: binding.certificateFormatId,
            variableName,
            slotName,
            outputKey,
            availableOutputKeys: files.map((item) => item.key ?? item.name).filter(Boolean),
          });
        }
        outputs[slotName] = file ?? virtualOutput!;
      }
      const material = enrichWorkflowCertificateMaterial({
        ...baseMaterial,
        outputs,
      });
      workflowCertificateMaterials[variableName] = material;
      warnings.push(...generated.warnings);
      first ??= {
        certificateVersionId,
        certificateFormatId: generated.certificateFormatId,
        format: generated.format,
        containsPrivateKey: generated.containsPrivateKey,
        certificatePem: generated.certificatePem,
        privateKeyPem: generated.privateKeyPem,
        pfxBase64: generated.pfxBase64,
        pfxPassword: generated.pfxPassword,
        files,
        expectedFingerprintSha256: version.fingerprintSha256,
        warnings: [],
      };
    }
    return {
      ...(first ?? {
        certificateVersionId,
        certificateFormatId: '',
        format: 'workflow',
        containsPrivateKey: false,
      }),
      expectedFingerprintSha256: version.fingerprintSha256,
      workflowCertificateMaterials,
      warnings: [...new Set(warnings)],
    };
  }

  private async buildAgentPayloadForTarget(
    target: DeploymentPlanTargetEntity,
    artifact: DeploymentArtifactSnapshotDto,
    tenantId?: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (target.executorType === 'WORKFLOW') return undefined;
    const resolvedTenantId = target.tenantId ?? tenantId;
    if (!resolvedTenantId) return undefined;
    const strategyPayload = target.strategyPayload ?? {};
    const runtimeCapability = readRecord(strategyPayload.pluginRuntimeCapability);
    if (readOptionalString(runtimeCapability?.runtime) === 'AGENT_ATOMIC') {
      return {
        ...strategyPayload,
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        agentId: readOptionalString(strategyPayload.agentId),
        pluginBindingId: readOptionalString(runtimeCapability?.pluginBindingId),
        deploymentArtifact: artifact,
      };
    }
    throw new AppError('VALIDATION_FAILED', '受管目标缺少可执行的插件运行能力', {
      deploymentPlanTargetId: target.id,
      executionTargetId: target.executionTargetId,
      runtime: readOptionalString(runtimeCapability?.runtime),
    });
  }

  private async attachInitialDryRunChecks(
    steps: ExecutionStepDto[],
    targets: DeploymentPlanTargetEntity[],
    deploymentArtifactByTargetId: Map<string, DeploymentArtifactSnapshotDto>,
    agentPayloadByTargetId: Map<string, Record<string, unknown>>,
    actorId: string,
    tenantId?: string,
  ): Promise<ExecutionStepDto[]> {
    if (!steps.length) return steps;

    const targetById = new Map(targets.map((target) => [target.id, target] as const));
    const updatedStepIds = new Set<string>();

    for (const step of steps) {
      if (step.stepType !== 'DISCOVER' && step.stepType !== 'VERIFY') continue;
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      const target = targetById.get(targetId);
      const artifact = deploymentArtifactByTargetId.get(targetId);
      const agentPayload = agentPayloadByTargetId.get(targetId);
      if (!target || !artifact || !agentPayload) continue;

      const checks = await this.buildInitialDryRunChecks(target, artifact, agentPayload, tenantId);
      if (checks.length === 0) continue;

      const resultDetail = {
        ...(readRecord(step.inputSnapshot.resultDetail) ?? {}),
        dryRunChecks: checks,
        dryRunSummary: summarizeDryRunChecks(checks),
      };
      await this.executions.updateStepForTest(step.id, {
        inputSnapshot: {
          ...step.inputSnapshot,
          resultDetail,
        },
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      }, tenantId);
      updatedStepIds.add(step.id);
    }

    if (updatedStepIds.size === 0) return steps;
    return this.executions.listSteps({ tenantId, executionRunId: steps[0]?.executionRunId });
  }

  private async buildInitialDryRunChecks(
    target: DeploymentPlanTargetEntity,
    artifact: DeploymentArtifactSnapshotDto,
    agentPayload: Record<string, unknown>,
    tenantId?: string,
  ): Promise<DeploymentPlanDryRunCheckDto[]> {
    const resolvedTenantId = tenantId ?? target.tenantId;
    if (!resolvedTenantId) return [];
    if (!target.certificateBindingId) return [];
    const binding = await this.tryGetBinding(resolvedTenantId, target.certificateBindingId);
    if (!binding) return [];

    const expectedFingerprint = normalizeSha256(
      artifact.expectedFingerprintSha256
      ?? readOptionalString((agentPayload.deploymentArtifact as Record<string, unknown> | undefined)?.expectedFingerprintSha256)
      ?? readOptionalString(agentPayload.expectedCertificateFingerprintSha256),
    );
    const observedFingerprint = normalizeSha256(binding.observedFingerprintSha256);
    const targetFingerprint = normalizeSha256(binding.targetFingerprintSha256 ?? binding.desiredFingerprintSha256);
    const currentThumbprint = normalizeThumbprint(readOptionalString(binding.metadata?.currentThumbprint) ?? binding.storeThumbprint);

    const checks: DeploymentPlanDryRunCheckDto[] = [];
    if (expectedFingerprint && observedFingerprint && expectedFingerprint === observedFingerprint) {
      checks.push({
        key: 'certificate_already_active',
        label: '当前站点证书已与目标一致',
        status: 'warning',
        detail: '站点当前观测到的证书指纹已经等于本次计划目标证书，本次更新可能不会产生实际变更。',
        evidence: {
          bindingId: binding.id,
          certificateVersionId: binding.certificateVersionId,
          targetCertificateVersionId: artifact.certificateVersionId,
          currentFingerprintSha256: observedFingerprint,
          expectedFingerprintSha256: expectedFingerprint,
          currentThumbprint,
        },
      });
    } else if (expectedFingerprint && targetFingerprint && expectedFingerprint !== targetFingerprint) {
      checks.push({
        key: 'binding_target_fingerprint_drift',
        label: '绑定目标证书与计划目标不一致',
        status: 'warning',
        detail: '绑定记录里的目标指纹与本次计划目标证书不一致，dry-run 结论应结合绑定规则重新确认。',
        evidence: {
          bindingId: binding.id,
          targetFingerprintSha256: targetFingerprint,
          expectedFingerprintSha256: expectedFingerprint,
          certificateVersionId: binding.certificateVersionId,
          targetCertificateVersionId: artifact.certificateVersionId,
        },
      });
    }
    return checks;
  }


  private isDeployableVersion(version: CertificateVersionEntity): boolean {
    return version.status === 'active'
      && version.deployable === true
      && new Date(version.notAfter).getTime() > Date.now();
  }

  private async hasCompatibleWindowsIisFormat(certificateVersionId: string): Promise<boolean> {
    try {
      await this.artifacts.resolveWindowsIisPfx(certificateVersionId);
      return true;
    } catch (error) {
      if (error instanceof AppError && (error.errorCode === 'VALIDATION_FAILED' || error.errorCode === 'RESOURCE_NOT_FOUND')) {
        return false;
      }
      throw error;
    }
  }


  private async resolveManagedTargetContextFromBinding(
    tenantId: string,
    binding: CertificateBindingDto,
    target?: Pick<DeploymentPlanTargetEntity, 'executionTargetId'>,
  ) {
    const managedTargetId = binding.managedTargetId ?? target?.executionTargetId;
    return this.resolveManagedTargetContext(tenantId, managedTargetId);
  }

  private resolveSupportedFrameworkType(
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>>,
  ): 'web.iis' | 'web.nginx' {
    if (context.frameworkType === 'web.iis') return 'web.iis';
    if (context.frameworkType === 'web.nginx') return 'web.nginx';
    throw new AppError('VALIDATION_FAILED', '当前 Framework 不支持证书部署适配器', {
      frameworkInstanceId: context.serviceInstance?.id,
      frameworkType: context.frameworkType,
      managedTargetId: context.managedTarget.id,
      siteId: context.siteAsset?.id,
    });
  }

  private isDeployableLinuxNginxFormat(format: { format: string; containsPrivateKey: boolean; parameters?: Record<string, unknown> | null }): boolean {
    if (format.format !== 'pem') return false;
    if (format.containsPrivateKey === true) return true;
    return readOptionalBoolean((format.parameters ?? {})['generatePrivateKeyFile']) === true;
  }

  private coversBindingDomain(
    binding: CertificateBindingDto,
    version: CertificateVersionEntity,
    asset: CertificateAssetEntity,
    requestedDomain?: string,
  ): boolean {
    const bindingDomain = normalizeDomain(requestedDomain ?? binding.domainName ?? binding.domain);
    if (!bindingDomain) return false;
    const candidates = [
      asset.primaryDomain,
      ...asset.sans,
      version.commonName,
      ...version.sans,
    ].map(normalizeDomain).filter(Boolean) as string[];
    return candidates.some((candidate) => domainMatches(candidate, bindingDomain));
  }

  private async transitionPlan(
    plan: DeploymentPlanEntity,
    nextStatus: DeploymentPlanEntity['status'],
    actorId: string,
    event: string,
    patch: Partial<DeploymentPlanEntity> = {},
  ): Promise<DeploymentPlanEntity> {
    this.domain.transitionPlan(plan.status, nextStatus);
    const updated = await this.repository.updatePlan(plan.id, {
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
    await this.recordTransition('deploymentPlan', plan.id, plan.status, nextStatus, event, actorId, plan.tenantId);
    return updated;
  }

  private requiresApproval(plan: DeploymentPlanEntity): boolean {
    return Boolean(plan.policy.approvalRequired) || this.domain.isHighRisk(plan.policy);
  }

  private approvalRiskLevel(riskLevel: RiskLevel | undefined): RiskLevel {
    return riskLevel === 'critical' || riskLevel === 'high' ? riskLevel : 'high';
  }

  private writeBackgroundAudit(input: WriteAuditInput): void {
    void this.audit.write(input).catch(() => undefined);
  }

  private approvalParameters(plan: DeploymentPlanEntity): Record<string, string> {
    return { planId: plan.id, snapshotHash: plan.snapshotHash, action: 'deployment.execute' };
  }

  private async auditDenied(plan: DeploymentPlanEntity, actorId: string, action: string, context: RequestContext, reason: string): Promise<void> {
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTED,
      actorType: 'user',
      actorId,
      action,
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'denied',
      riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
      context,
      failClosed: true,
      detail: { reason },
    });
  }

  private async recordTransition(
    entityType: StateTransitionEventEntity['entityType'],
    entityId: string,
    fromStatus: string | undefined,
    toStatus: string,
    event: string,
    actorId: string,
    tenantId?: string,
  ): Promise<void> {
    await this.repository.createTransition({
      id: newId('ste'),
      tenantId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      event,
      actorType: 'user',
      actorId,
      createdAt: new Date().toISOString(),
    });
  }

  private defaultCapabilities(): string[] {
    return ['certificate.backup', 'certificate.install', 'service.reload', 'tls.verify'];
  }

  private normalizeRouteMatchResult(
    matchResult: Record<string, unknown> | undefined,
    route: DeploymentPlanTargetEntity['gatewayRoute'],
  ): Record<string, unknown> | undefined {
    if (!route?.blockedReason && !route?.approvalRequired) return matchResult;
    return {
      ...(matchResult ?? {}),
      status: 'manual_required',
      reason: route.approvalRequired ? 'Zone 路由要求审批' : `Gateway 路由被阻断：${route.blockedReason}`,
      gatewayRouteBlockedReason: route.blockedReason,
      fallbackSuggestions: route.fallbackSuggestions,
      missingCapabilities: route.missingCapabilities,
    };
  }

  private async normalizeGatewayRoute(
    target: CreateDeploymentPlanInput['targets'][number],
    tenantId: string | undefined,
    policy: DeploymentPlanEntity['policy'],
  ): Promise<DeploymentPlanTargetEntity['gatewayRoute']> {
    const explicitRoute = this.normalizeExplicitGatewayRoute(target);
    if (explicitRoute?.gatewayId || explicitRoute?.agentId || explicitRoute?.gatewayAgentId || target.gatewayRoute) return explicitRoute;

    const zoneId = target.zoneId ?? explicitRoute?.zoneId;
    const targetId = target.delegatedTargetId ?? target.executionTargetId ?? explicitRoute?.delegatedTargetId;
    if (!zoneId || !targetId) return explicitRoute;

    const protocols = this.routeProtocols(target);
    if (protocols.length === 0) return explicitRoute;

    const routeResult = await this.gateways.route(tenantId ?? '', {
      zoneId,
      targetId,
      protocols,
      requiredCapabilities: target.requiredCapabilities ?? this.defaultCapabilities(),
      destructive: target.destructive ?? this.isDestructivePlan(policy),
      action: target.action ?? this.defaultRouteAction(policy),
    });
    return this.gatewayRouteFromRouteResult(target, zoneId, targetId, routeResult, protocols[0]);
  }

  private normalizeExplicitGatewayRoute(target: CreateDeploymentPlanInput['targets'][number]): DeploymentPlanTargetEntity['gatewayRoute'] {
    const hasExplicitRoute = Boolean(target.gatewayRoute)
      || target.gatewayId !== undefined
      || target.adapter !== undefined
      || target.delegatedTargetId !== undefined
      || target.fallbackSuggestions !== undefined;
    const hasRoutingHintOnly = target.zoneId !== undefined || target.protocols !== undefined || target.action !== undefined || target.destructive !== undefined;
    if (!hasExplicitRoute && !hasRoutingHintOnly) return undefined;
    const route = {
      ...(target.gatewayRoute ?? {}),
      gatewayId: target.gatewayId ?? target.gatewayRoute?.gatewayId,
      agentId: target.gatewayRoute?.agentId,
      gatewayAgentId: target.gatewayRoute?.gatewayAgentId,
      zoneId: target.zoneId ?? target.gatewayRoute?.zoneId,
      adapter: target.adapter ?? target.gatewayRoute?.adapter,
      delegatedTargetId: target.delegatedTargetId ?? target.gatewayRoute?.delegatedTargetId ?? target.executionTargetId,
      fallbackSuggestions: target.fallbackSuggestions ?? target.gatewayRoute?.fallbackSuggestions,
      mockSafeLocalRuntime: target.gatewayRoute?.mockSafeLocalRuntime,
      candidateGateways: target.gatewayRoute?.candidateGateways,
      missingCapabilities: target.gatewayRoute?.missingCapabilities,
      blockedReason: target.gatewayRoute?.blockedReason,
      approvalRequired: target.gatewayRoute?.approvalRequired,
    };
    return this.compactGatewayRoute(route);
  }

  private gatewayRouteFromRouteResult(
    target: CreateDeploymentPlanInput['targets'][number],
    zoneId: string,
    delegatedTargetId: string,
    result: ZoneRouteResult,
    fallbackAdapter: GatewayAdapterType,
  ): DeploymentGatewayRouteDto {
    const selected = result.selectedGateway;
    return this.compactGatewayRoute({
      gatewayId: selected?.id,
      agentId: selected?.agentId,
      gatewayAgentId: selected?.agentId,
      zoneId,
      adapter: result.candidateGateways[0]?.reachability.protocol ?? fallbackAdapter,
      delegatedTargetId,
      candidateGateways: result.candidateGateways.map((candidate) => this.toGatewayRouteCandidate(candidate)),
      fallbackSuggestions: result.fallbackSuggestions,
      missingCapabilities: result.missingCapabilities,
      blockedReason: result.blockedReason,
      approvalRequired: result.status === 'approvalRequired',
      mockSafeLocalRuntime: target.gatewayRoute?.mockSafeLocalRuntime,
    })!;
  }

  private toGatewayRouteCandidate(candidate: GatewayCandidate): NonNullable<DeploymentGatewayRouteDto['candidateGateways']>[number] {
    return {
      gatewayId: candidate.gateway.id,
      agentId: candidate.gateway.agentId,
      zoneId: candidate.gateway.zoneIds[0],
      adapter: candidate.reachability.protocol,
      score: candidate.score,
      reasons: candidate.reasons,
    };
  }

  private routeProtocols(target: CreateDeploymentPlanInput['targets'][number]): GatewayAdapterType[] {
    const values = target.protocols ?? (target.adapter ? [target.adapter] : target.gatewayRoute?.adapter ? [target.gatewayRoute.adapter] : this.protocolsFromExecutorType(target.executorType));
    return [...new Set(values.filter(Boolean))] as GatewayAdapterType[];
  }

  private protocolsFromExecutorType(executorType: CreateDeploymentPlanInput['targets'][number]['executorType']): GatewayAdapterType[] {
    if (executorType === 'CURL') return ['probe.http'];
    if (executorType === 'GATEWAY_FORWARD') return ['forward.agent_task'];
    return ['forward.agent_task'];
  }

  private isDestructivePlan(policy: DeploymentPlanEntity['policy']): boolean {
    return policy.failurePolicy === 'rollback' || policy.riskLevel === 'high' || policy.riskLevel === 'critical';
  }

  private defaultRouteAction(policy: DeploymentPlanEntity['policy']): string {
    return this.isDestructivePlan(policy) ? 'install' : 'write';
  }

  private compactGatewayRoute(route: DeploymentGatewayRouteDto): DeploymentGatewayRouteDto | undefined {
    const compact = Object.fromEntries(
      Object.entries(route).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''),
    ) as DeploymentGatewayRouteDto;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  private async toDto(plan: DeploymentPlanEntity): Promise<DeploymentPlanDto> {
    const runs = await this.executions.listRuns({ tenantId: plan.tenantId, deploymentPlanId: plan.id });
    const latestRun = [...runs].sort((left, right) => {
      const runNo = Number(right.runNo ?? 0) - Number(left.runNo ?? 0);
      if (runNo !== 0) return runNo;
      return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
    })[0];
    return {
      ...plan,
      targets: (await this.repository.listTargetsByPlan(plan.id, plan.tenantId)).map((target) => this.toTargetDto(target)),
      latestRunId: latestRun?.id,
      latestRun,
    };
  }

  private toTargetDto(target: DeploymentPlanTargetEntity): DeploymentPlanTargetDto {
    return { ...target };
  }

  private async assertLatestDryRunPassed(plan: DeploymentPlanEntity, tenantId?: string): Promise<void> {
    const runs = await this.executions.listRuns({ tenantId, deploymentPlanId: plan.id }) as ExecutionRunDto[];
    const latestRun = runs
      .sort((left, right) => {
        const runNo = Number(right.runNo ?? 0) - Number(left.runNo ?? 0);
        if (runNo !== 0) return runNo;
        return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
      })[0];
    if (latestRun?.type === 'dry_run' && latestRun.status === 'SUCCESS') return;
    throw new AppError('DEPLOYMENT_INVALID_STATE', '正式执行前必须先完成一次成功的 Dry-run 影响预览', {
      planId: plan.id,
      latestRunId: latestRun?.id,
      latestRunType: latestRun?.type,
      latestRunStatus: latestRun?.status,
    });
  }
}

function normalizeDomain(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function readWorkflowCertificateArtifactBindings(value: unknown): Record<string, WorkflowCertificateArtifactBinding> {
  const record = readRecord(value);
  if (!record) return {};
  const output: Record<string, WorkflowCertificateArtifactBinding> = {};
  for (const [variableName, rawBinding] of Object.entries(record)) {
    const binding = readRecord(rawBinding);
    const certificateFormatId = readOptionalString(binding?.certificateFormatId);
    const outputBindingsRecord = readRecord(binding?.outputBindings);
    if (!certificateFormatId || !outputBindingsRecord) continue;
    const outputBindings: Record<string, string> = {};
    for (const [slotName, outputKey] of Object.entries(outputBindingsRecord)) {
      const normalizedOutputKey = readOptionalString(outputKey);
      if (normalizedOutputKey) outputBindings[slotName] = normalizedOutputKey;
    }
    if (Object.keys(outputBindings).length > 0) {
      output[variableName] = { certificateFormatId, outputBindings };
    }
  }
  return output;
}

function resolveStandardCertificateOutput(
  material: Record<string, unknown>,
  outputKey: string,
): Record<string, unknown> | undefined {
  const definitions: Record<string, { sourceKey: string; role: string; format: string }> = {
    leafPem: { sourceKey: 'leafPem', role: 'public_certificate', format: 'pem' },
    certificatePem: { sourceKey: 'certificatePem', role: 'public_certificate', format: 'pem' },
    privateKeyPem: { sourceKey: 'privateKeyPem', role: 'private_key', format: 'pem' },
    orderedChainPem: { sourceKey: 'orderedChainPem', role: 'certificate_chain', format: 'pem' },
    chain: { sourceKey: 'orderedChainPem', role: 'certificate_chain', format: 'pem' },
    fingerprintSha256: { sourceKey: 'fingerprintSha256', role: 'fingerprint_sha256', format: 'hex' },
  };
  const definition = definitions[outputKey];
  if (!definition) return undefined;
  const content = readOptionalString(material[definition.sourceKey]);
  if (!content) return undefined;
  return {
    key: outputKey,
    role: definition.role,
    format: definition.format,
    content,
    ...(definition.format === 'pem' ? { contentBase64: Buffer.from(content, 'utf8').toString('base64') } : {}),
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compareTimeDesc(left: unknown, right: unknown): number {
  const leftTime = readTimeValue(left);
  const rightTime = readTimeValue(right);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(right ?? '').localeCompare(String(left ?? ''));
}

function readTimeValue(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : 0;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readCredentialBindings(value: unknown): Record<string, { credentialId: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([slot, binding]) => {
    const record = readRecord(binding);
    const credentialId = readOptionalString(record?.credentialId);
    if (!credentialId) throw new AppError('VALIDATION_FAILED', '工作流凭据绑定缺少 credentialId', { slot });
    return [slot, { credentialId }];
  }));
}

function readObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((item): item is string => Boolean(item && item.trim())))];
}

function firstNonEmptyRecord(...items: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  return items.find((item) => Boolean(item && Object.keys(item).length > 0));
}

function mergeLinuxNginxBindingMetadata(
  current: Record<string, unknown>,
  patch: {
    sourceFile?: string;
    serverNames?: string[];
    testCommand?: string;
    permission?: Record<string, unknown>;
    helperCommand?: string;
    reloadCommand?: string;
  },
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...current };
  if (patch.sourceFile) next.sourceFile = patch.sourceFile;
  if (patch.serverNames && patch.serverNames.length > 0) next.serverNames = patch.serverNames;
  if (patch.testCommand) next.testCommand = patch.testCommand;
  if (patch.permission && Object.keys(patch.permission).length > 0) next.permission = patch.permission;
  if (patch.helperCommand) next.helperCommand = patch.helperCommand;
  if (patch.reloadCommand) next.reloadCommand = patch.reloadCommand;
  return JSON.stringify(next) === JSON.stringify(current) ? undefined : next;
}

function normalizeSha256(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(':', '').trim().toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function normalizeThumbprint(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(':', '').replaceAll(' ', '').trim().toUpperCase();
  return normalized || undefined;
}

function summarizeDryRunChecks(checks: readonly DeploymentPlanDryRunCheckDto[]): { passed: number; failed: number; warning: number; unknown: number } {
  const summary = { passed: 0, failed: 0, warning: 0, unknown: 0 };
  for (const check of checks) {
    if (check.status === 'passed') summary.passed += 1;
    else if (check.status === 'failed') summary.failed += 1;
    else if (check.status === 'warning') summary.warning += 1;
    else summary.unknown += 1;
  }
  return summary;
}

function domainMatches(pattern: string, domain: string): boolean {
  if (pattern === domain) return true;
  if (!pattern.startsWith('*.')) return false;
  const suffix = pattern.slice(1);
  return domain.endsWith(suffix) && domain.length > suffix.length;
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  return code === '42P01' || message.includes('does not exist');
}

function agentProductFamily(osType: string): string | undefined {
  return AGENT_PRODUCT_FAMILY_BY_OS[osType.trim().toUpperCase()];
}

const AGENT_PRODUCT_FAMILY_BY_OS: Readonly<Record<string, string>> = Object.freeze({
  WINDOWS: 'WINDOWS_SERVER',
  LINUX: 'LINUX_SERVER',
});
