import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { ExecutionsApplicationService } from '../application/executions.application-service.js';

export class ExecutionsController {
  constructor(private readonly service: ExecutionsApplicationService) {}

  register(router: Router): void {
    router.get('/api/v1/execution-runs', '查询执行运行', ['Executions'], (request) => this.listRuns(request));
    router.get('/api/v1/execution-steps', '查询执行步骤', ['Executions'], (request) => this.listSteps(request));
    router.post('/api/v1/execution-runs/retry', '重试执行运行', ['Executions'], (request) => this.retry(request));
    router.post('/api/v1/execution-runs/rollback', '回滚执行运行', ['Executions'], (request) => this.rollback(request));
  }

  private async listRuns(request: HttpRequest) {
    const deploymentPlanId = this.readOptionalQueryString(request, 'deploymentPlanId');
    const items = await this.service.listRuns({ tenantId: request.context.tenantId, deploymentPlanId });
    return { items, page: 1, pageSize: 200, total: items.length };
  }

  private async listSteps(request: HttpRequest) {
    const executionRunId = this.readOptionalQueryString(request, 'executionRunId');
    const items = await this.service.listSteps({ tenantId: request.context.tenantId, executionRunId });
    return { items, page: 1, pageSize: 200, total: items.length };
  }

  private retry(request: HttpRequest) {
    const body = validateObject(request.body, {
      runId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
    });
    return this.service.retry({
      runId: String(body.runId),
      idempotencyKey: String(body.idempotencyKey),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
  }

  private rollback(request: HttpRequest) {
    const body = validateObject(request.body, {
      runId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
      approvalId: { type: 'string' },
    });
    return this.service.rollback({
      runId: String(body.runId),
      idempotencyKey: String(body.idempotencyKey),
      approvalId: body.approvalId === undefined ? undefined : String(body.approvalId),
      actorId: this.actorId(request),
      tenantId: request.context.tenantId,
    }, this.securityContext(request));
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

  private readOptionalQueryString(request: HttpRequest, key: string): string | undefined {
    const value = request.query[key];
    return Array.isArray(value) ? value[0] : value;
  }
}

export function getExecutionRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/execution-runs', operationId: 'listExecutionRuns', summary: '查询执行运行', tags: ['Executions'], responseSchema: schema },
    { method: 'GET', path: '/api/v1/execution-steps', operationId: 'listExecutionSteps', summary: '查询执行步骤', tags: ['Executions'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/execution-runs/retry', operationId: 'retryExecutionRun', summary: '重试执行运行', tags: ['Executions'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/execution-runs/rollback', operationId: 'rollbackExecutionRun', summary: '回滚执行运行', tags: ['Executions'], responseSchema: schema },
  ];
}
