import { AppError } from '../../../common/errors/app-error.js';

export interface CookieSessionScope {
  tenantId: string;
  runId: string;
  workflowVersionId: string;
  cookieSessionRef: string;
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  hostOnly: boolean;
  expiresAt?: number;
  creationIndex: number;
}

/**
 * 只在当前工作进程内保存 Cookie。实现覆盖 RFC6265 的域、路径、Secure、
 * Host-only、Expires 和 Max-Age 规则，不提供文件导入导出能力。
 */
export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();
  private creationIndex = 0;

  setCookies(headers: readonly string[], requestUrl: string, now = Date.now()): void {
    for (const header of headers) this.setCookie(header, requestUrl, now);
    this.removeExpired(now);
  }

  setCookie(header: string, requestUrl: string, now = Date.now()): void {
    const url = parseHttpUrl(requestUrl);
    const first = header.indexOf(';');
    const pair = (first < 0 ? header : header.slice(0, first)).trim();
    const equals = pair.indexOf('=');
    if (equals <= 0) return;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (!isValidCookieName(name)) return;

    let domain = url.hostname.toLowerCase();
    let hostOnly = true;
    let path = defaultCookiePath(url.pathname);
    let secure = false;
    let expiresAt: number | undefined;
    let maxAge: number | undefined;

    const attributes = first < 0 ? [] : header.slice(first + 1).split(';');
    for (const attribute of attributes) {
      const separator = attribute.indexOf('=');
      const key = (separator < 0 ? attribute : attribute.slice(0, separator)).trim().toLowerCase();
      const attributeValue = separator < 0 ? '' : attribute.slice(separator + 1).trim();
      if (key === 'domain') {
        const candidate = attributeValue.replace(/^\.+/, '').toLowerCase();
        if (!candidate || !domainMatches(url.hostname, candidate) || isIpAddress(url.hostname) && candidate !== url.hostname.toLowerCase()) return;
        domain = candidate;
        hostOnly = false;
      } else if (key === 'path') {
        if (attributeValue.startsWith('/')) path = attributeValue;
      } else if (key === 'secure') {
        secure = true;
      } else if (key === 'max-age') {
        const parsed = Number(attributeValue);
        if (Number.isFinite(parsed)) maxAge = parsed;
      } else if (key === 'expires') {
        const parsed = Date.parse(attributeValue);
        if (Number.isFinite(parsed)) expiresAt = parsed;
      }
    }

    if (maxAge !== undefined) expiresAt = maxAge <= 0 ? 0 : now + Math.min(maxAge * 1000, 1000 * 60 * 60 * 24 * 365 * 10);
    const key = cookieKey(name, domain, path);
    if (expiresAt !== undefined && expiresAt <= now) {
      this.cookies.delete(key);
      return;
    }
    const previous = this.cookies.get(key);
    this.cookies.set(key, {
      name,
      value,
      domain,
      path,
      secure,
      hostOnly,
      expiresAt,
      creationIndex: previous?.creationIndex ?? this.creationIndex++,
    });
  }

  getCookieHeader(requestUrl: string, now = Date.now()): string | undefined {
    const url = parseHttpUrl(requestUrl);
    this.removeExpired(now);
    const matching = [...this.cookies.values()]
      .filter((cookie) => {
        if (cookie.secure && url.protocol !== 'https:') return false;
        if (cookie.hostOnly ? url.hostname.toLowerCase() !== cookie.domain : !domainMatches(url.hostname, cookie.domain)) return false;
        return pathMatches(url.pathname, cookie.path);
      })
      .sort((left, right) => right.path.length - left.path.length || left.creationIndex - right.creationIndex);
    return matching.length > 0 ? matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') : undefined;
  }

  /**
   * 返回当前请求范围内 Cookie 的脱敏匹配片段，只供宿主在响应正文和错误摘要中擦除。
   * 不返回 Cookie 结构或会话键，避免把 Jar 变成可序列化的业务输出。
   */
  getRedactionValues(requestUrl: string, now = Date.now()): string[] {
    const header = this.getCookieHeader(requestUrl, now);
    if (!header) return [];
    return header.split('; ').flatMap((pair) => {
      const separator = pair.indexOf('=');
      return separator > 0 ? [pair, pair.slice(separator + 1)] : [pair];
    });
  }

  clear(): void {
    this.cookies.clear();
  }

  size(): number {
    return this.cookies.size;
  }

  private removeExpired(now: number): void {
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) this.cookies.delete(key);
    }
  }
}

export class CookieSessionStore {
  private readonly sessions = new Map<string, CookieJar>();

  getOrCreate(scope: CookieSessionScope): CookieJar {
    assertScope(scope);
    const key = cookieSessionKey(scope);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const jar = new CookieJar();
    this.sessions.set(key, jar);
    return jar;
  }

  get(scope: CookieSessionScope): CookieJar | undefined {
    assertScope(scope);
    return this.sessions.get(cookieSessionKey(scope));
  }

  clear(scope: Omit<CookieSessionScope, 'cookieSessionRef'>): void {
    if (!scope.tenantId || !scope.runId || !scope.workflowVersionId) return;
    const prefix = `${scope.tenantId}\u0000${scope.runId}\u0000${scope.workflowVersionId}\u0000`;
    for (const [key, jar] of this.sessions) {
      if (key.startsWith(prefix)) {
        jar.clear();
        this.sessions.delete(key);
      }
    }
  }

  clearAll(): void {
    for (const jar of this.sessions.values()) jar.clear();
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}

export function cookieSessionKey(scope: CookieSessionScope): string {
  assertScope(scope);
  return [scope.tenantId, scope.runId, scope.workflowVersionId, scope.cookieSessionRef].join('\u0000');
}

function assertScope(scope: CookieSessionScope | Omit<CookieSessionScope, 'cookieSessionRef'>): void {
  if (!scope.tenantId || !scope.runId || !scope.workflowVersionId) {
    throw new AppError('VALIDATION_FAILED', 'CookieSession 缺少租户、运行或工作流版本隔离上下文');
  }
  if ('cookieSessionRef' in scope && !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(scope.cookieSessionRef)) {
    throw new AppError('VALIDATION_FAILED', 'cookieSessionRef 格式无效');
  }
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError('VALIDATION_FAILED', 'CookieSession 只支持 HTTP/HTTPS URL');
  return url;
}

function cookieKey(name: string, domain: string, path: string): string {
  return `${name}\u0000${domain}\u0000${path}`;
}

function defaultCookiePath(pathname: string): string {
  if (!pathname || !pathname.startsWith('/')) return '/';
  const index = pathname.lastIndexOf('/');
  return index <= 0 ? '/' : pathname.slice(0, index);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const normalized = domain.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}

function isValidCookieName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
}
