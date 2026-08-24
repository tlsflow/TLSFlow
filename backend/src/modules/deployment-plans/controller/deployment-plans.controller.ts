import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { applyAuthorizationFilter } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { ExecutionTargetKinds, type ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel, SecuritySubject } from '../../../shared/security-types.js';
import { securityErrors } from '../../../shared/security-error.js';
import type { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import { assertGatewayRouteChannel, type GatewayAdapterType } from '../../gateway-agents/gateway-agent.types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { DeploymentGatewayRouteDto, DeploymentPlanPolicyDto, DeploymentPlanSelectionMode } from '../dto/deployment-plans.dto.js';
import { DeploymentPlansApplicationService, type DeploymentPlansApplicationDependencies } from '../application/deployment-plans.application-service.js';
import type { DeploymentPlansRepository } from '../repository/deployment-plans.repository.js';

export class DeploymentPlansController {
  private readonly service: DeploymentPlansApplicationService;

  constructor(service?: DeploymentPlansApplicationService, dependencies?: DeploymentPlansApplicationDependencies, private readonly security?: SecurityServices) {
    this.service = dependencies ? new DeploymentPlansApplicationService(dependencies) : (service ?? new DeploymentPlansApplicationService());
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.service.getExecutionsService();
  }

  getRepository(): DeploymentPlansRepository {
    return this.service.getRepository();
  }

  getApplicationService(): DeploymentPlansApplicationService {
    return this.service;
  }

  register(router: Router): void {
    router.get('/api/v1/deployment-plans', '查询部署计划', ['DeploymentPlans'], (request) => this.list(request));
    router.get('/api/v1/deployment-plans/by-application-asset', '按应用资产查询部署记录', ['DeploymentPlans'], (request) => this.listByApplicationAsset(request));
    router.get('/api/v1/deployment-plans/input-snapshots', '查询部署输入快照', ['DeploymentPlans'], (request) => this.listInputSnapshots(request));
    router.post('/api/v1/deployment-plans', '创建部署计划', ['DeploymentPlans'], (request) => this.create(request));
    router.post('/api/v1/deployment-plans/from-application-asset', '按应用资产创建部署计划', ['DeploymentPlans'], (request) => this.createFromApplicationAsset(request));
    router.post('/api/v1/deployment-plans/from-application', '按 Application 创建部署计划', ['DeploymentPlans'], (request) => this.createFromApplicationAsset(request));
    router.post('/api/v1/deployment-plans/update-from-application-asset', '编辑应用资产部署计划草稿', ['DeploymentPlans'], (request) => this.updateFromApplicationAsset(request));
    router.post('/api/v1/deployment-plans/submit', '提交部署计划', ['DeploymentPlans'], (request) => this.submit(request));
    router.post('/api/v1/deployment-plans/dry-run', '同步预检部署计划', ['DeploymentPlans'], (request) => this.dryRun(request));
    router.post('/api/v1/deployment-plans/execute', '执行部署计划', ['DeploymentPlans'], (request) => this.execute(request));
    router.post('/api/v1/deployment-plans/cancel', '取消部署计划', ['DeploymentPlans'], (request) => this.cancel(request));
    router.post('/api/v1/deployment-plans/delete', '删除部署计划', ['DeploymentPlans'], (request) => this.deleteDraft(request));
    router.post('/api/v1/deployment-plans/capabilities/reevaluate', '重算部署计划能力匹配', ['DeploymentPlans'], (request) => this.reevaluateCapabilities(request));
  }

  private async list(request: HttpRequest) {
    const items = await this.service.list({ tenantId: request.context.tenantId });
    const filtered = await this.authorizedItems(this.subjectFromRequest(request), 'deployment_plan', items);
    return { items: filtered, page: 1, pageSize: 200, total: filtered.length };
  }

  private async listByApplicationAsset(request: HttpRequest) {
    const rawApplicationAssetId = request.query.applicationAssetId;
    const applicationAssetId = Array.isArray(rawApplicationAssetId) ? rawApplicationAssetId[0] : rawApplicationAssetId;
    if (!applicationAssetId || applicationAssetId.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'applicationAssetId 不能为空');
    }
    const items = await this.service.listByApplicationAsset({
      tenantId: request.context.tenantId,
      applicationAssetId: applicationAssetId.trim(),
    });
    const filtered = await this.authorizedItems(this.subjectFromRequest(request), 'deployment_plan', items);
    return { items: filtered, page: 1, pageSize: filtered.length, total: filtered.length };
  }

  private async listInputSnapshots(request: HttpRequest) {
    const rawPlanId = request.query.planId;
    const planId = Array.isArray(rawPlanId) ? rawPlanId[0] : rawPlanId;
    if (!planId) throw new AppError('VALIDATION_FAILED', 'planId 不能为空');
    await this.assertPlanAction(request, ['application.deployment.read', 'deployment.plan.read'], planId);
    const items = await this.service.listInputSnapshots(planId, request.context.tenantId);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    return { id: this.actorId(request), type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private async authorizedItems<T extends object>(subject: SecuritySubject, objectType: string, items: T[]): Promise<T[]> {
    if (!this.security) return items;
    return applyAuthorizationFilter(items, {
      page: 1,
      pageSize: Math.max(items.length, 1),
      filter: {},
      authorization: await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, 'read'),
    });
  }

  private async create(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      certificateVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      selectionMode: { type: 'string' },
      targets: { type: 'array', required: true },
      idempotencyKey: { type: 'string' },
      planType: { type: 'string' },
      policy: { type: 'object' },
    });
    const actorId = this.actorId(request);
    const applicationAssetId = Array.isArray(body.targets)
      ? body.targets.find((target) => target && typeof target === 'object' && !Array.isArray(target) && typeof (target as Record<string, unknown>).applicationAssetId === 'string') as Record<string, unknown> | undefined
      : undefined;
    if (applicationAssetId?.applicationAssetId) {
      await this.assertPlanAction(request, 'application.update', String(applicationAssetId.applicationAssetId), ['service_asset', 'application_asset']);
    } else {
      await this.assertPlanAction(request, 'deployment.plan.create');
    }
    return {
      statusCode: 201,
      body: this.service.create({
        name: String(body.name),
        certificateVersionId: body.certificateVersionId === undefined ? undefined : String(body.certificateVersionId),
        certificateFormatId: body.certificateFormatId === undefined ? undefined : String(body.certificateFormatId),
        selectionMode: body.selectionMode === undefined ? undefined : body.selectionMode as DeploymentPlanSelectionMode,
        targets: this.parseTargets(body.targets),
        idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
        planType: body.planType === undefined ? undefined : body.planType as 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY',
        policy: this.parsePolicy(body.policy),
        actorId,
        tenantId: request.context.tenantId,
      }, this.securityContext(request)),
    };
  }

  private async createFromApplicationAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      applicationAssetId: { type: 'string' },
      applicationId: { type: 'string' },
      targetCertificateVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      selectionMode: { type: 'string' },
      reuseDraft: { type: 'boolean' },
      idempotencyKey: { type: 'string' },
      planType: { type: 'string' },
      policy: { type: 'object' },
    });
    const applicationAssetId = body.applicationAssetId ?? body.applicationId;
    if (typeof applicationAssetId !== 'string' || applicationAssetId.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'applicationId 不能为空', { field: 'applicationId' });
    }
    await this.assertPlanAction(request, 'application.update', String(applicationAssetId), ['service_asset', 'application_asset']);
    const actorId = this.actorId(request);
    return {
      statusCode: 201,
      body: this.service.createFromApplicationAsset({
        applicationAssetId: String(applicationAssetId),
        targetCertificateVersionId: body.targetCertificateVersionId === undefined ? undefined : String(body.targetCertificateVersionId),
        certificateFormatId: body.certificateFormatId === undefined ? undefined : String(body.certificateFormatId),
        selectionMode: body.selectionMode === undefined ? undefined : body.selectionMode as DeploymentPlanSelectionMode,
        reuseDraft: body.reuseDraft === undefined ? undefined : Boolean(body.reuseDraft),
        idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
        planType: body.planType === undefined ? undefined : body.planType as 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY',
        policy: this.parsePolicy(body.policy),
        actorId,
        tenantId: request.context.tenantId,
      }, this.securityContext(request)),
    };
  }

  private async updateFromApplicationAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      applicationAssetId: { type: 'string', required: true },
      targetCertificateVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      selectionMode: { type: 'string' },
      idempotencyKey: { type: 'string' },
      planType: { type: 'string' },
      policy: { type: 'object' },
    });
    await this.assertPlanAction(request, 'deployment.plan.update', String(body.planId));
    const actorId = this.actorId(request);
    return this.service.updateDraftFromApplicationAsset({
      planId: String(body.planId),
      applicationAssetId: String(body.applicationAssetId),
      targetCertificateVersionId: body.targetCertificateVersionId === undefined ? undefined : String(body.targetCertificateVersionId),
      certificateFormatId: body.certificateFormatId === undefined ? undefined : String(body.certificateFormatId),
      selectionMode: body.selectionMode === undefined ? undefined : body.selectionMode as DeploymentPlanSelectionMode,
      idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
      planType: body.planType === undefined ? undefined : body.planType as 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY',
      policy: this.parsePolicy(body.policy),
      actorId,
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async submit(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      approvalId: { type: 'string' },
    });
    await this.assertPlanAction(request, ['application.deployment.submit', 'deployment.plan.submit'], String(body.planId));
    return this.service.submit({
      planId: String(body.planId),
      approvalId: body.approvalId === undefined ? undefined : String(body.approvalId),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async execute(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      idempotencyKey: { type: 'string' },
      approvalId: { type: 'string' },
    });
    await this.assertPlanAction(request, ['application.deployment.execute', 'deployment.plan.execute'], String(body.planId));
    return this.service.execute({
      planId: String(body.planId),
      idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
      approvalId: body.approvalId === undefined ? undefined : String(body.approvalId),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async dryRun(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      idempotencyKey: { type: 'string' },
    });
    await this.assertPlanAction(request, ['application.deployment.execute', 'deployment.plan.execute'], String(body.planId));
    return this.service.dryRun({
      planId: String(body.planId),
      // 同步预检没有任何可重放写入；保留传入字段只为兼容旧客户端。
      idempotencyKey: body.idempotencyKey === undefined ? undefined : String(body.idempotencyKey),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async cancel(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      reason: { type: 'string' },
    });
    await this.assertPlanAction(request, ['application.deployment.rollback', 'deployment.plan.rollback', 'deployment.plan.cancel'], String(body.planId));
    return this.service.cancel({
      planId: String(body.planId),
      reason: body.reason === undefined ? undefined : String(body.reason),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async deleteDraft(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      reason: { type: 'string' },
    });
    await this.assertPlanAction(request, ['application.deployment.update', 'deployment.plan.update', 'deployment.plan.delete'], String(body.planId));
    return this.service.deleteDraft({
      planId: String(body.planId),
      reason: body.reason === undefined ? undefined : String(body.reason),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async reevaluateCapabilities(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      targetResults: { type: 'array', required: true },
    });
    if (!Array.isArray(body.targetResults)) throw new AppError('VALIDATION_FAILED', 'targetResults 必须是数组');
    await this.assertPlanAction(request, ['application.deployment.update', 'deployment.plan.update'], String(body.planId));
    return this.service.reevaluateCapabilities({
      planId: String(body.planId),
      targetResults: body.targetResults.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError('VALIDATION_FAILED', 'targetResult 必须是对象', { index });
        const row = item as Record<string, unknown>;
        if (typeof row.targetId !== 'string' || !row.targetId) throw new AppError('VALIDATION_FAILED', 'targetResult.targetId 必填', { index });
        if (!row.matchResult || typeof row.matchResult !== 'object' || Array.isArray(row.matchResult)) throw new AppError('VALIDATION_FAILED', 'targetResult.matchResult 必须是对象', { index });
        return { targetId: row.targetId, matchResult: row.matchResult as Record<string, unknown> };
      }),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private parseTargets(value: unknown): Array<{
    certificateBindingId?: string;
    applicationAssetId?: string;
    serviceAssetId?: string;
    managedTargetId?: string;
    siteAssetId?: string;
    domain?: string;
    executionTargetId?: string;
    executorType?: ExecutionTargetKind;
    requiredCapabilities?: string[];
    matchResult?: Record<string, unknown>;
    gatewayRoute?: DeploymentGatewayRouteDto;
    gatewayId?: string;
    zoneId?: string;
    adapter?: string;
    protocols?: string[];
    action?: string;
    destructive?: boolean;
    delegatedTargetId?: string;
  }> {
    if (!Array.isArray(value)) throw new AppError('VALIDATION_FAILED', 'targets 必须是数组');
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('VALIDATION_FAILED', 'target 必须是对象', { index });
      const target = raw as Record<string, unknown>;
      const parsed = {
        certificateBindingId: typeof target.certificateBindingId === 'string' ? target.certificateBindingId : undefined,
        applicationAssetId: typeof target.applicationAssetId === 'string' ? target.applicationAssetId : undefined,
        serviceAssetId: typeof target.serviceAssetId === 'string' ? target.serviceAssetId : undefined,
        managedTargetId: typeof target.managedTargetId === 'string' ? target.managedTargetId : undefined,
        siteAssetId: typeof target.siteAssetId === 'string' ? target.siteAssetId : undefined,
        domain: typeof target.domain === 'string' ? target.domain : undefined,
        executionTargetId: typeof target.executionTargetId === 'string' ? target.executionTargetId : undefined,
        executorType: parseExecutorType(target.executorType, `targets[${index}].executorType`),
        requiredCapabilities: Array.isArray(target.requiredCapabilities) ? target.requiredCapabilities.map(String) : undefined,
        matchResult: target.matchResult && typeof target.matchResult === 'object' && !Array.isArray(target.matchResult)
          ? target.matchResult as Record<string, unknown>
          : undefined,
        gatewayRoute: target.gatewayRoute && typeof target.gatewayRoute === 'object' && !Array.isArray(target.gatewayRoute)
          ? this.parseGatewayRoute(target.gatewayRoute as Record<string, unknown>)
          : undefined,
        gatewayId: typeof target.gatewayId === 'string' ? target.gatewayId : undefined,
        zoneId: typeof target.zoneId === 'string' ? target.zoneId : undefined,
        adapter: parseGatewayChannel(target.adapter, `targets[${index}].adapter`),
        protocols: Array.isArray(target.protocols)
          ? target.protocols.map((protocol, protocolIndex) => parseGatewayChannel(protocol, `targets[${index}].protocols[${protocolIndex}]`))
            .filter((protocol): protocol is GatewayAdapterType => protocol !== undefined)
          : undefined,
        action: typeof target.action === 'string' ? target.action : undefined,
        destructive: typeof target.destructive === 'boolean' ? target.destructive : undefined,
        delegatedTargetId: typeof target.delegatedTargetId === 'string' ? target.delegatedTargetId : undefined,
      };
      rejectFallbackSuggestions(target.fallbackSuggestions, `targets[${index}].fallbackSuggestions`);
      if (!parsed.certificateBindingId && !parsed.managedTargetId && !parsed.siteAssetId) {
        throw new AppError('VALIDATION_FAILED', '部署目标必须提供 certificateBindingId、managedTargetId 或 siteAssetId 之一', { index });
      }
      return parsed;
    });
  }

  private parseGatewayRoute(route: Record<string, unknown>): DeploymentGatewayRouteDto {
    const parsed = {
      gatewayId: typeof route.gatewayId === 'string' ? route.gatewayId : undefined,
      agentId: typeof route.agentId === 'string' ? route.agentId : undefined,
      zoneId: typeof route.zoneId === 'string' ? route.zoneId : undefined,
      adapter: parseGatewayChannel(route.adapter, 'gatewayRoute.adapter'),
      delegatedTargetId: typeof route.delegatedTargetId === 'string' ? route.delegatedTargetId : undefined,
      mockSafeLocalRuntime: typeof route.mockSafeLocalRuntime === 'boolean' ? route.mockSafeLocalRuntime : undefined,
    };
    rejectFallbackSuggestions(route.fallbackSuggestions, 'gatewayRoute.fallbackSuggestions');
    return parsed;
  }

  private parsePolicy(value: unknown): DeploymentPlanPolicyDto | undefined {
    if (value === undefined) return undefined;
    const policy = value as Record<string, unknown>;
    return {
      approvalRequired: typeof policy.approvalRequired === 'boolean' ? policy.approvalRequired : undefined,
      riskLevel: typeof policy.riskLevel === 'string' ? policy.riskLevel as RiskLevel : undefined,
      failurePolicy: typeof policy.failurePolicy === 'string' ? policy.failurePolicy as DeploymentPlanPolicyDto['failurePolicy'] : undefined,
      batchSize: typeof policy.batchSize === 'number' ? policy.batchSize : undefined,
    };
  }

  private idempotencyKey(request: HttpRequest, bodyValue?: unknown): string {
    const headerValue = this.readHeader(request, 'x-idempotency-key');
    const value = headerValue ?? (bodyValue === undefined ? undefined : String(bodyValue));
    if (!value) throw new AppError('VALIDATION_FAILED', '缺少幂等键，请提供 X-Idempotency-Key', { field: 'idempotencyKey' });
    return value;
  }

  private readHeader(request: HttpRequest, key: string): string | undefined {
    const value = request.headers[key] ?? request.headers[key.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private actorId(request: HttpRequest): string {
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return request.context.actorId;
  }

  /**
   * 业务授权和历史技术授权共用同一个入口：业务授权按注册表解析动作，
   * 历史对象授权仍可放行；任一旧技术显式 deny 必须先于 allow 生效。
   */
  private async assertPlanAction(
    request: HttpRequest,
    actions: string | readonly string[],
    resourceId?: string,
    resourceTypes: string | readonly string[] = 'deployment_plan',
  ): Promise<void> {
    if (!this.security) return;
    const subject = this.subjectFromRequest(request);
    const actionCandidates = typeof actions === 'string' ? [actions] : [...actions];
    const typeCandidates = typeof resourceTypes === 'string' ? [resourceTypes] : [...resourceTypes];
    const context = this.securityContext(request);
    const accessLevel = planActionAccessLevel(actionCandidates);

    for (const resourceType of typeCandidates) {
      const objectDecision = await this.security.objectPermissions.can(subject, accessLevel, {
        objectType: resourceType,
        objectId: resourceId,
        tenantId: request.context.tenantId,
      }, context);
      if (objectDecision.reason === 'explicit deny') {
        throw securityErrors.permissionDenied({ action: actionCandidates, objectType: resourceType, objectId: resourceId, reason: 'legacy technical deny' });
      }

      for (const action of actionCandidates) {
        const rbacDecision = await this.security.rbac.can(subject, action, {
          type: resourceType,
          id: resourceId,
          scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope },
        }, context);
        if (rbacDecision.reason === 'explicit deny') {
          throw securityErrors.permissionDenied({ action, resourceType, resourceId, reason: 'explicit deny' });
        }
        if (rbacDecision.allowed || objectDecision.allowed) return;
      }
    }

    throw securityErrors.permissionDenied({ action: actionCandidates, resourceTypes: typeCandidates, resourceId, reason: 'no business or legacy grant' });
  }

  private securityContext(request: HttpRequest) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor: { id: this.actorId(request), type: 'user' as const, scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } },
    };
  }
}

function planActionAccessLevel(actions: readonly string[]): 'read' | 'edit' | 'control' {
  if (actions.every((action) => action.endsWith('.read'))) return 'read';
  if (actions.some((action) => /(execute|submit|rollback|cancel|delete)$/.test(action))) return 'control';
  return 'edit';
}

function parseExecutorType(value: unknown, field: string): ExecutionTargetKind | undefined {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toUpperCase();
  if (!ExecutionTargetKinds.includes(normalized as ExecutionTargetKind)) {
    throw new AppError('VALIDATION_FAILED', `部署目标执行类型不受支持：${String(value)}`, { field, value, allowed: ExecutionTargetKinds });
  }
  return normalized as ExecutionTargetKind;
}

function parseGatewayChannel(value: unknown, field: string): GatewayAdapterType | undefined {
  if (value === undefined) return undefined;
  return assertGatewayRouteChannel(value, field);
}

function rejectFallbackSuggestions(value: unknown, field: string): void {
  if (value === undefined) return;
  throw new AppError('VALIDATION_FAILED', '部署计划不接受 fallbackSuggestions 字段', { field, value });
}

export function getDeploymentPlanRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/deployment-plans', operationId: 'listDeploymentPlans', summary: '查询部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'GET', path: '/api/v1/deployment-plans/by-application-asset', operationId: 'listDeploymentPlansByApplicationAsset', summary: '按应用资产查询部署记录', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'GET', path: '/api/v1/deployment-plans/input-snapshots', operationId: 'listDeploymentInputSnapshots', summary: '查询部署输入快照', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans', operationId: 'createDeploymentPlan', summary: '创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/from-application-asset', operationId: 'createDeploymentPlanFromApplicationAsset', summary: '按应用资产创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/from-application', operationId: 'createDeploymentPlanFromApplication', summary: '按 Application 创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/update-from-application-asset', operationId: 'updateDeploymentPlanFromApplicationAsset', summary: '编辑应用资产部署计划草稿', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/submit', operationId: 'submitDeploymentPlan', summary: '提交部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/dry-run', operationId: 'dryRunDeploymentPlan', summary: 'Dry-run 部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/execute', operationId: 'executeDeploymentPlan', summary: '执行部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/cancel', operationId: 'cancelDeploymentPlan', summary: '取消部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/delete', operationId: 'deleteDraftDeploymentPlan', summary: '删除部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/capabilities/reevaluate', operationId: 'reevaluateDeploymentPlanCapabilities', summary: '重算部署计划能力匹配', tags: ['DeploymentPlans'], responseSchema: schema },
  ];
}
