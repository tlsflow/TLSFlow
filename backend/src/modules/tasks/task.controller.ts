import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { requireTenantId } from '../../common/http/tenant-context.js';
import type { Router } from '../../common/http/router.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../common/pagination/pagination.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { SecurityServices } from '../security/security.controller.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { TasksApplicationService, type TaskControlPlaneLifecycle } from './task.application-service.js';
import { isPendingApprovalTask, taskCategories, taskStatuses, type TaskCategory, type TaskStatus } from './task.types.js';

const tags = ['Tasks'];

export class TasksController {
  constructor(
    private readonly service: TasksApplicationService,
    private readonly security: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/tasks', '查询任务列表', tags, (request) => this.list(request));
    router.get('/api/v1/tasks/:id', '查询任务详情', tags, (request) => this.detail(request));
    router.post('/api/v1/tasks/:id/cancel', '取消任务', tags, (request) => this.cancel(request));
    router.post('/api/v1/tasks/:id/force-cancel', '强制结束任务', tags, (request) => this.forceCancel(request));
    router.post('/api/v1/tasks/:id/retry', '重试任务', tags, (request) => this.retry(request));
    router.get('/api/v1/monitoring/task-runs/:id/probes', '查询监控任务探测记录', tags, (request) => this.probes(request));
  }

  private async list(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read');
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'startedAt', 'finishedAt', 'status', 'taskType'],
      allowedFilterFields: ['category', 'taskType', 'status', 'resourceType', 'resourceId', 'requestedBy', 'taskId', 'createdFrom', 'createdTo'],
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const category = query.filter.category as TaskCategory | undefined;
    if (category && !taskCategories.includes(category)) throw new AppError('VALIDATION_FAILED', '任务分类无效', { field: 'category' });
    const status = query.filter.status as TaskStatus | undefined;
    if (status && !taskStatuses.includes(status)) throw new AppError('VALIDATION_FAILED', '任务状态无效', { field: 'status' });
    const includeAll = readBoolean(request.query.includeAll);
    const canReadAll = await this.canReadAll(subject);
    const canDecideApprovals = await this.canDecideApprovals(subject);
    const requestedBy = canReadAll ? query.filter.requestedBy : subject.id;
    if (!canReadAll && query.filter.requestedBy && query.filter.requestedBy !== subject.id) {
      await this.assertRead(subject, request, 'task.read.all');
    }
    const page = await this.service.list({
      tenantId: requireTenantId(request),
      category,
      includeAll,
      taskType: query.filter.taskType,
      status,
      resourceType: query.filter.resourceType,
      resourceId: query.filter.resourceId,
      requestedBy,
      includePendingApprovals: !canReadAll && canDecideApprovals,
      taskId: query.filter.taskId,
      keyword: readString(request.query.keyword),
      createdFrom: query.filter.createdFrom,
      createdTo: query.filter.createdTo,
      page: query.page,
      pageSize: query.pageSize,
    });
    return page;
  }

  private async detail(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read');
    const taskId = readPathId(request);
    const detail = await this.service.detail(requireTenantId(request), taskId);
    if (detail.task.requestedBy && detail.task.requestedBy !== subject.id) {
      const canReadApproval = await this.canDecideApprovals(subject) && isPendingApprovalTask(detail.task);
      if (!canReadApproval) await this.assertRead(subject, request, 'task.read.all');
    }
    return detail;
  }

  private async cancel(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read.all');
    const taskId = readPathId(request);
    const body = validateObject(request.body ?? {}, { reason: { type: 'string' } });
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    return this.service.cancel(requireTenantId(request), taskId, subject.id, reason);
  }

  private async retry(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read.all');
    const taskId = readPathId(request);
    return this.service.retry(requireTenantId(request), taskId, subject.id);
  }

  private async forceCancel(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read.all');
    const taskId = readPathId(request);
    const body = validateObject(request.body ?? {}, { reason: { type: 'string' } });
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    return this.service.forceCancel(requireTenantId(request), taskId, subject.id, reason);
  }

  private async probes(request: HttpRequest) {
    const unavailable = this.lifecycleResponse(request);
    if (unavailable) return unavailable;
    const subject = await this.subjectFromRequest(request);
    await this.assertRead(subject, request, 'task.read');
    const taskRunId = readPathId(request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['checkedAt', 'status', 'latencyMs'],
      allowedFilterFields: ['monitorTargetId', 'serviceAssetId', 'status', 'checkedFrom', 'checkedTo'],
      defaultPageSize: 50,
      maxPageSize: 200,
    });
    return this.service.listMonitoringProbes({
      tenantId: requireTenantId(request),
      taskRunId,
      monitorTargetId: query.filter.monitorTargetId,
      serviceAssetId: query.filter.serviceAssetId,
      status: query.filter.status,
      checkedFrom: query.filter.checkedFrom,
      checkedTo: query.filter.checkedTo,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private async subjectFromRequest(request: HttpRequest): Promise<SecuritySubject> {
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    const user = await this.security.rbac.getUser(request.context.actorId);
    return {
      id: request.context.actorId,
      type: 'user',
      roleIds: user ? (await this.security.rbac.rolesForUser(user.id)).map((role) => role.id) : undefined,
      scope: { tenantId: requireTenantId(request), tenantScope: request.context.tenantScope },
    };
  }

  private async assertRead(subject: SecuritySubject, request: HttpRequest, action: string): Promise<void> {
    await this.security.rbac.assertCan(subject, action, {
      type: 'task',
      scope: { tenantId: requireTenantId(request), tenantScope: request.context.tenantScope },
    }, {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor: subject,
    });
  }

  private async canReadAll(subject: SecuritySubject): Promise<boolean> {
    const permissions = await this.security.rbac.permissionsForSubject(subject);
    return permissions.some((permission) => matchesPermission(permission, 'task.read.all'));
  }

  private async canDecideApprovals(subject: SecuritySubject): Promise<boolean> {
    const permissions = await this.security.rbac.permissionsForSubject(subject);
    return permissions.some((permission) => matchesPermission(permission, 'approval.decide'));
  }

  private lifecycleResponse(request: HttpRequest): {
    statusCode: 503;
    body: {
      errorCode: 'TASK_CONTROL_PLANE_NOT_READY';
      message: string;
      details: { status: TaskControlPlaneLifecycle['status']; error?: TaskControlPlaneLifecycle['error'] };
      requestId: string;
    };
  } | undefined {
    const getLifecycle = (this.service as TasksApplicationService & {
      getLifecycle?: () => TaskControlPlaneLifecycle;
    }).getLifecycle;
    if (typeof getLifecycle !== 'function') return undefined;
    const lifecycle = getLifecycle.call(this.service);
    if (lifecycle.status === 'READY') return undefined;
    return {
      statusCode: 503,
      body: {
        errorCode: 'TASK_CONTROL_PLANE_NOT_READY',
        message: lifecycle.status === 'FAILED'
          ? '任务控制面初始化失败'
          : lifecycle.status === 'INITIALIZING'
            ? '任务控制面正在初始化'
            : '任务控制面等待数据库迁移完成',
        details: lifecycle.error
          ? { status: lifecycle.status, error: lifecycle.error }
          : { status: lifecycle.status },
        requestId: request.context.requestId,
      },
    };
  }
}

function readPathId(request: HttpRequest): string {
  const match = request.path.match(/^\/api\/v1\/(?:tasks|monitoring\/task-runs)\/([^/]+)/);
  if (!match?.[1]) throw new AppError('VALIDATION_FAILED', '任务 ID 不能为空', { field: 'taskId' });
  return match[1];
}

function readString(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}

function readBoolean(value: string | string[] | undefined): boolean {
  return ['true', '1', 'yes'].includes((Array.isArray(value) ? value[0] : value)?.toLowerCase() ?? '');
}

function matchesPermission(candidate: string, required: string): boolean {
  return candidate === '*'
    || candidate === required
    || (candidate.endsWith('.*') && required.startsWith(candidate.slice(0, -1)));
}

export function getTaskRouteContracts(): RouteContract[] {
  const response = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/tasks', operationId: 'listTasks', summary: '查询任务列表', tags, responseSchema: response },
    { method: 'GET', path: '/api/v1/tasks/:id', operationId: 'getTaskDetail', summary: '查询任务详情', tags, responseSchema: response },
    { method: 'POST', path: '/api/v1/tasks/:id/cancel', operationId: 'cancelTask', summary: '取消任务', tags, responseSchema: response },
    { method: 'POST', path: '/api/v1/tasks/:id/force-cancel', operationId: 'forceCancelTask', summary: '强制结束任务', tags, responseSchema: response },
    { method: 'POST', path: '/api/v1/tasks/:id/retry', operationId: 'retryTask', summary: '重试任务', tags, responseSchema: response },
    { method: 'GET', path: '/api/v1/monitoring/task-runs/:id/probes', operationId: 'listTaskMonitoringProbes', summary: '查询监控任务探测记录', tags, responseSchema: response },
  ];
}
