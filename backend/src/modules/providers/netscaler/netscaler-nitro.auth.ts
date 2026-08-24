import type { NetscalerAuthMode } from './netscaler.types.js';

export interface NetscalerCredentials {
  username: string;
  password: string;
}

export interface NetscalerCredentialResolverContext {
  tenantId?: string;
  actorId?: string;
  purpose: string;
}

export interface NetscalerCredentialResolver {
  resolveCredentials(credentialId: string, context: NetscalerCredentialResolverContext): Promise<NetscalerCredentials>;
}

export interface NetscalerAuthCapabilities {
  session: boolean;
  perRequestHeaders: boolean;
}

export type NetscalerResolvedAuthMode = Exclude<NetscalerAuthMode, 'AUTO'>;

export function resolveNetscalerAuthMode(mode: NetscalerAuthMode, capabilities: NetscalerAuthCapabilities): NetscalerResolvedAuthMode {
  if (mode === 'SESSION') {
    if (!capabilities.session) throw new Error('当前设备能力不支持 Session 认证');
    return mode;
  }
  if (mode === 'PER_REQUEST') {
    if (!capabilities.perRequestHeaders) throw new Error('当前设备能力不支持逐请求认证');
    return mode;
  }
  if (capabilities.session) return 'SESSION';
  if (capabilities.perRequestHeaders) return 'PER_REQUEST';
  throw new Error('当前设备没有可用的 NITRO 认证模式');
}

export function perRequestAuthHeaders(credentials: NetscalerCredentials): Record<string, string> {
  return {
    'X-NITRO-USER': credentials.username,
    'X-NITRO-PASS': credentials.password,
  };
}

export function sessionCookie(token: string): string {
  return `NITRO_AUTH_TOKEN=${token}`;
}

export function extractNitroSessionToken(headers: Record<string, string> | undefined): string | undefined {
  const setCookie = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1];
  return setCookie?.match(/(?:^|[,;]\s*)NITRO_AUTH_TOKEN=([^;,\s]+)/i)?.[1];
}

export function authRedactionValues(credentials: NetscalerCredentials, token?: string): string[] {
  return [credentials.username, credentials.password, token].filter((value): value is string => Boolean(value));
}
