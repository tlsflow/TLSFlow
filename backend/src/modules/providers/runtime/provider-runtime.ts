import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import type { CloudAccountAsset, ProviderScope } from '../dto/providers.dto.js';

export interface ProviderHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ProviderHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json?: unknown;
}

export interface ProviderTransport {
  request(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

export class FetchProviderTransport implements ProviderTransport {
  async request(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const body = await response.text();
      let json: unknown;
      try {
        json = body ? JSON.parse(body) : undefined;
      } catch {
        json = undefined;
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        json,
      };
    } catch (cause) {
      throw new AppError('PROVIDER_CONNECTION_FAILED', 'Provider 请求失败', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface ProviderCredentialResolver {
  resolve(asset: CloudAccountAsset): Promise<Record<string, string>>;
}

export interface ProviderCertificateMaterialResolver {
  resolve(reference: string, tenantId: string): Promise<Record<string, string>>;
}

/**
 * 从 SecretRef 读取证书材料。任务和资产只保存引用，证书内容只在 Provider 执行调用栈中短暂存在。
 */
export class SecretProviderCertificateMaterialResolver implements ProviderCertificateMaterialResolver {
  constructor(private readonly secrets: SecretService) {}

  async resolve(reference: string, tenantId: string): Promise<Record<string, string>> {
    if (!reference.startsWith('secret://')) {
      throw new AppError('SECRET_REF_INVALID', '证书材料引用必须使用 SecretRef', { certificateRef: reference });
    }
    const resolved = await this.secrets.resolveForService({
      secretRef: reference,
      tenantId,
      purpose: 'secret.provider_operation',
      actorId: 'provider-extension',
    });
    return parseCredentialPayload(resolved.plainText);
  }
}

/**
 * 将 CredentialProfile 作为 Provider 的凭据来源。
 * CredentialProfile 只保存 SecretRef；这里在运行时逐个解析 SecretRef，绝不把明文写回资产、日志或结果。
 */
export class CredentialProfileProviderCredentialResolver implements ProviderCredentialResolver {
  constructor(
    private readonly credentials: CredentialsRepository,
    private readonly secrets: SecretService,
  ) {}

  async resolve(asset: CloudAccountAsset): Promise<Record<string, string>> {
    const profileId = asset.credentialRef.slice('credential://'.length).split('#', 1)[0]?.trim();
    if (!profileId) throw new AppError('SECRET_REF_INVALID', 'CredentialRef 缺少 CredentialProfile ID');
    const profile = await this.credentials.get(asset.tenantId, profileId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId: profileId });
    if (profile.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', 'CredentialProfile 当前不可用于 Provider 执行', {
        credentialId: profileId,
        status: profile.status,
      });
    }
    if (profile.kind !== 'CLOUD_PROVIDER') {
      throw new AppError('VALIDATION_FAILED', '云账号必须引用 CLOUD_PROVIDER 类型凭据', {
        credentialId: profileId,
        credentialKind: profile.kind,
      });
    }
    if (profile.metadata.providerKey !== asset.providerKey) {
      throw new AppError('VALIDATION_FAILED', '云账号与凭据的 Provider 不匹配', {
        credentialId: profileId,
        assetProviderKey: asset.providerKey,
        credentialProviderKey: profile.metadata.providerKey,
      });
    }
    const resolved: Record<string, string> = {};
    for (const [slot, secretRef] of Object.entries(profile.secretSlots)) {
      const secret = await this.secrets.resolveForService({
        secretRef,
        tenantId: asset.tenantId,
        purpose: 'secret.provider_operation',
        actorId: 'provider-extension',
      });
      resolved[slot] = secret.plainText;
    }
    return resolved;
  }
}

export function parseCredentialPayload(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) throw new AppError('SECRET_REF_INVALID', 'Provider 凭据为空');
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(([, item]) => typeof item === 'string')
          .map(([key, item]) => [key, item as string]),
      );
    }
  } catch {
    // 兼容 key=value 格式，便于迁移已有凭据。
  }
  const result: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  if (Object.keys(result).length === 0) {
    throw new AppError('SECRET_REF_INVALID', 'Provider 凭据必须是 JSON 或 key=value 格式');
  }
  return result;
}

export function scopeEndpoint(scope: ProviderScope, fallback: string): string {
  return (scope.endpoint?.trim() || fallback).replace(/\/+$/, '');
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function parseJsonResponse(response: ProviderHttpResponse): Record<string, unknown> {
  if (isRecord(response.json)) return response.json;
  try {
    const parsed = JSON.parse(response.body) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function assertProviderResponse(response: ProviderHttpResponse, providerKey: string): Record<string, unknown> {
  const payload = parseJsonResponse(response);
  if (response.status < 200 || response.status >= 300) {
    throw new AppError('PROVIDER_REQUEST_FAILED', 'Provider API 返回失败', {
      providerKey,
      status: response.status,
      code: stringValue(payload.code) ?? stringValue(payload.Code) ?? 'HTTP_ERROR',
      message: stringValue(payload.message) ?? stringValue(payload.Message),
    });
  }
  return payload;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
