import { createHash, X509Certificate } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { URL } from 'node:url';

export type TlsVerifyTarget = {
  host: string;
  port: number;
  serverName: string;
  target: string;
};

export type TlsVerifyReport = Record<string, unknown> & {
  remoteCertificateSha256: string;
  remoteThumbprint: string;
  matchesDomainNames: string[];
  dnsNames: string[];
  commonName?: string;
};

export type TlsVerificationEvaluation = {
  success: boolean;
  warning?: boolean;
  changeRequired?: boolean;
  matched: boolean;
  domainMismatches: string[];
  errorCode?: string;
  errorMessage?: string;
};

export function evaluateTlsVerification(
  report: TlsVerifyReport,
  expectedFingerprint: string | undefined,
  expectedDomains: string[],
  dryRun: boolean,
): TlsVerificationEvaluation {
  if (!expectedFingerprint) {
    return {
      success: false,
      matched: false,
      domainMismatches: [],
      errorCode: 'CERT_VERIFY_EXPECTED_FINGERPRINT_MISSING',
      errorMessage: '宿主证书验证缺少目标证书 SHA256 指纹',
    };
  }

  const actualFingerprint = normalizeCertificateFingerprint(report.remoteCertificateSha256);
  const matched = actualFingerprint === expectedFingerprint;
  const domainMismatches = expectedDomains
    .map((domain) => domain.trim())
    .filter((domain) => domain && !certificateMatchesDomain(report, domain));
  if (dryRun) {
    return {
      success: true,
      warning: !matched || domainMismatches.length > 0,
      changeRequired: !matched,
      matched,
      domainMismatches,
    };
  }
  if (!matched) {
    return {
      success: false,
      matched,
      domainMismatches,
      errorCode: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      errorMessage: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
    };
  }
  if (domainMismatches.length > 0) {
    return {
      success: false,
      matched,
      domainMismatches,
      errorCode: 'TLS_VERIFY_DOMAIN_MISMATCH',
      errorMessage: `控制面 VERIFY 发现远端 TLS 证书域名不匹配: ${domainMismatches[0]}`,
    };
  }
  return { success: true, matched, domainMismatches };
}

export function buildTlsVerifyTargetFromUrl(verifyUrl: string): TlsVerifyTarget {
  const parsed = new URL(verifyUrl);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!parsed.hostname || !port) {
    throw new Error(`verifyUrl 无法解析为有效 TLS 目标: ${verifyUrl}`);
  }
  return {
    host: parsed.hostname,
    port,
    serverName: parsed.hostname,
    target: verifyUrl,
  };
}

export async function probeTlsCertificate(target: TlsVerifyTarget): Promise<TlsVerifyReport> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: target.host,
      port: target.port,
      servername: target.serverName,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      timeout: 15_000,
    });

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.once('timeout', () => {
      cleanup();
      reject(new Error(`TLS 连接超时: ${target.host}:${target.port}`));
    });

    socket.once('error', (error) => {
      cleanup();
      reject(new Error(`TLS 连接失败: ${error.message}`));
    });

    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerX509Certificate();
        if (!peer) {
          cleanup();
          reject(new Error('TLS 握手成功但未返回远端证书'));
          return;
        }
        const raw = peer.raw;
        const thumbprint = createHash('sha1').update(raw).digest('hex').toUpperCase();
        const certificateSha256 = createHash('sha256').update(raw).digest('hex').toLowerCase();
        const x509 = new X509Certificate(raw);
        const dnsNames = extractDnsNames(x509.subjectAltName ?? '');
        const commonName = readCertificateCommonName(peer.subject);
        const subject = peer.subject ? Object.entries(peer.subject).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '';
        const issuer = peer.issuer ? Object.entries(peer.issuer).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '';
        cleanup();
        resolve({
          target: target.target,
          address: `${target.host}:${target.port}`,
          serverName: target.serverName,
          remoteThumbprint: thumbprint,
          remoteCertificateSha256: certificateSha256,
          subject,
          issuer,
          notAfter: peer.validTo ? new Date(peer.validTo).toISOString() : undefined,
          dnsNames,
          commonName,
          matchesDomainNames: [...new Set([...dnsNames, commonName].filter((item): item is string => Boolean(item)).map((item) => item.toLowerCase()))],
          verifiedAt: new Date().toISOString(),
        });
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function certificateMatchesDomain(report: Record<string, unknown>, domain: string): boolean {
  const normalizedDomain = normalizeDomainName(domain);
  if (!normalizedDomain) return false;
  const names = [
    ...readStringArray(report.dnsNames),
    readOptionalString(report.commonName),
    ...readStringArray(report.matchesDomainNames),
  ].filter((item): item is string => Boolean(item));
  return names.some((name) => certificateNameMatchesDomain(name, normalizedDomain));
}

function extractDnsNames(subjectAltName: string): string[] {
  return subjectAltName
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.startsWith('DNS:'))
    .map((item) => item.slice(4).trim())
    .filter(Boolean);
}

function certificateNameMatchesDomain(pattern: string, domain: string): boolean {
  const normalizedPattern = normalizeDomainName(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern === domain) return true;
  if (!normalizedPattern.startsWith('*.')) return false;
  const suffix = normalizedPattern.slice(1);
  if (!domain.endsWith(suffix)) return false;
  const wildcardLabel = domain.slice(0, -suffix.length);
  return wildcardLabel.length > 0 && !wildcardLabel.includes('.');
}

function normalizeDomainName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, '');
  return normalized || undefined;
}

function normalizeCertificateFingerprint(value: string | undefined): string | undefined {
  const normalized = value?.replace(/:/g, '').trim().toLowerCase();
  return normalized || undefined;
}

function readCertificateCommonName(subject: unknown): string | undefined {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) return undefined;
  const value = (subject as Record<string, unknown>).CN;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}
