import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';

export interface OnboardingTargetInput {
  accessDomain: string;
  verifyUrl: string;
}

/**
 * 统一向导的业务域名与证书验证地址必须脱离设备管理端点。
 * Citrix ADC 的站点监听地址可以是 VIP，但不能因此污染应用资产地址。
 */
export function validateOnboardingTargetInput(input: Partial<OnboardingTargetInput>): OnboardingTargetInput {
  const accessDomain = normalizeDomain(input.accessDomain);
  if (!accessDomain) {
    throw new AppError('VALIDATION_FAILED', '访问域名不能为空', { code: 'ONBOARDING_ACCESS_DOMAIN_REQUIRED' });
  }
  if (isIP(accessDomain)) {
    throw new AppError('VALIDATION_FAILED', '访问域名必须使用 DNS 域名，不能使用 IP 地址', {
      code: 'ONBOARDING_ACCESS_DOMAIN_IP_FORBIDDEN',
      accessDomain,
    });
  }
  if (!isDnsName(accessDomain)) {
    throw new AppError('VALIDATION_FAILED', '访问域名格式无效，请填写不带协议的 DNS 域名', {
      code: 'ONBOARDING_ACCESS_DOMAIN_INVALID',
      accessDomain,
    });
  }

  const verifyUrl = input.verifyUrl?.trim() ?? '';
  if (!verifyUrl) {
    throw new AppError('VALIDATION_FAILED', '验证 URL 不能为空', { code: 'ONBOARDING_VERIFY_URL_REQUIRED' });
  }
  let parsed: URL;
  try {
    parsed = new URL(verifyUrl);
  } catch {
    throw new AppError('VALIDATION_FAILED', '验证 URL 必须是有效的 HTTP 或 HTTPS 地址', {
      code: 'ONBOARDING_VERIFY_URL_INVALID',
      verifyUrl,
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError('VALIDATION_FAILED', '验证 URL 只能使用 HTTP 或 HTTPS 协议', {
      code: 'ONBOARDING_VERIFY_URL_INVALID',
      verifyUrl,
    });
  }
  const verifyHost = normalizeDomain(parsed.hostname);
  if (isIP(verifyHost) || !isDnsName(verifyHost)) {
    throw new AppError('VALIDATION_FAILED', '验证 URL 的主机名必须使用 DNS 域名，不能使用 IP 地址', {
      code: 'ONBOARDING_VERIFY_URL_IP_FORBIDDEN',
      verifyUrl,
    });
  }
  if (verifyHost !== accessDomain) {
    throw new AppError('VALIDATION_FAILED', '验证 URL 的主机名必须与访问域名一致', {
      code: 'ONBOARDING_VERIFY_URL_DOMAIN_MISMATCH',
      accessDomain,
      verifyHost,
    });
  }

  return { accessDomain, verifyUrl };
}

export function normalizeDomain(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

export function defaultOnboardingVerifyUrl(accessDomain: string, port?: number, protocol?: string): string {
  const scheme = String(protocol ?? 'HTTPS').toLowerCase() === 'http' ? 'http' : 'https';
  const resolvedPort = Number.isInteger(port) && Number(port) > 0 ? Number(port) : 443;
  return `${scheme}://${accessDomain.trim()}:${resolvedPort}`;
}

function isDnsName(value: string): boolean {
  if (!value || value.length > 253 || value.startsWith('.') || value.endsWith('.')) return false;
  const labels = value.split('.');
  return labels.length >= 2 && labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}
