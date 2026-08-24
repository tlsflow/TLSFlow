import { AppError } from '../../../common/errors/app-error.js';
import { createHash } from 'node:crypto';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService, type WriteAuditInput } from '../../audits/audit.service.js';
import { ApprovalService } from '../../approvals/approval.service.js';
import { newId } from '../../../shared/id.js';
import { ExecutionTargetKinds, type ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RequestContext, RiskLevel } from '../../../shared/security-types.js';
import { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionRunDto, ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { ApplicationAssetDeploymentRecordDto, CreateDeploymentPlanFromApplicationAssetInput, CreateDeploymentPlanInput, DeploymentGatewayRouteDto, DeploymentPlanDryRunCheckDto, DeploymentPlanDto, DeploymentPlanPreflightResultDto, DeploymentPlanTargetDto, DeploymentPlanWorkflowIdentityDto, ExecuteDeploymentPlanInput, CancelDeploymentPlanInput, SubmitDeploymentPlanInput, DryRunDeploymentPlanInput, ReevaluateDeploymentPlanCapabilitiesInput, UpdateDeploymentPlanFromApplicationAssetInput } from '../dto/deployment-plans.dto.js';
import { DeploymentPlansDomainService } from '../domain/deployment-plans.domain-service.js';
import { DeploymentPlansRepository } from '../repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../schema/deployment-plans.schema.js';
import { GatewaysApplicationService } from '../../gateways/application/gateways.application-service.js';
import { assertGatewayRelayRouteChannel, type GatewayAdapterType, type GatewayCandidate, type ZoneRouteResult } from '../../gateway-agents/index.js';
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
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { DeploymentStrategyResolver } from './deployment-strategy-resolver.js';
import { ExecutionSourceResolver } from './execution-source.resolver.js';
import type { DeploymentArtifactSnapshotDto } from '../../executions/dto/executions.dto.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import { ManagedTargetContextResolver } from '../../assets/application/managed-target-context.resolver.js';
import { canonicalProductFamilyForOsType } from '../../devices/domain/canonical-product-family.js';
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
import { deploymentAssetContextBuilder, requireManagedTargetMetadata } from '../../deployment-inputs/application/deployment-asset-context.builder.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';
import { ProductionDeploymentInputResolverService } from '../../deployment-inputs/application/production-deployment-input-resolver.service.js';
import type { ResolveDeploymentInputPhase, ResolvedArtifactV1, ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
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
import { CertificateTrustPlanService, type CertificateTrustPlanSnapshot } from '../../certificates/trust-roots/application/certificate-trust-plan.service.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { TenantHierarchyService } from '../../security/domain/tenant.domain-service.js';
import { DEFAULT_DEPLOYMENT_TASK_SETTINGS, type DeploymentTaskSettings } from '../../../shared/deployment-task-settings.js';
import { buildPluginActionBindings } from '../../executions/application/plugin-action-binding.service.js';
import type { WorkflowStep } from '../../workflow-templates/dto/workflow-templates.dto.js';

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

/** 编辑应用资产时用于生成输入投影的临时工作流身份，不会创建执行绑定。 */
export interface DeploymentInputProjectionWorkflowOverride {
  workflowTemplateId: string;
  workflowVersionId: string;
  pluginVersionId?: string;
  inputBindings?: InputBindingsV1;
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

type DeploymentCertificatesApplicationPort = Pick<CertificatesApplicationService, 'generateDeploymentArtifactFromFormat'> & {
  getTrustRoots?: CertificatesApplicationService['getTrustRoots'];
};

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
  agentsApp?: AgentsApplicationService;
  certificates?: CertificatesRepository;
  certificatesApp?: DeploymentCertificatesApplicationPort;
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
  tenantHierarchy?: Pick<TenantHierarchyService, 'getDeploymentTaskSettings'>;
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
  private readonly agentsApp: AgentsApplicationService;
  private readonly certificates: CertificatesRepository;
  private readonly certificatesApp: DeploymentCertificatesApplicationPort;
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
  private readonly certificateTrustPlans?: CertificateTrustPlanService;
  private readonly tasks?: TaskEnqueuer;
  private readonly tenantHierarchy?: Pick<TenantHierarchyService, 'getDeploymentTaskSettings'>;

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
    this.agentsApp = dependencies.agentsApp ?? new AgentsApplicationService(this.agents);
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
    this.tasks = dependencies.tasks;
    this.tenantHierarchy = dependencies.tenantHierarchy;
    this.workflowExecutionBindings = dependencies.database
      ? new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(dependencies.database))
      : undefined;
    const trustRoots = this.certificatesApp.getTrustRoots?.();
    this.certificateTrustPlans = trustRoots === undefined
      ? undefined
      : new CertificateTrustPlanService({ agents: this.agentsApp, trustRoots });
  }

  getRepository(): DeploymentPlansRepository {
    return this.repository;
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.executions;
  }

  async list(input: { tenantId?: string } = {}): Promise<DeploymentPlanDto[]> {
    const sourcePlans = (await this.repository.listPlans(input.tenantId)).filter((plan) => plan.temporary !== true);
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

  /**
   * 资产详情的部署记录由服务端按 applicationAssetId 聚合。
   * 临时计划在尚未清理时也会返回，方便观察自动化执行中的预检和运行状态。
   */
  async listByApplicationAsset(input: { tenantId?: string; applicationAssetId: string }): Promise<ApplicationAssetDeploymentRecordDto[]> {
    const sourcePlans = await this.repository.listPlansByApplicationAsset(input.tenantId, input.applicationAssetId);
    if (sourcePlans.length === 0) return [];

    const approvalIds = sourcePlans
      .map((plan) => plan.approvalId)
      .filter((id): id is string => Boolean(id));
    const approvalsById = await this.approval.getMany(approvalIds, input.tenantId);
    const plans = await Promise.all(
      sourcePlans.map((plan) => this.synchronizeApprovalState(plan, approvalsById.get(plan.approvalId ?? ''))),
    );
    const [targets, runsByPlan] = await Promise.all([
      this.repository.listTargetsByPlans(plans.map((plan) => plan.id), input.tenantId),
      Promise.all(plans.map(async (plan) => [
        plan.id,
        await this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id }) as ExecutionRunDto[],
      ] as const)),
    ]);
    const targetsByPlanId = new Map<string, DeploymentPlanTargetEntity[]>();
    for (const target of targets) {
      const current = targetsByPlanId.get(target.deploymentPlanId) ?? [];
      current.push(target);
      targetsByPlanId.set(target.deploymentPlanId, current);
    }
    const runsByPlanId = new Map(runsByPlan);
    const context: DeploymentPlanListContext = {
      runsByPlanId,
      targetsByPlanId,
      approvalsById,
      workflowVersions: new Map(),
    };

    const records = await Promise.all(plans.map(async (plan) => {
      const runs = sortDeploymentRuns(runsByPlanId.get(plan.id) ?? []);
      const latestPreflightRun = runs.find((run) => run.type === 'dry_run');
      const latestRollback = runs.find((run) => run.type === 'rollback');
      const dto = await this.toDto(plan, context);
      return {
        ...dto,
        runs,
        ...(latestPreflightRun ? {
          latestPreflight: {
            run: latestPreflightRun,
            checks: await this.readDryRunChecks(latestPreflightRun, input.tenantId),
          },
        } : {}),
        ...(latestRollback ? { latestRollback } : {}),
      } satisfies ApplicationAssetDeploymentRecordDto;
    }));
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    return this.createInternal(input, context, false);
  }

  private async createWithoutPreflight(input: CreateDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    return this.createInternal(input, context, true);
  }

  private async createInternal(input: CreateDeploymentPlanInput, context: RequestContext, deferPreflight: boolean): Promise<DeploymentPlanDto> {
    assertDeploymentExecutorTypes(input.targets, 'create');
    this.domain.assertCreateInput(input);
    const resolved = deferPreflight ? this.resolveDeferredCreateInput(input) : await this.resolveCreateInput(input);
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
      temporary: input.temporary === true,
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
      temporary: input.temporary === true,
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

    await this.writeBackgroundAudit({
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
      return input.deferPreflight ? this.createWithoutPreflight(draft, context) : this.create(draft, context);
    }
    if (input.reuseDraft !== false) {
      const reusableDraft = await this.repository.findLatestManualDraftByApplicationAsset(input.tenantId, input.applicationAssetId);
      if (reusableDraft) {
        return this.updateDraftFromApplicationAsset({ ...input, planId: reusableDraft.id, expectedVersion: reusableDraft.version }, context);
      }
    }
    const draft = await this.buildCreateInputFromApplicationAsset(input);
    return input.deferPreflight ? this.createWithoutPreflight(draft, context) : this.create(draft, context);
  }

  async resolveProjectionSource(input: Pick<CreateDeploymentPlanFromApplicationAssetInput, 'applicationAssetId' | 'tenantId'> & {
    workflow?: DeploymentInputProjectionWorkflowOverride;
  }): Promise<{
    contract: DeploymentInputContractV1;
    resolvedInput: ResolvedDeploymentInputV1;
    effectiveBinding?: import('../../deployment-inputs/domain/deployment-input-provenance.js').EffectiveInputBindingV1;
  }> {
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    if (input.workflow) return this.resolveWorkflowProjectionSource({ ...input, workflow: input.workflow });
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

  /**
   * 投影阶段允许使用编辑器尚未保存的工作流版本。
   * 这里只解析输入契约和当前草稿绑定，正式部署仍然必须经过 WorkflowExecutionBinding。
   */
  private async resolveWorkflowProjectionSource(input: Pick<CreateDeploymentPlanFromApplicationAssetInput, 'applicationAssetId' | 'tenantId'> & {
    workflow: DeploymentInputProjectionWorkflowOverride;
  }): Promise<{
    contract: DeploymentInputContractV1;
    resolvedInput: ResolvedDeploymentInputV1;
    effectiveBinding?: import('../../deployment-inputs/domain/deployment-input-provenance.js').EffectiveInputBindingV1;
  }> {
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    if (!this.workflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本服务未接入');
    const applicationAsset = await this.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
    if (!applicationAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    }
    const workflowTemplateId = input.workflow.workflowTemplateId.trim();
    const workflowVersionId = input.workflow.workflowVersionId.trim();
    if (!workflowTemplateId || !workflowVersionId) {
      throw new AppError('VALIDATION_FAILED', '工作流投影缺少 WorkflowTemplate 或 WorkflowVersion');
    }
    const version = await this.workflows.getVersion(workflowVersionId);
    if (version.templateId !== workflowTemplateId) {
      throw new AppError('VALIDATION_FAILED', '工作流投影的 Template 与 Version 不匹配', {
        workflowTemplateId,
        workflowVersionId,
        actualTemplateId: version.templateId,
      });
    }
    const inputBindings = input.workflow.inputBindings ?? emptyInputBindingsV1();
    const managedTargetId = applicationAsset.deploymentStrategy?.type === 'MANAGED_TARGET'
      ? applicationAsset.deploymentStrategy.managedTarget?.managedTargetId
      : undefined;
    const managedTargetContext = managedTargetId
      ? await this.resolveManagedTargetContext(input.tenantId, managedTargetId)
      : undefined;
    const contract = new DeploymentInputContractLoader().fromWorkflowVersion(version);
    const projection = this.deploymentInputResolver.resolveProjectionResult({
      phase: 'configure',
      contract,
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext }),
      bindingLayers: {
        assetOverride: {
          pluginVersionId: input.workflow.pluginVersionId?.trim() || `workflow-preview:${workflowVersionId}`,
          inputBindings,
        },
      },
      credentialSnapshots: await this.snapshotCredentials(input.tenantId, inputBindings.credentials),
    });
    return { contract, ...projection };
  }

  async updateDraftFromApplicationAsset(input: UpdateDeploymentPlanFromApplicationAssetInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (plan.status === 'RUNNING') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', 'RUNNING 部署计划正在执行，不能编辑', { planId: plan.id, status: plan.status });
    }

    const draft = await this.buildCreateInputFromApplicationAsset(input);
    assertDeploymentExecutorTypes(draft.targets, 'update');
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
    }, input.expectedVersion);

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
    await this.writeBackgroundAudit({
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
    if (!certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', '证书部署计划必须指定证书版本');
    }
    const compileCertificateVersionId = selectionMode === 'LATEST_AUTO'
      ? await this.findLatestDeployableCertificateVersionIdFromSeed(
        certificateVersionId,
        readyBinding,
        applicationAsset.sniName ?? applicationAsset.address,
        input.tenantId,
        input.certificateAssetId,
      )
      : certificateVersionId;
    const compileArtifact = certificateFormatId && compileCertificateVersionId
      ? await this.resolveDeploymentArtifact(compileCertificateVersionId, certificateFormatId, input.tenantId)
      : undefined;
    const resolvedStrategy = executionMode === 'WORKFLOW_OVERRIDE'
      ? await this.compileWorkflowExecutionBinding(input.tenantId, strategyAsset, deploymentStrategy?.managedTarget?.workflowExecutionBindingId, 'WORKFLOW_OVERRIDE', bindingTarget, managedTargetContext, readyBinding)
      : await this.compileManagedPluginExecution(input.tenantId, strategyAsset, bindingTarget, managedTargetContext, readyBinding, compileArtifact);

    return {
      name: planName,
      certificateAssetId: input.certificateAssetId,
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
      policy: {
        ...(input.policy ?? {}),
        approvalRequired: input.policy?.approvalRequired === true || deploymentStrategy?.approvalRequired === true,
      },
      temporary: input.temporary,
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
          workflowVersionSelection: 'FIXED',
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
    artifact?: DeploymentArtifactSnapshotDto,
  ) {
    const resolved = await this.compileManagedPluginRuntime(tenantId, asset, bindingTarget, context, certificateBinding, artifact);
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
    const executionIdentity = await this.workflowExecutionBindings.getExecutionIdentity(tenantId, bindingId);
    const binding = executionIdentity.binding;
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
      bindingLayers: { assetOverride: { pluginVersionId: binding.pluginVersionId, inputBindings: binding.inputBindings } },
      credentialSnapshots: await this.snapshotCredentials(tenantId, binding.inputBindings.credentials),
    }).effectiveBinding;
    const resolvedInput = (await this.resolveWorkflowBindingDeploymentInput('configure', tenantId, binding, workflowVersionId, asset, context)).resolvedInput;
    const materializedAsset: ServiceAssetDto = {
      ...asset,
      deploymentStrategy: {
        type: 'WORKFLOW',
        workflow: {
          workflowId: binding.workflowTemplateId,
          pluginVersionId: binding.pluginVersionId,
          capabilityKey: binding.capabilityKey,
          workflowVersionSelection: 'FIXED',
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
          pluginId: executionIdentity.chain.pluginId,
          pluginVersion: executionIdentity.chain.pluginVersion,
          pluginVersionId: executionSource.binding.pluginVersionId,
          capabilityKey: executionSource.binding.capabilityKey,
          workflowTemplateId: executionSource.binding.workflowTemplateId,
          workflowVersionSelection: executionSource.binding.workflowVersionSelection,
          workflowVersionId: executionSource.workflowVersionId,
          runner: executionSource.binding.runner,
          gatewayId: executionSource.binding.gatewayId,
          packageSha256: executionIdentity.chain.packageSha256,
          manifestSha256: executionIdentity.chain.manifestSha256,
          resourceSha256: executionIdentity.chain.resourceSha256,
          workflowContentSha256: executionIdentity.chain.workflowContentSha256,
        },
        managedTargetId: mode === 'WORKFLOW_OVERRIDE' ? context?.managedTarget.id : undefined,
        targetSnapshot: mode === 'WORKFLOW_OVERRIDE' && context ? { managedTarget: context.managedTarget, host: context.host, siteAsset: context.siteAsset, frameworkInstance: context.serviceInstance } : undefined,
      },
    };
  }

  private async resolveWorkflowExecutionVersion(binding: WorkflowExecutionBinding): Promise<string> {
    if (binding.workflowVersionSelection !== 'FIXED' || !binding.workflowVersionId) {
      throw new AppError('VALIDATION_FAILED', 'WorkflowExecutionBinding 缺少 FIXED WorkflowVersion', {
        code: 'WORKFLOW_VERSION_REQUIRED',
        bindingId: binding.id,
      });
    }
    return binding.workflowVersionId;
  }

  private async compileManagedPluginRuntime(
    tenantId: string,
    asset: ServiceAssetDto,
    bindingTarget: Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>,
    context: Awaited<ReturnType<ManagedTargetContextResolver['resolve']>> | undefined,
    certificateBinding?: CertificateBindingDto,
    artifact?: DeploymentArtifactSnapshotDto,
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
        productFamily: context.deviceAsset?.deviceFamily ?? canonicalProductFamilyForOsType(context.host.osType),
        frameworkType: context.frameworkType,
        targetType: context.managedTarget.targetType,
        managementMethod: context.agent ? 'AGENT' : context.deviceAsset ? 'PLUGIN' : 'MANUAL',
        artifactContract: 'certificate.deploy.v1',
      },
    });
    const workflow = capability.pluginRuntime === 'WORKFLOW_DSL'
      ? await this.requirePluginWorkflow(capability.pluginVersionId, capability.assignment.capabilityKey)
      : undefined;
    const workflowVersion = workflow && this.workflows
      ? await this.workflows.getVersion(workflow.workflowVersionId)
      : undefined;
    if (workflowVersion?.executionMode === 'PLUGIN_RUNNER') {
      throw new AppError('PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN', '包级 PLUGIN_RUNNER Workflow 已禁止；请发布普通 DSL WorkflowVersion', {
        workflowVersionId: workflowVersion.id,
      });
    }
    const executionSource = this.executionSourceResolver.resolvePlugin({
      capability,
      workflowVersionId: workflow?.workflowVersionId,
    });
    // 计划编译属于部署前预检，必须按 preflight 解析并密封 pre_execution 输入，
    // 让证书 Artifact、凭据和运行事实在生成 Agent Plan 时完成门禁。
    const inputResult = await this.resolveCapabilityDeploymentInput('preflight', tenantId, capability, context, asset, artifact);
    const resolvedInput = inputResult.resolvedInput;
    const runtime = await this.pluginRuntimeAdapters.compile({
      tenantId,
      capability,
      context,
      applicationAsset: asset,
      resolvedInput,
      certificateBindingId: certificateBinding?.id,
      workflow: workflow ? {
        workflowId: workflow.workflowTemplateId,
        workflowVersionId: workflow.workflowVersionId,
      } : undefined,
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
          pluginId: executionSource.capability.plugin.manifest.pluginId,
          pluginVersion: executionSource.capability.plugin.manifest.version,
          pluginVersionId: executionSource.capability.pluginVersionId,
          pluginBindingId: executionSource.capability.binding.id,
          runtime: executionSource.capability.pluginRuntime,
          capabilityKey: executionSource.capability.assignment.capabilityKey,
          packageSha256: executionSource.capability.plugin.packageSha256,
          manifestSha256: executionSource.capability.plugin.manifestSha256,
          resourceSha256: structuredClone(executionSource.capability.plugin.resourceSha256),
          ...(workflow ? {
            workflowTemplateId: workflow.workflowTemplateId,
            workflowVersionSelection: 'FIXED' as const,
            workflowVersionId: workflow.workflowVersionId,
            workflowContentSha256: workflow.workflowContentSha256,
          } : {}),
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
      artifactSnapshots: artifact
        ? artifactSnapshotsFromDeploymentArtifact(artifact, Object.keys(contract.artifacts))
        : undefined,
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
      artifactSnapshots: artifactSnapshotsFromDeploymentArtifact(artifact, Object.keys(contract.artifacts)),
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
          pluginVersionId: binding.pluginVersionId,
          inputBindings: binding.inputBindings,
        },
      },
      credentialSnapshots: await this.snapshotCredentials(tenantId, binding.inputBindings.credentials),
      artifactSnapshots: artifact
        ? artifactSnapshotsFromDeploymentArtifact(artifact, Object.keys(contract.artifacts))
        : undefined,
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
      certificateAssetId: input.certificateAssetId,
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
      policy: {
        ...(input.policy ?? {}),
        approvalRequired: input.policy?.approvalRequired === true || strategy?.approvalRequired === true,
      },
      temporary: input.temporary,
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
    const storedPlan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    const settings = await this.getDeploymentTaskSettings(input.tenantId);
    await this.assertPersistedDeploymentExecutors(storedPlan.id, input.tenantId, 'submit');
    const plan = await this.synchronizeApprovalState(storedPlan);
    const automationApproval = await this.resolveAutomationApproval(input.executionSource, input.tenantId);
    if (plan.status === 'READY') return this.toDto(plan);
    if (settings.dryRunEnabled) {
      const preflightTargets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId))
        .filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
      await this.assertSynchronousPreflight(plan, preflightTargets, 'submit', settings);
    }

    if (plan.status === 'PENDING_APPROVAL') {
      if (automationApproval) {
        const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'automation.approval.applied', {
          approvalStatus: 'NOT_REQUIRED',
          approvalId: undefined,
        });
        return this.toDto(ready);
      }
      if (!(await this.requiresApproval(plan, settings))) {
        const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.disabled', {
          approvalStatus: 'NOT_REQUIRED',
          approvalId: undefined,
        });
        return this.toDto(ready);
      }
      if (!input.approvalId) return this.toDto(plan);
      await this.approval.consume(input.approvalId, await this.approvalParameters(plan));
      const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
      return this.toDto(ready);
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DRAFT 或 PENDING_APPROVAL 计划允许提交', { planId: plan.id, status: plan.status });
    }

    if (await this.requiresApproval(plan, settings)) {
      if (automationApproval) {
        const ready = await this.transitionPlan(plan, 'READY', input.actorId, 'automation.approval.applied', {
          approvalStatus: 'NOT_REQUIRED',
          approvalId: undefined,
        });
        return this.toDto(ready);
      }
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
      await this.enqueueDeploymentApprovalTask(plan, approval.id, input.actorId);
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
    const storedPlan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    const settings = await this.getDeploymentTaskSettings(input.tenantId);
    await this.assertPersistedDeploymentExecutors(storedPlan.id, input.tenantId, 'execute');
    let plan = await this.synchronizeApprovalState(storedPlan);
    const automationApproval = await this.resolveAutomationApproval(input.executionSource, input.tenantId);
    let executionApprovalId = plan.approvalId;
    let executionApproved = plan.approvalStatus === 'APPROVED';
    if (automationApproval) {
      executionApprovalId = automationApproval.id;
      executionApproved = true;
      if (plan.status === 'DRAFT' || plan.status === 'PENDING_APPROVAL') {
        plan = await this.transitionPlan(plan, 'READY', input.actorId, 'automation.approval.applied', {
          approvalStatus: 'NOT_REQUIRED',
          approvalId: undefined,
        });
      }
    } else if (plan.status === 'PENDING_APPROVAL' && !(await this.requiresApproval(plan, settings))) {
      plan = await this.transitionPlan(plan, 'READY', input.actorId, 'approval.disabled', {
        approvalStatus: 'NOT_REQUIRED',
        approvalId: undefined,
      });
    } else if (await this.requiresApproval(plan, settings)) {
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
    if (settings.dryRunEnabled) {
      await this.assertSynchronousPreflight(plan, targets, 'execute', settings);
    }
    // 中文说明：Dry-run 是否启用由当前租户的部署任务参数决定。
    const runtimeSnapshots = await this.resolveRunDeploymentInputRuntimeSnapshots(plan, targets);
    const agentPayloadByTargetId = await this.buildAgentPayloadByTargetIds(plan, targets, runtimeSnapshots);
    await this.freezePluginActionBindingsForExecution(plan, targets, agentPayloadByTargetId);
    const trustPlanByTargetId = await this.buildCertificateTrustPlanByTargetIds(
      plan,
      targets,
      agentPayloadByTargetId,
      input.actorId,
      context.requestId ?? input.idempotencyKey,
    );
    for (const [targetId, payload] of agentPayloadByTargetId) {
      const workflowRequest = readRecord(payload.workflowRequest);
      const executionAuthorization = readRecord(payload.executionAuthorization);
      const workflowVersionId = readOptionalString(workflowRequest?.workflowVersionId);
      const runtimeSnapshot = runtimeSnapshots.get(targetId);
      const allowInsecureTls = runtimeSnapshot?.resolvedDeploymentInput.variables.allowInsecureTls === true;
      agentPayloadByTargetId.set(targetId, {
        ...payload,
        ...(trustPlanByTargetId.get(targetId) ? { certificateTrustPlan: trustPlanByTargetId.get(targetId) } : {}),
        executionAuthorization: {
          ...executionAuthorization,
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
    // 所有动态安全材料都必须在状态切换前完成校验。否则绑定证明缺失时，
    // 计划会被错误地留在 RUNNING，用户既不能执行也不能重新生成。
    const running = await this.transitionPlan(plan, 'RUNNING', input.actorId, 'execution.started');
    const created = await this.executions.createApplyRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: plan.tenantId ?? input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      agentPayloadByTargetId,
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
      source: input.executionSource,
    }, context);

    return { plan: await this.toDto(running), ...created };
  }

  async dryRun(input: DryRunDeploymentPlanInput, _context: RequestContext = {}): Promise<DeploymentPlanPreflightResultDto> {
    const storedPlan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    const settings = await this.getDeploymentTaskSettings(input.tenantId);
    if (!settings.dryRunEnabled) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '当前租户已禁用 Dry-run 预检', { planId: input.planId });
    }
    const plan = storedPlan;
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未运行或已结束的计划允许执行同步预检', { planId: plan.id, status: plan.status });
    }

    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可预检目标', { planId: plan.id });
    const checks = await this.collectSynchronousPlanPreflightChecks(plan, targets, settings);
    return {
      plan: await this.toDto(plan),
      checks,
      summary: summarizeDryRunChecks(checks),
    };
  }

  async cancel(input: CancelDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    for (const run of await this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id })) {
      if (['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
        await this.executions.cancelRun(run.id, input.actorId, input.tenantId);
      }
    }
    const cancelled = await this.transitionPlan(plan, 'CANCELLED', input.actorId, 'plan.cancelled');
    await this.writeBackgroundAudit({
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

  /**
   * 删除自动化内部使用的临时部署计划，但保留执行运行和自动化运行历史。
   */
  async cleanupTemporaryPlan(input: { planId: string; tenantId: string }): Promise<boolean> {
    const plan = await this.repository.getPlan(input.planId, input.tenantId);
    if (!plan || plan.temporary !== true) return false;
    const runs = await this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id }) as ExecutionRunDto[];
    if (runs.some((run) => ['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status))) return false;
    const targets = await this.repository.listTargetsByPlan(plan.id, input.tenantId);
    const approval = plan.approvalId
      ? await this.approval.get(plan.approvalId, input.tenantId)
      : undefined;
    const inputSnapshots = this.deploymentInputSnapshots
      ? await this.deploymentInputSnapshots.listByPlan(input.tenantId, plan.id)
      : [];

    // 审计快照先落盘再删除临时实体。写入失败时保留计划，不能为了清理而削薄排障证据。
    try {
      await this.audit.write({
        eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_TEMPORARY_PLAN_ARCHIVED,
        actorType: 'system',
        actorId: 'automation-cleanup',
        action: 'deployment_plan.temporary.archive',
        resourceType: 'deploymentPlan',
        resourceId: plan.id,
        result: 'success',
        riskLevel: 'medium',
        context: { tenantId: input.tenantId },
        failClosed: true,
        detail: buildTemporaryPlanAuditSnapshot(plan, targets, runs, inputSnapshots, approval),
      });
    } catch {
      return false;
    }
    await this.repository.deleteTransitionsByEntityIds([plan.id, ...targets.map((target) => target.id)], input.tenantId);
    await this.approval.deleteByDeploymentPlan(plan.id, plan.approvalId, input.tenantId);
    if (this.deploymentInputSnapshots) await this.deploymentInputSnapshots.deleteByPlan(input.tenantId, plan.id);
    await this.repository.deleteTargetsByPlan(plan.id, input.tenantId);
    await this.repository.deletePlan(plan.id);
    return true;
  }

  async reevaluateCapabilities(input: ReevaluateDeploymentPlanCapabilitiesInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未正式执行的计划允许重算能力匹配', { planId: plan.id, status: plan.status });
    }
    const targets = new Map((await this.repository.listTargetsByPlan(plan.id, input.tenantId)).map((target) => [target.id, target]));
    let blockedCount = 0;
    for (const result of input.targetResults) {
      const target = targets.get(result.targetId);
      if (!target) throw new AppError('RESOURCE_NOT_FOUND', '部署计划目标不存在', { targetId: result.targetId });
      const status = String(result.matchResult.status ?? '');
      if (status === 'blocked') blockedCount += 1;
      await this.repository.updateTarget(target.id, {
        matchResult: result.matchResult,
        status: status === 'blocked' ? 'FAILED' : 'READY',
        updatedAt: new Date().toISOString(),
        updatedBy: input.actorId,
      });
    }
    const patch: Partial<DeploymentPlanEntity> = { updatedAt: new Date().toISOString(), updatedBy: input.actorId };
    const updated = await this.repository.updatePlan(plan.id, patch);
    await this.writeBackgroundAudit({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.capability.reevaluate',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: blockedCount > 0 ? 'denied' : 'success',
      riskLevel: this.approvalRiskLevel(updated.policy.riskLevel),
      context,
      detail: { targetCount: input.targetResults.length, blockedCount, approvalRequired: updated.policy.approvalRequired === true },
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
           requestedCertificateAssetId: input.certificateAssetId,
           requestedCertificateVersionId: input.certificateVersionId,
           requestedCertificateFormatId: input.certificateFormatId,
           binding: target.binding,
           requestedDomain: target.domain,
         })
       : this.resolveWorkflowCertificateVersionId({
           tenantId: input.tenantId!,
           selectionMode,
           requestedCertificateAssetId: input.certificateAssetId,
           requestedCertificateVersionId: input.certificateVersionId,
           requestedDomain: target.domain,
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

  /**
   * 统一向导创建阶段只保存用户已选的证书版本和目标快照，不读取证书产物，
   * 也不因为当前证书域名或格式预检失败而阻断资产与 DRAFT 计划创建。
   */
  private resolveDeferredCreateInput(input: CreateDeploymentPlanInput): ResolvedCreatePlanInput {
    const selectionMode = input.selectionMode ?? (input.certificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    if (!input.certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', '延迟预检计划必须保留用户选择的证书版本', {
        code: 'CERTIFICATE_VERSION_REQUIRED',
      });
    }
    return {
      selectionMode,
      certificateVersionId: input.certificateVersionId,
      certificateFormatId: input.certificateFormatId,
      targets: input.targets.map((target) => ({ ...target })),
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
        target.managedTarget
          ? readCertificateLocation(requireManagedTargetMetadata(target.managedTarget), target.managedTarget.updatedAt || now)
          : undefined,
        contract,
        resolvedInput,
      );
      // 内网部署以配置绑定和 Agent 写后校验为准；运行态 TLS 观测只作诊断，不能成为建计划门槛。
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
    requestedCertificateAssetId?: string;
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
        input.tenantId,
        input.requestedCertificateAssetId,
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
      input.tenantId,
      input.requestedCertificateAssetId,
    );
  }

  private async resolveWorkflowCertificateVersionId(input: {
    tenantId: string;
    selectionMode: 'EXPLICIT' | 'LATEST_AUTO';
    requestedCertificateAssetId?: string;
    requestedCertificateVersionId?: string;
    requestedDomain?: string;
  }): Promise<string> {
    if (!input.requestedCertificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 部署计划必须指定 certificateVersionId', { selectionMode: input.selectionMode });
    }
    const version = await this.certificates.getVersion(input.requestedCertificateVersionId, input.tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.requestedCertificateVersionId });
    if (input.requestedCertificateAssetId && version.certificateAssetId !== input.requestedCertificateAssetId) {
      throw new AppError('VALIDATION_FAILED', '证书版本不属于所选证书资产', {
        certificateAssetId: input.requestedCertificateAssetId,
        certificateVersionId: input.requestedCertificateVersionId,
      });
    }
    if (!isDeployableCertificateVersion(version)) {
      throw new AppError('VALIDATION_FAILED', '证书版本不可部署', {
        certificateVersionId: input.requestedCertificateVersionId,
        status: version.status,
        deployable: version.deployable,
        notAfter: version.notAfter,
      });
    }
    if (input.requestedDomain) {
      const asset = await this.certificates.getAsset(version.certificateAssetId, input.tenantId);
      if (!asset || !this.coversCertificateDomain(version, asset, input.requestedDomain)) {
        throw new AppError('VALIDATION_FAILED', '证书版本域名与部署目标域名不匹配', {
          certificateVersionId: input.requestedCertificateVersionId,
          domain: normalizeDomain(input.requestedDomain),
        });
      }
    }
    return input.requestedCertificateVersionId;
  }

  private async assertCertificateVersionDeployable(
    certificateVersionId: string,
    binding: CertificateBindingDto,
    requestedDomain?: string,
    requestedCertificateFormatId?: string,
    tenantId?: string,
    requestedCertificateAssetId?: string,
  ): Promise<void> {
    const version = await this.certificates.getVersion(certificateVersionId, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    if (requestedCertificateAssetId && version.certificateAssetId !== requestedCertificateAssetId) {
      throw new AppError('VALIDATION_FAILED', '证书版本不属于所选证书资产', {
        certificateAssetId: requestedCertificateAssetId,
        certificateVersionId,
      });
    }
    const asset = await this.certificates.getAsset(version.certificateAssetId, tenantId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: version.certificateAssetId });
    if (!isDeployableCertificateVersion(version)) {
      throw new AppError('VALIDATION_FAILED', '证书版本不可部署', { certificateVersionId, status: version.status, deployable: version.deployable, notAfter: version.notAfter });
    }
    if (!this.coversBindingDomain(binding, version, asset, requestedDomain)) {
      throw new AppError('VALIDATION_FAILED', '证书版本域名与绑定域名不匹配', {
        certificateVersionId,
        domain: normalizeDomain(requestedDomain ?? binding.domainName ?? binding.domain),
        requestedDomain: normalizeDomain(requestedDomain),
        bindingDomain: normalizeDomain(binding.domainName ?? binding.domain),
      });
    }
    if (requestedCertificateFormatId) {
      await this.assertExplicitCertificateFormatDeployable(certificateVersionId, requestedCertificateFormatId, tenantId);
      return;
    }
  }

  private async assertExplicitCertificateFormatDeployable(
    certificateVersionId: string,
    certificateFormatId: string,
    tenantId?: string,
  ): Promise<void> {
    await this.resolveCertificateFormatForVersion(certificateVersionId, certificateFormatId, tenantId);
  }

  private async findLatestDeployableCertificateVersionIdFromSeed(
    certificateVersionId: string,
    binding?: CertificateBindingDto,
    requestedDomain?: string,
    tenantId?: string,
    requestedCertificateAssetId?: string,
  ): Promise<string> {
    const seed = await this.certificates.getVersion(certificateVersionId, tenantId);
    if (!seed) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    if (requestedCertificateAssetId && seed.certificateAssetId !== requestedCertificateAssetId) {
      throw new AppError('VALIDATION_FAILED', '证书版本不属于所选证书资产', {
        certificateAssetId: requestedCertificateAssetId,
        certificateVersionId,
      });
    }
    const asset = await this.certificates.getAsset(seed.certificateAssetId, tenantId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: seed.certificateAssetId });
    const versionsPage = await this.certificates.listVersions({ page: 1, pageSize: 5000, filter: {} }, tenantId);
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
      const output = new Map<string, DeploymentInputRuntimeSnapshotV1>();
      for (const target of targets) {
        const ref = readRecord(target.strategyPayload?.deploymentInputSnapshotRef);
        if (readOptionalString(ref?.snapshotId)) {
          output.set(target.id, await this.readTargetDeploymentInputRuntimeSnapshot(target, target.tenantId ?? plan.tenantId!));
          continue;
        }
        output.set(target.id, await this.buildAndPersistDeferredRuntimeSnapshot(plan, target, plan.certificateVersionId));
      }
      return output;
    }

    const output = new Map<string, DeploymentInputRuntimeSnapshotV1>();
    for (const target of targets) {
      output.set(target.id, await this.buildLatestAutoRuntimeSnapshot(plan, target));
    }
    return output;
  }

  private async buildAndPersistDeferredRuntimeSnapshot(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
    certificateVersionId: string,
  ): Promise<DeploymentInputRuntimeSnapshotV1> {
    const workingTarget = { ...target } as unknown as ResolvedCreateTarget;
    await this.preflightDeploymentArtifact({
      name: plan.name,
      certificateVersionId,
      certificateFormatId: plan.certificateFormatId,
      selectionMode: plan.selectionMode,
      targets: [],
      idempotencyKey: plan.idempotencyKey,
      actorId: plan.createdBy,
      tenantId: plan.tenantId,
    }, workingTarget, 0, certificateVersionId);
    if (!workingTarget.deploymentInputSnapshotDraft || !workingTarget.deploymentInputRuntimeSnapshotDraft) {
      throw new AppError('VALIDATION_FAILED', '部署目标未生成完整输入快照', {
        code: 'DEPLOYMENT_INPUT_SNAPSHOT_INCOMPLETE',
        deploymentPlanTargetId: target.id,
      });
    }
    await this.persistDeploymentInputSnapshot(
      plan,
      target,
      workingTarget.deploymentInputSnapshotDraft,
      workingTarget.deploymentInputRuntimeSnapshotDraft,
      plan.createdBy,
    );
    return workingTarget.deploymentInputRuntimeSnapshotDraft;
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
      tenantId,
    );
    const artifact = await this.resolveDeploymentArtifactForTarget(target, certificateVersionId, plan.certificateFormatId, tenantId);
    const material = await this.resolveTargetDeploymentInput('preflight', tenantId, {
      applicationAssetId: target.applicationAssetId,
      serviceAssetId: target.serviceAssetId,
      managedTargetId: resolveRuntimeManagedTargetId(target),
      strategyPayload: target.strategyPayload,
    }, artifact);

    if (!material) {
      return this.buildAndPersistDeferredRuntimeSnapshot(plan, target, certificateVersionId);
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
    if (target.executorType !== 'WORKFLOW') return snapshotPayload;
    const workflowSnapshot = readRecord(snapshotPayload.workflowRequest);
    const executionSource = readRecord(snapshotPayload.executionSource);
    const workflowVersionSelection = readWorkflowVersionSelection(executionSource?.workflowVersionSelection);
    const workflowTemplateId = readOptionalString(executionSource?.workflowTemplateId);
    const workflowVersionId = readOptionalString(executionSource?.workflowVersionId);
    const pluginVersionId = readOptionalString(executionSource?.pluginVersionId);
    const capabilityKey = readOptionalString(executionSource?.capabilityKey);
    if (!workflowSnapshot || executionSource?.type !== 'WORKFLOW' && executionSource?.type !== 'PLUGIN'
      || workflowVersionSelection !== 'FIXED' || !workflowTemplateId || !workflowVersionId || !pluginVersionId || !capabilityKey) {
      throw new AppError('VALIDATION_FAILED', '部署计划缺少固定的 WorkflowVersion、PluginVersion 或 Capability 快照', {
        code: 'DEPLOYMENT_WORKFLOW_SNAPSHOT_INVALID',
        deploymentPlanTargetId: target.id,
        workflowVersionSelection,
        workflowTemplateId,
        workflowVersionId,
        pluginVersionId,
        capabilityKey,
      });
    }
    return snapshotPayload;
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
      const payload = await this.buildAgentPayloadForTarget({ ...target, strategyPayload }, artifact);
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

  private async freezePluginActionBindingsForExecution(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    payloadByTargetId: Map<string, Record<string, unknown>>,
  ): Promise<void> {
    for (const target of targets) {
      if (target.executorType !== 'WORKFLOW') continue;
      const payload = payloadByTargetId.get(target.id);
      const workflowRequest = readRecord(payload?.workflowRequest);
      const executionSource = readRecord(payload?.executionSource);
      const workflowVersionId = readOptionalString(workflowRequest?.workflowVersionId)
        ?? readOptionalString(executionSource?.workflowVersionId);
      if (!workflowVersionId || !this.workflows) continue;
      const workflow = await this.workflows.getVersion(workflowVersionId);
      const hasPluginAction = containsPluginAction(workflow.content.steps)
        || containsPluginAction(workflow.content.rollback ?? []);
      if (!hasPluginAction) continue;
      const pluginVersionId = readOptionalString(executionSource?.pluginVersionId)
        ?? readOptionalString(workflowRequest?.pluginVersionId);
      if (!pluginVersionId || !this.unifiedPlugins || !workflowRequest || !payload) {
        throw new AppError('PLUGIN_ACTION_BINDING_MISSING', 'plugin.action 缺少固定 WorkflowVersion 或 PluginVersion，拒绝在执行时猜测绑定', {
          deploymentPlanId: plan.id,
          deploymentPlanTargetId: target.id,
          workflowVersionId,
          pluginVersionId,
        });
      }
      const bindings = buildPluginActionBindings({
        tenantId: target.tenantId ?? plan.tenantId ?? '',
        workflowVersionId,
        content: workflow.content,
        plugin: await this.unifiedPlugins.getVersion(pluginVersionId),
        planDigest: plan.snapshotHash,
      });
      payloadByTargetId.set(target.id, {
        ...payload,
        workflowRequest: {
          ...workflowRequest,
          pluginActionBindings: bindings,
        },
      });
    }
  }

  private async buildCertificateTrustPlanByTargetIds(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    agentPayloadByTargetId: Map<string, Record<string, unknown>>,
    actorId: string,
    requestId: string,
  ): Promise<Map<string, CertificateTrustPlanSnapshot>> {
    const output = new Map<string, CertificateTrustPlanSnapshot>();
    if (!this.certificateTrustPlans) return output;
    for (const target of targets) {
      const agentPayload = agentPayloadByTargetId.get(target.id);
      if (!agentPayload) continue;
      if (!shouldBuildCertificateTrustPlan(agentPayload)) continue;
      const tenantId = target.tenantId ?? plan.tenantId;
      if (!tenantId) continue;
      const agentId = await this.resolveTrustInspectionAgentId(target, agentPayload, tenantId);
      if (!agentId) continue;
      const trustPlan = await this.certificateTrustPlans.build({
        tenantId,
        actorId,
        agentId,
        certificateVersionId: plan.certificateVersionId,
        requestId: `${requestId}:deployment-plan:${plan.id}:target:${target.id}:trust`,
      });
      output.set(target.id, trustPlan.plan);
    }
    return output;
  }

  private async resolveTrustInspectionAgentId(
    target: DeploymentPlanTargetEntity,
    agentPayload: Record<string, unknown>,
    tenantId: string,
  ): Promise<string | undefined> {
    const directAgentId = readOptionalString(agentPayload.agentId);
    if (directAgentId) return directAgentId;
    const managedTargetId = resolveRuntimeManagedTargetId(target);
    if (!managedTargetId || !this.managedTargetContextResolver) return undefined;
    const context = await this.managedTargetContextResolver.resolve(tenantId, managedTargetId);
    return context.agent?.id ?? context.host.agentId;
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
      return this.resolveWorkflowDeploymentArtifact(
        certificateVersionId,
        artifactBindings as Record<string, WorkflowCertificateArtifactBinding>,
        resolvedTenantId,
      );
    }
    if (!target.certificateBindingId) {
      return this.resolveDeploymentArtifact(certificateVersionId, certificateFormatId, resolvedTenantId);
    }
    const binding = await this.tryGetBinding(resolvedTenantId, target.certificateBindingId);
    if (!binding) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署目标缺少 CertificateBinding，无法解析部署材料', {
        deploymentPlanTargetId: target.id,
        certificateBindingId: target.certificateBindingId,
        tenantId: resolvedTenantId,
      });
    }
    return this.resolveDeploymentArtifact(certificateVersionId, certificateFormatId, resolvedTenantId);
  }

  private async resolveDeploymentArtifact(
    certificateVersionId: string,
    certificateFormatId?: string,
    tenantId?: string,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId, tenantId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    if (!certificateFormatId) {
      throw new AppError('VALIDATION_FAILED', '部署目标缺少证书产物绑定或 certificateFormatId', {
        code: 'CERTIFICATE_ARTIFACT_BINDING_REQUIRED',
        certificateVersionId,
      });
    }
    const format = await this.resolveCertificateFormatForVersion(certificateVersionId, certificateFormatId, tenantId);
    const generated = await this.certificatesApp.generateDeploymentArtifactFromFormat({
      tenantId,
      certificateVersionId,
      certificateFormatId: format.id,
      createdBy: 'system',
    });
    return {
      certificateVersionId,
      certificateFormatId: format.id,
      artifactRef: generated.artifactRef,
      artifactSha256: generated.artifactSha256,
      format: generated.format,
      containsPrivateKey: generated.containsPrivateKey,
      certificatePem: generated.certificatePem,
      privateKeyPem: generated.privateKeyPem,
      pfxBase64: generated.pfxBase64,
      pfxPassword: generated.pfxPassword,
      jksBase64: generated.jksBase64,
      files: generated.files.map((file) => ({ ...file, name: file.key })),
      expectedFingerprintSha256: version.fingerprintSha256,
      warnings: generated.warnings,
    };
  }

  private async resolveCertificateFormatForVersion(certificateVersionId: string, certificateFormatId: string, tenantId?: string) {
    const selected = await this.certificates.getFormat(certificateFormatId, tenantId);
    if (!selected) throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId });
    if (!selected.certificateVersionId || selected.certificateVersionId === certificateVersionId) return selected;
    const candidates = await this.certificates.listFormatsByVersion(certificateVersionId, tenantId);
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
    tenantId?: string,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId, tenantId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    const workflowCertificateMaterials: Record<string, Record<string, unknown>> = {};
    let first: DeploymentArtifactSnapshotDto | undefined;
    const warnings: string[] = [];
    for (const [variableName, binding] of Object.entries(bindings)) {
      const format = await this.resolveCertificateFormatForVersion(certificateVersionId, binding.certificateFormatId, tenantId);
      const generated = await this.certificatesApp.generateDeploymentArtifactFromFormat({
        tenantId,
        certificateVersionId,
        certificateFormatId: format.id,
        createdBy: 'system',
      });
      const files = generated.files.map((file) => ({ ...file, name: file.key }));
      const baseMaterial = enrichWorkflowCertificateMaterial({
        certificateVersionId,
        certificateFormatId: generated.certificateFormatId,
        artifactRef: generated.artifactRef,
        artifactSha256: generated.artifactSha256,
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
        jksBase64: generated.jksBase64,
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
        artifactRef: generated.artifactRef,
        artifactSha256: generated.artifactSha256,
        format: generated.format,
        containsPrivateKey: generated.containsPrivateKey,
        certificatePem: generated.certificatePem,
        privateKeyPem: generated.privateKeyPem,
        pfxBase64: generated.pfxBase64,
        pfxPassword: generated.pfxPassword,
        jksBase64: generated.jksBase64,
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
  ): Promise<Record<string, unknown> | undefined> {
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
    // 保留统一的部署后证书验证上下文，但不再给 Windows/Linux Agent 强插本机 TLS 握手步骤。
    const payloadWithCertificateVerification = { ...strategyPayload, certificateVerification };
    if (!runtimeCapability && target.executorType === 'WORKFLOW' && workflowRequest) {
      return { ...payloadWithCertificateVerification, deploymentArtifact: artifact };
    }
    if (readOptionalString(runtimeCapability?.runtime) === 'WORKFLOW_DSL') {
      return { ...payloadWithCertificateVerification, deploymentArtifact: artifact };
    }
    if (readOptionalString(runtimeCapability?.runtime) === 'AGENT_PLAN') {
      return { ...payloadWithCertificateVerification, deploymentArtifact: artifact };
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

  private async attachTrustPlanDryRunChecks(
    steps: ExecutionStepDto[],
    trustPlanByTargetId: Map<string, CertificateTrustPlanSnapshot>,
    actorId: string,
    tenantId?: string,
  ): Promise<ExecutionStepDto[]> {
    if (!steps.length || trustPlanByTargetId.size === 0) return steps;

    const updatedStepIds = new Set<string>();
    for (const step of steps) {
      if (step.stepType !== 'DISCOVER') continue;
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      const trustPlan = trustPlanByTargetId.get(targetId);
      if (!trustPlan) continue;

      const resultDetail = readRecord(step.inputSnapshot.resultDetail) ?? {};
      const existingChecks = Array.isArray(resultDetail.dryRunChecks)
        ? resultDetail.dryRunChecks.filter((item): item is DeploymentPlanDryRunCheckDto => Boolean(item))
        : [];
      const checks = [...existingChecks, this.buildTrustPlanDryRunCheck(trustPlan)];
      await this.executions.updateStepForTest(step.id, {
        inputSnapshot: {
          ...step.inputSnapshot,
          resultDetail: {
            ...resultDetail,
            dryRunChecks: checks,
            dryRunSummary: summarizeDryRunChecks(checks),
            certificateTrustPlan: trustPlan,
          },
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
        status: 'failed',
        detail: '绑定记录里的目标指纹与本次计划目标证书不一致，已阻止部署，避免替换错误证书。',
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

  private buildTrustPlanDryRunCheck(trustPlan: CertificateTrustPlanSnapshot): DeploymentPlanDryRunCheckDto {
    if (trustPlan.decision === 'skip') {
      return {
        key: 'root_trust_already_present',
        label: '目标宿主已信任根证书',
        status: 'passed',
        detail: '按目标根指纹定向检查后，宿主 Root Store 已包含该根证书，本次不会新增根信任阶段。',
        evidence: {
          agentId: trustPlan.agentId,
          rootCertificateId: trustPlan.rootCertificateId,
          fingerprintSha256: trustPlan.fingerprintSha256,
          inspectionStatus: trustPlan.inspection.status,
        },
      };
    }
    return {
      key: 'root_trust_install_required',
      label: '目标宿主缺少根证书信任',
      status: 'warning',
      detail: '按目标根指纹定向检查后，宿主 Root Store 未找到该根证书；正式执行会先插入独立根信任阶段，再继续原有证书部署链。',
      evidence: {
        agentId: trustPlan.agentId,
        rootCertificateId: trustPlan.rootCertificateId,
        fingerprintSha256: trustPlan.fingerprintSha256,
        inspectionStatus: trustPlan.inspection.status,
      },
    };
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
    // 应用资产创建入口传入的 domain 是用户配置的部署目标。绑定记录只在没有应用资产域名时兜底，
    // 避免自动化运行快照中的绑定字段覆盖应用资产的预定义部署参数。
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

  private async requiresApproval(plan: DeploymentPlanEntity, settings?: DeploymentTaskSettings): Promise<boolean> {
    const resolvedSettings = settings ?? await this.getDeploymentTaskSettings(plan.tenantId);
    return resolvedSettings.approvalEnabled || plan.policy.approvalRequired === true;
  }

  private async getDeploymentTaskSettings(tenantId?: string): Promise<DeploymentTaskSettings> {
    if (!tenantId || !this.tenantHierarchy) return { ...DEFAULT_DEPLOYMENT_TASK_SETTINGS };
    return this.tenantHierarchy.getDeploymentTaskSettings(tenantId);
  }

  private async enqueueDeploymentApprovalTask(
    plan: DeploymentPlanEntity,
    approvalId: string,
    actorId: string,
  ): Promise<void> {
    if (!this.tasks || !plan.tenantId) return;
    const summary = {
      displayName: plan.name,
      deploymentPlanId: plan.id,
      approvalId,
      approvalStatus: 'pending',
      approvalPending: true,
      status: 'waiting_approval',
      executionType: 'approval',
    };
    await this.tasks.enqueue({
      tenantId: plan.tenantId,
      // 中文说明：审批本身不是部署执行，必须使用独立任务类型，避免审批通过被误报为部署成功。
      taskType: 'DEPLOYMENT_APPROVAL',
      requestedBy: actorId,
      triggerSource: 'deployment.approval.requested',
      idempotencyKey: `deployment-approval:${approvalId}`,
      resourceSummary: summary,
      initialProgress: summary,
      // 中文说明：审批占位任务不能进入 Worker 队列，审批决定后由监听器直接收敛任务状态。
      initialStatus: 'RETRY_WAITING',
      availableAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      payload: {
        planId: plan.id,
        deploymentPlanId: plan.id,
        approvalId,
        executionType: 'approval',
      },
      resourceRefs: [
        { resourceType: 'deploymentPlan', resourceId: plan.id, displayKey: plan.name },
        { resourceType: 'approval', resourceId: approvalId },
      ],
    });
  }

  private async resolveAutomationApproval(
    source: import('../../executions/dto/executions.dto.js').ExecutionSourceDto | undefined,
    tenantId?: string,
  ): Promise<ApprovalRequestEntity | undefined> {
    if (source?.type !== 'automation' || !source.approvalId || !source.automationRunId) return undefined;
    const approval = await this.approval.get(source.approvalId, tenantId);
    const isBoundToRun = approval?.resourceRefs.some((ref) => ref.type === 'automationRun' && ref.id === source.automationRunId);
    if (!approval || !isBoundToRun || !['approved', 'consumed'].includes(approval.status)) {
      throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '自动化运行审批无效，不能作为部署授权', {
        approvalId: source.approvalId,
        automationRunId: source.automationRunId,
      });
    }
    return approval;
  }

  private approvalRiskLevel(riskLevel: RiskLevel | undefined): RiskLevel {
    return riskLevel === 'critical' || riskLevel === 'high' ? riskLevel : 'high';
  }

  private async writeBackgroundAudit(input: WriteAuditInput): Promise<void> {
    await this.audit.write(input).catch(() => undefined);
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
    const relayProtocols = protocols.map((protocol, index) => assertGatewayRelayRouteChannel(protocol, `protocols[${index}]`));
    if (!tenantId) {
      throw new AppError('TENANT_CONTEXT_INVALID', '部署目标缺少租户上下文，拒绝计算网关路由', {
        executionTargetId: target.executionTargetId,
        delegatedTargetId: target.delegatedTargetId,
      });
    }

    const routeResult = await this.gateways.route(tenantId, {
      zoneId,
      targetId,
      protocols: relayProtocols,
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
    if (route.adapter !== undefined) {
      route.adapter = assertGatewayRelayRouteChannel(route.adapter, 'gatewayRoute.adapter');
    }
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
    if (executorType === 'GATEWAY_FORWARD') return ['relay.tcp'];
    return [];
  }

  private async assertPersistedDeploymentExecutors(planId: string, tenantId: string | undefined, operation: string): Promise<void> {
    const targets = await this.repository.listTargetsByPlan(planId, tenantId);
    assertDeploymentExecutorTypes(targets, operation);
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

  private async readDryRunChecks(run: ExecutionRunDto, tenantId?: string): Promise<DeploymentPlanDryRunCheckDto[]> {
    const steps = await this.executions.listSteps({ tenantId, executionRunId: run.id }) as ExecutionStepDto[];
    const checks: DeploymentPlanDryRunCheckDto[] = [];
    for (const step of steps) {
      const resultDetail = readRecord(step.inputSnapshot.resultDetail);
      const rawChecks = Array.isArray(resultDetail?.dryRunChecks) ? resultDetail.dryRunChecks : [];
      for (const rawCheck of rawChecks) {
        if (!rawCheck || typeof rawCheck !== 'object' || Array.isArray(rawCheck)) continue;
        const check = rawCheck as Record<string, unknown>;
        const key = readOptionalString(check.key);
        const label = readOptionalString(check.label);
        if (!key || !label) continue;
        const status = readOptionalString(check.status);
        checks.push({
          key,
          label,
          status: status === 'passed' || status === 'failed' || status === 'warning' ? status : 'unknown',
          ...(readOptionalString(check.detail) ? { detail: readOptionalString(check.detail) } : {}),
        });
      }
    }
    return checks;
  }

  /**
   * 从部署计划目标的固定执行来源快照读取工作流身份。
   *
   * 计划执行阶段只消费这份快照，不能回查应用资产或工作流目录来重新选择版本。
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
    if (target.executorType !== 'WORKFLOW' && target.executorType !== 'PLUGIN_RUNNER') return undefined;

    const executionSource = readRecord(target.strategyPayload?.executionSource);
    const sourceType = readOptionalString(executionSource?.type);
    const workflowVersionSelection = readWorkflowVersionSelection(executionSource?.workflowVersionSelection);
    const workflowId = readOptionalString(executionSource?.workflowTemplateId);
    const workflowVersionId = readOptionalString(executionSource?.workflowVersionId);
    const pluginId = readOptionalString(executionSource?.pluginId);
    const pluginVersion = readOptionalString(executionSource?.pluginVersion);
    const pluginVersionId = readOptionalString(executionSource?.pluginVersionId);
    const capabilityKey = readOptionalString(executionSource?.capabilityKey);
    const packageSha256 = readOptionalString(executionSource?.packageSha256);
    const manifestSha256 = readOptionalString(executionSource?.manifestSha256);
    const resourceSha256 = readStringMap(executionSource?.resourceSha256);
    const workflowContentSha256 = readOptionalString(executionSource?.workflowContentSha256);
    if ((sourceType !== 'WORKFLOW' && sourceType !== 'PLUGIN')
      || workflowVersionSelection !== 'FIXED'
      || !workflowId
      || !workflowVersionId
      || !pluginId
      || !pluginVersion
      || !pluginVersionId
      || !capabilityKey
      || !packageSha256
      || !manifestSha256
      || !resourceSha256
      || !workflowContentSha256) {
      // 列表和详情是只读审计视图。历史计划可能在固定身份快照收紧前创建，
      // 不能因为其中一个目标缺字段就让整个部署计划列表失败；执行链路仍在
      // resolveLiveWorkflowStrategyPayloadForTarget 中严格拒绝这类快照。
      return undefined;
    }

    let workflowVersion: WorkflowVersion | undefined;
    if (this.workflows) {
      workflowVersion = await this.getWorkflowVersion(
        workflowVersions,
        `version:${workflowVersionId}`,
        () => this.workflows!.getVersion(workflowVersionId),
      );
      if (!workflowVersion || workflowVersion.templateId !== workflowId || workflowVersion.contentHash !== workflowContentSha256) {
        // 工作流目录中的历史版本可能已清理或重新投影。身份摘要只用于展示，
        // 不能让目录不一致阻断读取；正式执行仍通过固定快照校验保护。
        return undefined;
      }
    }

    return {
      mode: sourceType === 'PLUGIN' ? 'PLUGIN_INTERNAL_WORKFLOW' : 'WORKFLOW',
      workflowId,
      ...(workflowVersion?.content.metadata.name ? { workflowName: workflowVersion.content.metadata.name } : {}),
      workflowVersionId,
      workflowVersionSelection: 'FIXED',
      ...(workflowVersion?.content.metadata.version ? { workflowDslVersion: workflowVersion.content.metadata.version } : {}),
      pluginId,
      pluginVersion,
      pluginVersionId,
      capabilityKey,
      packageSha256,
      manifestSha256,
      resourceSha256,
      workflowContentSha256,
    };
  }

  private async getWorkflowVersion(
    cache: Map<string, Promise<WorkflowVersion | undefined>>,
    key: string,
    load: () => Promise<WorkflowVersion | undefined>,
  ): Promise<WorkflowVersion | undefined> {
    const cached = cache.get(key);
    if (cached) return cached;
    // 目录版本可能已被历史清理；列表摘要是只读信息，目录异常不能阻断计划读取。
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

  /**
   * 这组检查只读取控制面数据，不能创建执行运行、任务、Grant 或证书产物。
   * 仅由手动预检接口调用，供用户了解正式部署前的当前状态。
   */
  private async collectSynchronousPlanPreflightChecks(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    settings?: DeploymentTaskSettings,
  ): Promise<DeploymentPlanDryRunCheckDto[]> {
    const checks: DeploymentPlanDryRunCheckDto[] = [this.buildPlanSnapshotPreflightCheck(plan, targets)];
    const targetChecks = await Promise.all(targets.map(async (target) => [
      await this.buildTargetCompatibilityPreflightCheck(target),
      await this.buildCertificateDomainPreflightCheck(plan, target),
      await this.buildDeploymentInputSnapshotPreflightCheck(plan, target),
      await this.buildExecutionSummaryPreflightCheck(target),
    ]));
    checks.push(...targetChecks.flat());
    checks.push(await this.buildApprovalPreflightCheck(plan, settings));
    return checks;
  }

  private async assertSynchronousPreflight(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    operation: 'submit' | 'execute',
    settings?: DeploymentTaskSettings,
  ): Promise<void> {
    const checks = await this.collectSynchronousPlanPreflightChecks(plan, targets, settings);
    const failed = checks.filter((check) => check.status === 'failed');
    if (failed.length > 0) {
      throw new AppError('VALIDATION_FAILED', '部署计划预检失败，请先处理失败检查项', {
        code: 'DEPLOYMENT_PREFLIGHT_FAILED',
        operation,
        planId: plan.id,
        checks: failed,
      });
    }
  }

  private buildPlanSnapshotPreflightCheck(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
  ): DeploymentPlanDryRunCheckDto {
    const actual = this.domain.buildSnapshotHash(plan, targets);
    if (actual !== plan.snapshotHash) {
      return {
        key: 'plan_snapshot_hash',
        label: '部署计划摘要',
        status: 'failed',
        detail: '部署计划摘要与目标快照不一致，请重新创建部署计划。',
        evidence: { planId: plan.id, expectedSnapshotHash: plan.snapshotHash, actualSnapshotHash: actual },
      };
    }
    return {
      key: 'plan_snapshot_hash',
      label: '部署计划摘要',
      status: 'passed',
      detail: '部署计划及目标摘要一致。',
      evidence: { planId: plan.id, snapshotHash: plan.snapshotHash },
    };
  }

  private async buildTargetCompatibilityPreflightCheck(
    target: DeploymentPlanTargetEntity,
  ): Promise<DeploymentPlanDryRunCheckDto> {
    try {
      assertDeploymentExecutorTypes([target], 'synchronous-preflight');
      if (!['READY', 'COMPLETED', 'FAILED'].includes(target.status)) {
        throw new AppError('VALIDATION_FAILED', '部署目标当前状态不允许执行', {
          deploymentPlanTargetId: target.id,
          status: target.status,
        });
      }
      if (!target.executionTargetId) {
        throw new AppError('VALIDATION_FAILED', '部署目标缺少固定执行目标', {
          deploymentPlanTargetId: target.id,
        });
      }
      const matchStatus = readOptionalString(target.matchResult?.status);
      if (matchStatus === 'blocked') {
        throw new AppError('CAPABILITY_MISSING', '目标能力匹配已被阻断', {
          deploymentPlanTargetId: target.id,
          matchResult: target.matchResult,
        });
      }
      if (matchStatus === 'manual_required' || matchStatus === 'degraded') {
        return {
          key: `target_compatibility:${target.id}`,
          label: '部署目标兼容性',
          status: 'warning',
          detail: '目标能力存在人工确认或降级风险，正式执行将按计划审批策略处理。',
          evidence: { deploymentPlanTargetId: target.id, executorType: target.executorType, matchStatus },
        };
      }
      return {
        key: `target_compatibility:${target.id}`,
        label: '部署目标兼容性',
        status: 'passed',
        detail: '目标状态、执行器和能力匹配可用于部署。',
        evidence: { deploymentPlanTargetId: target.id, executorType: target.executorType, matchStatus: matchStatus ?? 'assumed' },
      };
    } catch (error) {
      return this.toFailedPreflightCheck(`target_compatibility:${target.id}`, '部署目标兼容性', error, {
        deploymentPlanTargetId: target.id,
      });
    }
  }

  private async buildCertificateDomainPreflightCheck(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
  ): Promise<DeploymentPlanDryRunCheckDto> {
    try {
      const tenantId = target.tenantId ?? plan.tenantId;
      if (!tenantId) throw new AppError('VALIDATION_FAILED', '部署目标缺少 tenantId，无法校验证书。', { deploymentPlanTargetId: target.id });
      const binding = target.certificateBindingId
        ? await this.tryGetBinding(tenantId, target.certificateBindingId)
        : undefined;
      if (target.certificateBindingId && !binding) {
        throw new AppError('RESOURCE_NOT_FOUND', '部署目标引用的 CertificateBinding 已不存在。', {
          deploymentPlanTargetId: target.id,
          certificateBindingId: target.certificateBindingId,
        });
      }
      const asset = target.applicationAssetId
        ? await this.assets.getServiceAsset(tenantId, target.applicationAssetId)
        : undefined;
      // 中文说明：ApplicationAsset 的 DNS 是用户实际访问入口，优先于绑定发现时记录的 IP。
      const domain = normalizeDomain(asset?.sniName ?? asset?.address ?? binding?.domainName ?? binding?.domain);
      const certificateVersionId = plan.selectionMode === 'LATEST_AUTO'
        ? await this.findLatestDeployableCertificateVersionIdFromSeed(plan.certificateVersionId, binding, domain, tenantId)
        : plan.certificateVersionId;
      if (binding) {
        await this.assertCertificateVersionDeployable(
          certificateVersionId,
          binding,
          domain,
          plan.certificateFormatId,
          tenantId,
        );
      } else {
        await this.resolveWorkflowCertificateVersionId({
          tenantId,
          selectionMode: 'EXPLICIT',
          requestedCertificateVersionId: certificateVersionId,
          requestedDomain: domain,
        });
      }
      await this.assertPreflightCertificateArtifactFormats(plan, target, certificateVersionId, tenantId);
      return {
        key: `certificate_domain:${target.id}`,
        label: '证书与目标域名',
        status: 'passed',
        detail: '可部署证书版本、格式和目标域名匹配。',
        evidence: {
          deploymentPlanTargetId: target.id,
          certificateVersionId,
          domain,
          selectionMode: plan.selectionMode,
        },
      };
    } catch (error) {
      return this.toFailedPreflightCheck(`certificate_domain:${target.id}`, '证书与目标域名', error, {
        deploymentPlanTargetId: target.id,
        certificateVersionId: plan.certificateVersionId,
      });
    }
  }

  private async assertPreflightCertificateArtifactFormats(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
    certificateVersionId: string,
    tenantId: string,
  ): Promise<void> {
    if (plan.certificateFormatId) {
      await this.resolveCertificateFormatForVersion(certificateVersionId, plan.certificateFormatId, tenantId);
    }
    const workflowRequest = readRecord(target.strategyPayload?.workflowRequest);
    const bindings = readWorkflowCertificateArtifactBindings(readRecord(workflowRequest?.inputBindings)?.artifacts);
    for (const binding of Object.values(bindings)) {
      await this.resolveCertificateFormatForVersion(certificateVersionId, binding.certificateFormatId, tenantId);
    }
  }

  private async buildDeploymentInputSnapshotPreflightCheck(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
  ): Promise<DeploymentPlanDryRunCheckDto> {
    try {
      const tenantId = target.tenantId ?? plan.tenantId;
      if (!tenantId) throw new AppError('VALIDATION_FAILED', '部署目标缺少 tenantId，无法校验输入快照。', { deploymentPlanTargetId: target.id });
      const ref = readRecord(target.strategyPayload?.deploymentInputSnapshotRef);
      const runtimeSnapshot = readOptionalString(ref?.snapshotId)
        ? await this.readTargetDeploymentInputRuntimeSnapshot(target, tenantId)
        : await this.buildDeferredRuntimeSnapshotForPreflight(plan, target, tenantId);
      const artifact = readDeploymentArtifactRuntimeSnapshot(runtimeSnapshot.deploymentArtifact, target.id);
      return {
        key: `deployment_input_snapshot:${target.id}`,
        label: '部署输入快照',
        status: 'passed',
        detail: readOptionalString(ref?.snapshotId)
          ? '不可变输入快照及其摘要可重放。'
          : '延迟创建计划已在预检阶段生成可重放的部署输入材料。',
        evidence: {
          deploymentPlanTargetId: target.id,
          snapshotId: readOptionalString(ref?.snapshotId),
          resolvedSha256: readOptionalString(ref?.resolvedSha256),
          certificateVersionId: artifact.certificateVersionId,
          certificateFormatId: artifact.certificateFormatId,
          snapshotPending: !readOptionalString(ref?.snapshotId),
        },
      };
    } catch (error) {
      return this.toFailedPreflightCheck(`deployment_input_snapshot:${target.id}`, '部署输入快照', error, {
        deploymentPlanTargetId: target.id,
      });
    }
  }

  private async buildDeferredRuntimeSnapshotForPreflight(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
    tenantId: string,
  ): Promise<DeploymentInputRuntimeSnapshotV1> {
    const certificateVersionId = plan.selectionMode === 'LATEST_AUTO'
      ? await this.resolveLatestAutoCertificateVersionForTarget(plan, target, tenantId)
      : plan.certificateVersionId;
    const workingTarget = { ...target } as unknown as ResolvedCreateTarget;
    await this.preflightDeploymentArtifact({
      name: plan.name,
      certificateVersionId,
      certificateFormatId: plan.certificateFormatId,
      selectionMode: plan.selectionMode,
      targets: [],
      idempotencyKey: plan.idempotencyKey,
      actorId: plan.createdBy,
      tenantId,
    }, workingTarget, 0, certificateVersionId);
    if (!workingTarget.deploymentInputRuntimeSnapshotDraft) {
      throw new AppError('VALIDATION_FAILED', '部署目标未生成完整输入快照', {
        code: 'DEPLOYMENT_INPUT_SNAPSHOT_INCOMPLETE',
        deploymentPlanTargetId: target.id,
      });
    }
    return workingTarget.deploymentInputRuntimeSnapshotDraft;
  }

  private async resolveLatestAutoCertificateVersionForTarget(
    plan: DeploymentPlanEntity,
    target: DeploymentPlanTargetEntity,
    tenantId: string,
  ): Promise<string> {
    const binding = target.certificateBindingId ? await this.tryGetBinding(tenantId, target.certificateBindingId) : undefined;
    const asset = target.applicationAssetId ? await this.assets.getServiceAsset(tenantId, target.applicationAssetId) : undefined;
    return this.findLatestDeployableCertificateVersionIdFromSeed(
      plan.certificateVersionId,
      binding,
      asset?.sniName ?? asset?.address,
      tenantId,
    );
  }

  private async buildExecutionSummaryPreflightCheck(
    target: DeploymentPlanTargetEntity,
  ): Promise<DeploymentPlanDryRunCheckDto> {
    try {
      this.assertAgentPlanPreflightShape(target);
      const source = readRecord(target.strategyPayload?.executionSource);
      const pluginVersionId = readOptionalString(source?.pluginVersionId);
      if (!source || !pluginVersionId) {
        if (target.executorType === 'WORKFLOW' || target.executorType === 'PLUGIN_RUNNER') {
          throw new AppError('VALIDATION_FAILED', '工作流部署目标缺少固定插件版本摘要。', {
            deploymentPlanTargetId: target.id,
          });
        }
        return {
          key: `execution_summary:${target.id}`,
          label: '执行绑定摘要',
          status: 'passed',
          detail: '该目标不使用统一插件版本摘要。',
          evidence: { deploymentPlanTargetId: target.id, executorType: target.executorType },
        };
      }
      if (!this.unifiedPlugins) {
        return {
          key: `execution_summary:${target.id}`,
          label: '执行绑定摘要',
          status: 'unknown',
          detail: '当前控制面未接入插件版本读取器，无法校验固定插件摘要。',
          evidence: { deploymentPlanTargetId: target.id, pluginVersionId },
        };
      }
      const plugin = await this.unifiedPlugins.getVersion(pluginVersionId);
      const expectedResourceSha256 = readStringMap(source?.resourceSha256);
      const sourcePluginId = readOptionalString(source?.pluginId);
      const sourcePluginVersion = readOptionalString(source?.pluginVersion);
      const sourcePackageSha256 = readOptionalString(source?.packageSha256);
      const sourceManifestSha256 = readOptionalString(source?.manifestSha256);
      if (!sourcePluginId || !sourcePluginVersion || !sourcePackageSha256 || !sourceManifestSha256 || !expectedResourceSha256) {
        throw new AppError('VALIDATION_FAILED', '执行来源缺少固定插件身份或摘要。', {
          deploymentPlanTargetId: target.id,
          pluginVersionId,
        });
      }
      if (plugin.pluginId !== sourcePluginId
        || plugin.version !== sourcePluginVersion
        || plugin.packageSha256 !== sourcePackageSha256
        || plugin.manifestSha256 !== sourceManifestSha256
        || canonicalize(plugin.resourceSha256) !== canonicalize(expectedResourceSha256)) {
        throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '执行绑定摘要与固定插件版本不一致。', {
          deploymentPlanTargetId: target.id,
          pluginVersionId,
        });
      }
      await this.assertWorkflowAndRunnerSummary(target, source, plugin);
      return {
        key: `execution_summary:${target.id}`,
        label: '执行绑定摘要',
        status: 'passed',
        detail: '固定插件、工作流和 Runner 摘要一致。',
        evidence: {
          deploymentPlanTargetId: target.id,
          pluginVersionId,
          packageSha256: plugin.packageSha256,
          manifestSha256: plugin.manifestSha256,
        },
      };
    } catch (error) {
      return this.toFailedPreflightCheck(`execution_summary:${target.id}`, '执行绑定摘要', error, {
        deploymentPlanTargetId: target.id,
      });
    }
  }

  private assertAgentPlanPreflightShape(target: DeploymentPlanTargetEntity): void {
    const runtime = readOptionalString(readRecord(target.strategyPayload?.pluginRuntimeCapability)?.runtime);
    if (runtime !== 'AGENT_PLAN') return;
    requireAgentPlanExecutionShape(target.strategyPayload ?? {});
  }

  private async assertWorkflowAndRunnerSummary(
    target: DeploymentPlanTargetEntity,
    source: Record<string, unknown>,
    plugin: Awaited<ReturnType<UnifiedPluginVersionReader['getVersion']>>,
  ): Promise<void> {
    const sourceType = readOptionalString(source.type);
    const workflowVersionId = readOptionalString(source.workflowVersionId);
    const workflowContentSha256 = readOptionalString(source.workflowContentSha256);
    if ((sourceType === 'PLUGIN' || sourceType === 'WORKFLOW') && workflowVersionId) {
      if (!workflowContentSha256) throw new AppError('VALIDATION_FAILED', '执行来源缺少固定工作流内容摘要。', { deploymentPlanTargetId: target.id });
      if (!this.workflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本读取器未接入。', { deploymentPlanTargetId: target.id });
      const workflow = await this.workflows.getVersion(workflowVersionId);
      if (!workflow || workflow.contentHash !== workflowContentSha256) {
        throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '固定工作流版本内容摘要不一致。', {
          deploymentPlanTargetId: target.id,
          workflowVersionId,
        });
      }
    }
    if (target.executorType === 'PLUGIN_RUNNER') {
      throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '包级 PLUGIN_RUNNER 目标已禁止，不能从部署计划恢复执行。', {
        deploymentPlanTargetId: target.id,
      });
    }
  }

  private async buildApprovalPreflightCheck(
    plan: DeploymentPlanEntity,
    settings?: DeploymentTaskSettings,
  ): Promise<DeploymentPlanDryRunCheckDto> {
    try {
      const approvalRequired = await this.requiresApproval(plan, settings);
      if (!approvalRequired) {
        return {
          key: 'approval',
          label: '审批状态',
          status: 'passed',
          detail: '当前部署策略不要求审批。',
          evidence: { approvalRequired: false, approvalStatus: plan.approvalStatus },
        };
      }
      const approval = plan.approvalId ? await this.approval.get(plan.approvalId, plan.tenantId) : undefined;
      if (plan.approvalStatus === 'APPROVED' && (!approval || approval.status === 'approved' || approval.status === 'consumed')) {
        return {
          key: 'approval',
          label: '审批状态',
          status: 'passed',
          detail: '正式执行所需审批已满足。',
          evidence: { approvalRequired: true, approvalId: plan.approvalId, approvalStatus: approval?.status ?? plan.approvalStatus },
        };
      }
      if (approval?.status === 'rejected' || approval?.status === 'expired' || approval?.status === 'cancelled') {
        return {
          key: 'approval',
          label: '审批状态',
          status: 'failed',
          detail: '关联审批单已被拒绝、过期或取消，不能执行部署。',
          evidence: { approvalRequired: true, approvalId: approval.id, approvalStatus: approval.status },
        };
      }
      return {
        key: 'approval',
        label: '审批状态',
        status: 'warning',
        detail: approval ? '部署仍在等待审批通过。' : '正式执行前将创建或校验审批单。',
        evidence: { approvalRequired: true, approvalId: plan.approvalId, approvalStatus: approval?.status ?? plan.approvalStatus },
      };
    } catch (error) {
      return this.toFailedPreflightCheck('approval', '审批状态', error, { planId: plan.id });
    }
  }

  private toFailedPreflightCheck(
    key: string,
    label: string,
    error: unknown,
    evidence: Record<string, unknown>,
  ): DeploymentPlanDryRunCheckDto {
    return {
      key,
      label,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
      evidence: {
        ...evidence,
        errorCode: error instanceof AppError ? error.errorCode : 'SYSTEM_INTERNAL_ERROR',
      },
    };
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
    jksBase64: { sourceKey: 'jksBase64', role: 'keystore', format: 'base64' },
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
  'jksBase64',
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

/**
 * 根信任只服务于会读取 Windows 证书库的部署目标（典型是 IIS HTTPS Binding）。
 * 证书更新插件的 PEM 快照是明确的跳过证据；其它已知存储类型则以统一输入中的
 * certificateLocation 为准。普通工作流若没有存储事实，保留历史兜底，避免旧计划
 * 因新增门禁而改变行为；一旦有明确事实，就不能把 PEM/KeyStore 猜成 Windows Root Store。
 */
export function shouldBuildCertificateTrustPlan(agentPayload: Record<string, unknown>): boolean {
  const storageKind = readDeploymentCertificateStorageKind(agentPayload);
  if (Object.prototype.hasOwnProperty.call(agentPayload, 'certificateUpdateSnapshot')) {
    const snapshot = readRecord(agentPayload.certificateUpdateSnapshot);
    const artifactKind = readOptionalString(snapshot?.artifactKind);
    if (artifactKind === 'PEM_FILES') return false;
    if (artifactKind === 'KEYSTORE') return storageKind === 'WINDOWS_CERTIFICATE_STORE';
    throw new AppError('VALIDATION_FAILED', '证书更新快照缺少受支持的 Artifact 类型，拒绝继续部署', {
      code: 'CERTIFICATE_ARTIFACT_KIND_INVALID',
      artifactKind,
    });
  }

  if (storageKind === 'WINDOWS_CERTIFICATE_STORE') return true;
  if (storageKind === 'PEM_FILES' || storageKind === 'KEYSTORE') return false;

  // 普通工作流没有统一证书存储事实时沿用历史根信任逻辑。
  return true;
}

function readDeploymentCertificateStorageKind(
  agentPayload: Record<string, unknown>,
): 'PEM_FILES' | 'KEYSTORE' | 'WINDOWS_CERTIFICATE_STORE' | undefined {
  const resolvedInput = readRecord(agentPayload.resolvedDeploymentInput);
  const assetContext = readRecord(resolvedInput?.assetContext);
  const target = readRecord(assetContext?.target);
  const deployment = readRecord(assetContext?.deployment);
  const deploymentTargets = Array.isArray(deployment?.targets) ? deployment.targets : [];
  const locations = [
    readRecord(target?.certificateLocation),
    ...deploymentTargets.map((item) => readRecord(readRecord(item)?.certificateLocation)),
  ];
  for (const location of locations) {
    const storageKind = readOptionalString(location?.storageKind);
    if (storageKind === 'PEM_FILES' || storageKind === 'KEYSTORE' || storageKind === 'WINDOWS_CERTIFICATE_STORE') {
      return storageKind;
    }
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sortDeploymentRuns(runs: readonly ExecutionRunDto[]): ExecutionRunDto[] {
  return [...runs].sort((left, right) => {
    const runNo = Number(right.runNo ?? 0) - Number(left.runNo ?? 0);
    if (runNo !== 0) return runNo;
    return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
  });
}

function buildTemporaryPlanAuditSnapshot(
  plan: DeploymentPlanEntity,
  targets: readonly DeploymentPlanTargetEntity[],
  runs: readonly ExecutionRunDto[],
  inputSnapshots: readonly DeploymentInputSnapshotEntity[],
  approval?: ApprovalRequestEntity,
): Record<string, unknown> {
  return {
    snapshotVersion: 1,
    archivedAt: new Date().toISOString(),
    planId: plan.id,
    applicationAssetIds: uniqueStrings(targets.map((target) => target.applicationAssetId)),
    certificateVersionId: plan.certificateVersionId,
    status: plan.status,
    executionStatus: plan.executionStatus,
    approvalStatus: plan.approvalStatus,
    approvalId: plan.approvalId,
    ...(approval ? {
      approvalSummary: {
        id: approval.id,
        status: approval.status,
        riskLevel: approval.riskLevel,
        requestedBy: approval.requestedBy,
        approvedBy: approval.approvedBy,
        expiresAt: approval.expiresAt,
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
      },
    } : {}),
    snapshotHash: plan.snapshotHash,
    createdReason: plan.createdReason,
    targetSummary: targets.map((target) => ({
      targetId: target.id,
      applicationAssetId: target.applicationAssetId,
      certificateBindingId: target.certificateBindingId,
      executionTargetId: target.executionTargetId,
      executorType: target.executorType,
      status: target.status,
      executionStatus: target.executionStatus,
    })),
    runSummary: sortDeploymentRuns(runs).map((run) => ({
      runId: run.id,
      type: run.type,
      status: run.status,
      runNo: run.runNo,
      errorCode: run.errorCode,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
    inputSnapshotSummary: inputSnapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      targetId: snapshot.deploymentPlanTargetId,
      revision: snapshot.revision,
      resolvedSha256: snapshot.snapshot.resolvedSha256,
      contractVersion: snapshot.snapshot.contractVersion,
      executable: snapshot.snapshot.executable,
      createdAt: snapshot.createdAt,
    })),
  };
}

function readWorkflowVersionSelection(value: unknown): 'FIXED' | undefined {
  return value === 'FIXED' ? 'FIXED' : undefined;
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

function readStringMap(value: unknown): Record<string, string> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record);
  if (entries.some(([, item]) => typeof item !== 'string' || !item.trim())) return undefined;
  return Object.fromEntries(entries.map(([key, item]) => [key, item as string]));
}

export function artifactSnapshotsFromDeploymentArtifact(
  artifact: DeploymentArtifactSnapshotDto,
  artifactSlots: readonly string[] = [],
): Record<string, ResolvedArtifactV1> {
  const workflowMaterials = Object.entries(artifact.workflowCertificateMaterials ?? {});
  if (workflowMaterials.length > 0) {
    return Object.fromEntries(workflowMaterials.map(([slot, material]) => [slot, {
      ...material,
      artifactId: `${artifact.certificateVersionId}:${artifact.certificateFormatId}`,
      certificateVersionId: artifact.certificateVersionId,
      certificateFormatId: artifact.certificateFormatId,
      format: artifact.format,
      outputs: readRecord(material.outputs) ?? {},
    }]));
  }

  // 直接证书产物也要进入固定 certificateArtifact 槽位；否则普通六插件
  // 工作流在没有 workflowCertificateMaterials 时会丢失 JKS/PEM/PFX 输出。
  const enriched = enrichWorkflowCertificateMaterial({
    ...artifact,
    files: artifact.files ?? [],
  });
  const outputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    leafPem: enriched.leafPem,
    certificatePem: enriched.certificatePem,
    privateKeyPem: enriched.privateKeyPem,
    orderedChainPem: enriched.orderedChainPem,
    fingerprintSha256: enriched.fingerprintSha256,
    pfxBase64: artifact.pfxBase64,
    pfxPassword: artifact.pfxPassword,
    jksBase64: artifact.jksBase64,
  })) {
    if (value !== undefined) outputs[key] = value;
  }
  if (artifact.files?.length) outputs.files = structuredClone(artifact.files);
  const snapshot: ResolvedArtifactV1 = {
    artifactId: `${artifact.certificateVersionId}:${artifact.certificateFormatId}`,
    artifactRef: artifact.artifactRef,
    artifactSha256: artifact.artifactSha256,
    format: artifact.format,
    containsPrivateKey: artifact.containsPrivateKey,
    expectedFingerprintSha256: artifact.expectedFingerprintSha256,
    outputs,
  };
  // 直接生成的证书产物没有 Workflow 绑定名，必须按当前插件合同的槽位投影。
  // 没有合同上下文时保留历史 certificateArtifact 槽位，兼容旧版六类证书插件。
  const slots = artifactSlots.length > 0 ? artifactSlots : ['certificateArtifact'];
  return Object.fromEntries(slots.map((slot) => [slot, structuredClone(snapshot)]));
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

export function isAgentPlanDeploymentPayload(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  if (readOptionalString(readRecord(payload.pluginRuntimeCapability)?.runtime) === 'AGENT_PLAN') return true;
  const actionType = readOptionalString(payload.actionType);
  const plan = readRecord(payload.plan);
  return actionType === 'agent.plan.execute' && Array.isArray(plan?.operations) && plan.operations.length > 0;
}

function requireAgentPlanExecutionShape(payload: Record<string, unknown>): {
  rawPlan: Record<string, unknown>;
  authorization: Record<string, unknown>;
} {
  const rawPlan = readRecord(payload.plan);
  if (!rawPlan || !Array.isArray(rawPlan.operations) || rawPlan.operations.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Agent Plan 缺少有效 operations，无法执行部署', {
      code: 'AGENT_PLAN_OPERATIONS_REQUIRED',
    });
  }
  const authorization = readRecord(payload.executionAuthorization);
  if (!authorization || !Array.isArray(authorization.actions)) {
    throw new AppError('VALIDATION_FAILED', 'Agent Plan 缺少有效 executionAuthorization.actions', {
      code: 'AGENT_PLAN_AUTHORIZATION_REQUIRED',
    });
  }
  return { rawPlan, authorization };
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

/** 与插件 Runtime Adapter 使用同一稳定排序规则，避免对象键顺序造成伪摘要不一致。 */
function pluginResourceAggregateHash(resourceSha256: Record<string, string>): string {
  const ordered = Object.fromEntries(
    Object.entries(resourceSha256).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `sha256:${createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')}`;
}

function domainMatches(pattern: string, domain: string): boolean {
  const normalizedPattern = normalizeDomain(pattern);
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedPattern || !normalizedDomain) return false;
  if (normalizedPattern === normalizedDomain) return true;
  if (!normalizedPattern.startsWith('*.')) return false;
  const suffix = normalizedPattern.slice(2);
  const domainLabels = normalizedDomain.split('.');
  const suffixLabels = suffix.split('.');
  return domainLabels.length === suffixLabels.length + 1
    && normalizedDomain.endsWith(`.${suffix}`);
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  return code === '42P01' || message.includes('does not exist');
}

function effectiveBindingFromPayload(payload: Record<string, unknown>) {
  const value = readRecord(payload.effectiveInputBindings);
  if (!value || value.apiVersion !== 'gcac.input-bindings/v1') return undefined;
  return { inputBindings: value as unknown as InputBindingsV1, provenance: {} };
}

function assertDeploymentExecutorTypes(
  targets: readonly { executorType?: unknown }[],
  operation: string,
): void {
  for (const [targetIndex, target] of targets.entries()) {
    const executorType = target.executorType;
    if (executorType === undefined) continue;
    if (executorType === 'PLUGIN_RUNNER') {
      throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '包级 PLUGIN_RUNNER 部署目标已禁止；必须使用普通 WORKFLOW 和步骤级 plugin.action', {
        operation,
        targetIndex,
      });
    }
    if (typeof executorType !== 'string' || !ExecutionTargetKinds.includes(executorType as ExecutionTargetKind)) {
      throw new AppError('VALIDATION_FAILED', '部署目标执行器未接入受支持的 Agent v2 或 Plugin Runner 路径，拒绝继续', {
        code: 'DEPLOYMENT_EXECUTOR_NOT_REGISTERED',
        operation,
        targetIndex,
        executorType,
        allowedExecutorTypes: ExecutionTargetKinds,
      });
    }
  }
}

function containsPluginAction(steps: readonly WorkflowStep[]): boolean {
  return steps.some((step) => step.type === 'plugin.action'
    || step.type === 'foreach' && containsPluginAction(step.foreach.steps));
}
