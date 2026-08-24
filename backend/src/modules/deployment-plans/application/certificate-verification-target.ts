import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';

export interface CertificateVerificationTargetInput {
  applicationAsset: Pick<ServiceAssetDto, 'id' | 'address' | 'sniName' | 'port' | 'verifyUrl'>;
  managedTargetContext?: Pick<ResolvedManagedTargetContext, 'host' | 'siteAsset' | 'managedTarget'>;
  sourceLabel: string;
}

export function buildCertificateVerificationTarget(input: CertificateVerificationTargetInput): Record<string, unknown> {
  const verifyUrl = normalizeVerifyUrl(input.applicationAsset.verifyUrl);
  const endpoint = verifyUrl ? parseVerifyUrl(verifyUrl) : undefined;
  const connectHost = endpoint?.host ?? usableEndpointHost(input.applicationAsset.address) ?? usableEndpointHost(input.managedTargetContext?.host.primaryIp);
  const serverName = nonEmptyString(input.applicationAsset.sniName) ?? endpoint?.serverName ?? nonEmptyString(input.applicationAsset.address);
  const port = endpoint?.port ?? input.applicationAsset.port;
  if (!connectHost || !serverName || !port) {
    throw new AppError('VALIDATION_FAILED', '部署 Runtime 缺少证书验证目标', {
      applicationAssetId: input.applicationAsset.id,
      managedTargetId: input.managedTargetContext?.managedTarget.id,
      verifyUrl,
      connectHost,
      serverName,
      port,
    });
  }
  return {
    capabilityKey: 'certificate.verify',
    schemaVersion: '1.0',
    connectHost,
    serverName,
    port,
    expectedDomains: [serverName],
    ...(verifyUrl ? { verifyUrl } : {}),
    source: verifyUrl ? 'APPLICATION_VERIFY_URL' : input.managedTargetContext ? input.sourceLabel : 'APPLICATION_ASSET',
  };
}

function normalizeVerifyUrl(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  return text;
}

function parseVerifyUrl(verifyUrl: string): { host: string; port: number; serverName: string } {
  try {
    const parsed = new URL(verifyUrl);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : undefined;
    if (!parsed.hostname || !port) throw new Error('invalid url');
    return {
      host: parsed.hostname,
      port,
      serverName: parsed.hostname,
    };
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', '应用资产 verifyUrl 无法解析为有效证书验证目标', {
      verifyUrl,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function usableEndpointHost(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text || text === '*' || text === '0.0.0.0' || text === '::') return undefined;
  return text;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
