import { AppError } from '../../../common/errors/app-error.js';
import { createHash } from 'node:crypto';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService, type WriteAuditInput } from '../../audits/audit.service.js';
import { ApprovalService } from '../../approvals/approval.service.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, RiskLevel } from '../../../shared/security-types.js';
import { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionRunDto, ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { CreateDeploymentPlanFromApplicationAssetInput, CreateDeploymentPlanInput, DeploymentGatewayRouteDto, DeploymentPlanDryRunCheckDto, DeploymentPlanDto, DeploymentPlanTargetDto, DeploymentPlanWorkflowIdentityDto, ExecuteDeploymentPlanInput, CancelDeploymentPlanInput, SubmitDeploymentPlanInput, DryRunDeploymentPlanInput, ReevaluateDeploymentPlanCapabilitiesInput, UpdateDeploymentPlanFromApplicationAssetInput } from '../dto/deployment-plans.dto.js';
import { assertLegacyExecutionRetired, DeploymentPlansDomainService } from '../domain/deployment-plans.domain-service.js';
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
import { DeploymentStrategyResolver } from './deployment-strategy-resolver.js';
import { ExecutionSourceResolver } from './execution-source.resolver.js';
import type { DeploymentArtifactSnapshotDto } from '../../executions/dto/executions.dto.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowDeploymentStrategyDto } from '../../assets/dto/assets.dto.js';
import { ManagedTargetContextResolver } from '../../assets/application/managed-target-context.resolver.js';
import type { DeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { DeploymentCapabilityResolver, type ResolvedDeploymentCapability, type UnifiedPluginVersionReader } from '../../plugins/application/deployment-capability.resolver.js';
import { createDefaultPluginRuntimeAdapterRegistry, type PluginRuntimeAdapterRegistry } from './plugin-runtime-adapter.registry.js';
import { enrichWorkflowCertificateMaterial } from '../../certificates/artifacts/workflow-certificate-material.js';
import { isDeployableCertificateVersion, selectLatestDeployableCertificateVersion } from './certificate-version-selection.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import { RuntimeCredentialResolver } from '../../credentials/application/runtime-credential-resolver.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import type { WorkflowExecutionBinding } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import {
  getDeploymentStrategyPluginBindingId,
  validateDeploymentStrategyPluginBinding,
} from '../../assets/application/deployment-strategy.service.js';
import { deploymentAssetContextBuilder } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { ProductionDeploymentInputResolverService } from '../../deployment-inputs/application/production-deployment-input-resolver.service.js';
import type { ResolveDeploymentInputPhase, ResolvedArtifactV1, ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import type { EffectiveInputBindingV1 } from '../../deployment-inputs/domain/deployment-input-provenance.js';
import { readResolvedDeploymentInputV1 } from '../../deployment-inputs/schema/resolved-deployment-input.schema.js';
import { DeploymentInputSnapshotService } from '../../deployment-inputs/application/deployment-input-snapshot.service.js';
import { DeploymentInputSnapshotsRepository } from '../../deployment-inputs/repository/deployment-input-snapshots.repository.js';
import { DeploymentInputPreflightService, type DeploymentInputPreflightIssue } from '../../deployment-inputs/application/deployment-input-preflight.service.js';
import type {
  DeploymentInputSnapshotEntity,
  DeploymentInputSnapshotIdentityV1,
  DeploymentInputSnapshotRefV1,
  DeploymentInputRuntimeSnapshotV1,
  DeploymentInputSnapshotV1,
} from '../../deployment-inputs/dto/deployment-input-snapshot.dto.js';
import type { ApprovalRequestEntity } from '../../../persistence/entities/approval.entity.js';
import { sanitizeDeploymentInputPersistencePayload } from '../../deployment-inputs/application/deployment-input-persistence-sanitizer.js';
import { readCertificateLocation } from '../../deployment-inputs/dto/certificate-location.dto.js';
import { validateDiscoveredLocationConsistency } from '../../deployment-inputs/domain/deployment-input-consistency.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

type ResolvedCreateTarget = CreateDeploymentPlanInput['targets'][number] & {
  certificateBindingId?: string;
  binding?: CertificateBindingDto;
  managedTarget?: ManagedTargetDto;
  siteAsset?: SiteAssetDto;
  strategyPayload?: Record<string, unknown>;
  deploymentInputSnapshotDraft?: DeploymentInputSnapshotV1;
  deploymentInputRuntimeSnapshotDraft?: DeploymentInputRuntimeSnapshotV1;
};

interface ResolvedDeploymentInputMaterial {
  contract: DeploymentInputContractV1;
  effectiveBinding: EffectiveInputBindingV1;
  resolvedInput: ResolvedDeploymentInputV1;
}

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

type DeploymentPreflightIssue = DeploymentInputPreflightIssue;

type WorkflowVersion = Awaited<ReturnType<WorkflowTemplatesApplicationService['getVersion']>>;

interface DeploymentPlanListContext {
  readonly runsByPlanId: ReadonlyMap<string, ExecutionRunDto[]>;
  readonly targetsByPlanId: ReadonlyMap<string, DeploymentPlanTargetEntity[]>;
  readonly approvalsById: ReadonlyMap<string, ApprovalRequestEntity>;
  readonly workflowVersions: Map<string, Promise<WorkflowVersion | undefined>>;
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
  deploymentInputResolver?: ProductionDeploymentInputResolverService;
  deploymentInputSnapshots?: DeploymentInputSnapshotsRepository;
  tasks?: TaskEnqueuer;
}

export class DeploymentPlansApplicationService {
  private readonly inputPreflight = new DeploymentInputPreflightService();
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
  private readonly deploymentStrategyResolver: DeploymentStrategyResolver;
  private readonly executionSourceResolver: ExecutionSourceResolver;
  private readonly managedTargetContextResolver?: ManagedTargetContextResolver;
  private readonly workflows?: WorkflowTemplatesApplicationService;
  private readonly pluginBindings?: PluginBindingsApplicationService;
  private readonly deploymentCapabilityResolver?: DeploymentCapabilityResolver;
  private readonly unifiedPlugins?: UnifiedPluginVersionReader;
  private readonly pluginWorkflows?: PluginWorkflowPublisherService;
  private readonly credentials?: RuntimeCredentialResolver;
  private readonly pluginRuntimeAdapters: PluginRuntimeAdapterRegistry;
  private readonly deploymentInputResolver: ProductionDeploymentInputResolverService;
  private readonly workflowExecutionBindings?: WorkflowExecutionBindingsService;
  private readonly deploymentInputSnapshotService = new DeploymentInputSnapshotService();
  private readonly deploymentInputSnapshots?: DeploymentInputSnapshotsRepository;
  private readonly tasks?: TaskEnqueuer;

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
    this.deploymentStrategyResolver = dependencies.deploymentStrategyResolver ?? new DeploymentStrategyResolver();
    this.executionSourceResolver = new ExecutionSourceResolver();
    this.managedTargetContextResolver = dependencies.managedTargetContextResolver
      ?? (dependencies.deviceAssets ? new ManagedTargetContextResolver(this.assets, this.agents, dependencies.deviceAssets) : undefined);
    this.workflows = dependencies.workflows;
    this.pluginBindings = dependencies.pluginBindings;
    this.deploymentCapabilityResolver = dependencies.pluginBindings && dependencies.unifiedPlugins
      ? new DeploymentCapabilityResolver(dependencies.pluginBindings, dependencies.unifiedPlugins)
      : undefined;
    this.unifiedPlugins = dependencies.unifiedPlugins;
    this.pluginWorkflows = dependencies.pluginWorkflows;
    this.credentials = dependencies.credentials ?? (dependencies.secrets && dependencies.database
      ? new RuntimeCredentialResolver(new CredentialsRepository(dependencies.database), dependencies.secrets)
      : undefined);
    this.pluginRuntimeAdapters = dependencies.pluginRuntimeAdapters ?? createDefaultPluginRuntimeAdapterRegistry();
    this.deploymentInputResolver = dependencies.deploymentInputResolver ?? new ProductionDeploymentInputResolverService();
    this.deploymentInputSnapshots = dependencies.deploymentInputSnapshots
      ?? (dependencies.database ? new DeploymentInputSnapshotsRepository(dependencies.database) : undefined);
    this.workflowExecutionBindings = dependencies.database
      ? new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(dependencies.database))
      : undefined;
    this.tasks = dependencies.tasks;
  }

  getRepository(): DeploymentPlansRepository {
    return this.repository;
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.executions;
  }

  async list(input: { tenantId?: string } = {}): Promise<DeploymentPlanDto[]> {
    const sourcePlans = await this.repository.listPlans(input.tenantId);
    const approvalIds = sourcePlans
      .map((plan) => plan.approvalId)
      .filter((id): id is string => Boolean(id));
    const approvalsById = await this.approval.getMany(approvalIds);
    const plans = await Promise.all(
      sourcePlans.map((plan) => this.synchronizeApprovalState(plan, approvalsById.get(plan.approvalId ?? ''))),
    );
    const [runs, targets] = await Promise.all([
      this.executions.listRuns({ tenantId: input.tenantId }) as Promise<ExecutionRunDto[]>,
      this.repository.listTargetsByPlans(plans.map((plan) => plan.id), input.tenantId),
    ]);
    const runsByPlanId = new Map<string, ExecutionRunDto[]>();
    for (const run of runs) {
      const current = runsByPlanId.get(run.deploymentPlanId) ?? [];
      current.push(run);
      runsByPlanId.set(run.deploymentPlanId, current);
    }
    const targetsByPlanId = new Map<string, DeploymentPlanTargetEntity[]>();
    for (const target of targets) {
      const current = targetsByPlanId.get(target.deploymentPlanId) ?? [];
      current.push(target);
      targetsByPlanId.set(target.deploymentPlanId, current);
    }
    const context: DeploymentPlanListContext = {
      runsByPlanId,
      targetsByPlanId,
      approvalsById,
      workflowVersions: new Map(),
    };
    return Promise.all(plans.map((plan) => this.toDto(plan, context)));
  }

  async get(id: string, tenantId?: string): Promise<DeploymentPlanDto> {
    return this.toDto(await this.synchronizeApprovalState(await this.repository.getPlanOrThrow(id, tenantId)));
  }

  async listInputSnapshots(planId: string, tenantId?: string): Promise<DeploymentInputSnapshotEntity[]> {
    if (!tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    await this.repository.getPlanOrThrow(planId, tenantId);
    if (!this.deploymentInputSnapshots) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '部署输入快照仓储未接入', { code: 'DEPLOYMENT_INPUT_SNAPSHOT_REPOSITORY_MISSING' });
    }
    return this.deploymentInputSnapshots.listByPlan(tenantId, planId);
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
        deploymentInputSnapshotDraft: target.deploymentInputSnapshotDraft,
        deploymentInputRuntimeSnapshotDraft: target.deploymentInputRuntimeSnapshotDraft,
      };
    }));
    const hasCapabilityRisk = targetDrafts.some((target) => ['manual_required', 'degraded'].includes(String(target.matchResult?.status ?? '')));
    targetDrafts.forEach((target, index) => assertLegacyExecutionRetired(target.executorType, { index }));
    if (hasCapabilityRisk) {
      policy.approvalRequired = true;
      if (policy.riskLevel === 'low' || policy.riskLevel === 'medium') policy.riskLevel = 'high';
    }
    if (targetDrafts.some(targetRequestsInsecureTls)) {
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

    const inputSnapshotRefs: DeploymentInputSnapshotRefV1[] = [];
    for (const target of targetDrafts) {
      const createdTarget = await this.repository.createTarget({
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
      const snapshotRef = await this.persistDeploymentInputSnapshot(
        plan,
        createdTarget,
        target.deploymentInputSnapshotDraft,
        target.deploymentInputRuntimeSnapshotDraft,
        input.actorId,
      );
      if (snapshotRef) inputSnapshotRefs.push(snapshotRef);
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
        deploymentInputSnapshots: inputSnapshotRefs,
      },
    });

    return this.toDto(plan);
  }

  async createFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const idempotentPlan = await this.repository.findPlanByIdempotencyKey(input.tenantId, input.actorId, input.idempotencyKey);
    if (idempotentPlan) {
      const draft = await this.buildCreateInputFromApplicationAsset(input);
      return this.create(draft, context);
    }
    const reusableDraft = await this.repository.findLatestManualDraftByApplicationAsset(input.tenantId, input.applicationAssetId);
    if (reusableDraft) {
      return this.updateDraftFromApplicationAsset({ ...input, planId: reusableDraft.id }, context);
    }
    const draft = await this.buildCreateInputFromApplicationAsset(input);
    return this.create(draft, context);
  }

  async resolveProjectionSource(input: Pick<CreateDeploymentPlanFromApplicationAssetInput, 'applicationAssetId' | 'tenantId'>): Promise<{
    contract: ReturnType<DeploymentInputContractLoader['fromPlugin']>;
    resolvedInput: ResolvedDeploymentInputV1;
    effectiveBinding?: import('../../deployment-inputs/domain/deployment-input-provenance.js').EffectiveInputBindingV1;
  }> {
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const draft = await this.buildCreateInputFromApplicationAsset({
      applicationAssetId: input.applicationAssetId,
      tenantId: input.tenantId,
      idempotencyKey: `projection:${input.applicationAssetId}`,
      actorId: 'projection',
    });
    const target = draft.targets[0];
    const payload = target?.strategyPayload ?? {};
    const resolvedInput = readResolvedDeploymentInputV1(payload.resolvedDeploymentInput);
    if (!resolvedInput) throw new AppError('VALIDATION_FAILED', '应用资产执行来源未生成统一部署输入', { applicationAssetId: input.applicationAssetId });
    const runtimeCapability = readRecord(payload.pluginRuntimeCapability);
    if (runtimeCapability) {
      if (!this.unifiedPlugins) throw new AppError('SYSTEM_INTERNAL_ERROR', '统一插件版本服务未接入');
      const pluginVersionId = readOptionalString(runtimeCapability.pluginVersionId);
      const capabilityKey = readOptionalString(runtimeCapability.capabilityKey);
      if (!pluginVersionId || !capabilityKey) throw new AppError('VALIDATION_FAILED', '插件 Projection 缺少版本化输入身份');
      const plugin = await this.unifiedPlugins.getVersion(pluginVersionId);
      return { contract: new DeploymentInputContractLoader().fromPlugin(plugin, capabilityKey), resolvedInput, effectiveBinding: effectiveBindingFromPayload(payload) };
    }
    const executionSource = readRecord(payload.executionSource);
    const workflowVersionId = readOptionalString(executionSource?.workflowVersionId);
    if (!workflowVersionId || !this.workflows) throw new AppError('VALIDATION_FAILED', 'Workflow Projection 缺少版本化输入身份');
    const version = await this.workflows.getVersion(workflowVersionId);
    return { contract: new DeploymentInputContractLoader().fromWorkflowVersion(version), resolvedInput, effectiveBinding: effectiveBindingFromPayload(payload) };
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
        deploymentInputSnapshotDraft: target.deploymentInputSnapshotDraft,
        deploymentInputRuntimeSnapshotDraft: target.deploymentInputRuntimeSnapshotDraft,
      };
    }));
    const hasCapabilityRisk = targetDrafts.some((target) => ['manual_required', 'degraded'].includes(String(target.matchResult?.status ?? '')));
    targetDrafts.forEach((target, index) => assertLegacyExecutionRetired(target.executorType, { index, planId: plan.id }));
    if (hasCapabilityRisk) {
      policy.approvalRequired = true;
      if (policy.riskLevel === 'low' || policy.riskLevel === 'medium') policy.riskLevel = 'high';
    }
    if (targetDrafts.some(targetRequestsInsecureTls)) {
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
    const inputSnapshotRefs: DeploymentInputSnapshotRefV1[] = [];
    for (const target of targetDrafts) {
      const createdTarget = await this.repository.createTarget({
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
      const snapshotRef = await this.persistDeploymentInputSnapshot(
        updated,
        createdTarget,
        target.deploymentInputSnapshotDraft,
        target.deploymentInputRuntimeSnapshotDraft,
        draft.actorId,
      );
      if (snapshotRef) inputSnapshotRefs.push(snapshotRef);
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
        deploymentInputSnapshots: inputSnapshotRefs,
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
    const applicationAssetDetail = await this.assets.getServiceAssetDetail(input.tenantId, input.applicationAssetId);
    const selectionMode = input.selectionMode ?? (input.targetCertificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    const certificateVersionId = input.targetCertificateVersionId ?? undefined;
    const planName = `${applicationAsset.displayName ?? applicationAsset.address} 证书部署`;
    const strategyAsset = await this.validateStrategyPluginBinding(
      input.tenantId,
      applicationAssetDetail ?? applicationAsset,
    );
    const deploymentStrategy = strategyAsset.deploymentStrategy;
    const strategyType = deploymentStrategy?.type;
    const managedTargetId = deploymentStrategy?.type === 'MANAGED_TARGET'
      ? deploymentStrategy.managedTarget?.managedTargetId
      : bindingTarget.managedTargetId;
    const managedTargetContext = strategyType === 'MANAGED_TARGET'
      ? await this.resolveManagedTargetContext(input.tenantId, managedTargetId)
      : undefined;
    const targetContext = managedTargetContext ?? await this.resolveManagedTargetContext(input.tenantId, bindingTarget.managedTargetId);
    const readyBinding = await this.tryResolveApplicationAssetCertificateBinding(
      input.tenantId,
      applicationAssetDetail?.targetBindingDetail?.certificateBindings ?? [],
      input.applicationAssetId,
      targetContext.managedTarget.id,
    );
    const certificateFormatId = input.certificateFormatId
      ?? (deploymentStrategy?.type === 'MANAGED_TARGET' ? deploymentStrategy.managedTarget?.certificateFormatId : undefined);
    const executionMode = deploymentStrategy?.type === 'MANAGED_TARGET' ? deploymentStrategy.managedTarget?.executionMode ?? 'PLUGIN' : 'PLUGIN';
    const resolvedStrategy = executionMode === 'WORKFLOW_OVERRIDE'
      ? await this.compileWorkflowExecutionBinding(input.tenantId, strategyAsset, deploymentStrategy?.managedTarget?.workflowExecutionBindingId, 'WORKFLOW_OVERRIDE', bindingTarget, managedTargetContext, readyBinding)
      : await this.compileManagedPluginExecution(input.tenantId, strategyAsset, bindingTarget, managedTargetContext, readyBinding);

    return {
      name: planName,
      certificateVersionId,
      certificateFormatId,
      selectionMode,
      targets: [{
        certificateBindingId: readyBinding?.id,
        applicationAssetId: applicationAsset.id,
        serviceAssetId: applicationAsset.id,
        managedTargetId: targetContext.managedTarget.id,
        siteAssetId: targetContext.siteAsset?.id,
        domain: applicationAsset.sniName ?? applicationAsset.address,
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
    const credentials = await this.snapshotCredentials(tenantId, binding.inputBindings.credentials);
    return {
      ...asset,
      deploymentStrategy: {
        ...validated,
        workflow: {
          ...validated.workflow,
          workflowId: workflowBinding.workflowTemplateId,
          workflowVersionSelection: 'PINNED',
          workflowVersionId: workflowBinding.workflowVersionId,
          inputBindings: binding.inputBindings,
          credentials,
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
    const plugin = this.unifiedPlugins ? await this.unifiedPlugins.getVersion(binding.pluginVersionId) : undefined;
    const workflowRequest = readRecord(resolved.payload.workflowRequest);
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        workflowRequest: workflowRequest ? {
          ...workflowRequest,
          pluginVersionId: binding.pluginVersionId,
          ...(plugin ? { pluginId: plugin.pluginId, pluginVersion: plugin.version } : {}),
          pluginBindingId,
          capabilityKey: 'certificate.deploy',
        } : workflowRequest,
      },
    };
  }

  private async compileManagedPluginExecution(
    tenantId: string,
    asset: ServiceAssetDto,
    bindingTarget: Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>> | undefined,
    certificateBinding?: CertificateBindingDto,
  ) {
    const resolved = await this.compileManagedPluginRuntime(tenantId, asset, bindingTarget, context, certificateBinding);
    return this.attachWorkflowCredentialSnapshots(tenantId, await this.attachPluginExecutionIdentity(asset, resolved));
  }

  private async compileWorkflowExecutionBinding(
    tenantId: string,
    asset: ServiceAssetDto,
    bindingId: string | undefined,
    mode: 'WORKFLOW_OVERRIDE' | 'WORKFLOW',
    bindingTarget?: Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>,
    context?: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>>,
    certificateBinding?: CertificateBindingDto,
  ) {
    if (!bindingId || !this.workflowExecutionBindings) {
      throw new AppError('VALIDATION_FAILED', '工作流执行模式缺少 WorkflowExecutionBinding', { bindingId, mode });
    }
    const binding = await this.workflowExecutionBindings.get(tenantId, bindingId);
    if (binding.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', 'WorkflowExecutionBinding 已停用', { bindingId });
    const expectedLocation = binding.runner === 'GATEWAY' ? 'GATEWAY' : 'CONTROL_PLANE';
    if (mode === 'WORKFLOW_OVERRIDE' && context && !context.availableExecutionLocations.includes(expectedLocation)) {
      throw new AppError('WORKFLOW_RUNNER_INCOMPATIBLE', '工作流 Runner 与 ManagedTarget 可执行位置不兼容', { expectedLocation, availableExecutionLocations: context.availableExecutionLocations });
    }
    const workflowVersionId = await this.resolveWorkflowExecutionVersion(binding);
    const executionSource = this.executionSourceResolver.resolveWorkflow({ mode, binding, workflowVersionId });
    const effectiveBinding = this.deploymentInputResolver.resolveProjectionResult({
      phase: 'configure',
      contract: new DeploymentInputContractLoader().fromWorkflowVersion(await this.workflows!.getVersion(workflowVersionId)),
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset: asset, managedTargetContext: context }),
      bindingLayers: { assetOverride: { pluginVersionId: workflowVersionId, inputBindings: binding.inputBindings } },
      credentialSnapshots: await this.snapshotCredentials(tenantId, binding.inputBindings.credentials),
    }).effectiveBinding;
    const resolvedInput = (await this.resolveWorkflowBindingDeploymentInput('configure', tenantId, binding, workflowVersionId, asset, context)).resolvedInput;
    const materializedAsset: ServiceAssetDto = {
      ...asset,
      deploymentStrategy: {
        type: 'WORKFLOW',
        workflow: {
          workflowId: binding.workflowTemplateId,
          workflowVersionSelection: 'PINNED',
          workflowVersionId,
          runner: binding.runner,
          gatewayId: binding.gatewayId,
          inputBindings: binding.inputBindings,
        },
      },
    };
    const resolved = await this.attachWorkflowCredentialSnapshots(tenantId, this.deploymentStrategyResolver.resolve({
      applicationAsset: materializedAsset,
      bindingTarget,
      managedTargetContext: context,
      certificateBinding,
    }));
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        resolvedDeploymentInput: resolvedInput,
        effectiveInputBindings: effectiveBinding.inputBindings,
        executionSource: {
          type: executionSource.type,
          mode: executionSource.mode,
          workflowExecutionBindingId: executionSource.binding.id,
          bindingVersion: executionSource.binding.version,
          workflowTemplateId: executionSource.binding.workflowTemplateId,
          workflowVersionSelection: executionSource.binding.workflowVersionSelection,
          workflowVersionId: executionSource.workflowVersionId,
          runner: executionSource.binding.runner,
          gatewayId: executionSource.binding.gatewayId,
        },
        managedTargetId: mode === 'WORKFLOW_OVERRIDE' ? context?.managedTarget.id : undefined,
        targetSnapshot: mode === 'WORKFLOW_OVERRIDE' && context ? { managedTarget: context.managedTarget, host: context.host, siteAsset: context.siteAsset, frameworkInstance: context.serviceInstance } : undefined,
      },
    };
  }

  private async resolveWorkflowExecutionVersion(binding: WorkflowExecutionBinding): Promise<string> {
    if (binding.workflowVersionSelection === 'PINNED') return binding.workflowVersionId!;
    if (!this.workflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本服务未接入');
    const latest = await this.workflows.getRuntimePublishedVersion(binding.workflowTemplateId);
    if (!latest) throw new AppError('VALIDATION_FAILED', 'LATEST_PUBLISHED 找不到已发布工作流版本', { workflowTemplateId: binding.workflowTemplateId });
    return latest.id;
  }

  private async compileManagedPluginRuntime(
    tenantId: string,
    asset: ServiceAssetDto,
    bindingTarget: Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>> | undefined,
    certificateBinding?: CertificateBindingDto,
  ): Promise<ReturnType<DeploymentStrategyResolver['resolve']>> {
    if (asset.deploymentStrategy?.type !== 'MANAGED_TARGET' || !context) {
      return this.deploymentStrategyResolver.resolve({
        applicationAsset: asset,
        bindingTarget,
        certificateBinding,
        managedTargetContext: context,
      });
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
    const executionSource = this.executionSourceResolver.resolvePlugin({
      capability,
      internalWorkflowVersionId: workflow?.workflowVersionId,
    });
    const inputResult = await this.resolveCapabilityDeploymentInput('configure', tenantId, capability, context, asset);
    const resolvedInput = inputResult.resolvedInput;
    const runtime = await this.pluginRuntimeAdapters.compile({
      capability,
      context,
      applicationAsset: asset,
      resolvedInput,
      certificateBindingId: certificateBinding?.id,
      workflow: workflow ? { workflowId: workflow.workflowTemplateId, workflowVersionId: workflow.workflowVersionId } : undefined,
    });
    const resolved = this.deploymentStrategyResolver.resolve({
      applicationAsset: asset,
      bindingTarget,
      certificateBinding,
      managedTargetContext: context,
      managedTargetRuntime: runtime,
    });
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        effectiveInputBindings: inputResult.effectiveBinding.inputBindings,
        executionSource: {
          type: executionSource.type,
          mode: 'PLUGIN',
          assignmentId: executionSource.capability.assignment.id,
          pluginVersionId: executionSource.capability.pluginVersionId,
          pluginBindingId: executionSource.capability.binding.id,
          runtime: executionSource.capability.pluginRuntime,
          internalWorkflowVersionId: executionSource.internalWorkflowVersionId,
          atomicRecipeId: executionSource.atomicRecipeId,
        },
      },
    };
  }

  private requirePluginWorkflow(pluginVersionId: string, capabilityKey: string) {
    if (!this.pluginWorkflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '插件 Workflow 发布服务未接入', { code: 'PLUGIN_WORKFLOW_RESOLVER_MISSING' });
    return this.pluginWorkflows.require(pluginVersionId, capabilityKey);
  }

  private async resolveCapabilityDeploymentInput(
    phase: ResolveDeploymentInputPhase,
    tenantId: string,
    capability: ResolvedDeploymentCapability,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>>,
    asset: ServiceAssetDto,
    artifact?: DeploymentArtifactSnapshotDto,
  ): Promise<{ resolvedInput: ResolvedDeploymentInputV1; effectiveBinding: import('../../deployment-inputs/domain/deployment-input-provenance.js').EffectiveInputBindingV1 }> {
    const contract = new DeploymentInputContractLoader().fromPlugin(capability.plugin, capability.assignment.capabilityKey);
    const bindingLayers = await this.resolveCapabilityBindingLayers(tenantId, capability, context, asset.id);
    const request = {
      phase,
      contract,
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset: asset, managedTargetContext: context }),
      bindingLayers,
      credentialSnapshots: await this.snapshotCredentials(tenantId, capability.binding.inputBindings.credentials),
      artifactSnapshots: artifact ? artifactSnapshotsFromDeploymentArtifact(artifact) : undefined,
    };
    if (phase === 'configure') return this.deploymentInputResolver.resolveProjectionResult(request);
    const resolvedInput = this.deploymentInputResolver.resolve(request);
    return { resolvedInput, effectiveBinding: this.deploymentInputResolver.resolveProjectionResult(request).effectiveBinding };
  }

  private async resolveCapabilityBindingLayers(
    tenantId: string,
    capability: ResolvedDeploymentCapability,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>>,
    applicationAssetId: string,
  ) {
    if (!this.pluginBindings) throw new AppError('SYSTEM_INTERNAL_ERROR', 'PluginBinding 服务未接入');
    const assignments = await this.pluginBindings.listAssignmentCandidates(tenantId, capability.assignment.capabilityKey, {
      deviceId: context.host.id,
      managedTargetId: context.managedTarget.id,
      applicationAssetId,
    });
    const layers: Record<string, { pluginVersionId: string; inputBindings: InputBindingsV1 }> = {};
    for (const assignment of assignments.filter((item) => item.pluginVersionId === capability.pluginVersionId)) {
      const binding = await this.pluginBindings.getTenantBinding(tenantId, assignment.pluginBindingId);
      if (binding.status !== 'ACTIVE' || binding.pluginVersionId !== capability.pluginVersionId) continue;
      const layer = { pluginVersionId: capability.pluginVersionId, inputBindings: binding.inputBindings };
      if (assignment.ownerType === 'DEVICE') layers.deviceDefault = layer;
      if (assignment.ownerType === 'MANAGED_TARGET') layers.targetOverride = layer;
      if (assignment.ownerType === 'APPLICATION_ASSET') layers.assetOverride = layer;
    }
    return layers;
  }

  private async resolveTargetDeploymentInput(
    phase: ResolveDeploymentInputPhase,
    tenantId: string,
    target: {
      applicationAssetId?: string;
      serviceAssetId?: string;
      managedTargetId?: string;
      strategyPayload?: Record<string, unknown>;
    },
    artifact: DeploymentArtifactSnapshotDto,
  ): Promise<ResolvedDeploymentInputMaterial | undefined> {
    const strategyPayload = target.strategyPayload ?? {};
    const runtimeCapability = readRecord(strategyPayload.pluginRuntimeCapability);
    if (!runtimeCapability) {
      const workflowRequest = readRecord(strategyPayload.workflowRequest);
      if (!workflowRequest) {
        const resolvedInput = readResolvedDeploymentInputV1(strategyPayload.resolvedDeploymentInput);
        if (!resolvedInput) return undefined;
        throw new AppError('VALIDATION_FAILED', '部署目标缺少可重放的完整输入材料', { code: 'DEPLOYMENT_INPUT_SNAPSHOT_INVALID' });
      }
      const executionSource = readRecord(strategyPayload.executionSource);
      const workflowBindingId = readOptionalString(executionSource?.workflowExecutionBindingId);
      const workflowVersionId = readOptionalString(executionSource?.workflowVersionId)
        ?? readOptionalString(workflowRequest.workflowVersionId);
      if (!workflowBindingId || !workflowVersionId || !this.workflowExecutionBindings) {
        throw new AppError('VALIDATION_FAILED', 'Workflow 部署缺少版本化统一输入 Binding', {
          code: 'DEPLOYMENT_INPUT_IDENTITY_REQUIRED',
          workflowBindingId,
          workflowVersionId,
        });
      }
      const applicationAssetId = target.applicationAssetId ?? target.serviceAssetId;
      const applicationAsset = applicationAssetId ? await this.assets.getServiceAsset(tenantId, applicationAssetId) : undefined;
      if (!applicationAsset) throw new AppError('RESOURCE_NOT_FOUND', '统一部署输入缺少 ApplicationAsset', { applicationAssetId });
      const managedTargetId = target.managedTargetId
        ?? readOptionalString(strategyPayload.managedTargetId)
        ?? readOptionalString(workflowRequest.managedTargetId);
      const context = managedTargetId && this.managedTargetContextResolver
        ? await this.managedTargetContextResolver.resolve(tenantId, managedTargetId)
        : undefined;
      const binding = await this.workflowExecutionBindings.get(tenantId, workflowBindingId);
      return this.resolveWorkflowBindingDeploymentInput(phase, tenantId, binding, workflowVersionId, applicationAsset, context, artifact);
    }
    if (!this.pluginBindings || !this.unifiedPlugins || !this.managedTargetContextResolver) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '统一部署输入解析依赖未完整接入', {
        code: 'DEPLOYMENT_INPUT_RESOLVER_DEPENDENCY_MISSING',
      });
    }
    const pluginBindingId = readOptionalString(runtimeCapability.pluginBindingId);
    const pluginVersionId = readOptionalString(runtimeCapability.pluginVersionId);
    const capabilityKey = readOptionalString(runtimeCapability.capabilityKey);
    const ownerType = readOptionalString(runtimeCapability.assignmentOwnerType);
    if (!pluginBindingId || !pluginVersionId || !capabilityKey || !ownerType) {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少固定插件输入身份', {
        code: 'DEPLOYMENT_INPUT_IDENTITY_REQUIRED',
        pluginBindingId,
        pluginVersionId,
        capabilityKey,
        ownerType,
      });
    }
    const binding = await this.pluginBindings.getTenantBinding(tenantId, pluginBindingId);
    if (binding.pluginVersionId !== pluginVersionId) {
      throw new AppError('VALIDATION_FAILED', '部署目标插件版本与 Binding 不一致', {
        code: 'DEPLOYMENT_INPUT_VERSION_MISMATCH',
        pluginBindingId,
        pluginVersionId,
        bindingPluginVersionId: binding.pluginVersionId,
      });
    }
    const applicationAssetId = target.applicationAssetId ?? target.serviceAssetId;
    const applicationAsset = applicationAssetId ? await this.assets.getServiceAsset(tenantId, applicationAssetId) : undefined;
    if (!applicationAsset) throw new AppError('RESOURCE_NOT_FOUND', '统一部署输入缺少 ApplicationAsset', { applicationAssetId });
    const workflowRequest = readRecord(strategyPayload.workflowRequest);
    const managedTargetId = target.managedTargetId
      ?? readOptionalString(strategyPayload.managedTargetId)
      ?? readOptionalString(workflowRequest?.managedTargetId);
    if (!managedTargetId) throw new AppError('VALIDATION_FAILED', '统一部署输入缺少 ManagedTarget', { applicationAssetId });
    const context = await this.managedTargetContextResolver.resolve(tenantId, managedTargetId);
    const plugin = await this.unifiedPlugins.getVersion(pluginVersionId);
    const contract = new DeploymentInputContractLoader().fromPlugin(plugin, capabilityKey);
    const assignments = await this.pluginBindings.listAssignmentCandidates(tenantId, capabilityKey, {
      deviceId: context.host.id,
      managedTargetId: context.managedTarget.id,
      applicationAssetId,
    });
    const bindingLayers: {
      deviceDefault?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
      targetOverride?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
      assetOverride?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
    } = {};
    let pinnedAssignmentFound = false;
    for (const assignment of assignments.filter((item) => item.pluginVersionId === pluginVersionId)) {
      const candidate = await this.pluginBindings.getTenantBinding(tenantId, assignment.pluginBindingId);
      if (candidate.status !== 'ACTIVE' || candidate.pluginVersionId !== pluginVersionId) continue;
      const layer = { pluginVersionId, inputBindings: candidate.inputBindings };
      if (assignment.ownerType === 'DEVICE') bindingLayers.deviceDefault = layer;
      else if (assignment.ownerType === 'MANAGED_TARGET') bindingLayers.targetOverride = layer;
      else if (assignment.ownerType === 'APPLICATION_ASSET') bindingLayers.assetOverride = layer;
      if (assignment.ownerType === ownerType && assignment.pluginBindingId === pluginBindingId) {
        pinnedAssignmentFound = true;
        if (runtimeCapability.pluginBindingVersion !== undefined
          && candidate.version !== Number(runtimeCapability.pluginBindingVersion)) {
          throw new AppError('VALIDATION_FAILED', '部署目标 PluginBinding 版本已变化', {
            code: 'DEPLOYMENT_INPUT_BINDING_VERSION_MISMATCH',
            pluginBindingId,
            expectedVersion: runtimeCapability.pluginBindingVersion,
            actualVersion: candidate.version,
          });
        }
      }
    }
    if (!pinnedAssignmentFound) {
      throw new AppError('VALIDATION_FAILED', '部署目标插件 Binding 指派已失效', {
        code: 'DEPLOYMENT_INPUT_BINDING_ASSIGNMENT_MISSING',
        pluginBindingId,
        pluginVersionId,
        ownerType,
      });
    }
    const request = {
      phase,
      contract,
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context }),
      bindingLayers,
      credentialSnapshots: await this.snapshotCredentials(tenantId, collectBindingCredentials(bindingLayers)),
      artifactSnapshots: artifactSnapshotsFromDeploymentArtifact(artifact),
    };
    const projection = this.deploymentInputResolver.resolveProjectionResult(request);
    const resolvedInput = phase === 'configure' ? projection.resolvedInput : this.deploymentInputResolver.resolve(request);
    return { contract, effectiveBinding: projection.effectiveBinding, resolvedInput };
  }

  private async resolveWorkflowBindingDeploymentInput(
    phase: ResolveDeploymentInputPhase,
    tenantId: string,
    binding: WorkflowExecutionBinding,
    workflowVersionId: string,
    asset: ServiceAssetDto,
    context?: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>>,
    artifact?: DeploymentArtifactSnapshotDto,
  ): Promise<ResolvedDeploymentInputMaterial> {
    if (!this.workflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本服务未接入');
    const version = await this.workflows.getVersion(workflowVersionId);
    const contract = new DeploymentInputContractLoader().fromWorkflowVersion(version);
    const request = {
      phase,
      contract,
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset: asset, managedTargetContext: context }),
      bindingLayers: {
        assetOverride: {
          pluginVersionId: workflowVersionId,
          inputBindings: binding.inputBindings,
        },
      },
      credentialSnapshots: await this.snapshotCredentials(tenantId, binding.inputBindings.credentials),
      artifactSnapshots: artifact ? artifactSnapshotsFromDeploymentArtifact(artifact) : undefined,
    };
    const projection = this.deploymentInputResolver.resolveProjectionResult(request);
    const resolvedInput = phase === 'configure' ? projection.resolvedInput : this.deploymentInputResolver.resolve(request);
    return { contract, effectiveBinding: projection.effectiveBinding, resolvedInput };
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
    const credentialBindings = readCredentialBindings(readRecord(workflowRequest.inputBindings)?.credentials);
    if (Object.keys(credentialBindings).length === 0) return resolved;
    return {
      ...resolved,
      payload: {
        ...resolved.payload,
        workflowRequest: {
          ...workflowRequest,
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
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const resolvedStrategy = workflow.workflowExecutionBindingId
      ? await this.compileWorkflowExecutionBinding(input.tenantId, applicationAsset, workflow.workflowExecutionBindingId, 'WORKFLOW')
      : await this.attachWorkflowCredentialSnapshots(input.tenantId, await this.attachPluginExecutionIdentity(applicationAsset, this.deploymentStrategyResolver.resolve({ applicationAsset })));
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

  private async tryResolveApplicationAssetCertificateBinding(
    tenantId: string,
    items: Array<Pick<CertificateBindingDto, 'id' | 'serviceAssetId' | 'managedTargetId'>>,
    applicationAssetId: string,
    managedTargetId: string,
  ): Promise<CertificateBindingDto | undefined> {
    const explicit = items.find((item) => item.serviceAssetId === applicationAssetId)
      ?? items.find((item) => item.managedTargetId === managedTargetId);
    return explicit ? this.tryGetBinding(tenantId, explicit.id) : undefined;
  }

  async submit(input: SubmitDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.synchronizeApprovalState(await this.repository.getPlanOrThrow(input.planId, input.tenantId));
    if (plan.status === 'READY') return this.toDto(plan);

    if (plan.status === 'PENDING_APPROVAL') {
      if (!input.approvalId) return this.toDto(plan);
      await this.approval.consume(input.approvalId, await this.approvalParameters(plan));
      const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
      return this.toDto(ready);
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DRAFT 或 PENDING_APPROVAL 计划允许提交', { planId: plan.id, status: plan.status });
    }

    if (await this.requiresApproval(plan)) {
      if (input.approvalId) {
        await this.approval.consume(input.approvalId, await this.approvalParameters(plan));
        const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
        return this.toDto(ready);
      }
      const approval = await this.approval.create({
        operationType: 'deployment.execute',
        resourceRefs: [{ type: 'deploymentPlan', id: plan.id }],
        riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
        parameters: await this.approvalParameters(plan),
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
    let plan = await this.synchronizeApprovalState(await this.repository.getPlanOrThrow(input.planId, input.tenantId));
    let executionApprovalId = plan.approvalId;
    let executionApproved = plan.approvalStatus === 'APPROVED';
    if (await this.requiresApproval(plan)) {
      executionApprovalId = input.approvalId ?? plan.approvalId;
      if (!executionApprovalId) {
        await this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'missing approval');
        throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '高风险部署执行必须提供已批准审批单', { planId: plan.id });
      }
      try {
        await this.approval.consume(executionApprovalId, await this.approvalParameters(plan));
      } catch (error) {
        await this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'approval invalid');
        throw error;
      }
      // 审批消费是本次正式执行的授权事实。不能只在 DRAFT/PENDING_APPROVAL
      // 状态转换时回写，否则 READY/历史结束计划会继续携带 NOT_REQUIRED，
      // 进而让工作流子步骤无法获得 workflow.tls.insecure Grant。
      executionApproved = true;
      if (plan.status === 'DRAFT' || plan.status === 'PENDING_APPROVAL') {
        plan = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', {
          approvalStatus: 'APPROVED',
          approvalId: executionApprovalId,
        });
      } else if (plan.approvalStatus !== 'APPROVED' || plan.approvalId !== executionApprovalId) {
        plan = await this.repository.updatePlan(plan.id, {
          approvalStatus: 'APPROVED',
          approvalId: executionApprovalId,
          updatedAt: new Date().toISOString(),
          updatedBy: input.actorId,
        });
      }
    }

    if (!['READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 READY 或已结束的计划允许执行/重新执行', { planId: plan.id, status: plan.status });
    }
    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可执行目标', { planId: plan.id });
    targets.forEach((target) => assertLegacyExecutionRetired(target.executorType, { planId: plan.id, deploymentPlanTargetId: target.id }));
    await this.assertLatestDryRunPassed(plan, input.tenantId);
    const running = await this.transitionPlan(plan, 'RUNNING', input.actorId, 'execution.started');
    const runtimeSnapshots = await this.resolveRunDeploymentInputRuntimeSnapshots(plan, targets);
    const agentPayloadByTargetId = await this.buildAgentPayloadByTargetIds(plan, targets, runtimeSnapshots);
    for (const [targetId, payload] of agentPayloadByTargetId) {
      const workflowRequest = readRecord(payload.workflowRequest);
      const workflowVersionId = readOptionalString(workflowRequest?.workflowVersionId);
      const runtimeSnapshot = runtimeSnapshots.get(targetId);
      const allowInsecureTls = runtimeSnapshot?.resolvedDeploymentInput.variables.allowInsecureTls === true;
      agentPayloadByTargetId.set(targetId, {
        ...payload,
        executionAuthorization: {
          tenantId: plan.tenantId,
          planId: plan.id,
          targetId,
          approvalId: executionApprovalId,
          workflowVersionId,
          snapshotHash: plan.snapshotHash,
          approved: executionApproved,
          allowInsecureTls,
        },
      });
    }
    const created = await this.executions.createApplyRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      agentPayloadByTargetId,
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    const taskTenantId = plan.tenantId ?? input.tenantId;
    if (!taskTenantId) throw new AppError('TENANT_CONTEXT_INVALID', '部署计划缺少租户上下文', { planId: plan.id });
    enqueueTaskBestEffort(this.tasks, {
      tenantId: taskTenantId,
      taskType: 'CERTIFICATE_DEPLOY',
      requestedBy: input.actorId,
      triggerSource: 'deployment-plan.execute',
      idempotencyKey: `deployment-plan:execute:${created.run.id}`,
      payload: { planId: plan.id, executionRunId: created.run.id },
      resourceRefs: [
        { resourceType: 'deploymentPlan', resourceId: plan.id },
        { resourceType: 'executionRun', resourceId: created.run.id },
      ],
    });
    return { plan: await this.toDto(running), ...created };
  }

  async dryRun(input: DryRunDeploymentPlanInput, context: RequestContext = {}): Promise<{ plan: DeploymentPlanDto; run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    let plan = await this.synchronizeApprovalState(await this.repository.getPlanOrThrow(input.planId, input.tenantId));
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未运行或已结束的计划允许 dry-run', { planId: plan.id, status: plan.status });
    }

    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可 dry-run 目标', { planId: plan.id });
    targets.forEach((target) => assertLegacyExecutionRetired(target.executorType, { planId: plan.id, deploymentPlanTargetId: target.id }));
    const runtimeSnapshots = await this.resolveRunDeploymentInputRuntimeSnapshots(plan, targets);
    const deploymentArtifactByTargetId = deploymentArtifactsFromRuntimeSnapshots(runtimeSnapshots);
    const agentPayloadByTargetId = await this.buildAgentPayloadByTargetIds(plan, targets, runtimeSnapshots);
    for (const [targetId, payload] of agentPayloadByTargetId) {
      const runtimeSnapshot = runtimeSnapshots.get(targetId);
      const workflowRequest = readRecord(payload.workflowRequest);
      agentPayloadByTargetId.set(targetId, {
        ...payload,
        executionAuthorization: {
          tenantId: plan.tenantId,
          planId: plan.id,
          targetId,
          approvalId: plan.approvalId,
          workflowVersionId: readOptionalString(workflowRequest?.workflowVersionId),
          snapshotHash: plan.snapshotHash,
          approved: plan.approvalStatus === 'APPROVED',
          allowInsecureTls: runtimeSnapshot?.resolvedDeploymentInput.variables.allowInsecureTls === true,
        },
      });
    }
    const created = await this.executions.createDryRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'dry_run',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      agentPayloadByTargetId,
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);
    const stepsWithInitialChecks = await this.attachInitialDryRunChecks(created.steps, targets, deploymentArtifactByTargetId, agentPayloadByTargetId, input.actorId, input.tenantId);
    const taskTenantId = plan.tenantId ?? input.tenantId;
    if (!taskTenantId) throw new AppError('TENANT_CONTEXT_INVALID', '部署计划缺少租户上下文', { planId: plan.id });
    enqueueTaskBestEffort(this.tasks, {
      tenantId: taskTenantId,
      taskType: 'CERTIFICATE_DRY_RUN',
      requestedBy: input.actorId,
      triggerSource: 'deployment-plan.dry-run',
      idempotencyKey: `deployment-plan:dry-run:${created.run.id}`,
      payload: { planId: plan.id, executionRunId: created.run.id },
      resourceRefs: [
        { resourceType: 'deploymentPlan', resourceId: plan.id },
        { resourceType: 'executionRun', resourceId: created.run.id },
      ],
    });
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
    const issues: DeploymentPreflightIssue[] = [];
    const targetResults = await Promise.allSettled(input.targets.map((target) => this.resolveTarget(input.tenantId, target)));
    issues.push(...this.inputPreflight.collect('TARGET', targetResults));
    const resolvedTargetEntries = targetResults.flatMap((result, targetIndex) => result.status === 'fulfilled'
      ? [{ targetIndex, target: result.value }]
      : []);
    const versionResults = await Promise.allSettled(resolvedTargetEntries.map(({ target }) => target.binding
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
    issues.push(...this.inputPreflight.collect('VERSION', versionResults, resolvedTargetEntries.map((entry) => entry.targetIndex)));
    const resolvedVersionEntries = versionResults.flatMap((result, index) => result.status === 'fulfilled'
      ? [{ ...resolvedTargetEntries[index]!, certificateVersionId: result.value }]
      : []);
    const versionIds = resolvedVersionEntries.map((entry) => entry.certificateVersionId);
    const uniqueVersionIds = [...new Set(versionIds)];
    if (uniqueVersionIds.length > 1) {
      issues.push({
        stage: 'VERSION',
        targetIndex: -1,
        errorCode: 'MULTIPLE_CERTIFICATE_VERSIONS',
        message: '当前部署计划模型只支持单一 certificateVersionId，请按域名或版本拆分计划',
        details: { certificateVersionIds: uniqueVersionIds },
      });
    }
    const artifactResults = await Promise.allSettled(resolvedVersionEntries.map((entry) =>
      this.preflightDeploymentArtifact(input, entry.target, entry.targetIndex, entry.certificateVersionId)));
    issues.push(...this.inputPreflight.collect('ARTIFACT', artifactResults, resolvedVersionEntries.map((entry) => entry.targetIndex)));
    if (issues.length > 0) throwDeploymentPreflightError(issues);
    const resolvedTargets = resolvedTargetEntries.map((entry) => entry.target);
    const certificateVersionId = uniqueVersionIds[0];
    if (!certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', '部署计划没有可用的证书版本', { code: 'CERTIFICATE_VERSION_REQUIRED' });
    }
    return {
      selectionMode,
      certificateVersionId,
      certificateFormatId: input.certificateFormatId,
      targets: resolvedTargets,
    };
  }

  private async preflightDeploymentArtifact(
    input: CreateDeploymentPlanInput,
    target: ResolvedCreateTarget,
    targetIndex: number,
    certificateVersionId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const artifact = await this.resolveDeploymentArtifactForTarget({
      id: `preflight_target_${targetIndex}`,
      tenantId: input.tenantId,
      deploymentPlanId: 'preflight',
      certificateBindingId: target.certificateBindingId,
      applicationAssetId: target.applicationAssetId,
      serviceAssetId: target.serviceAssetId ?? target.applicationAssetId,
      executionTargetId: target.managedTarget?.id ?? target.managedTargetId ?? target.executionTargetId,
      executorType: target.executorType ?? 'WORKFLOW',
      requiredCapabilities: target.requiredCapabilities ?? [],
      matchResult: target.matchResult,
      gatewayRoute: target.gatewayRoute,
      strategyPayload: target.strategyPayload,
      status: 'READY',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    }, certificateVersionId, input.certificateFormatId, input.tenantId);
    const resolvedMaterial = await this.resolveTargetDeploymentInput('preflight', input.tenantId!, target, artifact);
    if (resolvedMaterial) {
      const { contract, effectiveBinding, resolvedInput } = resolvedMaterial;
      validateDiscoveredLocationConsistency(
        target.managedTarget ? readCertificateLocation(target.managedTarget.metadata, target.managedTarget.updatedAt || now) : undefined,
        contract,
        resolvedInput,
      );
      const safeStrategyPayload = sanitizeDeploymentInputPersistencePayload(target.strategyPayload ?? {});
      target.deploymentInputSnapshotDraft = this.deploymentInputSnapshotService.build(
        resolvedInput,
        deploymentInputSnapshotIdentity(safeStrategyPayload),
        now,
      );
      target.deploymentInputRuntimeSnapshotDraft = {
        apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
        contract: structuredClone(contract),
        effectiveBinding: structuredClone(effectiveBinding),
        resolvedDeploymentInput: structuredClone(resolvedInput),
        deploymentArtifact: structuredClone(artifact) as unknown as Record<string, unknown>,
      };
      target.strategyPayload = {
        ...safeStrategyPayload,
        deploymentInputPreflight: {
          apiVersion: resolvedInput.apiVersion,
          contractVersion: resolvedInput.contractVersion,
          resolvedSha256: resolvedInput.resolvedSha256,
        },
      };
    }
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
    if (target.applicationAssetId && (managedTarget?.id ?? target.managedTargetId)) {
      return {
        ...target,
        managedTargetId: managedTarget?.id ?? target.managedTargetId,
        siteAssetId: siteAsset?.id ?? target.siteAssetId,
        managedTarget,
        siteAsset,
      };
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
    if (!input.requestedCertificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'LATEST_AUTO 必须提供用户所选证书资产的种子版本', {
        code: 'LATEST_AUTO_SEED_VERSION_REQUIRED',
        bindingId: input.binding.id,
      });
    }
    return this.findLatestDeployableCertificateVersionIdFromSeed(
      input.requestedCertificateVersionId,
      input.binding,
      input.requestedDomain,
    );
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
    if (!isDeployableCertificateVersion(version)) {
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
    if (!isDeployableCertificateVersion(version)) {
      throw new AppError('VALIDATION_FAILED', '证书版本不可部署', { certificateVersionId, status: version.status, deployable: version.deployable, notAfter: version.notAfter });
    }
    if (!this.coversBindingDomain(binding, version, asset, requestedDomain)) {
      throw new AppError('VALIDATION_FAILED', '证书版本域名与绑定域名不匹配', { certificateVersionId, domain: requestedDomain ?? binding.domainName ?? binding.domain });
    }
    if (requestedCertificateFormatId) {
      await this.assertExplicitCertificateFormatDeployable(certificateVersionId, requestedCertificateFormatId);
      return;
    }
  }

  private async assertExplicitCertificateFormatDeployable(
    certificateVersionId: string,
    certificateFormatId: string,
  ): Promise<void> {
    await this.resolveCertificateFormatForVersion(certificateVersionId, certificateFormatId);
  }

  private async findLatestDeployableCertificateVersionIdFromSeed(
    certificateVersionId: string,
    binding?: CertificateBindingDto,
    requestedDomain?: string,
  ): Promise<string> {
    const seed = await this.certificates.getVersion(certificateVersionId);
    if (!seed) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    const asset = await this.certificates.getAsset(seed.certificateAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: seed.certificateAssetId });
    const versionsPage = await this.certificates.listVersions({ page: 1, pageSize: 5000, filter: {} });
    const targetDomain = normalizeDomain(requestedDomain ?? binding?.domainName ?? binding?.domain);
    const candidates = targetDomain
      ? versionsPage.items.filter((version) => this.coversCertificateDomain(version, asset, targetDomain))
      : versionsPage.items;
    const selected = selectLatestDeployableCertificateVersion(candidates, seed.certificateAssetId);
    if (!selected) {
      throw new AppError('RESOURCE_NOT_FOUND', '用户所选证书资产中没有匹配目标域名的可部署版本', {
        certificateAssetId: seed.certificateAssetId,
        seedCertificateVersionId: certificateVersionId,
        domain: targetDomain,
        bindingId: binding?.id,
      });
    }
    return selected.id;
  }

  private async readDeploymentInputRuntimeSnapshots(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
  ): Promise<Map<string, DeploymentInputRuntimeSnapshotV1>> {
    const output = new Map<string, DeploymentInputRuntimeSnapshotV1>();
    for (const target of targets) {
      output.set(target.id, await this.readTargetDeploymentInputRuntimeSnapshot(target, target.tenantId ?? plan.tenantId!));
    }
    return output;
  }

  private async resolveRunDeploymentInputRuntimeSnapshots(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
  ): Promise<Map<string, DeploymentInputRuntimeSnapshotV1>> {
    if (plan.selectionMode !== 'LATEST_AUTO') {
      return this.readDeploymentInputRuntimeSnapshots(plan, targets);
    }

    const output = new Map<string, DeploymentInputRuntimeSnapshotV1>();
    for (const target of targets) {
      output.set(target.id, await this.buildLatestAutoRuntimeSnapshot(plan, target));
    }
    return output;
  }

  private async buildLatestAutoRuntimeSnapshot(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
  ): Promise<DeploymentInputRuntimeSnapshotV1> {
    const tenantId = target.tenantId ?? plan.tenantId;
    if (!tenantId) {
      throw new AppError('VALIDATION_FAILED', 'LATEST_AUTO 部署目标缺少 tenantId，无法解析最新证书', {
        deploymentPlanId: plan.id,
        deploymentPlanTargetId: target.id,
      });
    }

    const binding = target.certificateBindingId
      ? await this.tryGetBinding(tenantId, target.certificateBindingId)
      : undefined;
    const applicationAsset = target.applicationAssetId
      ? await this.assets.getServiceAsset(tenantId, target.applicationAssetId)
      : undefined;
    const certificateVersionId = await this.findLatestDeployableCertificateVersionIdFromSeed(
      plan.certificateVersionId,
      binding,
      applicationAsset?.sniName ?? applicationAsset?.address,
    );
    const artifact = await this.resolveDeploymentArtifactForTarget(target, certificateVersionId, plan.certificateFormatId, tenantId);
    const material = await this.resolveTargetDeploymentInput('preflight', tenantId, {
      applicationAssetId: target.applicationAssetId,
      serviceAssetId: target.serviceAssetId,
      managedTargetId: resolveRuntimeManagedTargetId(target),
      strategyPayload: target.strategyPayload,
    }, artifact);

    if (!material) {
      const persisted = await this.readTargetDeploymentInputRuntimeSnapshot(target, tenantId);
      return {
        ...persisted,
        deploymentArtifact: structuredClone(artifact) as unknown as Record<string, unknown>,
      };
    }

    return {
      apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
      contract: structuredClone(material.contract),
      effectiveBinding: structuredClone(material.effectiveBinding),
      resolvedDeploymentInput: structuredClone(material.resolvedInput),
      deploymentArtifact: structuredClone(artifact) as unknown as Record<string, unknown>,
    };
  }

  private async resolveLiveWorkflowStrategyPayloadForTarget(target: DeploymentPlanTargetEntity): Promise<Record<string, unknown>> {
    const snapshotPayload = target.strategyPayload ?? {};
    if (readRecord(snapshotPayload.executionSource)?.type === 'WORKFLOW') return snapshotPayload;
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
    runtimeSnapshots: Map<string, DeploymentInputRuntimeSnapshotV1>,
  ): Promise<Map<string, Record<string, unknown>>> {
    const output = new Map<string, Record<string, unknown>>();
    for (const target of targets) {
      const runtimeSnapshot = runtimeSnapshots.get(target.id);
      if (!runtimeSnapshot) {
        throw new AppError('VALIDATION_FAILED', '部署目标缺少密封运行材料，请重新创建计划', {
          code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
          deploymentPlanTargetId: target.id,
        });
      }
      const artifact = readDeploymentArtifactRuntimeSnapshot(runtimeSnapshot.deploymentArtifact, target.id);
      const strategyPayload = target.strategyPayload ?? {};
      const payload = await this.buildAgentPayloadForTarget({ ...target, strategyPayload }, artifact, plan.tenantId);
      output.set(target.id, {
        ...strategyPayload,
        ...(payload ?? {}),
        deploymentInputSnapshotRef: strategyPayload.deploymentInputSnapshotRef,
        ...(plan.selectionMode === 'LATEST_AUTO'
          ? { executionRuntimeSnapshot: structuredClone(runtimeSnapshot) }
          : {}),
      });
    }
    return output;
  }

  private async readTargetDeploymentInputRuntimeSnapshot(
    target: DeploymentPlanTargetEntity,
    tenantId: string,
  ): Promise<DeploymentInputRuntimeSnapshotV1> {
    const ref = readRecord(target.strategyPayload?.deploymentInputSnapshotRef);
    const snapshotId = readOptionalString(ref?.snapshotId);
    if (!snapshotId) {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少不可变输入快照，请重新创建计划', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        deploymentPlanTargetId: target.id,
      });
    }
    if (ref?.apiVersion !== 'gcac.deployment-input-snapshot/v1'
      || !Number.isInteger(ref.revision)
      || Number(ref.revision) < 1
      || !readOptionalString(ref.resolvedSha256)) {
      throw new AppError('VALIDATION_FAILED', '部署目标的输入快照引用格式无效，请重新创建计划', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        deploymentPlanTargetId: target.id,
        snapshotId,
      });
    }
    if (!this.deploymentInputSnapshots) throw new AppError('SYSTEM_INTERNAL_ERROR', '部署输入快照仓储未接入', { code: 'DEPLOYMENT_INPUT_SNAPSHOT_REPOSITORY_MISSING' });
    const entity = await this.deploymentInputSnapshots.get(tenantId, snapshotId);
    if (!entity
      || entity.deploymentPlanId !== target.deploymentPlanId
      || entity.deploymentPlanTargetId !== target.id
      || entity.revision !== ref.revision) {
      throw new AppError('VALIDATION_FAILED', '部署输入快照不存在或目标不匹配', { code: 'DEPLOYMENT_INPUT_SNAPSHOT_INVALID', snapshotId, deploymentPlanTargetId: target.id });
    }
    const expectedHash = readOptionalString(ref?.resolvedSha256);
    if (expectedHash !== entity.snapshot.resolvedSha256) {
      throw new AppError('VALIDATION_FAILED', '部署输入快照摘要不匹配', { code: 'DEPLOYMENT_INPUT_SNAPSHOT_INVALID', snapshotId });
    }
    const runtimeSnapshot = await this.deploymentInputSnapshots.getRuntimeSnapshot(tenantId, snapshotId);
    if (!runtimeSnapshot || runtimeSnapshot.resolvedDeploymentInput.resolvedSha256 !== entity.snapshot.resolvedSha256) {
      throw new AppError('VALIDATION_FAILED', '部署输入密封运行材料缺失或摘要不匹配，请重新创建计划', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        snapshotId,
      });
    }
    return runtimeSnapshot;
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
    const workflowBindings = readWorkflowCertificateArtifactBindings(
      readRecord(readRecord(strategyPayload.workflowRequest)?.inputBindings)?.artifacts,
    );
    const workflowExecutionBindingId = readOptionalString(readRecord(strategyPayload.executionSource)?.workflowExecutionBindingId);
    const workflowExecutionBinding = workflowExecutionBindingId && this.workflowExecutionBindings
      ? await this.workflowExecutionBindings.get(resolvedTenantId, workflowExecutionBindingId)
      : undefined;
    const agentBindingId = readOptionalString(readRecord(strategyPayload.pluginRuntimeCapability)?.pluginBindingId)
      ?? readOptionalString(readRecord(readRecord(strategyPayload.deploymentStrategy)?.agent)?.pluginBindingId);
    const agentBinding = agentBindingId && this.pluginBindings
      ? await this.pluginBindings.getTenantBinding(resolvedTenantId, agentBindingId)
      : undefined;
    const artifactBindings = Object.keys(agentBinding?.inputBindings.artifacts ?? {}).length > 0
      ? agentBinding!.inputBindings.artifacts
      : Object.keys(workflowExecutionBinding?.inputBindings.artifacts ?? {}).length > 0
        ? workflowExecutionBinding!.inputBindings.artifacts
        : workflowBindings;
    if (Object.keys(artifactBindings).length > 0) {
      return this.resolveWorkflowDeploymentArtifact(certificateVersionId, artifactBindings as Record<string, WorkflowCertificateArtifactBinding>);
    }
    if (!target.certificateBindingId) {
      return this.resolveDeploymentArtifact(certificateVersionId, certificateFormatId);
    }
    const binding = await this.tryGetBinding(resolvedTenantId, target.certificateBindingId);
    if (!binding) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署目标缺少 CertificateBinding，无法解析部署材料', {
        deploymentPlanTargetId: target.id,
        certificateBindingId: target.certificateBindingId,
        tenantId: resolvedTenantId,
      });
    }
    return this.resolveDeploymentArtifact(certificateVersionId, certificateFormatId);
  }

  private async resolveDeploymentArtifact(
    certificateVersionId: string,
    certificateFormatId?: string,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    if (!certificateFormatId) {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少证书产物绑定或 certificateFormatId', {
        code: 'CERTIFICATE_ARTIFACT_BINDING_REQUIRED',
        certificateVersionId,
      });
    }
    const format = await this.resolveCertificateFormatForVersion(certificateVersionId, certificateFormatId);
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

  private async resolveCertificateFormatForVersion(certificateVersionId: string, certificateFormatId: string) {
    const selected = await this.certificates.getFormat(certificateFormatId);
    if (!selected) throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId });
    if (!selected.certificateVersionId || selected.certificateVersionId === certificateVersionId) return selected;
    const candidates = await this.certificates.listFormatsByVersion(certificateVersionId);
    const equivalent = candidates.find((candidate) => candidate.format === selected.format
      && candidate.parameterHash === selected.parameterHash
      && candidate.containsPrivateKey === selected.containsPrivateKey);
    if (equivalent) return equivalent;
    throw new AppError('VALIDATION_FAILED', '最新证书版本缺少与所选配置等价的证书格式', {
      code: 'EQUIVALENT_CERTIFICATE_FORMAT_MISSING',
      certificateVersionId,
      selectedCertificateFormatId: certificateFormatId,
      selectedFormatVersionId: selected.certificateVersionId,
      format: selected.format,
      parameterHash: selected.parameterHash,
    });
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
      const format = await this.resolveCertificateFormatForVersion(certificateVersionId, binding.certificateFormatId);
      const generated = await this.certificatesApp.generateDeploymentArtifactFromFormat({
        certificateVersionId,
        certificateFormatId: format.id,
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
      const outputs: Record<string, unknown> = {};
      for (const [slotName, outputKey] of Object.entries(binding.outputBindings)) {
        const file = files.find((item) => item.key === outputKey || item.name === outputKey);
        const virtualOutput = resolveStandardCertificateOutput(baseMaterial, outputKey);
        const output = resolveBoundCertificateOutput(baseMaterial, slotName, file, virtualOutput);
        if (output === undefined) {
          throw new AppError('VALIDATION_FAILED', '证书产物输出项不存在', {
            certificateVersionId,
            certificateFormatId: binding.certificateFormatId,
            variableName,
            slotName,
            outputKey,
            availableOutputKeys: files.map((item) => item.key ?? item.name).filter(Boolean),
          });
        }
        outputs[slotName] = output;
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
    const resolvedTenantId = target.tenantId ?? tenantId;
    if (!resolvedTenantId) return undefined;
    const strategyPayload = target.strategyPayload ?? {};
    const runtimeCapability = readRecord(strategyPayload.pluginRuntimeCapability);
    const workflowRequest = readRecord(strategyPayload.workflowRequest);
    const verification = readRecord(strategyPayload.certificateVerification);
    const capabilityKey = readOptionalString(verification?.capabilityKey);
    const schemaVersion = readOptionalString(verification?.schemaVersion);
    const connectHost = readOptionalString(verification?.connectHost);
    const serverName = readOptionalString(verification?.serverName);
    const port = verification?.port;
    if (capabilityKey !== 'certificate.verify' || schemaVersion !== '1.0' || !connectHost || !serverName || typeof port !== 'number') {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少最新宿主证书验证快照，请重新生成部署计划', {
        deploymentPlanTargetId: target.id,
        certificateVerification: verification,
      });
    }
    const certificateVerification = {
      ...verification,
      expectedFingerprintSha256: artifact.expectedFingerprintSha256,
    };
    if (!runtimeCapability && target.executorType === 'WORKFLOW' && workflowRequest) {
      return { ...strategyPayload, certificateVerification, deploymentArtifact: artifact };
    }
    if (readOptionalString(runtimeCapability?.runtime) === 'AGENT_ATOMIC') {
      const pluginBindingId = readOptionalString(runtimeCapability?.pluginBindingId);
      if (!pluginBindingId) {
        throw new AppError('VALIDATION_FAILED', '部署目标缺少最新 TLS 验证快照，请重新生成部署计划', {
          deploymentPlanTargetId: target.id,
          pluginBindingId,
        });
      }
      return {
        ...strategyPayload,
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        agentId: readOptionalString(strategyPayload.agentId),
        pluginBindingId,
        certificateVerification,
        deploymentArtifact: artifact,
      };
    }
    if (readOptionalString(runtimeCapability?.runtime) === 'WORKFLOW_DSL') {
      return { ...strategyPayload, certificateVerification, deploymentArtifact: artifact };
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

  /**
   * 审批决定由 Security 模块写入审批单，部署计划不能依赖前端或插件自行伪造审批状态。
   * 每次进入部署计划边界时读取关联审批单，确保审批通过后计划能从等待状态恢复为可执行状态。
   */
  private async synchronizeApprovalState(plan: DeploymentPlanEntity, knownApproval?: ApprovalRequestEntity): Promise<DeploymentPlanEntity> {
    if (!plan.approvalId || plan.approvalStatus === 'APPROVED' || plan.approvalStatus === 'NOT_REQUIRED') {
      return plan;
    }

    const approval = knownApproval ?? await this.approval.get(plan.approvalId);
    if (!approval) return plan;

    const actorId = approval.approvedBy ?? 'system';
    if (approval.status === 'approved') {
      if (plan.status === 'PENDING_APPROVAL') {
        return this.transitionPlan(plan, 'READY', actorId, 'approval.approved', {
          approvalStatus: 'APPROVED',
          approvalId: plan.approvalId,
        });
      }
      return this.repository.updatePlan(plan.id, {
        approvalStatus: 'APPROVED',
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
    }

    if (approval.status === 'rejected' && plan.approvalStatus !== 'REJECTED') {
      return this.repository.updatePlan(plan.id, {
        approvalStatus: 'REJECTED',
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
    }

    return plan;
  }



  private async resolveManagedTargetContextFromBinding(
    tenantId: string,
    binding: CertificateBindingDto,
    target?: Pick<DeploymentPlanTargetEntity, 'executionTargetId'>,
  ) {
    const managedTargetId = binding.managedTargetId ?? target?.executionTargetId;
    return this.resolveManagedTargetContext(tenantId, managedTargetId);
  }

  private coversBindingDomain(
    binding: CertificateBindingDto,
    version: CertificateVersionEntity,
    asset: CertificateAssetEntity,
    requestedDomain?: string,
  ): boolean {
    const bindingDomain = normalizeDomain(requestedDomain ?? binding.domainName ?? binding.domain);
    return this.coversCertificateDomain(version, asset, bindingDomain);
  }

  private coversCertificateDomain(
    version: CertificateVersionEntity,
    asset: CertificateAssetEntity,
    domain?: string,
  ): boolean {
    if (!domain) return false;
    const candidates = [
      asset.primaryDomain,
      ...asset.sans,
      version.commonName,
      ...version.sans,
    ].map(normalizeDomain).filter(Boolean) as string[];
    return candidates.some((candidate) => domainMatches(candidate, domain));
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

  private async requiresApproval(plan: DeploymentPlanEntity): Promise<boolean> {
    if (Boolean(plan.policy.approvalRequired) || this.domain.isHighRisk(plan.policy)) return true;
    const parameters = await this.approvalParameters(plan);
    const scopes = Array.isArray(parameters.tlsScopes) ? parameters.tlsScopes : [];
    return scopes.some((scope) => readRecord(scope)?.allowInsecureTls === true);
  }

  private approvalRiskLevel(riskLevel: RiskLevel | undefined): RiskLevel {
    return riskLevel === 'critical' || riskLevel === 'high' ? riskLevel : 'high';
  }

  private writeBackgroundAudit(input: WriteAuditInput): void {
    void this.audit.write(input).catch(() => undefined);
  }

  private async approvalParameters(plan: DeploymentPlanEntity): Promise<Record<string, unknown>> {
    const targets = await this.repository.listTargetsByPlan(plan.id, plan.tenantId);
    const scopes = await Promise.all(targets.map(async (target) => {
      const strategyPayload = target.strategyPayload ?? {};
      const workflowRequest = readRecord(strategyPayload.workflowRequest);
      const workflowVersionId = readOptionalString(workflowRequest?.workflowVersionId);
      const inputBindings = readRecord(workflowRequest?.inputBindings);
      const bindingVariables = readRecord(inputBindings?.variables);
      const snapshotRef = readRecord(strategyPayload.deploymentInputSnapshotRef);
      const snapshot = plan.tenantId && this.deploymentInputSnapshots && typeof snapshotRef?.snapshotId === 'string'
        ? await this.deploymentInputSnapshots.get(plan.tenantId, snapshotRef.snapshotId)
        : undefined;
      const snapshotInput = readRecord(snapshot?.snapshot.input);
      const snapshotVariables = readRecord(snapshotInput?.variables);
      const snapshotConnections = readRecord(snapshotInput?.connections);
      const managementConnection = readRecord(snapshotConnections?.management)
        ?? readRecord(readRecord(inputBindings?.connections)?.management);
      const tls = readRecord(managementConnection?.tls) ?? {};
      const allowInsecureTls = snapshotVariables?.allowInsecureTls === true || bindingVariables?.allowInsecureTls === true;
      let stepIds: string[] = [];
      if (workflowVersionId && this.workflows) {
        try {
          const version = await this.workflows.getVersion(workflowVersionId);
          stepIds = [
            ...version.content.steps.map((step) => step.name),
            ...(version.content.rollback?.map((step) => step.name) ?? []),
          ];
        } catch {
          stepIds = [];
        }
      }
      return {
        targetId: target.id,
        workflowVersionId,
        stepIds,
        allowInsecureTls,
        connectionTlsFingerprint: createHash('sha256').update(canonicalize(tls)).digest('hex'),
      };
    }));
    return {
      planId: plan.id,
      snapshotHash: plan.snapshotHash,
      action: 'deployment.execute',
      targetIds: targets.map((target) => target.id).sort(),
      workflowVersionIds: [...new Set(scopes.map((scope) => scope.workflowVersionId).filter((value): value is string => Boolean(value)))].sort(),
      stepIds: [...new Set(scopes.flatMap((scope) => scope.stepIds))].sort(),
      tlsScopes: scopes.sort((left, right) => left.targetId.localeCompare(right.targetId)),
    };
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
    return ['certificate.backup', 'certificate.install', 'service.reload'];
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
    if (explicitRoute?.gatewayId || explicitRoute?.agentId || target.gatewayRoute) return explicitRoute;

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

  private async toDto(plan: DeploymentPlanEntity, context?: DeploymentPlanListContext): Promise<DeploymentPlanDto> {
    const runs = context?.runsByPlanId.get(plan.id)
      ?? await this.executions.listRuns({ tenantId: plan.tenantId, deploymentPlanId: plan.id }) as ExecutionRunDto[];
    const latestRun = [...runs].sort((left, right) => {
      const runNo = Number(right.runNo ?? 0) - Number(left.runNo ?? 0);
      if (runNo !== 0) return runNo;
      return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
    })[0];
    const targets = (context?.targetsByPlanId.get(plan.id) ?? await this.repository.listTargetsByPlan(plan.id, plan.tenantId))
      .map((target) => this.toTargetDto(target));
    const workflowExecutionIdentities = await this.resolveWorkflowExecutionIdentities(targets, context?.workflowVersions);
    const approval = plan.approvalId
      ? context?.approvalsById.get(plan.approvalId) ?? await this.approval.get(plan.approvalId)
      : undefined;
    return {
      ...plan,
      targets,
      ...(approval ? {
        approval: {
          id: approval.id,
          status: approval.status,
          riskLevel: approval.riskLevel,
          requestedBy: approval.requestedBy,
          ...(approval.approvedBy ? { approvedBy: approval.approvedBy } : {}),
          ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
        },
      } : {}),
      ...(workflowExecutionIdentities.length > 0 ? { workflowExecutionIdentities } : {}),
      latestRunId: latestRun?.id,
      latestRun,
    };
  }

  /**
   * 从部署计划目标快照解析实际使用的工作流版本。
   *
   * 计划创建时，LATEST_PUBLISHED 会先解析成一个不可变的 workflowVersionId；
   * 这里同时读取 executionSource 中保留的原始选择策略，避免把“解析时最新”
   * 错误显示成用户手动固定版本。
   */
  private async resolveWorkflowExecutionIdentities(
    targets: readonly DeploymentPlanTargetDto[],
    workflowVersions = new Map<string, Promise<WorkflowVersion | undefined>>(),
  ): Promise<DeploymentPlanWorkflowIdentityDto[]> {
    const identities = new Map<string, DeploymentPlanWorkflowIdentityDto>();
    for (const target of targets) {
      const identity = await this.resolveWorkflowExecutionIdentity(target, workflowVersions);
      if (!identity) continue;
      const key = [
        identity.mode,
        identity.workflowId ?? '',
        identity.workflowVersionId,
        identity.workflowVersionSelection,
        identity.pluginVersionId ?? '',
      ].join('|');
      const existing = identities.get(key);
      if (existing) {
        existing.targetIds.push(target.id);
        continue;
      }
      identities.set(key, { ...identity, targetIds: [target.id] });
    }
    return [...identities.values()];
  }

  private async resolveWorkflowExecutionIdentity(
    target: DeploymentPlanTargetDto,
    workflowVersions = new Map<string, Promise<WorkflowVersion | undefined>>(),
  ): Promise<Omit<DeploymentPlanWorkflowIdentityDto, 'targetIds'> | undefined> {
    const strategyPayload = target.strategyPayload;
    const executionSource = readRecord(strategyPayload?.executionSource);
    const workflowRequest = readRecord(strategyPayload?.workflowRequest);
    const isPluginInternalWorkflow = readOptionalString(executionSource?.type) === 'PLUGIN';
    if (target.executorType !== 'WORKFLOW' && !isPluginInternalWorkflow) return undefined;

    const workflowVersionSelection = readWorkflowVersionSelection(
      executionSource?.workflowVersionSelection
        ?? workflowRequest?.workflowVersionSelection,
    );
    const declaredWorkflowVersionId = readOptionalString(executionSource?.workflowVersionId)
      ?? readOptionalString(executionSource?.internalWorkflowVersionId)
      ?? readOptionalString(workflowRequest?.workflowVersionId);
    const declaredWorkflowId = readOptionalString(executionSource?.workflowTemplateId)
      ?? readOptionalString(workflowRequest?.workflowId);

    let workflowVersionId = declaredWorkflowVersionId;
    let workflowVersion: Awaited<ReturnType<WorkflowTemplatesApplicationService['getVersion']>> | undefined;
    if (!workflowVersionId && workflowVersionSelection === 'LATEST_PUBLISHED' && declaredWorkflowId && this.workflows) {
      try {
        workflowVersion = await this.getWorkflowVersion(workflowVersions, `latest:${declaredWorkflowId}`, () => this.workflows!.getRuntimePublishedVersion(declaredWorkflowId));
        workflowVersionId = workflowVersion?.id;
      } catch {
        // 目录服务异常时保留无版本身份，不能阻断部署计划列表。
      }
    }
    if (workflowVersionId && this.workflows) {
      try {
        workflowVersion = await this.getWorkflowVersion(workflowVersions, `version:${workflowVersionId}`, () => this.workflows!.getVersion(workflowVersionId));
      } catch {
        // 历史计划可能引用已经清理的工作流版本，仍返回不可变 ID 供审计定位。
      }
    }

    const workflowId = declaredWorkflowId
      ?? workflowVersion?.templateId;
    if (!workflowVersionId) return undefined;
    const workflowName = workflowVersion?.content.metadata.name
      ?? readOptionalString(workflowRequest?.workflowName);
    const pluginId = readOptionalString(workflowRequest?.pluginId);
    const pluginVersion = readOptionalString(workflowRequest?.pluginVersion);
    const pluginVersionId = readOptionalString(workflowRequest?.pluginVersionId)
      ?? readOptionalString(executionSource?.pluginVersionId);

    return {
      mode: isPluginInternalWorkflow ? 'PLUGIN_INTERNAL_WORKFLOW' : 'WORKFLOW',
      ...(workflowId ? { workflowId } : {}),
      ...(workflowName ? { workflowName } : {}),
      workflowVersionId,
      workflowVersionSelection,
      ...(workflowVersion?.content.metadata.version ? { workflowDslVersion: workflowVersion.content.metadata.version } : {}),
      ...(pluginId ? { pluginId } : {}),
      ...(pluginVersion ? { pluginVersion } : {}),
      ...(pluginVersionId ? { pluginVersionId } : {}),
    };
  }

  private async getWorkflowVersion(
    cache: Map<string, Promise<WorkflowVersion | undefined>>,
    key: string,
    load: () => Promise<WorkflowVersion | undefined>,
  ): Promise<WorkflowVersion | undefined> {
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = load().catch(() => undefined);
    cache.set(key, pending);
    return pending;
  }

  private async persistDeploymentInputSnapshot(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
    snapshot: DeploymentInputSnapshotV1 | undefined,
    runtimeSnapshot: DeploymentInputRuntimeSnapshotV1 | undefined,
    actorId: string,
  ): Promise<DeploymentInputSnapshotRefV1 | undefined> {
    if (!snapshot && !runtimeSnapshot) return undefined;
    if (!snapshot || !runtimeSnapshot) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '部署输入审计快照与密封运行材料必须同时生成', {
        code: 'DEPLOYMENT_INPUT_SNAPSHOT_INCOMPLETE',
        deploymentPlanId: plan.id,
        deploymentPlanTargetId: target.id,
      });
    }
    if (!plan.tenantId || !this.deploymentInputSnapshots) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '部署输入快照仓储未接入', {
        code: 'DEPLOYMENT_INPUT_SNAPSHOT_REPOSITORY_MISSING',
        deploymentPlanId: plan.id,
        deploymentPlanTargetId: target.id,
      });
    }
    const entity = await this.deploymentInputSnapshots.create({
      id: newId('dpis'),
      tenantId: plan.tenantId,
      deploymentPlanId: plan.id,
      deploymentPlanTargetId: target.id,
      revision: plan.version,
      snapshot,
      createdAt: snapshot.resolvedAt,
      createdBy: actorId,
    }, runtimeSnapshot);
    const ref: DeploymentInputSnapshotRefV1 = {
      apiVersion: entity.snapshot.apiVersion,
      snapshotId: entity.id,
      revision: entity.revision,
      resolvedSha256: entity.snapshot.resolvedSha256,
    };
    await this.repository.updateTarget(target.id, {
      strategyPayload: { ...(target.strategyPayload ?? {}), deploymentInputSnapshotRef: ref },
      updatedAt: entity.createdAt,
      updatedBy: actorId,
    });
    return ref;
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

function deploymentInputSnapshotIdentity(strategyPayload: Record<string, unknown>): DeploymentInputSnapshotIdentityV1 {
  const executionSource = readRecord(strategyPayload.executionSource);
  const runtimeCapability = readRecord(strategyPayload.pluginRuntimeCapability);
  const workflowRequest = readRecord(strategyPayload.workflowRequest);
  return {
    assignmentId: readOptionalString(executionSource?.assignmentId)
      ?? readOptionalString(runtimeCapability?.assignmentId),
    pluginVersionId: readOptionalString(executionSource?.pluginVersionId)
      ?? readOptionalString(runtimeCapability?.pluginVersionId)
      ?? readOptionalString(workflowRequest?.pluginVersionId),
    pluginBindingId: readOptionalString(executionSource?.pluginBindingId)
      ?? readOptionalString(runtimeCapability?.pluginBindingId)
      ?? readOptionalString(workflowRequest?.pluginBindingId),
    workflowVersionId: readOptionalString(executionSource?.workflowVersionId)
      ?? readOptionalString(executionSource?.internalWorkflowVersionId)
      ?? readOptionalString(workflowRequest?.workflowVersionId),
    workflowExecutionBindingId: readOptionalString(executionSource?.workflowExecutionBindingId),
  };
}

function resolveRuntimeManagedTargetId(target: DeploymentPlanTargetEntity): string | undefined {
  const strategyPayload = target.strategyPayload ?? {};
  const deploymentStrategy = readRecord(strategyPayload.deploymentStrategy);
  const managedStrategy = readRecord(deploymentStrategy?.managedTarget);
  const workflowRequest = readRecord(strategyPayload.workflowRequest);
  const directId = readOptionalString(strategyPayload.managedTargetId)
    ?? readOptionalString(managedStrategy?.managedTargetId)
    ?? readOptionalString(workflowRequest?.managedTargetId);
  if (directId) return directId;

  const runtimeCapability = readRecord(strategyPayload.pluginRuntimeCapability);
  const isManagedRuntime = deploymentStrategy?.type === 'MANAGED_TARGET' || runtimeCapability !== undefined;
  return isManagedRuntime ? target.executionTargetId : undefined;
}

function throwDeploymentPreflightError(issues: DeploymentPreflightIssue[]): never {
  throw new AppError('VALIDATION_FAILED', `部署计划预检失败：${issues.map((issue) => issue.message).join('；')}`, {
    code: 'DEPLOYMENT_PREFLIGHT_FAILED',
    issues,
  });
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

export function resolveStandardCertificateOutput(
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
    pfxBase64: { sourceKey: 'pfxBase64', role: 'pkcs12_bundle', format: 'base64' },
    pfxPassword: { sourceKey: 'pfxPassword', role: 'pkcs12_password', format: 'text' },
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

const canonicalCertificateOutputKeys = new Set([
  'leafPem',
  'certificatePem',
  'privateKeyPem',
  'orderedChainPem',
  'fingerprintSha256',
  'leafPemBase64',
  'privateKeyPemBase64',
  'orderedChainPemBase64',
  'orderedIntermediates',
  'pfxBase64',
  'pfxPassword',
]);

export function resolveBoundCertificateOutput(
  material: Record<string, unknown>,
  slotName: string,
  file: Record<string, unknown> | undefined,
  virtualOutput: Record<string, unknown> | undefined,
): unknown {
  if (canonicalCertificateOutputKeys.has(slotName) && material[slotName] !== undefined) {
    return structuredClone(material[slotName]);
  }
  return file ?? virtualOutput;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readWorkflowVersionSelection(value: unknown): 'PINNED' | 'LATEST_PUBLISHED' {
  return value === 'LATEST_PUBLISHED' ? 'LATEST_PUBLISHED' : 'PINNED';
}

function collectBindingCredentials(
  layers: {
    deviceDefault?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
    targetOverride?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
    assetOverride?: { pluginVersionId: string; inputBindings: InputBindingsV1 };
  },
): Record<string, { credentialId: string }> {
  const credentials: Record<string, { credentialId: string }> = {};
  for (const layer of Object.values(layers)) {
    if (!layer) continue;
    Object.assign(credentials, layer.inputBindings.credentials);
  }
  return credentials;
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

function targetRequestsInsecureTls(target: {
  strategyPayload?: Record<string, unknown>;
  deploymentInputSnapshotDraft?: DeploymentInputSnapshotV1;
}): boolean {
  const snapshotVariables = readRecord(target.deploymentInputSnapshotDraft?.input.variables);
  if (snapshotVariables?.allowInsecureTls === true) return true;
  const workflowRequest = readRecord(target.strategyPayload?.workflowRequest);
  const inputBindings = readRecord(workflowRequest?.inputBindings);
  return readRecord(inputBindings?.variables)?.allowInsecureTls === true;
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

function artifactSnapshotsFromDeploymentArtifact(
  artifact: DeploymentArtifactSnapshotDto,
): Record<string, ResolvedArtifactV1> {
  return Object.fromEntries(Object.entries(artifact.workflowCertificateMaterials ?? {}).map(([slot, material]) => [slot, {
    ...material,
    artifactId: `${artifact.certificateVersionId}:${artifact.certificateFormatId}`,
    certificateVersionId: artifact.certificateVersionId,
    certificateFormatId: artifact.certificateFormatId,
    format: artifact.format,
    outputs: readRecord(material.outputs) ?? {},
  }]));
}

function readDeploymentArtifactRuntimeSnapshot(
  value: Record<string, unknown>,
  deploymentPlanTargetId: string,
): DeploymentArtifactSnapshotDto {
  if (typeof value.certificateVersionId !== 'string'
    || typeof value.certificateFormatId !== 'string'
    || typeof value.format !== 'string'
    || typeof value.containsPrivateKey !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', '部署输入密封运行材料中的证书产物无效', {
      code: 'DEPLOYMENT_INPUT_RUNTIME_ARTIFACT_INVALID',
      deploymentPlanTargetId,
    });
  }
  return structuredClone(value) as unknown as DeploymentArtifactSnapshotDto;
}

function deploymentArtifactsFromRuntimeSnapshots(
  snapshots: Map<string, DeploymentInputRuntimeSnapshotV1>,
): Map<string, DeploymentArtifactSnapshotDto> {
  return new Map([...snapshots].map(([targetId, snapshot]) => [
    targetId,
    readDeploymentArtifactRuntimeSnapshot(snapshot.deploymentArtifact, targetId),
  ]));
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

function effectiveBindingFromPayload(payload: Record<string, unknown>) {
  const value = readRecord(payload.effectiveInputBindings);
  if (!value || value.apiVersion !== 'gcac.input-bindings/v1') return undefined;
  return { inputBindings: value as unknown as InputBindingsV1, provenance: {} };
}

const AGENT_PRODUCT_FAMILY_BY_OS: Readonly<Record<string, string>> = Object.freeze({
  WINDOWS: 'WINDOWS_SERVER',
  LINUX: 'LINUX_SERVER',
});
