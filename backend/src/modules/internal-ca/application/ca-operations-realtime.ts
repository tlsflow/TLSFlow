import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { AppError } from '../../../common/errors/app-error.js';
import type { SecuritySubject, TenantScope } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';

export interface CaOperationsChangedInput {
  tenantId: string;
  providerId: string;
  caId: string;
  objectTypes: readonly string[];
}

export interface CaOperationsRealtimeSnapshotMessage {
  type: 'snapshot';
  emittedAt: string;
}

export interface CaOperationsRealtimeChangedMessage {
  type: 'ca.changed';
  caId: string;
  providerId: string;
  objectTypes: readonly string[];
  emittedAt: string;
}

export type CaOperationsRealtimeMessage =
  | CaOperationsRealtimeSnapshotMessage
  | CaOperationsRealtimeChangedMessage;

export interface CaOperationsRealtimePublisher {
  publishChanged(input: CaOperationsChangedInput): void;
}

type CaOperationsRealtimeListener = (input: CaOperationsChangedInput) => void;

interface CaOperationsRealtimeClient {
  tenantId: string;
  actorId: string;
  tenantScope?: TenantScope;
}

/**
 * 中文说明：CA 观测入库后只发布失效通知，客户端通过既有 REST 查询获取完整数据。
 * 当前进程内广播与任务实时流保持一致；多实例部署需要在网关层接入共享消息总线。
 */
export class CaOperationsRealtimeStreamService implements CaOperationsRealtimePublisher {
  private readonly listeners = new Set<CaOperationsRealtimeListener>();

  publishChanged(input: CaOperationsChangedInput): void {
    const normalized: CaOperationsChangedInput = {
      tenantId: input.tenantId,
      providerId: input.providerId,
      caId: input.caId,
      objectTypes: [...new Set(input.objectTypes.filter((value) => value.trim().length > 0))],
    };
    for (const listener of this.listeners) listener(normalized);
  }

  subscribe(listener: CaOperationsRealtimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class CaOperationsRealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly stream: CaOperationsRealtimeStreamService,
    private readonly security: SecurityServices,
  ) {
    this.wss.on('connection', (socket: WebSocket, _request: IncomingMessage, client: CaOperationsRealtimeClient) => {
      this.handleConnection(socket, client);
    });
  }

  async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/v1/ca-operations/stream') return false;
    // 中文说明：浏览器在鉴权完成前断开时也必须消费错误，避免 Node 进程收到未处理 error。
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
          requestId: headerValue(request.headers, 'x-request-id') ?? `req_ca_ws_${Date.now()}`,
          timestamp: new Date().toISOString(),
        }),
      );
      socket.end();
      return true;
    }
  }

  private handleConnection(socket: WebSocket, client: CaOperationsRealtimeClient): void {
    let closed = false;
    const send = (message: CaOperationsRealtimeMessage): void => {
      if (closed || socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(message));
    };
    const unsubscribe = this.stream.subscribe((input) => {
      if (input.tenantId !== client.tenantId) return;
      send({
        type: 'ca.changed',
        caId: input.caId,
        providerId: input.providerId,
        objectTypes: input.objectTypes,
        emittedAt: new Date().toISOString(),
      });
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
    send({ type: 'snapshot', emittedAt: new Date().toISOString() });
  }

  private async authorize(request: IncomingMessage, url: URL): Promise<CaOperationsRealtimeClient> {
    const identity = await this.security.auth.parseRequestIdentity(
      headerValue(request.headers, 'authorization'),
      headerValue(request.headers, 'cookie'),
    );
    if (!identity?.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少登录上下文');
    const requestedTenantId = url.searchParams.get('tenantId')?.trim() || undefined;
    const tenantId = requestedTenantId ?? identity.tenantId;
    if (!tenantId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少租户上下文');
    if (identity.tenantId && requestedTenantId && identity.tenantId !== requestedTenantId) {
      throw new AppError('AUTH_FORBIDDEN', '无权订阅指定租户的 CA 变更');
    }
    const subject = await this.subjectFor(identity.actorId, tenantId, identity.tenantScope);
    await this.security.rbac.assertCan(subject, 'ca.operations.read', {
      type: 'caOperation',
      scope: { tenantId, tenantScope: identity.tenantScope, ownerId: subject.id, resourceType: 'caOperation' },
    }, {
      actor: subject,
      requestId: headerValue(request.headers, 'x-request-id'),
      sourceIp: request.socket.remoteAddress,
    });
    return { tenantId, actorId: identity.actorId, tenantScope: identity.tenantScope };
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
