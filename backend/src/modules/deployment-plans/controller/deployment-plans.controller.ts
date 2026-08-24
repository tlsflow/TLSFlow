import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { applyAuthorizationFilter } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel, SecuritySubject } from '../../../shared/security-types.js';
import type { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { FallbackSuggestion } from '../../gateway-agents/gateway-agent.types.js';
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

  register(router: Router): void {
    router.get('/api/v1/deployment-plans', '查询部署计划', ['DeploymentPlans'], (request) => this.list(request));
    router.post('/api/v1/deployment-plans', '创建部署计划', ['DeploymentPlans'], (request) => this.create(request));
    router.post('/api/v1/deployment-plans/from-application-asset', '按应用资产创建部署计划', ['DeploymentPlans'], (request) => this.createFromApplicationAsset(request));
    router.post('/api/v1/deployment-plans/update-from-application-asset', '编辑应用资产部署计划草稿', ['DeploymentPlans'], (request) => this.updateFromApplicationAsset(request));
    router.post('/api/v1/deployment-plans/submit', '提交部署计划', ['DeploymentPlans'], (request) => this.submit(request));
    router.post('/api/v1/deployment-plans/dry-run', 'Dry-run 部署计划', ['DeploymentPlans'], (request) => this.dryRun(request));
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

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    return { id: this.actorId(request), type: 'user', scope: { tenantId: request.context.tenantId } };
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

  private create(request: HttpRequest) {
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

  private createFromApplicationAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      applicationAssetId: { type: 'string', required: true },
      targetCertificateVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      selectionMode: { type: 'string' },
      idempotencyKey: { type: 'string' },
      planType: { type: 'string' },
      policy: { type: 'object' },
    });
    const actorId = this.actorId(request);
    return {
      statusCode: 201,
      body: this.service.createFromApplicationAsset({
        applicationAssetId: String(body.applicationAssetId),
        targetCertificateVersionId: body.targetCertificateVersionId === undefined ? undefined : String(body.targetCertificateVersionId),
        certificateFormatId: body.certificateFormatId === undefined ? undefined : String(body.certificateFormatId),
        selectionMode: body.selectionMode === undefined ? undefined : body.selectionMode as DeploymentPlanSelectionMode,
        idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
        planType: body.planType === undefined ? undefined : body.planType as 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY',
        policy: this.parsePolicy(body.policy),
        actorId,
        tenantId: request.context.tenantId,
      }, this.securityContext(request)),
    };
  }

  private updateFromApplicationAsset(request: HttpRequest) {
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

  private submit(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      approvalId: { type: 'string' },
    });
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
    return this.service.dryRun({
      planId: String(body.planId),
      idempotencyKey: this.idempotencyKey(request, body.idempotencyKey),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private cancel(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      reason: { type: 'string' },
    });
    return this.service.cancel({
      planId: String(body.planId),
      reason: body.reason === undefined ? undefined : String(body.reason),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private deleteDraft(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      reason: { type: 'string' },
    });
    return this.service.deleteDraft({
      planId: String(body.planId),
      reason: body.reason === undefined ? undefined : String(body.reason),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private reevaluateCapabilities(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      targetResults: { type: 'array', required: true },
    });
    if (!Array.isArray(body.targetResults)) throw new AppError('VALIDATION_FAILED', 'targetResults 必须是数组');
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
    fallbackSuggestions?: FallbackSuggestion[];
  }> {
    if (!Array.isArray(value)) throw new AppError('VALIDATION_FAILED', 'targets 必须是数组');
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('VALIDATION_FAILED', 'target 必须是对象', { index });
      const target = raw as Record<string, unknown>;
      const parsed = {
        certificateBindingId: typeof target.certificateBindingId === 'string' ? target.certificateBindingId : undefined,
        managedTargetId: typeof target.managedTargetId === 'string' ? target.managedTargetId : undefined,
        siteAssetId: typeof target.siteAssetId === 'string' ? target.siteAssetId : undefined,
        domain: typeof target.domain === 'string' ? target.domain : undefined,
        executionTargetId: typeof target.executionTargetId === 'string' ? target.executionTargetId : undefined,
        executorType: typeof target.executorType === 'string' ? target.executorType as ExecutionTargetKind : undefined,
        requiredCapabilities: Array.isArray(target.requiredCapabilities) ? target.requiredCapabilities.map(String) : undefined,
        matchResult: target.matchResult && typeof target.matchResult === 'object' && !Array.isArray(target.matchResult)
          ? target.matchResult as Record<string, unknown>
          : undefined,
        gatewayRoute: target.gatewayRoute && typeof target.gatewayRoute === 'object' && !Array.isArray(target.gatewayRoute)
          ? this.parseGatewayRoute(target.gatewayRoute as Record<string, unknown>)
          : undefined,
        gatewayId: typeof target.gatewayId === 'string' ? target.gatewayId : undefined,
        zoneId: typeof target.zoneId === 'string' ? target.zoneId : undefined,
        adapter: typeof target.adapter === 'string' ? target.adapter : undefined,
        protocols: Array.isArray(target.protocols) ? target.protocols.map(String) : undefined,
        action: typeof target.action === 'string' ? target.action : undefined,
        destructive: typeof target.destructive === 'boolean' ? target.destructive : undefined,
        delegatedTargetId: typeof target.delegatedTargetId === 'string' ? target.delegatedTargetId : undefined,
        fallbackSuggestions: parseFallbackSuggestions(target.fallbackSuggestions),
      };
      if (!parsed.certificateBindingId && !parsed.managedTargetId && !parsed.siteAssetId) {
        throw new AppError('VALIDATION_FAILED', '部署目标必须提供 certificateBindingId、managedTargetId 或 siteAssetId 之一', { index });
      }
      return parsed;
    });
  }

  private parseGatewayRoute(route: Record<string, unknown>): DeploymentGatewayRouteDto {
    return {
      gatewayId: typeof route.gatewayId === 'string' ? route.gatewayId : undefined,
      agentId: typeof route.agentId === 'string' ? route.agentId : undefined,
      gatewayAgentId: typeof route.gatewayAgentId === 'string' ? route.gatewayAgentId : undefined,
      zoneId: typeof route.zoneId === 'string' ? route.zoneId : undefined,
      adapter: typeof route.adapter === 'string' ? route.adapter : undefined,
      delegatedTargetId: typeof route.delegatedTargetId === 'string' ? route.delegatedTargetId : undefined,
      fallbackSuggestions: parseFallbackSuggestions(route.fallbackSuggestions),
      mockSafeLocalRuntime: typeof route.mockSafeLocalRuntime === 'boolean' ? route.mockSafeLocalRuntime : undefined,
    };
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

  private securityContext(request: HttpRequest) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor: { id: this.actorId(request), type: 'user' as const, scope: { tenantId: request.context.tenantId } },
    };
  }
}

function parseFallbackSuggestions(value: unknown): FallbackSuggestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<FallbackSuggestion>(['gateway_required', 'script_package', 'manual']);
  return value.map(String).filter((item): item is FallbackSuggestion => allowed.has(item as FallbackSuggestion));
}

export function getDeploymentPlanRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/deployment-plans', operationId: 'listDeploymentPlans', summary: '查询部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans', operationId: 'createDeploymentPlan', summary: '创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/from-application-asset', operationId: 'createDeploymentPlanFromApplicationAsset', summary: '按应用资产创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/update-from-application-asset', operationId: 'updateDeploymentPlanFromApplicationAsset', summary: '编辑应用资产部署计划草稿', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/submit', operationId: 'submitDeploymentPlan', summary: '提交部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/dry-run', operationId: 'dryRunDeploymentPlan', summary: 'Dry-run 部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/execute', operationId: 'executeDeploymentPlan', summary: '执行部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/cancel', operationId: 'cancelDeploymentPlan', summary: '取消部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/delete', operationId: 'deleteDraftDeploymentPlan', summary: '删除部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/capabilities/reevaluate', operationId: 'reevaluateDeploymentPlanCapabilities', summary: '重算部署计划能力匹配', tags: ['DeploymentPlans'], responseSchema: schema },
  ];
}
