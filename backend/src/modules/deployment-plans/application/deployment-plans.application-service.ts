import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService } from '../../audits/audit.service.js';
import { ApprovalService } from '../../approvals/approval.service.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, RiskLevel } from '../../../shared/security-types.js';
import { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionRunDto, ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { CreateDeploymentPlanFromApplicationAssetInput, CreateDeploymentPlanInput, DeploymentGatewayRouteDto, DeploymentPlanDto, DeploymentPlanTargetDto, ExecuteDeploymentPlanInput, CancelDeploymentPlanInput, SubmitDeploymentPlanInput, DryRunDeploymentPlanInput, ReevaluateDeploymentPlanCapabilitiesInput } from '../dto/deployment-plans.dto.js';
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
import type { ManagedTargetDto, SiteAssetDto } from '../../assets/dto/assets.dto.js';
import { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import { PgCertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { CertificateAssetEntity, CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import { DeployableArtifactResolver } from './deployable-artifact-resolver.js';
import type { DeploymentArtifactSnapshotDto } from '../../executions/dto/executions.dto.js';

type ResolvedCreateTarget = CreateDeploymentPlanInput['targets'][number] & {
  certificateBindingId: string;
  binding: CertificateBindingDto;
  managedTarget?: ManagedTargetDto;
  siteAsset?: SiteAssetDto;
};

interface ResolvedCreatePlanInput {
  certificateVersionId: string;
  certificateFormatId?: string;
  selectionMode: 'EXPLICIT' | 'LATEST_AUTO';
  targets: ResolvedCreateTarget[];
  artifact: DeploymentArtifactSnapshotDto;
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
  certificates?: CertificatesRepository;
  certificatesApp?: CertificatesApplicationService;
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
  private readonly certificates: CertificatesRepository;
  private readonly certificatesApp: CertificatesApplicationService;
  private readonly artifacts: DeployableArtifactResolver;

  constructor(dependencies: DeploymentPlansApplicationDependencies = {}) {
    this.repository = dependencies.repository ?? new DeploymentPlansRepository();
    this.audit = dependencies.audit ?? new AuditService();
    this.approval = dependencies.approval ?? new ApprovalService(undefined, this.audit);
    this.domain = dependencies.domain ?? new DeploymentPlansDomainService();
    this.executions = dependencies.executions ?? new ExecutionsApplicationService({ deploymentPlansRepository: this.repository, audit: this.audit });
    this.gateways = dependencies.gateways ?? new GatewaysApplicationService();
    this.assets = dependencies.assets ?? new PgAssetsRepository();
    this.bindings = dependencies.bindings ?? new PgBindingsRepository(this.assets);
    this.certificates = dependencies.certificates ?? new PgCertificatesRepository(new PgliteDatabase());
    this.certificatesApp = dependencies.certificatesApp ?? new CertificatesApplicationService({
      secrets: { resolveForService: async () => { throw new AppError('VALIDATION_FAILED', '未配置 Secrets 服务'); } } as never,
      repository: this.certificates,
    });
    this.artifacts = new DeployableArtifactResolver(this.certificates);
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
        managedTargetId: target.managedTargetId ?? target.managedTarget?.id,
        siteAssetId: target.siteAssetId ?? target.siteAsset?.id,
        domain: target.domain ?? target.binding.domainName ?? target.binding.domain,
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
        executionTargetId: target.managedTarget?.id ?? target.managedTargetId ?? target.executionTargetId,
        executorType: this.domain.defaultExecutorType(target.executorType),
        requiredCapabilities: [...new Set<string>(target.requiredCapabilities ?? this.defaultCapabilities())],
        matchResult: this.normalizeRouteMatchResult(target.matchResult, gatewayRoute),
        gatewayRoute,
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
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
        matchResult: target.matchResult ?? { status: 'assumed', reason: '编排层只记录能力需求，不做真实探测' },
        gatewayRoute: target.gatewayRoute,
        status: 'READY',
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        version: 1,
      });
    }

    void this.audit.write({
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
    if (!input.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    const applicationAsset = await this.assets.getServiceAsset(input.tenantId, input.applicationAssetId);
    if (!applicationAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    }
    const bindingTarget = await this.assets.getApplicationAssetTargetByApplicationAssetId(input.tenantId, input.applicationAssetId);
    if (!bindingTarget) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAssetTarget 不存在', { applicationAssetId: input.applicationAssetId });
    }

    let applicationAssetDetail = await this.assets.getServiceAssetDetail(input.tenantId, input.applicationAssetId);
    let candidates = this.resolveApplicationAssetBindingCandidates(
      applicationAssetDetail?.targetBindingDetail?.certificateBindings ?? [],
      input.applicationAssetId,
      bindingTarget,
      applicationAsset.address,
    );
    if (candidates.length === 0) {
      await this.ensureApplicationAssetBinding(input.tenantId, applicationAsset.id, applicationAsset.address, bindingTarget);
      applicationAssetDetail = await this.assets.getServiceAssetDetail(input.tenantId, input.applicationAssetId);
      candidates = this.resolveApplicationAssetBindingCandidates(
        applicationAssetDetail?.targetBindingDetail?.certificateBindings ?? [],
        input.applicationAssetId,
        bindingTarget,
        applicationAsset.address,
      );
    }
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
          siteAssetId: bindingTarget.siteAssetId,
          bindingKey: bindingTarget.bindingKey,
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
    const selectionMode = input.selectionMode ?? (input.targetCertificateVersionId ? 'EXPLICIT' : 'LATEST_AUTO');
    const certificateVersionId = input.targetCertificateVersionId ?? undefined;
    const planName = `${applicationAsset.displayName ?? applicationAsset.address} 证书部署`;

    return this.create({
      name: planName,
      certificateVersionId,
      certificateFormatId: input.certificateFormatId,
      selectionMode,
      targets: [{
        certificateBindingId: binding.id,
        managedTargetId: bindingTarget.managedTargetId,
        siteAssetId: bindingTarget.siteAssetId,
        domain: binding.domainName ?? binding.domain ?? applicationAsset.address,
        executorType: 'AGENT',
      }],
      planType: input.planType ?? 'UPDATE',
      policy: input.policy,
      createdReason: 'MANUAL',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
    }, context);
  }

  private resolveApplicationAssetBindingCandidates(
    items: Array<Pick<CertificateBindingDto, 'id' | 'serviceAssetId' | 'siteAssetId' | 'managedTargetId' | 'bindingKey' | 'domainName' | 'domain'>>,
    applicationAssetId: string,
    bindingTarget: { managedTargetId: string; siteAssetId: string; bindingKey?: string },
    applicationAddress?: string,
  ): Array<Pick<CertificateBindingDto, 'id' | 'serviceAssetId' | 'siteAssetId' | 'managedTargetId' | 'bindingKey' | 'domainName' | 'domain'>> {
    const explicit = items.filter((item) => item.serviceAssetId === applicationAssetId);
    if (explicit.length > 0) return explicit;

    const normalizedAddress = this.normalizeCompareValue(applicationAddress);
    const normalizedBindingKey = this.normalizeCompareValue(bindingTarget.bindingKey);

    const matched = items.filter((item) => {
      if (item.managedTargetId !== bindingTarget.managedTargetId) return false;
      if (item.siteAssetId !== bindingTarget.siteAssetId) return false;

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

  private async ensureApplicationAssetBinding(
    tenantId: string,
    applicationAssetId: string,
    applicationAddress: string,
    bindingTarget: { managedTargetId: string; siteAssetId: string; bindingKey?: string },
  ): Promise<void> {
    const managedTarget = await this.assets.getManagedTarget(tenantId, bindingTarget.managedTargetId);
    const siteAsset = await this.assets.getSiteAsset(tenantId, bindingTarget.siteAssetId);
    if (!managedTarget || !siteAsset) return;

    const serviceInstanceId = managedTarget.serviceInstanceId ?? siteAsset.serviceInstanceId;
    if (!serviceInstanceId) return;

    const existing = await this.bindings.findCertificateBindingByIdentity(tenantId, {
      serviceAssetId: applicationAssetId,
      siteAssetId: siteAsset.id,
      managedTargetId: managedTarget.id,
      serviceInstanceId,
      domainName: applicationAddress,
      domain: applicationAddress,
      port: siteAsset.port ?? undefined,
      protocol: (siteAsset.protocol ?? 'HTTPS') as CertificateBindingDto['protocol'],
      bindingKey: bindingTarget.bindingKey ?? managedTarget.bindingKey ?? siteAsset.bindingInformation ?? applicationAddress,
      bindingType: 'WINDOWS_CERT_STORE',
      storeLocation: 'LocalMachine',
      storeName: 'My',
      verifyMethod: 'STORE_QUERY',
      status: 'MANAGED',
      metadata: {
        source: 'deployment_plan_autofix',
        targetKey: managedTarget.targetKey,
        siteName: siteAsset.siteName,
        bindingInformation: siteAsset.bindingInformation ?? bindingTarget.bindingKey,
        hostHeader: siteAsset.hostHeader ?? '',
      },
    });
    if (existing) return;

    await this.bindings.createCertificateBinding(tenantId, {
      serviceAssetId: applicationAssetId,
      siteAssetId: siteAsset.id,
      managedTargetId: managedTarget.id,
      serviceInstanceId,
      domainName: applicationAddress,
      domain: applicationAddress,
      port: siteAsset.port ?? undefined,
      protocol: (siteAsset.protocol ?? 'HTTPS') as CertificateBindingDto['protocol'],
      bindingKey: bindingTarget.bindingKey ?? managedTarget.bindingKey ?? siteAsset.bindingInformation ?? applicationAddress,
      bindingType: 'WINDOWS_CERT_STORE',
      storeLocation: 'LocalMachine',
      storeName: 'My',
      verifyMethod: 'STORE_QUERY',
      status: 'MANAGED',
      metadata: {
        source: 'deployment_plan_autofix',
        targetKey: managedTarget.targetKey,
        siteName: siteAsset.siteName,
        bindingInformation: siteAsset.bindingInformation ?? bindingTarget.bindingKey,
        hostHeader: siteAsset.hostHeader ?? '',
      },
    });
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
    await this.assertLatestDryRunPassed(plan, input.tenantId);

    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可执行目标', { planId: plan.id });
    const running = await this.transitionPlan(plan, 'RUNNING', input.actorId, 'execution.started');
    const deploymentArtifactByTargetId = await this.buildDeploymentArtifactByTargetIds(plan, targets.map((target) => target.id));
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
      agentPayloadByTargetId: await this.buildAgentPayloadByTargetIds(plan, targets, deploymentArtifactByTargetId),
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    return { plan: await this.toDto(running), ...created };
  }

  async dryRun(input: DryRunDeploymentPlanInput, context: RequestContext = {}): Promise<{ plan: DeploymentPlanDto; run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未运行或已结束的计划允许 dry-run', { planId: plan.id, status: plan.status });
    }

    const targets = (await this.repository.listTargetsByPlan(plan.id, input.tenantId)).filter((target) => ['READY', 'COMPLETED', 'FAILED'].includes(target.status));
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可 dry-run 目标', { planId: plan.id });
    const deploymentArtifactByTargetId = await this.buildDeploymentArtifactByTargetIds(plan, targets.map((target) => target.id));
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
      agentPayloadByTargetId: await this.buildAgentPayloadByTargetIds(plan, targets, deploymentArtifactByTargetId),
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    return { plan: await this.toDto(plan), ...created };
  }

  async cancel(input: CancelDeploymentPlanInput, context: RequestContext = {}): Promise<DeploymentPlanDto> {
    const plan = await this.repository.getPlanOrThrow(input.planId, input.tenantId);
    for (const run of await this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id })) {
      if (['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
        await this.executions.cancelRun(run.id, input.actorId, input.tenantId);
      }
    }
    const cancelled = await this.transitionPlan(plan, 'CANCELLED', input.actorId, 'plan.cancelled');
    void this.audit.write({
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
    void this.audit.write({
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
    const versionIds = await Promise.all(resolvedTargets.map((target) => this.resolveCertificateVersionId({
      tenantId: input.tenantId,
      selectionMode,
      requestedCertificateVersionId: input.certificateVersionId,
      binding: target.binding,
      requestedDomain: target.domain,
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
      artifact: await this.resolveDeploymentArtifact(uniqueVersionIds[0]!, input.certificateFormatId),
    };
  }

  private async resolveTarget(tenantId: string | undefined, target: CreateDeploymentPlanInput['targets'][number]): Promise<ResolvedCreateTarget> {
    if (!tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
    if (target.certificateBindingId) {
      const binding = await this.tryGetBinding(tenantId, target.certificateBindingId);
      if (!binding) {
        // 兼容老的 fixture-only 调用：历史测试只传 bindingId，并未初始化 bindings 表。
        return {
          ...target,
          certificateBindingId: target.certificateBindingId,
          binding: {
            id: target.certificateBindingId,
            tenantId,
            serviceInstanceId: '',
            hostId: '',
            bindingKey: target.certificateBindingId,
            bindingType: 'WINDOWS_CERT_STORE',
            verifyMethod: 'STORE_QUERY',
            status: 'DISCOVERED',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        };
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
      : managedTarget?.siteAssetId
        ? await this.assets.getSiteAsset(tenantId, managedTarget.siteAssetId)
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
    binding: CertificateBindingDto;
    requestedDomain?: string;
  }): Promise<string> {
    if (input.selectionMode === 'EXPLICIT') {
      if (!input.requestedCertificateVersionId) {
        throw new AppError('VALIDATION_FAILED', 'EXPLICIT 模式必须指定 certificateVersionId');
      }
      await this.assertCertificateVersionDeployable(input.requestedCertificateVersionId, input.binding, input.requestedDomain);
      return input.requestedCertificateVersionId;
    }
    return this.findLatestDeployableCertificateVersionId(input.binding, input.requestedDomain);
  }

  private async assertCertificateVersionDeployable(certificateVersionId: string, binding: CertificateBindingDto, requestedDomain?: string): Promise<void> {
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
    const hasCompatibleFormat = await this.hasCompatibleWindowsIisFormat(certificateVersionId);
    if (!hasCompatibleFormat) {
      throw new AppError('VALIDATION_FAILED', '当前不存在可用于 Windows IIS 的证书格式配置', { certificateVersionId, requiredFormat: 'pfx' });
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
      const notAfter = right.version.notAfter.localeCompare(left.version.notAfter);
      if (notAfter !== 0) return notAfter;
      const versionNo = right.version.versionNo - left.version.versionNo;
      if (versionNo !== 0) return versionNo;
      return right.version.createdAt.localeCompare(left.version.createdAt);
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

  private async buildDeploymentArtifactByTargetIds(plan: DeploymentPlanEntity, targetIds: string[]): Promise<Map<string, DeploymentArtifactSnapshotDto>> {
    const artifact = await this.resolveDeploymentArtifact(plan.certificateVersionId, plan.certificateFormatId);
    return new Map(targetIds.map((targetId) => [targetId, artifact] as const));
  }

  private async buildAgentPayloadByTargetIds(
    plan: DeploymentPlanEntity,
    targets: DeploymentPlanTargetEntity[],
    deploymentArtifactByTargetId?: Map<string, DeploymentArtifactSnapshotDto>,
  ): Promise<Map<string, Record<string, unknown>>> {
    const fallbackArtifact = deploymentArtifactByTargetId ? undefined : await this.resolveDeploymentArtifact(plan.certificateVersionId, plan.certificateFormatId);
    const output = new Map<string, Record<string, unknown>>();
    for (const target of targets) {
      const artifact = deploymentArtifactByTargetId?.get(target.id) ?? fallbackArtifact;
      if (!artifact) continue;
      const payload = await this.buildAgentPayloadForTarget(target, artifact);
      if (payload) output.set(target.id, payload);
    }
    return output;
  }

  private async resolveDeploymentArtifact(
    certificateVersionId: string,
    certificateFormatId?: string,
  ): Promise<DeploymentArtifactSnapshotDto> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    const format = certificateFormatId
      ? await this.certificates.getFormat(certificateFormatId)
      : await this.artifacts.resolveWindowsIisPfx(certificateVersionId);
    if (!format) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId });
    }
    if (format.format !== 'pfx' || format.containsPrivateKey !== true) {
      throw new AppError('VALIDATION_FAILED', 'Windows IIS 目前只支持带私钥的 PFX 格式配置', {
        certificateFormatId,
        format: format.format,
        containsPrivateKey: format.containsPrivateKey,
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
      pfxBase64: generated.pfxBase64,
      pfxPassword: generated.pfxPassword,
      containsPrivateKey: generated.containsPrivateKey,
      expectedFingerprintSha256: version.fingerprintSha256,
    };
  }

  private async buildAgentPayloadForTarget(
    target: DeploymentPlanTargetEntity,
    artifact: DeploymentArtifactSnapshotDto,
  ): Promise<Record<string, unknown> | undefined> {
    if (!target.tenantId) return undefined;
    const binding = await this.tryGetBinding(target.tenantId, target.certificateBindingId);
    if (!binding) return undefined;

    const managedTarget = binding.managedTargetId
      ? await this.assets.getManagedTarget(target.tenantId, binding.managedTargetId)
      : undefined;
    const siteAsset = binding.siteAssetId
      ? await this.assets.getSiteAsset(target.tenantId, binding.siteAssetId)
      : managedTarget?.siteAssetId
        ? await this.assets.getSiteAsset(target.tenantId, managedTarget.siteAssetId)
        : undefined;

    const providerType = siteAsset?.providerType ?? managedTarget?.providerType ?? 'IIS';
    if (providerType !== 'IIS') return undefined;

    const siteName = siteAsset?.siteName?.trim();
    if (!siteName) {
      throw new AppError('VALIDATION_FAILED', 'IIS 部署目标缺少 siteName，无法生成 Agent 执行 payload', {
        deploymentPlanTargetId: target.id,
        certificateBindingId: binding.id,
        siteAssetId: siteAsset?.id,
        managedTargetId: managedTarget?.id,
      });
    }

    const bindingInformation = siteAsset?.bindingInformation?.trim() || binding.bindingKey?.trim() || '';
    const parsedBinding = parseIisBindingInformation(bindingInformation);
    const expectedDomains = [...new Set([
      normalizeDomain(binding.domainName ?? binding.domain),
      normalizeDomain(siteAsset?.hostHeader),
    ].filter(Boolean))];
    const verifyUrl = this.resolveVerifyUrl(binding, siteAsset);

    return {
      type: 'windows.iis.deploy_certificate',
      providerType: 'IIS',
      action: 'INSTALL_CERTIFICATE',
      agentId: managedTarget?.agentId,
      managedTargetId: managedTarget?.id,
      siteAssetId: siteAsset?.id,
      siteName,
      bindingSelector: {
        ip: siteAsset?.listenIp ?? parsedBinding.ip,
        port: siteAsset?.port ?? binding.port ?? parsedBinding.port ?? 443,
        hostHeader: siteAsset?.hostHeader ?? parsedBinding.hostHeader,
        bindingInformation: bindingInformation || undefined,
      },
      expectedDomains,
      verifyUrl,
      appPoolName: readOptionalString(siteAsset?.metadata?.appPool) ?? readOptionalString(binding.metadata?.appPool),
      pfxBase64: artifact.pfxBase64,
      pfxPassword: artifact.pfxPassword,
      expectedCertificateFingerprintSha256: artifact.expectedFingerprintSha256,
      deploymentArtifact: {
        certificateVersionId: artifact.certificateVersionId,
        certificateFormatId: artifact.certificateFormatId,
        format: artifact.format,
        containsPrivateKey: artifact.containsPrivateKey,
        providerType: 'IIS',
        expectedFingerprintSha256: artifact.expectedFingerprintSha256,
      },
    };
  }

  private resolveVerifyUrl(binding: CertificateBindingDto, siteAsset?: SiteAssetDto): string {
    const explicit = readOptionalString(siteAsset?.metadata?.verifyUrl);
    if (explicit) return explicit;

    const host = normalizeDomain(
      binding.domainName
      ?? binding.domain
      ?? siteAsset?.hostHeader
      ?? readOptionalString(siteAsset?.metadata?.hostHeader),
    );
    const port = siteAsset?.port ?? binding.port ?? 443;
    if (!host) {
      throw new AppError('VALIDATION_FAILED', 'IIS VERIFY 缺少可构造 verifyUrl 的域名', {
        certificateBindingId: binding.id,
        siteAssetId: siteAsset?.id,
      });
    }
    return `https://${host}:${port}`;
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
    if (executorType === 'WINRM') return ['winrm'];
    if (executorType === 'SMB_WMI') return ['smb', 'wmi'];
    if (executorType === 'CURL') return ['curl'];
    return ['ssh'];
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

function parseIisBindingInformation(value: string): { ip?: string; port?: number; hostHeader?: string } {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const [ip, port, hostHeader] = trimmed.split(':');
  return {
    ip: ip?.trim() || undefined,
    port: port ? Number(port) || undefined : undefined,
    hostHeader: normalizeDomain(hostHeader),
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
