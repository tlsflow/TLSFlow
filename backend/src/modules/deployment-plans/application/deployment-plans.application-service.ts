import { AppError } from '../../../common/errors/app-error.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService } from '../../audits/audit.service.js';
import { ApprovalService } from '../../approvals/approval.service.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, RiskLevel } from '../../../shared/security-types.js';
import { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionRunDto, ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { CreateDeploymentPlanInput, DeploymentGatewayRouteDto, DeploymentPlanDto, DeploymentPlanTargetDto, ExecuteDeploymentPlanInput, CancelDeploymentPlanInput, SubmitDeploymentPlanInput, DryRunDeploymentPlanInput, ReevaluateDeploymentPlanCapabilitiesInput } from '../dto/deployment-plans.dto.js';
import { DeploymentPlansDomainService } from '../domain/deployment-plans.domain-service.js';
import { DeploymentPlansRepository } from '../repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../schema/deployment-plans.schema.js';
import { GatewaysApplicationService } from '../../gateways/application/gateways.application-service.js';
import type { GatewayAdapterType, GatewayCandidate, ZoneRouteResult } from '../../gateway-agents/index.js';

export interface DeploymentPlansApplicationDependencies {
  repository?: DeploymentPlansRepository;
  executions?: ExecutionsApplicationService;
  approval?: ApprovalService;
  audit?: AuditService;
  domain?: DeploymentPlansDomainService;
  gateways?: GatewaysApplicationService;
}

export class DeploymentPlansApplicationService {
  private readonly repository: DeploymentPlansRepository;
  private readonly audit: AuditService;
  private readonly approval: ApprovalService;
  private readonly domain: DeploymentPlansDomainService;
  private readonly executions: ExecutionsApplicationService;
  private readonly gateways: GatewaysApplicationService;

  constructor(dependencies: DeploymentPlansApplicationDependencies = {}) {
    this.repository = dependencies.repository ?? new DeploymentPlansRepository();
    this.audit = dependencies.audit ?? new AuditService();
    this.approval = dependencies.approval ?? new ApprovalService(undefined, this.audit);
    this.domain = dependencies.domain ?? new DeploymentPlansDomainService();
    this.executions = dependencies.executions ?? new ExecutionsApplicationService({ deploymentPlansRepository: this.repository, audit: this.audit });
    this.gateways = dependencies.gateways ?? new GatewaysApplicationService();
  }

  getRepository(): DeploymentPlansRepository {
    return this.repository;
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.executions;
  }

  list(input: { tenantId?: string } = {}): DeploymentPlanDto[] {
    return this.repository.listPlans(input.tenantId).map((plan) => this.toDto(plan));
  }

  get(id: string, tenantId?: string): DeploymentPlanDto {
    return this.toDto(this.repository.getPlanOrThrow(id, tenantId));
  }

  create(input: CreateDeploymentPlanInput, context: RequestContext = {}): DeploymentPlanDto {
    this.domain.assertCreateInput(input);
    const requestHash = this.domain.buildRequestHash(input);
    const existing = this.repository.findPlanByIdempotencyKey(input.tenantId, input.actorId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '部署计划幂等键冲突', { idempotencyKey: input.idempotencyKey });
      return this.toDto(existing);
    }

    const now = new Date().toISOString();
    const policy = this.domain.normalizePolicy(input.policy);
    const targetDrafts = input.targets.map((target) => {
      const gatewayRoute = this.normalizeGatewayRoute(target, input.tenantId, policy);
      return {
        certificateBindingId: target.certificateBindingId,
        executionTargetId: target.executionTargetId,
        executorType: this.domain.defaultExecutorType(target.executorType),
        requiredCapabilities: [...new Set(target.requiredCapabilities ?? this.defaultCapabilities())],
        matchResult: this.normalizeRouteMatchResult(target.matchResult, gatewayRoute),
        gatewayRoute,
      };
    });
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
      certificateVersionId: input.certificateVersionId,
      status: 'DRAFT',
      approvalStatus: 'NOT_REQUIRED',
      idempotencyKey: input.idempotencyKey,
      policy,
      createdReason: input.createdReason ?? 'MANUAL',
      createdBy: input.actorId,
    }, targetDrafts);

    const plan = this.repository.createPlan({
      id: newId('pln'),
      tenantId: input.tenantId,
      name: input.name,
      planType: input.planType ?? 'UPDATE',
      certificateVersionId: input.certificateVersionId,
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
    this.recordTransition('deploymentPlan', plan.id, undefined, 'DRAFT', 'plan.created', input.actorId, input.tenantId);

    for (const target of targetDrafts) {
      this.repository.createTarget({
        id: newId('dpt'),
        tenantId: input.tenantId,
        deploymentPlanId: plan.id,
        certificateBindingId: target.certificateBindingId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: target.requiredCapabilities,
        matchResult: target.matchResult ?? { status: 'assumed', reason: '编排壳只记录能力需求，不做真实探测' },
        gatewayRoute: target.gatewayRoute,
        status: 'READY',
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        version: 1,
      });
    }

    this.audit.write({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'deployment_plan.create',
      resourceType: 'deploymentPlan',
      resourceId: plan.id,
      result: 'success',
      riskLevel: this.approvalRiskLevel(policy.riskLevel),
      context,
      detail: { targetCount: input.targets.length, snapshotHash },
    });

    return this.toDto(plan);
  }

  submit(input: SubmitDeploymentPlanInput, context: RequestContext = {}): DeploymentPlanDto {
    const plan = this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (plan.status === 'READY') return this.toDto(plan);

    if (plan.status === 'PENDING_APPROVAL') {
      if (!input.approvalId) return this.toDto(plan);
      this.approval.consume(input.approvalId, this.approvalParameters(plan));
      const ready = this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
      return this.toDto(ready);
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DRAFT 或 PENDING_APPROVAL 计划允许提交', { planId: plan.id, status: plan.status });
    }

    if (this.requiresApproval(plan)) {
      if (input.approvalId) {
        this.approval.consume(input.approvalId, this.approvalParameters(plan));
        const ready = this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId: input.approvalId });
        return this.toDto(ready);
      }
      const approval = this.approval.create({
        operationType: 'deployment.execute',
        resourceRefs: [{ type: 'deploymentPlan', id: plan.id }],
        riskLevel: this.approvalRiskLevel(plan.policy.riskLevel),
        parameters: this.approvalParameters(plan),
        requestedBy: input.actorId,
      }, context);
      const pending = this.transitionPlan(plan, 'PENDING_APPROVAL', input.actorId, 'approval.requested', { approvalStatus: 'PENDING', approvalId: approval.id });
      this.audit.write({
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

    const ready = this.transitionPlan(plan, 'READY', input.actorId, 'plan.ready', { approvalStatus: 'NOT_REQUIRED' });
    this.audit.write({
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
    let plan = this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (this.requiresApproval(plan)) {
      const approvalId = input.approvalId ?? plan.approvalId;
      if (!approvalId) {
        this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'missing approval');
        throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '高风险部署执行必须提供已批准审批单', { planId: plan.id });
      }
      try {
        this.approval.consume(approvalId, this.approvalParameters(plan));
      } catch (error) {
        this.auditDenied(plan, input.actorId, 'deployment_plan.execute', context, 'approval invalid');
        throw error;
      }
      if (plan.status === 'DRAFT') {
        plan = this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId });
      } else if (plan.status === 'PENDING_APPROVAL') {
        plan = this.transitionPlan(plan, 'READY', input.actorId, 'approval.approved', { approvalStatus: 'APPROVED', approvalId });
      }
    }

    if (plan.status !== 'READY') {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 READY 计划允许执行', { planId: plan.id, status: plan.status });
    }

    const targets = this.repository.listTargetsByPlan(plan.id, input.tenantId).filter((target) => target.status === 'READY');
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可执行目标', { planId: plan.id });
    const running = this.transitionPlan(plan, 'RUNNING', input.actorId, 'execution.started');
    const created = await this.executions.createApplyRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    return { plan: this.toDto(running), ...created };
  }

  async dryRun(input: DryRunDeploymentPlanInput, context: RequestContext = {}): Promise<{ plan: DeploymentPlanDto; run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const plan = this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未正式执行的计划允许 dry-run', { planId: plan.id, status: plan.status });
    }

    const targets = this.repository.listTargetsByPlan(plan.id, input.tenantId).filter((target) => target.status === 'READY');
    if (!targets.length) throw new AppError('VALIDATION_FAILED', '部署计划没有可 dry-run 目标', { planId: plan.id });
    const created = await this.executions.createDryRun({
      deploymentPlanId: plan.id,
      deploymentPlanTargetIds: targets.map((target) => target.id),
      type: 'dry_run',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId: new Map(targets.map((target) => [target.id, target.executorType] as const)),
      gatewayRouteByTargetId: new Map(targets.map((target) => [target.id, target.gatewayRoute] as const)),
      concurrencyLimit: plan.policy.batchSize,
      stepMaxAttempts: plan.policy.retry?.maxAttempts,
      retry: plan.policy.retry,
      failurePolicy: plan.policy.failurePolicy,
    }, context);

    return { plan: this.toDto(plan), ...created };
  }

  cancel(input: CancelDeploymentPlanInput, context: RequestContext = {}): DeploymentPlanDto {
    const plan = this.repository.getPlanOrThrow(input.planId, input.tenantId);
    for (const run of this.executions.listRuns({ tenantId: input.tenantId, deploymentPlanId: plan.id })) {
      if (['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
        this.executions.cancelRun(run.id, input.actorId, input.tenantId);
      }
    }
    const cancelled = this.transitionPlan(plan, 'CANCELLED', input.actorId, 'plan.cancelled');
    this.audit.write({
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

  reevaluateCapabilities(input: ReevaluateDeploymentPlanCapabilitiesInput, context: RequestContext = {}): DeploymentPlanDto {
    const plan = this.repository.getPlanOrThrow(input.planId, input.tenantId);
    if (!['DRAFT', 'PENDING_APPROVAL', 'READY'].includes(plan.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有未正式执行的计划允许重算能力匹配', { planId: plan.id, status: plan.status });
    }
    const targets = new Map(this.repository.listTargetsByPlan(plan.id, input.tenantId).map((target) => [target.id, target]));
    let blockedCount = 0;
    let approvalRequired = false;
    for (const result of input.targetResults) {
      const target = targets.get(result.targetId);
      if (!target) throw new AppError('RESOURCE_NOT_FOUND', '部署计划目标不存在', { targetId: result.targetId });
      const status = String(result.matchResult.status ?? '');
      if (status === 'blocked') blockedCount += 1;
      if (status === 'manual_required' || status === 'degraded') approvalRequired = true;
      this.repository.updateTarget(target.id, {
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
    const updated = this.repository.updatePlan(plan.id, patch);
    this.audit.write({
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

  markRunFailedForTest(runId: string, actorId: string, tenantId?: string): ExecutionRunDto {
    return this.executions.markFailedForTest(runId, actorId, tenantId);
  }

  private transitionPlan(plan: DeploymentPlanEntity, nextStatus: DeploymentPlanEntity['status'], actorId: string, event: string, patch: Partial<DeploymentPlanEntity> = {}): DeploymentPlanEntity {
    this.domain.transitionPlan(plan.status, nextStatus);
    const updated = this.repository.updatePlan(plan.id, {
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
    this.recordTransition('deploymentPlan', plan.id, plan.status, nextStatus, event, actorId, plan.tenantId);
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

  private auditDenied(plan: DeploymentPlanEntity, actorId: string, action: string, context: RequestContext, reason: string): void {
    this.audit.write({
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

  private recordTransition(entityType: StateTransitionEventEntity['entityType'], entityId: string, fromStatus: string | undefined, toStatus: string, event: string, actorId: string, tenantId?: string): void {
    this.repository.createTransition({
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

  private normalizeRouteMatchResult(matchResult: Record<string, unknown> | undefined, route: DeploymentPlanTargetEntity['gatewayRoute']): Record<string, unknown> | undefined {
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

  private normalizeGatewayRoute(target: CreateDeploymentPlanInput['targets'][number], tenantId: string | undefined, policy: DeploymentPlanEntity['policy']): DeploymentPlanTargetEntity['gatewayRoute'] {
    const explicitRoute = this.normalizeExplicitGatewayRoute(target);
    if (explicitRoute?.gatewayId || explicitRoute?.agentId || explicitRoute?.gatewayAgentId || target.gatewayRoute) return explicitRoute;

    const zoneId = target.zoneId ?? explicitRoute?.zoneId;
    const targetId = target.delegatedTargetId ?? target.executionTargetId ?? explicitRoute?.delegatedTargetId;
    if (!zoneId || !targetId) return explicitRoute;

    const protocols = this.routeProtocols(target);
    if (protocols.length === 0) return explicitRoute;

    const routeResult = this.gateways.route(tenantId ?? '', {
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

  private gatewayRouteFromRouteResult(target: CreateDeploymentPlanInput['targets'][number], zoneId: string, delegatedTargetId: string, result: ZoneRouteResult, fallbackAdapter: GatewayAdapterType): DeploymentGatewayRouteDto {
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
    const compact = Object.fromEntries(Object.entries(route).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '')) as DeploymentGatewayRouteDto;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  private toDto(plan: DeploymentPlanEntity): DeploymentPlanDto {
    return {
      ...plan,
      targets: this.repository.listTargetsByPlan(plan.id, plan.tenantId).map((target) => this.toTargetDto(target)),
    };
  }

  private toTargetDto(target: DeploymentPlanTargetEntity): DeploymentPlanTargetDto {
    return { ...target };
  }
}
