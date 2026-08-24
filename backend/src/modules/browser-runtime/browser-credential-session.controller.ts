import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { requireTenantId } from '../../common/http/tenant-context.js';
import type { Router } from '../../common/http/router.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import type { SecurityServices } from '../security/security.controller.js';
import { BrowserCredentialSessionService } from './browser-credential-session.service.js';

const tags = ['BrowserCredentials'];

export class BrowserCredentialSessionController {
  constructor(
    private readonly service: BrowserCredentialSessionService,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.post('/api/v1/credentials/browser-sessions', '创建浏览器临时凭据会话', tags, (request) => this.create(request));
    router.get('/api/v1/credentials/browser-sessions/:id', '查询浏览器临时凭据会话', tags, (request) => this.get(request));
    router.get('/api/v1/credentials/browser-sessions/:id/connect', '连接浏览器临时 VNC', tags, (request) => this.connect(request));
    router.post('/api/v1/credentials/browser-sessions/:id/acquire', '手动获取浏览器凭据', tags, (request) => this.acquire(request));
    router.post('/api/v1/credentials/browser-sessions/:id/cancel', '取消浏览器临时凭据会话', tags, (request) => this.cancel(request));
  }

  private async create(request: HttpRequest) {
    const subject = await this.authorize(request, 'credential.create');
    const body = validateObject(request.body, {
      assetId: { type: 'string', required: true },
      pluginVersionId: { type: 'string', required: true },
      ttlSeconds: { type: 'number' },
      idempotencyKey: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.service.create(tenantId(request), subject, {
        assetId: String(body.assetId),
        pluginVersionId: String(body.pluginVersionId),
        ttlSeconds: body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds),
        idempotencyKey: body.idempotencyKey === undefined ? undefined : String(body.idempotencyKey),
      }),
    };
  }

  private async get(request: HttpRequest) {
    await this.authorize(request, 'credential.read');
    return this.service.get(tenantId(request), pathId(request));
  }

  private async connect(request: HttpRequest) {
    await this.authorize(request, 'credential.create');
    const token = queryString(request, 'token');
    if (!token) throw new AppError('TEMPORARY_URL_INVALID', '临时 URL 缺少 token');
    const result = await this.service.connect(tenantId(request), pathId(request), token);
    return {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: `<!doctype html><html><head><meta charset="utf-8"><title>GCAC Browser</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#111}body{overflow:hidden}</style></head><body><iframe src="${escapeHtmlAttribute(result.vncUrl)}" allow="clipboard-read; clipboard-write"></iframe></body></html>`,
    };
  }

  private async acquire(request: HttpRequest) {
    const subject = await this.authorize(request, 'credential.create');
    return this.service.acquire(tenantId(request), subject, pathId(request), {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor: subject,
    });
  }

  private async cancel(request: HttpRequest) {
    await this.authorize(request, 'credential.create');
    return this.service.cancel(tenantId(request), pathId(request));
  }

  private async authorize(request: HttpRequest, action: string): Promise<SecuritySubject> {
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, action, {
      type: 'credential', scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return subject;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_browser_credentials', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function pathId(request: HttpRequest): string {
  const match = /\/browser-sessions\/([^/]+)/.exec(request.path);
  const id = match?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '会话 ID 不能为空');
  return decodeURIComponent(id);
}

function queryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
