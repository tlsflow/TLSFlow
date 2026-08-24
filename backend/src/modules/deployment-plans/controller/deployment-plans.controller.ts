import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel } from '../../../shared/security-types.js';
import type { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import { DeploymentPlansApplicationService, type DeploymentPlansApplicationDependencies } from '../application/deployment-plans.application-service.js';
import type { DeploymentPlanPolicyDto } from '../dto/deployment-plans.dto.js';

export class DeploymentPlansController {
  private readonly service: DeploymentPlansApplicationService;

  constructor(service?: DeploymentPlansApplicationService, dependencies?: DeploymentPlansApplicationDependencies) {
    this.service = dependencies ? new DeploymentPlansApplicationService(dependencies) : (service ?? new DeploymentPlansApplicationService());
  }

  getExecutionsService(): ExecutionsApplicationService {
    return this.service.getExecutionsService();
  }

  register(router: Router): void {
    router.get('/api/v1/deployment-plans', '查询部署计划', ['DeploymentPlans'], (request) => this.list(request));
    router.post('/api/v1/deployment-plans', '创建部署计划', ['DeploymentPlans'], (request) => this.create(request));
    router.post('/api/v1/deployment-plans/submit', '提交部署计划', ['DeploymentPlans'], (request) => this.submit(request));
    router.post('/api/v1/deployment-plans/dry-run', 'Dry-run 部署计划', ['DeploymentPlans'], (request) => this.dryRun(request));
    router.post('/api/v1/deployment-plans/execute', '执行部署计划', ['DeploymentPlans'], (request) => this.execute(request));
    router.post('/api/v1/deployment-plans/cancel', '取消部署计划', ['DeploymentPlans'], (request) => this.cancel(request));
    router.post('/api/v1/deployment-plans/capabilities/reevaluate', '重算部署计划能力匹配', ['DeploymentPlans'], (request) => this.reevaluateCapabilities(request));
  }

  private list(request: HttpRequest) {
    return { items: this.service.list({ tenantId: request.context.tenantId }), page: 1, pageSize: 200, total: this.service.list({ tenantId: request.context.tenantId }).length };
  }

  private create(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      certificateVersionId: { type: 'string', required: true },
      targets: { type: 'array', required: true },
      idempotencyKey: { type: 'string', required: true },
      planType: { type: 'string' },
      policy: { type: 'object' },
    });
    const actorId = this.actorId(request);
    return {
      statusCode: 201,
      body: this.service.create({
        name: String(body.name),
        certificateVersionId: String(body.certificateVersionId),
        targets: this.parseTargets(body.targets),
        idempotencyKey: String(body.idempotencyKey),
        planType: body.planType === undefined ? undefined : body.planType as 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY',
        policy: this.parsePolicy(body.policy),
        actorId,
        tenantId: request.context.tenantId,
      }, this.securityContext(request)),
    };
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
      idempotencyKey: { type: 'string', required: true },
      approvalId: { type: 'string' },
    });
    return this.service.execute({
      planId: String(body.planId),
      idempotencyKey: String(body.idempotencyKey),
      approvalId: body.approvalId === undefined ? undefined : String(body.approvalId),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private async dryRun(request: HttpRequest) {
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
    });
    return this.service.dryRun({
      planId: String(body.planId),
      idempotencyKey: String(body.idempotencyKey),
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
    certificateBindingId: string;
    executionTargetId?: string;
    executorType?: ExecutionTargetKind;
    requiredCapabilities?: string[];
    matchResult?: Record<string, unknown>;
  }> {
    if (!Array.isArray(value)) throw new AppError('VALIDATION_FAILED', 'targets 必须是数组');
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('VALIDATION_FAILED', 'target 必须是对象', { index });
      const target = raw as Record<string, unknown>;
      if (!target.certificateBindingId || typeof target.certificateBindingId !== 'string') {
        throw new AppError('VALIDATION_FAILED', '部署目标必须引用 certificateBindingId', { index });
      }
      return {
        certificateBindingId: target.certificateBindingId,
        executionTargetId: typeof target.executionTargetId === 'string' ? target.executionTargetId : undefined,
        executorType: typeof target.executorType === 'string' ? target.executorType as ExecutionTargetKind : undefined,
        requiredCapabilities: Array.isArray(target.requiredCapabilities) ? target.requiredCapabilities.map(String) : undefined,
        matchResult: target.matchResult && typeof target.matchResult === 'object' && !Array.isArray(target.matchResult)
          ? target.matchResult as Record<string, unknown>
          : undefined,
      };
    });
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

export function getDeploymentPlanRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/deployment-plans', operationId: 'listDeploymentPlans', summary: '查询部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans', operationId: 'createDeploymentPlan', summary: '创建部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/submit', operationId: 'submitDeploymentPlan', summary: '提交部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/dry-run', operationId: 'dryRunDeploymentPlan', summary: 'Dry-run 部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/execute', operationId: 'executeDeploymentPlan', summary: '执行部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/cancel', operationId: 'cancelDeploymentPlan', summary: '取消部署计划', tags: ['DeploymentPlans'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/deployment-plans/capabilities/reevaluate', operationId: 'reevaluateDeploymentPlanCapabilities', summary: '重算部署计划能力匹配', tags: ['DeploymentPlans'], responseSchema: schema },
  ];
}
