import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { requireTenantId } from '../../common/http/tenant-context.js';
import type { Router } from '../../common/http/router.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { SecurityServices } from '../security/security.controller.js';
import { BrowserCredentialSessionService } from './browser-credential-session.service.js';

const tags = ['BrowserCredentials'];

export class BrowserCredentialSessionController {
  private readonly vncWebSocketServer = new WebSocketServer({ noServer: true });

  constructor(
    private readonly service: BrowserCredentialSessionService,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.post('/api/v1/credentials/browser-sessions', '创建浏览器临时凭据会话', tags, (request) => this.create(request));
    router.get('/api/v1/credentials/browser-sessions/:id', '查询浏览器临时凭据会话', tags, (request) => this.get(request));
    router.get('/api/v1/credentials/browser-sessions/:id/connect', '连接浏览器临时 VNC', tags, (request) => this.connect(request));
    router.post('/api/v1/credentials/browser-sessions/:id/connect', '提交浏览器临时 VNC 密码', tags, (request) => this.connect(request));
    router.get('/api/v1/credentials/browser-sessions/:id/vnc/:path*', '代理浏览器临时 VNC 资源', tags, (request) => this.vncHttp(request));
    router.post('/api/v1/credentials/browser-sessions/:id/acquire', '手动获取浏览器凭据', tags, (request) => this.acquire(request));
    router.post('/api/v1/credentials/browser-sessions/:id/cancel', '取消浏览器临时凭据会话', tags, (request) => this.cancel(request));
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    const match = /\/browser-sessions\/([^/]+)\/vnc\/(.+)$/.exec(new URL(request.url ?? '/', 'http://gcac.local').pathname);
    if (!match || decodeURIComponent(match[2]!) !== 'websockify') return false;
    try {
      const sessionId = decodeURIComponent(match[1]!);
      const targetUrl = await this.service.getVncWebSocketUrl(sessionId, request.headers.cookie);
      const upstream = new WebSocket(targetUrl);
      const timeout = setTimeout(() => {
        upstream.close();
        socket.destroy();
      }, 10_000);
      upstream.once('open', () => {
        clearTimeout(timeout);
        this.vncWebSocketServer.handleUpgrade(request, socket, head, (downstream) => {
          bridgeWebSockets(downstream, upstream);
        });
      });
      upstream.once('error', () => {
        clearTimeout(timeout);
        socket.destroy();
      });
      return true;
    } catch {
      socket.destroy();
      return true;
    }
  }

  private async create(request: HttpRequest) {
    const subject = await this.authorize(request, 'credential.create');
    const body = validateObject(request.body, {
      credentialId: { type: 'string', required: true },
      assetId: { type: 'string' },
      pluginVersionId: { type: 'string', required: true },
      loginUrl: { type: 'string' },
      sharePassword: { type: 'string', required: true },
      ttlSeconds: { type: 'number' },
      screenWidth: { type: 'number' },
      screenHeight: { type: 'number' },
      idempotencyKey: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.service.create(tenantId(request), subject, {
        credentialId: String(body.credentialId),
        assetId: body.assetId === undefined ? undefined : String(body.assetId),
        pluginVersionId: String(body.pluginVersionId),
        loginUrl: body.loginUrl === undefined ? undefined : String(body.loginUrl),
        ttlSeconds: body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds),
        sharePassword: String(body.sharePassword),
        screenWidth: body.screenWidth === undefined ? undefined : Number(body.screenWidth),
        screenHeight: body.screenHeight === undefined ? undefined : Number(body.screenHeight),
        idempotencyKey: body.idempotencyKey === undefined ? undefined : String(body.idempotencyKey),
      }),
    };
  }

  private async get(request: HttpRequest) {
    await this.authorize(request, 'credential.read');
    return this.service.get(tenantId(request), pathId(request));
  }

  private async connect(request: HttpRequest) {
    const token = queryString(request, 'token');
    if (!token) throw new AppError('TEMPORARY_URL_INVALID', '临时 URL 缺少 token');
    const password = request.method === 'POST' ? passwordFromBody(request.body) : undefined;
    const result = await this.service.authorizeShare(pathId(request), token, password, request.headers.cookie);
    if (!result.authorized) {
      return {
        headers: shareHeaders(),
        body: renderPasswordPage(request.path, token),
      };
    }
    const sessionId = pathId(request);
    const vncPath = `/api/v1/credentials/browser-sessions/${encodeURIComponent(sessionId)}/vnc/vnc.html`;
    const websocketPath = `api/v1/credentials/browser-sessions/${encodeURIComponent(sessionId)}/vnc/websockify`;
    return {
      headers: {
        ...shareHeaders(),
        ...(result.setCookie ? { 'set-cookie': result.setCookie } : {}),
      },
      body: renderVncPage(vncPath, websocketPath),
    };
  }

  private async vncHttp(request: HttpRequest) {
    const result = await this.service.proxyVncHttp(
      pathId(request),
      request.headers.cookie,
      vncPath(request),
      queryStringForProxy(request.query),
    );
    return {
      statusCode: result.statusCode,
      headers: { ...result.headers, 'cache-control': 'no-store' },
      body: result.body,
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
      type: 'credential', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return subject;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_browser_credentials', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
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

function passwordFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION_FAILED', '请求体必须是对象');
  const value = (body as Record<string, unknown>).password;
  if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', '临时链接密码不能为空');
  return value;
}

function queryStringForProxy(query: HttpRequest['query']): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function vncPath(request: HttpRequest): string {
  const match = /\/browser-sessions\/[^/]+\/vnc\/(.*)$/.exec(request.path);
  return match?.[1] || 'vnc.html';
}

function shareHeaders(): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'",
  };
}

function renderPasswordPage(actionPath: string, token: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GCAC 临时浏览器</title><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;background:#111;color:#eee}main{max-width:420px;margin:12vh auto;padding:24px}label{display:grid;gap:8px}input,button{box-sizing:border-box;width:100%;padding:12px;font:inherit;border-radius:6px;border:1px solid #666}button{margin-top:16px;background:#2f7df6;color:#fff;border:0;cursor:pointer}button:disabled{opacity:.6}p{color:#aaa}.error{color:#ff8f8f}</style></head><body><main><h1>临时浏览器登录</h1><p>请输入本次会话密码。</p><form id="share-form" action="${escapeHtmlAttribute(actionPath)}?token=${encodeURIComponent(token)}"><label>临时密码<input name="password" type="password" autocomplete="one-time-code" required autofocus></label><button type="submit">进入浏览器</button><p id="share-error" class="error" role="alert"></p></form></main><script>(()=>{const form=document.getElementById('share-form');const input=form.elements.namedItem('password');const button=form.querySelector('button');const error=document.getElementById('share-error');form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;error.textContent='';try{const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:input.value})});const body=await response.text();if(!response.ok){try{error.textContent=JSON.parse(body).errorMessage||'临时链接密码错误';}catch{error.textContent='临时链接密码错误';}button.disabled=false;return;}document.open();document.write(body);document.close();}catch{error.textContent='无法连接 GCAC 服务';button.disabled=false;}});})();</script></body></html>`;
}

function renderVncPage(vncPath: string, websocketPath: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GCAC 临时浏览器</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#111}body{overflow:hidden}</style></head><body><iframe src="${escapeHtmlAttribute(`${vncPath}?autoconnect=true&resize=remote&path=${encodeURIComponent(websocketPath)}`)}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
}

function bridgeWebSockets(downstream: WebSocket, upstream: WebSocket): void {
  downstream.on('message', (data: RawData) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(rawDataToBuffer(data));
  });
  upstream.on('message', (data: RawData) => {
    if (downstream.readyState === WebSocket.OPEN) downstream.send(rawDataToBuffer(data));
  });
  const closeBoth = () => {
    if (downstream.readyState === WebSocket.OPEN) downstream.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  downstream.on('close', closeBoth);
  upstream.on('close', closeBoth);
  downstream.on('error', closeBoth);
  upstream.on('error', closeBoth);
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
