import type { CurlHttpClientResponse } from '../../executors/curl/curl.http-client.js';
import type { NetscalerErrorCode } from './netscaler.types.js';

export class NetscalerNitroError extends Error {
  constructor(
    readonly code: NetscalerErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'NetscalerNitroError';
  }
}

export function assertNitroSuccess(response: CurlHttpClientResponse, redactionValues: string[]): Record<string, unknown> {
  const body = asRecord(response.bodyJson);
  const errorCode = numericValue(body?.errorcode);
  if (response.statusCode >= 200 && response.statusCode < 300 && (errorCode === undefined || errorCode === 0)) {
    if (!body) throw new NetscalerNitroError('NETSCALER_RESPONSE_INVALID', 'NITRO 响应不是 JSON 对象');
    return body;
  }

  const message = sanitizedText(stringValue(body?.message) ?? response.bodyText ?? `HTTP ${response.statusCode}`, redactionValues);
  throw new NetscalerNitroError(mapNitroError(response.statusCode, errorCode, message), message, {
    statusCode: response.statusCode,
    nitroErrorCode: errorCode,
    severity: sanitizedText(stringValue(body?.severity) ?? '', redactionValues),
  });
}

export function normalizeNitroTransportError(error: unknown, redactionValues: string[]): NetscalerNitroError {
  if (error instanceof NetscalerNitroError) return error;
  const message = sanitizedText(error instanceof Error ? error.message : String(error), redactionValues);
  const lower = message.toLowerCase();
  if (lower.includes('certificate') || lower.includes('self signed') || lower.includes('unable to verify')) {
    return new NetscalerNitroError('NETSCALER_TLS_UNTRUSTED', message);
  }
  return new NetscalerNitroError('NETSCALER_UNREACHABLE', message);
}

export function sanitizedText(value: string, redactionValues: string[]): string {
  let result = value;
  for (const secret of redactionValues) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result
    .replace(/(X-NITRO-(?:USER|PASS)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(NITRO_AUTH_TOKEN=)[^;,\s]+/gi, '$1[REDACTED]');
}

function mapNitroError(statusCode: number, errorCode: number | undefined, message: string): NetscalerErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('mfa') || lower.includes('multi-factor') || lower.includes('two-factor')) return 'NETSCALER_MFA_REQUIRED';
  if (statusCode === 401 || lower.includes('invalid username') || lower.includes('invalid password') || lower.includes('authentication')) return 'NETSCALER_AUTH_FAILED';
  if (statusCode === 403 || lower.includes('permission') || lower.includes('not authorized')) return 'NETSCALER_PERMISSION_DENIED';
  if (statusCode === 404 || errorCode === 258) return 'NETSCALER_RESOURCE_NOT_FOUND';
  return 'NETSCALER_RESPONSE_INVALID';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
