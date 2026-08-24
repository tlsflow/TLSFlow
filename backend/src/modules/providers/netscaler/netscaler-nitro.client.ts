import { Buffer } from 'node:buffer';
import { NodeCurlHttpClient, type CurlHttpClient, type CurlHttpClientRequest } from '../../executors/curl/curl.http-client.js';
import {
  authRedactionValues,
  extractNitroSessionToken,
  perRequestAuthHeaders,
  resolveNetscalerAuthMode,
  sessionCookie,
  type NetscalerAuthCapabilities,
  type NetscalerCredentialResolver,
  type NetscalerCredentials,
  type NetscalerResolvedAuthMode,
} from './netscaler-nitro.auth.js';
import { assertNitroSuccess, NetscalerNitroError, normalizeNitroTransportError } from './netscaler-nitro.errors.js';
import type { NetscalerAuthMode } from './netscaler.types.js';

export interface NetscalerNitroClientOptions {
  managementAddress: string;
  managementPort?: number;
  credentialId: string;
  authMode: NetscalerAuthMode;
  authCapabilities?: NetscalerAuthCapabilities;
  tls?: { verify: boolean; ca?: string; servername?: string };
  timeoutMs?: number;
  maxResponseBytes?: number;
  credentialResolver: NetscalerCredentialResolver;
  httpClient?: CurlHttpClient;
  context?: { tenantId?: string; actorId?: string };
}

export interface NetscalerNitroRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export class NetscalerNitroClient {
  private readonly httpClient: CurlHttpClient;
  private credentials?: NetscalerCredentials;
  private resolvedAuthMode?: NetscalerResolvedAuthMode;
  private sessionToken?: string;

  constructor(private readonly options: NetscalerNitroClientOptions) {
    this.httpClient = options.httpClient ?? new NodeCurlHttpClient();
  }

  async request(input: NetscalerNitroRequest): Promise<Record<string, unknown>> {
    const credentials = await this.getCredentials();
    const mode = this.resolvedAuthMode ?? resolveNetscalerAuthMode(this.options.authMode, this.options.authCapabilities ?? { session: true, perRequestHeaders: true });
    this.resolvedAuthMode = mode;
    if (mode === 'SESSION' && !this.sessionToken) await this.login(credentials);

    const headers = mode === 'SESSION'
      ? { Cookie: sessionCookie(this.requiredSessionToken()) }
      : perRequestAuthHeaders(credentials);
    return this.send(input, headers, authRedactionValues(credentials, this.sessionToken));
  }

  async close(): Promise<void> {
    if (!this.sessionToken || !this.credentials) return;
    const token = this.sessionToken;
    this.sessionToken = undefined;
    try {
      await this.send({ method: 'POST', path: '/nitro/v1/config/logout', body: { logout: {} } }, { Cookie: sessionCookie(token) }, authRedactionValues(this.credentials, token));
    } catch {
      // 注销失败不能覆盖主业务请求结果，设备会自行回收 Session。
    }
  }

  private async login(credentials: NetscalerCredentials): Promise<void> {
    const response = await this.sendRaw({
      method: 'POST',
      path: '/nitro/v1/config/login',
      body: { login: { username: credentials.username, password: credentials.password } },
    }, {}, authRedactionValues(credentials));
    assertNitroSuccess(response, authRedactionValues(credentials));
    const token = extractNitroSessionToken(response.headers);
    if (!token) throw new NetscalerNitroError('NETSCALER_AUTH_FAILED', 'NITRO 登录成功但未返回 Session Token');
    this.sessionToken = token;
  }

  private async send(input: NetscalerNitroRequest, authHeaders: Record<string, string>, redactionValues: string[]): Promise<Record<string, unknown>> {
    const response = await this.sendRaw(input, authHeaders, redactionValues);
    return assertNitroSuccess(response, redactionValues);
  }

  private async sendRaw(input: NetscalerNitroRequest, authHeaders: Record<string, string>, redactionValues: string[]) {
    try {
      const body = input.body ? Buffer.from(JSON.stringify(input.body), 'utf8') : undefined;
      const request: CurlHttpClientRequest = {
        url: this.buildUrl(input.path, input.query),
        method: input.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) } : {}),
          ...authHeaders,
        },
        body,
        timeoutMs: this.options.timeoutMs ?? 15_000,
        tls: this.options.tls,
      };
      const response = await this.httpClient.send(request);
      const responseBytes = Buffer.byteLength(response.bodyText ?? '', 'utf8');
      if (responseBytes > (this.options.maxResponseBytes ?? 4 * 1024 * 1024)) {
        throw new NetscalerNitroError('NETSCALER_RESPONSE_INVALID', 'NITRO 响应超过允许大小', { responseBytes });
      }
      return response;
    } catch (error) {
      throw normalizeNitroTransportError(error, redactionValues);
    }
  }

  private async getCredentials(): Promise<NetscalerCredentials> {
    if (this.credentials) return this.credentials;
    const credentials = await this.options.credentialResolver.resolveCredentials(this.options.credentialId, {
      tenantId: this.options.context?.tenantId,
      actorId: this.options.context?.actorId,
      purpose: 'netscaler.nitro.authenticate',
    });
    if (!credentials.username || !credentials.password) throw new NetscalerNitroError('NETSCALER_AUTH_FAILED', 'NITRO 凭据缺少用户名或密码');
    this.credentials = credentials;
    return credentials;
  }

  private requiredSessionToken(): string {
    if (!this.sessionToken) throw new NetscalerNitroError('NETSCALER_AUTH_FAILED', 'NITRO Session 尚未建立');
    return this.sessionToken;
  }

  private buildUrl(path: string, query: NetscalerNitroRequest['query']): string {
    if (!path.startsWith('/nitro/')) throw new NetscalerNitroError('NETSCALER_RESPONSE_INVALID', 'NITRO 请求路径非法');
    const host = this.options.managementAddress.includes(':') && !this.options.managementAddress.startsWith('[')
      ? `[${this.options.managementAddress}]`
      : this.options.managementAddress;
    const url = new URL(`https://${host}:${this.options.managementPort ?? 443}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
