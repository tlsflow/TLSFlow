import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

type SessionStatus = 'created' | 'ready' | 'stopped' | 'expired' | 'failed';

interface SessionRecord {
  sessionId: string;
  containerName: string;
  status: SessionStatus;
  loginUrl: string;
  allowedOrigins: string[];
  expiresAt: string;
  cdpUrl: string;
  vncUrl: string;
  vncPort: number;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  responseHeaders: Record<string, string>;
}

interface BrowserAction {
  action: 'navigate' | 'extract' | 'verify';
  url?: string;
  extractions?: Array<{ name: string; source: 'cookie' | 'header' | 'local_storage' | 'session_storage' | 'url' | 'text'; key?: string; optional?: boolean }>;
  verification?: { url?: string; statusCode?: number; textContains?: string; headers?: Record<string, string> };
}

const sessions = new Map<string, SessionRecord>();
const port = Number(process.env.PORT ?? 8787);
const sharedSecret = process.env.BROWSER_RUNTIME_SHARED_SECRET;
const chromiumImage = process.env.BROWSER_CHROMIUM_IMAGE ?? 'gcac/chromium-vnc:local';
const publicBaseUrl = (process.env.BROWSER_RUNTIME_PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
const dockerNetwork = process.env.BROWSER_RUNTIME_DOCKER_NETWORK;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://runtime.local');
    if (request.method === 'GET' && /^\/vnc\/[^/]+\//.test(url.pathname)) return proxyVncHttp(request, response, url);
    if (sharedSecret && request.headers['x-browser-runtime-secret'] !== sharedSecret) throw httpError(403, 'AUTH_FORBIDDEN', 'Browser Runtime 身份校验失败');
    if (request.method === 'POST' && url.pathname === '/v1/sessions') return send(response, 201, await createSession(await readJson(request)));
    const matched = /^\/v1\/sessions\/([^/]+)(?:\/actions)?$/.exec(url.pathname);
    if (!matched) throw httpError(404, 'RESOURCE_NOT_FOUND', '接口不存在');
    const sessionId = decodeURIComponent(matched[1]!);
    if (request.method === 'GET' && !url.pathname.endsWith('/actions')) return send(response, 200, await getSession(sessionId));
    if (request.method === 'DELETE' && !url.pathname.endsWith('/actions')) {
      await stopSession(sessionId);
      return send(response, 200, { stopped: true });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/actions')) return send(response, 200, await executeAction(sessionId, await readJson(request) as BrowserAction));
    throw httpError(405, 'VALIDATION_FAILED', 'HTTP 方法不支持');
  } catch (error) {
    const handled = normalizeError(error);
    send(response, handled.status, { errorCode: handled.errorCode, errorMessage: handled.errorMessage });
  }
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://runtime.local');
  if (!/^\/vnc\/[^/]+\//.test(url.pathname)) {
    socket.destroy();
    return;
  }
  proxyVncWebSocket(request, socket, head, url);
});

server.listen(port);

setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (Date.parse(session.expiresAt) <= now && session.status !== 'stopped') {
      session.status = 'expired';
      stopSession(session.sessionId).catch(() => undefined);
    }
  }
}, 30_000).unref();

async function createSession(input: unknown) {
  const request = requireRecord(input);
  const sessionId = text(request.sessionId, 'sessionId');
  const loginUrl = text(request.loginUrl, 'loginUrl');
  const allowedOrigins = arrayOfText(request.allowedOrigins, 'allowedOrigins');
  const ttlSeconds = number(request.ttlSeconds, 'ttlSeconds');
  ensureAllowedUrl(loginUrl, allowedOrigins);
  const existing = sessions.get(sessionId);
  if (existing && existing.status !== 'stopped') return view(existing);
  const containerName = `gcac-browser-${safeName(sessionId)}-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const ports = await runDocker([
    'run', '-d', '--rm',
    '--name', containerName,
    '--cap-drop=ALL',
    '--security-opt', 'no-new-privileges',
    '--memory', process.env.BROWSER_CONTAINER_MEMORY ?? '768m',
    '--cpus', process.env.BROWSER_CONTAINER_CPUS ?? '1',
    ...(dockerNetwork ? ['--network', dockerNetwork] : []),
    '-e', `LOGIN_URL=${loginUrl}`,
    '-p', '127.0.0.1::6080',
    '-p', '127.0.0.1::9222',
    chromiumImage,
  ]);
  const containerId = ports.trim();
  const mappedVnc = await mappedPort(containerId, '6080/tcp');
  const mappedCdp = await mappedPort(containerId, '9222/tcp');
  const record: SessionRecord = {
    sessionId,
    containerName,
    status: 'created',
    loginUrl,
    allowedOrigins,
    expiresAt,
    cdpUrl: `http://127.0.0.1:${mappedCdp}`,
    vncUrl: `${publicBaseUrl}/vnc/${encodeURIComponent(sessionId)}/vnc.html?autoconnect=true&resize=scale&path=vnc/${encodeURIComponent(sessionId)}/websockify`,
    vncPort: Number(mappedVnc),
    responseHeaders: {},
  };
  sessions.set(sessionId, record);
  await connectBrowser(record);
  record.status = 'ready';
  return view(record);
}

async function getSession(sessionId: string) {
  const record = requireSession(sessionId);
  if (Date.parse(record.expiresAt) <= Date.now() && record.status !== 'stopped') record.status = 'expired';
  return view(record);
}

async function executeAction(sessionId: string, action: BrowserAction) {
  const record = requireSession(sessionId);
  if (record.status !== 'ready') throw httpError(409, 'BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文不可用');
  if (Date.parse(record.expiresAt) <= Date.now()) throw httpError(410, 'TEMPORARY_URL_EXPIRED', '浏览器会话已过期');
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
    const response = await page.request.get(targetUrl, { headers: action.verification?.headers });
    const body = await response.text();
    const statusOk = action.verification?.statusCode === undefined || response.status() === action.verification.statusCode;
    const textOk = action.verification?.textContains === undefined || body.includes(action.verification.textContains);
    return statusOk && textOk
      ? { success: true, statusCode: response.status() }
      : { success: false, statusCode: response.status(), errorCode: 'CREDENTIAL_VALIDATION_FAILED', errorMessage: '同上下文验证未通过' };
  }
  const parameters: Record<string, string> = {};
  for (const extraction of action.extractions ?? []) {
    const value = await extract(record, page, extraction);
    if (!value && !extraction.optional) throw httpError(422, 'CREDENTIAL_OUTPUT_INVALID', `缺少浏览器提取字段：${extraction.name}`);
    if (value) parameters[extraction.name] = value;
  }
  return { success: true, parameters };
}

async function connectBrowser(record: SessionRecord): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP(record.cdpUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error('Chromium 未提供默认 BrowserContext');
      const page = context.pages()[0] ?? await context.newPage();
      record.browser = browser;
      record.context = context;
      record.page = page;
      page.on('response', (response) => {
        if (!isAllowedUrl(response.url(), record.allowedOrigins)) return;
        record.responseHeaders = Object.fromEntries(Object.entries(response.headers()).map(([key, value]) => [key.toLowerCase(), value]));
      });
      browser.on('disconnected', () => {
        if (record.status !== 'stopped' && record.status !== 'expired') record.status = 'failed';
      });
      return;
    } catch {
      await delay(1000);
    }
  }
  record.status = 'failed';
  throw httpError(503, 'BROWSER_CONTEXT_UNAVAILABLE', '无法连接 Chromium CDP');
}

async function requirePage(record: SessionRecord): Promise<Page> {
  if (!record.browser || !record.context || !record.page || record.browser.isConnected() === false) {
    throw httpError(409, 'BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文已断开');
  }
  return record.page;
}

async function extract(record: SessionRecord, page: Page, extraction: { source: string; key?: string }): Promise<string | undefined> {
  if (extraction.source === 'url') return page.url();
  if (extraction.source === 'text') return await page.locator('body').innerText({ timeout: 3000 }).catch(() => undefined);
  if (extraction.source === 'cookie') {
    const cookies = await page.context().cookies();
    const cookie = cookies.find((item) => item.name === extraction.key);
    return cookie?.value;
  }
  if (extraction.source === 'local_storage' || extraction.source === 'session_storage') {
    return page.evaluate(({ source, key }) => source === 'local_storage' ? localStorage.getItem(key) ?? undefined : sessionStorage.getItem(key) ?? undefined, {
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
  record.status = 'stopped';
  await record.browser?.close().catch(() => undefined);
  await runDocker(['rm', '-f', record.containerName]).catch(() => undefined);
}

function view(record: SessionRecord) {
  return {
    sessionId: record.sessionId,
    status: record.status,
    vncUrl: record.vncUrl,
    cdpConnected: record.browser?.isConnected() === true,
    expiresAt: record.expiresAt,
  };
}

function requireSession(sessionId: string): SessionRecord {
  const record = sessions.get(sessionId);
  if (!record) throw httpError(404, 'RESOURCE_NOT_FOUND', '浏览器会话不存在');
  return record;
}

function ensureAllowedUrl(raw: string, allowedOrigins: string[]): void {
  if (isAllowedUrl(raw, allowedOrigins)) return;
  throw httpError(403, 'BROWSER_NETWORK_BLOCKED', 'URL 不在插件允许的 Origin 内');
}

function isAllowedUrl(raw: string, allowedOrigins: string[]): boolean {
  const url = new URL(raw);
  return allowedOrigins.some((origin) => {
    const item = new URL(origin);
    return item.origin === url.origin;
  });
}

function mappedPort(containerId: string, portSpec: string): Promise<string> {
  return runDocker(['port', containerId, portSpec]).then((output) => {
    const line = output.trim().split('\n')[0] ?? '';
    const port = line.split(':').at(-1);
    if (!port) throw new Error(`Docker 端口映射不存在：${portSpec}`);
    return port;
  });
}

function proxyVncHttp(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const route = parseVncRoute(url);
  if (!route) throw httpError(404, 'RESOURCE_NOT_FOUND', 'VNC 路径无效');
  const record = requireSession(route.sessionId);
  const targetPort = vncPort(record);
  const target = httpRequest({
    hostname: '127.0.0.1',
    port: targetPort,
    method: request.method,
    path: `${route.innerPath}${url.search}`,
    headers: { ...request.headers, host: `127.0.0.1:${targetPort}` },
  }, (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  target.on('error', (error) => {
    response.statusCode = 502;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ errorCode: 'BROWSER_RUNTIME_UNAVAILABLE', errorMessage: error.message }));
  });
  request.pipe(target);
}

function proxyVncWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
  const route = parseVncRoute(url);
  if (!route) {
    socket.destroy();
    return;
  }
  const record = requireSession(route.sessionId);
  const targetPort = vncPort(record);
  const upstream = tcpConnect(targetPort, '127.0.0.1', () => {
    const requestLine = `${request.method ?? 'GET'} ${route.innerPath}${url.search} HTTP/${request.httpVersion}\r\n`;
    const headers = Object.entries({ ...request.headers, host: `127.0.0.1:${targetPort}` })
      .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => `${key}: ${item}`) : value === undefined ? [] : [`${key}: ${value}`])
      .join('\r\n');
    upstream.write(`${requestLine}${headers}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

function parseVncRoute(url: URL): { sessionId: string; innerPath: string } | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'vnc' || !parts[1]) return undefined;
  const innerPath = `/${parts.slice(2).join('/') || 'vnc.html'}`;
  return { sessionId: decodeURIComponent(parts[1]), innerPath };
}

function vncPort(record: SessionRecord): number {
  const port = record.vncPort;
  if (!Number.isInteger(port) || port <= 0) throw httpError(503, 'BROWSER_RUNTIME_UNAVAILABLE', 'VNC 端口无效');
  return port;
}

function runDocker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      if (code === 0) resolve(output);
      else reject(new Error(Buffer.concat(stderr).toString('utf8') || `docker exited ${code}`));
    });
  });
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'VALIDATION_FAILED', '请求体必须是对象');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw httpError(400, 'VALIDATION_FAILED', `${field} 必填`);
  return value.trim();
}

function arrayOfText(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw httpError(400, 'VALIDATION_FAILED', `${field} 必须是字符串数组`);
  return value.map((item) => item.trim());
}

function number(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw httpError(400, 'VALIDATION_FAILED', `${field} 必须是正整数`);
  return Number(value);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 48);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpError(status: number, errorCode: string, errorMessage: string) {
  return { status, errorCode, errorMessage };
}

function normalizeError(error: unknown): { status: number; errorCode: string; errorMessage: string } {
  if (error && typeof error === 'object' && 'status' in error) return error as { status: number; errorCode: string; errorMessage: string };
  return { status: 500, errorCode: 'BROWSER_RUNTIME_UNAVAILABLE', errorMessage: error instanceof Error ? error.message : String(error) };
}
