import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { URL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { SessionProcessLauncher, type SessionProcessHandle } from './session-process.js';

type SessionStatus = 'created' | 'ready' | 'stopped' | 'expired' | 'failed';

interface SessionRecord {
  sessionId: string;
  status: SessionStatus;
  loginUrl: string;
  allowedOrigins: string[];
  expiresAt: string;
  cdpUrl: string;
  vncUrl: string;
  processHandle: SessionProcessHandle;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  responseHeaders: Record<string, string>;
}

interface BrowserAction {
  action: 'navigate' | 'extract' | 'verify';
  url?: string;
  extractions?: Array<{
    name: string;
    source: 'cookie' | 'header' | 'local_storage' | 'session_storage' | 'url' | 'text';
    key?: string;
    optional?: boolean;
  }>;
  verification?: {
    url?: string;
    statusCode?: number;
    textContains?: string;
    headers?: Record<string, string>;
  };
}

const sessions = new Map<string, SessionRecord>();
const port = Number(process.env.PORT ?? 8787);
const sharedSecret = process.env.BROWSER_RUNTIME_SHARED_SECRET;
const publicBaseUrl = (process.env.BROWSER_RUNTIME_PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
const noVncRoot = resolve(process.env.BROWSER_NOVNC_ROOT ?? '/app/novnc');
const processLauncher = new SessionProcessLauncher();
const vncWebSocketServer = new WebSocketServer({ noServer: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://runtime.local');
    if (request.method === 'GET' && url.pathname === '/health') {
      return send(response, 200, {
        status: 'OK',
        service: 'gcac-browser-runtime',
        activeSessions: processLauncher.activeCount,
      });
    }
    if (request.method === 'GET' && /^\/vnc\/[^/]+\//.test(url.pathname)) {
      return await proxyVncHttp(request, response, url);
    }
    authorizeRuntimeRequest(request);
    if (request.method === 'POST' && url.pathname === '/v1/sessions') {
      return send(response, 201, await createSession(await readJson(request)));
    }
    const matched = /^\/v1\/sessions\/([^/]+)(?:\/actions)?$/.exec(url.pathname);
    if (!matched) throw httpError(404, 'RESOURCE_NOT_FOUND', '接口不存在');
    const sessionId = decodeURIComponent(matched[1]!);
    if (request.method === 'GET' && !url.pathname.endsWith('/actions')) {
      return send(response, 200, await getSession(sessionId));
    }
    if (request.method === 'DELETE' && !url.pathname.endsWith('/actions')) {
      await stopSession(sessionId);
      return send(response, 200, { stopped: true });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/actions')) {
      return send(response, 200, await executeAction(sessionId, await readJson(request) as BrowserAction));
    }
    throw httpError(405, 'VALIDATION_FAILED', 'HTTP 方法不支持');
  } catch (error) {
    const handled = normalizeError(error);
    send(response, handled.status, { errorCode: handled.errorCode, errorMessage: handled.errorMessage });
  }
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url ?? '/', 'http://runtime.local');
    if (!/^\/vnc\/[^/]+\//.test(url.pathname)) return socket.destroy();
    const route = parseVncRoute(url);
    if (!route) return socket.destroy();
    const record = requireReadyVncSession(route.sessionId);
    vncWebSocketServer.handleUpgrade(request, socket, head, (client) => {
      bridgeVncSocket(client, record);
    });
  } catch {
    socket.destroy();
  }
});

server.listen(port);

setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (Date.parse(session.expiresAt) > now || isTerminal(session.status)) continue;
    void cleanupSession(session, 'expired');
  }
}, 30_000).unref();

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

async function createSession(input: unknown) {
  const request = requireRecord(input);
  const sessionId = text(request.sessionId, 'sessionId');
  const loginUrl = text(request.loginUrl, 'loginUrl');
  const allowedOrigins = arrayOfText(request.allowedOrigins, 'allowedOrigins');
  const ttlSeconds = number(request.ttlSeconds, 'ttlSeconds');
  ensureAllowedUrl(loginUrl, allowedOrigins);

  const existing = sessions.get(sessionId);
  if (existing && existing.status !== 'stopped') return view(existing);

  const processHandle = await processLauncher.start(sessionId);
  const record: SessionRecord = {
    sessionId,
    status: 'created',
    loginUrl,
    allowedOrigins,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    cdpUrl: `http://127.0.0.1:${processHandle.cdpPort}`,
    vncUrl: `${publicBaseUrl}/vnc/${encodeURIComponent(sessionId)}/vnc.html?autoconnect=true&resize=scale&path=vnc/${encodeURIComponent(sessionId)}/websockify`,
    processHandle,
    responseHeaders: {},
  };
  sessions.set(sessionId, record);
  void processHandle.exit.then(() => {
    if (record.status === 'created' || record.status === 'ready') {
      void cleanupSession(record, 'failed');
    }
  });

  try {
    await connectBrowser(record);
    record.status = 'ready';
    return view(record);
  } catch (error) {
    await cleanupSession(record, 'failed');
    throw error;
  }
}

async function getSession(sessionId: string) {
  const record = requireSession(sessionId);
  if (Date.parse(record.expiresAt) <= Date.now() && !isTerminal(record.status)) {
    await cleanupSession(record, 'expired');
  }
  return view(record);
}

async function executeAction(sessionId: string, action: BrowserAction) {
  const record = requireSession(sessionId);
  if (record.status !== 'ready') throw httpError(409, 'BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文不可用');
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await cleanupSession(record, 'expired');
    throw httpError(410, 'TEMPORARY_URL_EXPIRED', '浏览器会话已过期');
  }
  if (!['navigate', 'extract', 'verify'].includes(action.action)) {
    throw httpError(400, 'VALIDATION_FAILED', '浏览器操作类型不支持');
  }

  const page = await requirePage(record);
  if (action.action === 'navigate') {
    if (!action.url) throw httpError(400, 'VALIDATION_FAILED', 'navigate 缺少 url');
    ensureAllowedUrl(action.url, record.allowedOrigins);
    await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    ensureAllowedUrl(page.url(), record.allowedOrigins);
    return { success: true, statusCode: 200 };
  }
  if (action.action === 'verify') {
    const targetUrl = action.verification?.url ?? action.url ?? page.url();
    ensureAllowedUrl(targetUrl, record.allowedOrigins);
    const response = await page.request.get(targetUrl, {
      headers: action.verification?.headers,
      maxRedirects: 5,
    });
    ensureAllowedUrl(response.url(), record.allowedOrigins);
    const body = await response.text();
    const statusOk = action.verification?.statusCode === undefined || response.status() === action.verification.statusCode;
    const textOk = action.verification?.textContains === undefined || body.includes(action.verification.textContains);
    return statusOk && textOk
      ? { success: true, statusCode: response.status() }
      : {
          success: false,
          statusCode: response.status(),
          errorCode: 'CREDENTIAL_VALIDATION_FAILED',
          errorMessage: '同上下文验证未通过',
        };
  }

  const parameters: Record<string, string> = {};
  for (const extraction of action.extractions ?? []) {
    const value = await extract(record, page, extraction);
    if (!value && !extraction.optional) {
      throw httpError(422, 'CREDENTIAL_OUTPUT_INVALID', `缺少浏览器提取字段：${extraction.name}`);
    }
    if (value) parameters[extraction.name] = value;
  }
  return { success: true, parameters };
}

async function connectBrowser(record: SessionRecord): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if (!processLauncher.isAlive(record.processHandle)) throw new Error('Chromium 进程组已退出');
      const browser = await chromium.connectOverCDP(record.cdpUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error('Chromium 未提供默认 BrowserContext');
      await context.route('**/*', async (route) => {
        if (isAllowedBrowserResource(route.request().url(), record.allowedOrigins)) {
          await route.continue();
        } else {
          await route.abort('blockedbyclient');
        }
      });
      const page = context.pages()[0] ?? await context.newPage();
      record.browser = browser;
      record.context = context;
      record.page = page;
      attachPage(record, page);
      context.on('page', (createdPage) => {
        record.page = createdPage;
        attachPage(record, createdPage);
      });
      browser.on('disconnected', () => {
        if (record.status === 'created' || record.status === 'ready') {
          void cleanupSession(record, 'failed');
        }
      });
      await page.goto(record.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      ensureAllowedUrl(page.url(), record.allowedOrigins);
      return;
    } catch (error) {
      if (record.browser || !processLauncher.isAlive(record.processHandle)) {
        throw error;
      }
      if (attempt === 29) {
        throw httpError(503, 'BROWSER_CONTEXT_UNAVAILABLE', '无法连接 Chromium CDP');
      }
      await delay(1_000);
    }
  }
  throw httpError(503, 'BROWSER_CONTEXT_UNAVAILABLE', '无法连接 Chromium CDP');
}

function attachPage(record: SessionRecord, page: Page): void {
  page.on('response', (response) => {
    if (!isAllowedUrl(response.url(), record.allowedOrigins)) return;
    record.responseHeaders = Object.fromEntries(
      Object.entries(response.headers()).map(([key, value]) => [key.toLowerCase(), value]),
    );
  });
}

async function requirePage(record: SessionRecord): Promise<Page> {
  const processAlive = processLauncher.isAlive(record.processHandle);
  const contextStable = record.processHandle.contextNonce.length > 0;
  if (!processAlive || !contextStable || !record.browser || !record.context || !record.page || !record.browser.isConnected()) {
    await cleanupSession(record, 'failed');
    throw httpError(409, 'BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文已断开');
  }
  return record.page;
}

async function extract(
  record: SessionRecord,
  page: Page,
  extraction: { source: string; key?: string },
): Promise<string | undefined> {
  if (extraction.source === 'url') return page.url();
  if (extraction.source === 'text') {
    return page.locator('body').innerText({ timeout: 3_000 }).catch(() => undefined);
  }
  if (extraction.source === 'cookie') {
    const cookies = await record.context!.cookies();
    return cookies.find((item) => item.name === extraction.key)?.value;
  }
  if (extraction.source === 'local_storage' || extraction.source === 'session_storage') {
    return page.evaluate(({ source, key }) => (
      source === 'local_storage'
        ? localStorage.getItem(key) ?? undefined
        : sessionStorage.getItem(key) ?? undefined
    ), {
      source: extraction.source,
      key: extraction.key ?? '',
    });
  }
  if (extraction.source === 'header') {
    return extraction.key ? record.responseHeaders[extraction.key.toLowerCase()] : undefined;
  }
  return undefined;
}

async function stopSession(sessionId: string): Promise<void> {
  const record = sessions.get(sessionId);
  if (!record) return;
  await cleanupSession(record, 'stopped');
}

async function cleanupSession(record: SessionRecord, terminalStatus: SessionStatus): Promise<void> {
  if (isTerminal(record.status) && record.status !== terminalStatus) return;
  record.status = terminalStatus;
  const browser = record.browser;
  record.browser = undefined;
  record.context = undefined;
  record.page = undefined;
  await browser?.close().catch(() => undefined);
  await processLauncher.stop(record.processHandle).catch(() => undefined);
}

function view(record: SessionRecord) {
  return {
    sessionId: record.sessionId,
    status: record.status,
    vncUrl: record.vncUrl,
    cdpConnected: record.browser?.isConnected() === true,
    processAlive: processLauncher.isAlive(record.processHandle),
    contextVersion: 1,
    expiresAt: record.expiresAt,
  };
}

function requireSession(sessionId: string): SessionRecord {
  const record = sessions.get(sessionId);
  if (!record) throw httpError(404, 'RESOURCE_NOT_FOUND', '浏览器会话不存在');
  return record;
}

function authorizeRuntimeRequest(request: IncomingMessage): void {
  if (sharedSecret && request.headers['x-browser-runtime-secret'] !== sharedSecret) {
    throw httpError(403, 'AUTH_FORBIDDEN', 'Browser Runtime 身份校验失败');
  }
}

function ensureAllowedUrl(raw: string, allowedOrigins: string[]): void {
  if (isAllowedUrl(raw, allowedOrigins)) return;
  throw httpError(403, 'BROWSER_NETWORK_BLOCKED', 'URL 不在插件允许的 Origin 内');
}

function isAllowedUrl(raw: string, allowedOrigins: string[]): boolean {
  try {
    const url = new URL(raw);
    return allowedOrigins.some((origin) => new URL(origin).origin === url.origin);
  } catch {
    return false;
  }
}

function isAllowedBrowserResource(raw: string, allowedOrigins: string[]): boolean {
  try {
    const url = new URL(raw);
    if (['about:', 'blob:', 'data:'].includes(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return allowedOrigins.some((origin) => new URL(origin).origin === url.origin);
  } catch {
    return false;
  }
}

async function proxyVncHttp(_request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const route = parseVncRoute(url);
  if (!route) throw httpError(404, 'RESOURCE_NOT_FOUND', 'VNC 路径无效');
  requireReadyVncSession(route.sessionId);
  const targetPath = resolve(noVncRoot, `.${route.innerPath}`);
  if (!targetPath.startsWith(`${noVncRoot}${sep}`)) {
    throw httpError(403, 'RESOURCE_FORBIDDEN', 'VNC 静态资源路径无效');
  }
  try {
    const content = await readFile(targetPath);
    response.statusCode = 200;
    response.setHeader('content-type', contentType(targetPath));
    response.setHeader('cache-control', 'public, max-age=3600');
    response.end(content);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw httpError(404, 'RESOURCE_NOT_FOUND', 'VNC 静态资源不存在');
    }
    throw error;
  }
}

function bridgeVncSocket(client: WebSocket, record: SessionRecord): void {
  const target = tcpConnect(record.processHandle.rfbPort, '127.0.0.1');
  target.on('data', (chunk) => {
    if (client.readyState === WebSocket.OPEN) client.send(chunk);
  });
  target.on('error', () => client.close());
  target.on('close', () => client.close());
  client.on('message', (data: RawData) => {
    if (!target.destroyed) target.write(rawDataToBuffer(data));
  });
  client.on('close', () => target.destroy());
  client.on('error', () => target.destroy());
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

function requireReadyVncSession(sessionId: string): SessionRecord {
  const record = requireSession(sessionId);
  if (record.status !== 'ready' || !processLauncher.isAlive(record.processHandle)) {
    throw httpError(409, 'BROWSER_CONTEXT_UNAVAILABLE', 'VNC 会话不可用');
  }
  return record;
}

function parseVncRoute(url: URL): { sessionId: string; innerPath: string } | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'vnc' || !parts[1]) return undefined;
  const innerPath = `/${parts.slice(2).join('/') || 'vnc.html'}`;
  return { sessionId: decodeURIComponent(parts[1]), innerPath };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'VALIDATION_FAILED', '请求体必须是对象');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, 'VALIDATION_FAILED', `${field} 必填`);
  }
  return value.trim();
}

function arrayOfText(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw httpError(400, 'VALIDATION_FAILED', `${field} 必须是非空字符串数组`);
  }
  return value.map((item) => item.trim());
}

function number(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw httpError(400, 'VALIDATION_FAILED', `${field} 必须是正整数`);
  }
  return Number(value);
}

function isTerminal(status: SessionStatus): boolean {
  return status === 'stopped' || status === 'expired' || status === 'failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function httpError(status: number, errorCode: string, errorMessage: string) {
  return { status, errorCode, errorMessage };
}

function normalizeError(error: unknown): { status: number; errorCode: string; errorMessage: string } {
  if (error && typeof error === 'object' && 'status' in error) {
    return error as { status: number; errorCode: string; errorMessage: string };
  }
  return {
    status: 500,
    errorCode: 'BROWSER_RUNTIME_UNAVAILABLE',
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

async function shutdown(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => cleanupSession(session, 'stopped')));
  server.close(() => process.exit(0));
}
