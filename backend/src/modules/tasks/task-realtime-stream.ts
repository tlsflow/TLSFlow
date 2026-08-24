import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';
import { AppError } from '../../common/errors/app-error.js';
import type { SecuritySubject, TenantScope } from '../../shared/security-types.js';
import type { SecurityServices } from '../security/security.controller.js';
import type { TasksApplicationService } from './task.application-service.js';
import { isPendingApprovalTask, type TaskRun } from './task.types.js';
import { WebSocketServer, type WebSocket } from 'ws';

const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING']);

export interface TaskRealtimeMessageSnapshot {
  type: 'snapshot';
  activeTasks: TaskRun[];
  recentTasks: TaskRun[];
  emittedAt: string;
}

export interface TaskRealtimeMessageTaskChanged {
  type: 'task.changed';
  task: TaskRun;
  emittedAt: string;
}

export type TaskRealtimeMessage = TaskRealtimeMessageSnapshot | TaskRealtimeMessageTaskChanged;

export interface TaskRealtimePublisher {
  publishTask(task: TaskRun): void;
}

interface TaskRealtimeClient {
  tenantId: string;
  actorId: string;
  tenantScope?: TenantScope;
  canReadAll: boolean;
  canDecideApprovals: boolean;
}

type TaskRealtimeListener = (message: TaskRealtimeMessageTaskChanged) => void;

/**
 * 中文说明：统一任务的变更先进入内存事件流，再由 WebSocket 广播给前端，
 * 这样任务列表只会在真实变更发生时刷新。
 */
export class TaskRealtimeStreamService implements TaskRealtimePublisher {
  private readonly listeners = new Set<TaskRealtimeListener>();

  publishTask(task: TaskRun): void {
    const message: TaskRealtimeMessageTaskChanged = {
      type: 'task.changed',
      task,
      emittedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(message);
  }

  subscribe(listener: TaskRealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class TaskRealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly stream: TaskRealtimeStreamService,
    private readonly tasks: Pick<TasksApplicationService, 'listActiveExecutionTasks' | 'listRecentTaskRuns'>,
    private readonly security: SecurityServices,
  ) {
    this.wss.on('connection', (socket: WebSocket, _request: IncomingMessage, client: TaskRealtimeClient) => {
      void this.handleConnection(socket, client as TaskRealtimeClient);
    });
  }

  async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/v1/tasks/stream') return false;
    // 中文说明：客户端刷新或关闭页面时可能在鉴权完成前断开，必须消费 Socket 错误，避免进程崩溃。
    socket.on('error', () => undefined);
    try {
      const client = await this.authorize(request, url);
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request, client);
      });
      return true;
    } catch (error) {
      if (socket.destroyed) return true;
      const appError = error instanceof AppError
        ? error
        : new AppError('SYSTEM_INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
      const statusCode = httpStatus(appError.errorCode);
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\n`
        + 'Content-Type: application/json; charset=utf-8\r\n'
        + 'Connection: close\r\n\r\n'
        + JSON.stringify({
          errorCode: appError.errorCode,
          message: appError.message,
          requestId: headerValue(request.headers, 'x-request-id') ?? `req_ws_${Date.now()}`,
          timestamp: new Date().toISOString(),
        }),
      );
      socket.end();
      return true;
    }
  }

  private async handleConnection(socket: WebSocket, client: TaskRealtimeClient): Promise<void> {
    let closed = false;
    const send = (message: TaskRealtimeMessage) => {
      if (closed || socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(message));
    };
    const unsubscribe = this.stream.subscribe((message) => {
      if (!isTaskVisibleToClient(message.task, client)) return;
      send(message);
    });
    const heartbeat = setInterval(() => {
      if (!closed && socket.readyState === socket.OPEN) socket.ping();
    }, 15_000);
    socket.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    socket.on('error', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });

    const activeTasks = await this.tasks.listActiveExecutionTasks(
      client.tenantId,
      client.canReadAll ? undefined : client.actorId,
      client.canDecideApprovals,
    );
    const recentTasks = await this.tasks.listRecentTaskRuns(client.tenantId, client.canReadAll ? undefined : client.actorId);
    send({
      type: 'snapshot',
      activeTasks,
      recentTasks: recentTasks.filter((task) => isTaskVisibleToClient(task, client)),
      emittedAt: new Date().toISOString(),
    });
  }

  private async authorize(request: IncomingMessage, url: URL): Promise<TaskRealtimeClient> {
    const tenantId = readTenantId(url);
    const identity = await this.security.auth.parseRequestIdentity(
      headerValue(request.headers, 'authorization'),
      headerValue(request.headers, 'cookie'),
    );
    if (!identity?.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少登录上下文');
    const scopeTenantId = tenantId ?? identity.tenantId;
    if (!scopeTenantId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少租户上下文');
    const subject = await this.subjectFor(identity.actorId, scopeTenantId, identity.tenantScope);
    await this.security.rbac.assertCan(subject, 'task.read', {
      type: 'task',
      scope: { tenantId: scopeTenantId, tenantScope: identity.tenantScope },
    }, {
      actor: subject,
      requestId: headerValue(request.headers, 'x-request-id'),
      sourceIp: request.socket.remoteAddress,
    });
    const permissions = await this.security.rbac.permissionsForSubject(subject);
    return {
      tenantId: scopeTenantId,
      actorId: identity.actorId,
      tenantScope: identity.tenantScope,
      canReadAll: permissions.some((permission) => matchesPermission(permission, 'task.read.all')),
      canDecideApprovals: permissions.some((permission) => matchesPermission(permission, 'approval.decide')),
    };
  }

  private async subjectFor(actorId: string, tenantId: string, tenantScope?: TenantScope): Promise<SecuritySubject> {
    const user = await this.security.rbac.getUser(actorId);
    return {
      id: actorId,
      type: 'user',
      roleIds: user ? (await this.security.rbac.rolesForUser(user.id)).map((role) => role.id) : undefined,
      scope: { tenantId, tenantScope },
    };
  }
}

function readTenantId(url: URL): string | undefined {
  const value = url.searchParams.get('tenantId');
  return value?.trim() || undefined;
}

function isTaskVisibleToClient(task: TaskRun, client: TaskRealtimeClient): boolean {
  if (task.tenantId !== client.tenantId) return false;
  if (client.canReadAll) return true;
  return (Boolean(task.requestedBy) && task.requestedBy === client.actorId)
    || (client.canDecideApprovals && isPendingApprovalTask(task));
}

function matchesPermission(candidate: string, required: string): boolean {
  return candidate === '*'
    || candidate === required
    || (candidate.endsWith('.*') && required.startsWith(candidate.slice(0, -1)));
}

function headerValue(headers: IncomingMessage['headers'], key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function httpStatus(errorCode: string): number {
  if (errorCode === 'AUTH_UNAUTHENTICATED') return 401;
  if (errorCode === 'AUTH_FORBIDDEN') return 403;
  return 500;
}

function statusText(statusCode: number): string {
  if (statusCode === 401) return 'Unauthorized';
  if (statusCode === 403) return 'Forbidden';
  return 'Internal Server Error';
}

export function isActiveExecutionTask(task: TaskRun): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}
