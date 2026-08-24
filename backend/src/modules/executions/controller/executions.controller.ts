import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requestSecurityContext,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { ExecutionsApplicationService } from '../application/executions.application-service.js';
import type { ExecutionDetailStreamEvent, ExecutionDetailStreamService } from '../application/execution-detail-stream.service.js';
import type { WorkflowRecoveryLedgerService } from '../application/workflow-recovery-ledger.service.js';

export class ExecutionsController {
  constructor(
    private readonly service: ExecutionsApplicationService,
    private readonly detailStream?: ExecutionDetailStreamService,
    private readonly workflowRecovery?: WorkflowRecoveryLedgerService,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/execution-runs', '查询执行运行', ['Executions'], (request) => this.listRuns(request));
    router.get('/api/v1/execution-steps', '查询执行步骤', ['Executions'], (request) => this.listSteps(request));
    router.get('/api/v1/execution-runs/stream', '实时订阅执行详情', ['Executions'], (request) => this.streamDetail(request));
    router.get('/api/v1/execution-workflow-recovery', '查询工作流恢复账本', ['Executions'], (request) => this.getWorkflowRecovery(request));
    router.post('/api/v1/execution-runs/retry', '重试执行运行', ['Executions'], (request) => this.retry(request));
    router.post('/api/v1/execution-runs/rollback', '回滚执行运行', ['Executions'], (request) => this.rollback(request));
  }

  private async listRuns(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const deploymentPlanId = this.readOptionalQueryString(request, 'deploymentPlanId');
    await assertRouteAction(security, 'execution.run.read', 'execution_run');
    const items = await this.service.listRuns({ tenantId: security.tenantId, deploymentPlanId });
    const authorizedItems = await filterAuthorizedItems(security, items, 'execution_run', 'read');
    return { items: authorizedItems, page: 1, pageSize: 200, total: authorizedItems.length };
  }

  private async listSteps(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const executionRunId = this.readOptionalQueryString(request, 'executionRunId');
    await assertRouteAction(security, 'execution.step.read', 'execution_step');
    if (executionRunId) {
      await assertRouteObjectAccess(security, 'read', { objectType: 'execution_run', objectId: executionRunId, tenantId: security.tenantId });
    }
    const items = await this.service.listSteps({ tenantId: security.tenantId, executionRunId });
    const authorizedItems = await filterAuthorizedItems(security, items, 'execution_step', 'read');
    return { items: authorizedItems, page: 1, pageSize: 200, total: authorizedItems.length };
  }

  private async getWorkflowRecovery(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.recovery.read', 'workflow_recovery');
    if (!this.workflowRecovery) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流恢复账本服务未配置');
    const ledgerId = this.readOptionalQueryString(request, 'ledgerId');
    if (!ledgerId) throw new AppError('VALIDATION_FAILED', '缺少 ledgerId');
    return await this.workflowRecovery.get(security.tenantId, String(ledgerId));
  }

  private async retry(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body, {
      runId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
    });
    const run = await this.service.getRun(String(body.runId), security.tenantId);
    await assertRouteAction(security, 'execution.run.retry', 'execution_run', { resourceId: run.id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'execution_run', objectId: run.id, tenantId: security.tenantId });
    return this.service.retry({
      runId: String(body.runId),
      idempotencyKey: String(body.idempotencyKey),
      actorId: security.subject.id,
      tenantId: security.tenantId,
    }, requestSecurityContext(security));
  }

  private async rollback(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body, {
      runId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
      approvalId: { type: 'string' },
    });
    const run = await this.service.getRun(String(body.runId), security.tenantId);
    await assertRouteAction(security, 'execution.run.rollback', 'execution_run', { resourceId: run.id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'execution_run', objectId: run.id, tenantId: security.tenantId });
    return this.service.rollback({
      runId: String(body.runId),
      idempotencyKey: String(body.idempotencyKey),
      approvalId: body.approvalId === undefined ? undefined : String(body.approvalId),
      actorId: security.subject.id,
      tenantId: security.tenantId,
    }, requestSecurityContext(security));
  }

  private async streamDetail(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const runId = this.readOptionalQueryString(request, 'runId');
    if (!runId) throw new AppError('VALIDATION_FAILED', '缺少 runId');
    await assertRouteAction(security, 'execution.run.read', 'execution_run', { resourceId: runId });
    await assertRouteObjectAccess(security, 'read', { objectType: 'execution_run', objectId: runId, tenantId: security.tenantId });

    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
      stream: async (response: import('node:http').ServerResponse) => {
        let closed = false;
        let snapshotReady = false;
        const bufferedEvents: ExecutionDetailStreamEvent[] = [];
        let unsubscribe: (() => void) | undefined;

        const writeEvent = (event: string, data: unknown) => {
          if (closed || response.writableEnded) return;
          response.write(`event: ${event}\n`);
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe?.();
        };

        const heartbeat = setInterval(() => {
          if (!closed && !response.writableEnded) response.write(`: heartbeat ${Date.now()}\n\n`);
        }, 15_000);

        response.on('close', cleanup);
        response.on('error', cleanup);

        if (this.detailStream) {
          unsubscribe = this.detailStream.subscribe(runId, (event) => {
            if (event.tenantId !== security.tenantId) return;
            if (snapshotReady) {
              writeEvent(event.type, event);
            } else {
              bufferedEvents.push(event);
            }
          });
        }

        const [run, steps] = await Promise.all([
          this.service.getRun(runId, security.tenantId),
          this.service.listSteps({ tenantId: security.tenantId, executionRunId: runId }),
        ]);
        if (closed) return;

        writeEvent('snapshot', {
          run,
          steps,
          emittedAt: new Date().toISOString(),
        });
        snapshotReady = true;
        for (const event of bufferedEvents) writeEvent(event.type, event);

        if (!this.detailStream) {
          response.end();
          cleanup();
        }
      },
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
    { method: 'GET', path: '/api/v1/execution-runs/stream', operationId: 'streamExecutionRunDetail', summary: '实时订阅执行详情', tags: ['Executions'], responseSchema: schema },
    { method: 'GET', path: '/api/v1/execution-workflow-recovery', operationId: 'getExecutionWorkflowRecovery', summary: '查询工作流恢复账本', tags: ['Executions'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/execution-runs/retry', operationId: 'retryExecutionRun', summary: '重试执行运行', tags: ['Executions'], responseSchema: schema },
    { method: 'POST', path: '/api/v1/execution-runs/rollback', operationId: 'rollbackExecutionRun', summary: '回滚执行运行', tags: ['Executions'], responseSchema: schema },
  ];
}
