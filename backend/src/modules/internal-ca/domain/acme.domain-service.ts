import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';
import { parseSecretRef } from '../../secrets/secret-ref.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import {
  acmeChallengeTypes,
  isAcmeChallengeType,
  type AcmeProviderConfiguration,
  type AcmeRenewalPolicyEntity,
} from '../schema/acme.schema.js';
import {
  getAcmeProviderProfile,
  normalizeProfileKey,
  normalizeVerificationLevel,
} from '../providers/acme-provider-profiles.js';

export class AcmeDomainService {
  validateProviderConfiguration(configuration: Record<string, unknown>): AcmeProviderConfiguration {
    const directoryUrl = text(configuration.directoryUrl);
    if (!directoryUrl || !isHttpsUrl(directoryUrl)) {
      throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Directory 必须使用 HTTPS URL');
    }
    if (configuration.verifyTls === false) {
      throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider 不允许关闭 TLS 证书校验');
    }
    const configuredChallenges = configuration.allowedChallenges;
    const allowedChallenges = configuredChallenges === undefined
      ? [...acmeChallengeTypes]
      : Array.isArray(configuredChallenges)
        ? [...new Set(configuredChallenges.filter(isAcmeChallengeType))]
        : [];
    if (allowedChallenges.length === 0) {
      throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider 至少需要一种 Challenge 类型');
    }
    const requestTimeoutMs = numberInRange(configuration.requestTimeoutMs, 1000, 120000, 15000);
    const profileKey = normalizeProfileKey(configuration.profileKey ?? configuration.preset);
    const verificationLevel = normalizeVerificationLevel(configuration.verificationLevel);
    const trustBundleSecretRef = text(configuration.trustBundleSecretRef);
    if (trustBundleSecretRef) assertSecretRef(trustBundleSecretRef, 'certificate_trust_bundle', 'ACME Trust Bundle');
    return {
      directoryUrl,
      allowedChallenges,
      requestTimeoutMs,
      verifyTls: configuration.verifyTls !== false,
      userAgent: text(configuration.userAgent) ?? 'GCAC ACME Client',
      termsOfServiceAgreed: configuration.termsOfServiceAgreed === true,
      termsOfServiceUrl: text(configuration.termsOfServiceUrl),
      preset: profileKey,
      profileKey,
      profileVersion: text(configuration.profileVersion) ?? (profileKey ? getAcmeProviderProfile(profileKey)?.version : undefined),
      isDefault: configuration.isDefault === true,
      isBuiltIn: configuration.isBuiltIn === true,
      verificationLevel: verificationLevel ?? 'unconfigured',
      verification: object(configuration.verification),
      trustBundleSecretRef,
    };
  }

  assertProvider(provider: CaProviderEntity): AcmeProviderConfiguration {
    if (provider.type !== 'acme') {
      throw new AppError('CA_CAPABILITY_UNSUPPORTED', '当前 Provider 不是 ACME Provider', { providerId: provider.id });
    }
    return this.validateProviderConfiguration(provider.configuration);
  }

  validateAccountSecretRefs(input: {
    accountKeySecretRef: string;
    eabSecretRef?: string;
    eabKeyIdSecretRef?: string;
    eabHmacSecretRef?: string;
  }): void {
    assertSecretRef(input.accountKeySecretRef, 'certificate_private_key', 'ACME Account Key');
    if (input.eabSecretRef) {
      assertSecretRef(input.eabSecretRef, 'acme_eab', 'EAB');
      if (input.eabKeyIdSecretRef || input.eabHmacSecretRef) {
        throw new AppError('ACME_ACCOUNT_INVALID', 'EAB 只能使用一个结构化 SecretRef，不能同时提交旧双字段');
      }
      return;
    }
    const hasEabKeyId = Boolean(text(input.eabKeyIdSecretRef));
    const hasEabHmac = Boolean(text(input.eabHmacSecretRef));
    if (hasEabKeyId !== hasEabHmac) {
      throw new AppError('ACME_ACCOUNT_INVALID', 'EAB 必须同时提供 Key ID 和 HMAC SecretRef');
    }
    if (input.eabKeyIdSecretRef) assertSecretRef(input.eabKeyIdSecretRef, undefined, 'EAB Key ID');
    if (input.eabHmacSecretRef) assertSecretRef(input.eabHmacSecretRef, undefined, 'EAB HMAC');
  }

  normalizeContacts(contacts: string[] | undefined): string[] {
    const values = [...new Set((contacts ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (values.length > 10) throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 联系地址不能超过 10 个');
    for (const value of values) {
      if (!/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) {
        throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 联系地址必须是 mailto URL', { contact: value });
      }
    }
    return values;
  }

  normalizeIdentifiers(values: Array<{ type: 'dns' | 'ip'; value: string }>): Array<{ type: 'dns' | 'ip'; value: string }> {
    if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
      throw new AppError('VALIDATION_FAILED', 'ACME Order 至少需要一个且不能超过 100 个标识');
    }
    const identifiers = values.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new AppError('VALIDATION_FAILED', 'ACME 标识必须是对象');
      }
      const type = item.type;
      const value = typeof item.value === 'string' ? item.value.trim().toLowerCase() : '';
      if (type === 'dns') {
        if (!isDnsName(value) || value.length > 253) throw new AppError('VALIDATION_FAILED', 'ACME DNS 标识无效', { value });
      } else if (type === 'ip') {
        if (!isIp(value)) throw new AppError('VALIDATION_FAILED', 'ACME IP 标识无效', { value });
      } else {
        throw new AppError('VALIDATION_FAILED', 'ACME 仅支持 DNS 和 IP 标识');
      }
      return { type, value };
    });
    return [...new Map(identifiers.map((item) => [`${item.type}:${item.value}`, item])).values()];
  }

  assertChallengeAllowed(configuration: AcmeProviderConfiguration, challengeType: string): asserts challengeType is AcmeProviderConfiguration['allowedChallenges'][number] {
    if (!isAcmeChallengeType(challengeType) || !configuration.allowedChallenges.includes(challengeType)) {
      throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'ACME Provider 不支持所选 Challenge 类型', { challengeType });
    }
  }

  validateRenewalPolicy(policy: Pick<AcmeRenewalPolicyEntity, 'certificateAssetId' | 'bindingId' | 'renewalWindowDays' | 'maxAttempts' | 'backoffSeconds' | 'challengeType' | 'deploymentMode'>): void {
    if (!policy.certificateAssetId && !policy.bindingId) {
      throw new AppError('VALIDATION_FAILED', '续签策略至少需要绑定证书资产或证书绑定');
    }
    if (policy.renewalWindowDays < 1 || policy.renewalWindowDays > 90) {
      throw new AppError('VALIDATION_FAILED', '续签窗口必须在 1 到 90 天之间');
    }
    if (policy.maxAttempts < 1 || policy.maxAttempts > 20) {
      throw new AppError('VALIDATION_FAILED', '续签最大尝试次数必须在 1 到 20 次之间');
    }
    if (policy.backoffSeconds < 10 || policy.backoffSeconds > 86_400) {
      throw new AppError('VALIDATION_FAILED', '续签退避时间必须在 10 秒到 24 小时之间');
    }
    if (!isAcmeChallengeType(policy.challengeType)) throw new AppError('VALIDATION_FAILED', 'Challenge 类型无效');
    if (!['manual', 'approval', 'automatic'].includes(policy.deploymentMode)) throw new AppError('VALIDATION_FAILED', '部署模式无效');
  }

  directoryUrlHash(directoryUrl: string): string {
    return createHash('sha256').update(directoryUrl.trim().toLowerCase()).digest('hex');
  }
}

function assertSecretRef(value: string, expectedType: 'certificate_private_key' | 'certificate_trust_bundle' | 'acme_eab' | undefined, label: string): void {
  if (!text(value)) throw new AppError('ACME_SECRET_RESOLVE_DENIED', `${label}必须使用 SecretRef`);
  try {
    const parsed = parseSecretRef(value);
    if (expectedType && parsed.type !== expectedType) {
      throw new AppError('ACME_SECRET_RESOLVE_DENIED', `${label} SecretRef 类型不匹配`, { expectedType, actualType: parsed.type });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('ACME_SECRET_RESOLVE_DENIED', `${label} SecretRef 无效`);
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider 数值配置超出范围');
  }
  return parsed;
}

function isDnsName(value: string): boolean {
  if (value.startsWith('*.')) value = value.slice(2);
  return value.length > 0
    && !value.startsWith('.')
    && !value.endsWith('.')
    && value.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}

function isIp(value: string): boolean {
  return isIP(value) !== 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
