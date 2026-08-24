import type { DatabasePort } from '../../../database/database-port.js';

/** 证书发现结果中可用于关联项目证书版本的公开身份字段。 */
export interface DiscoveredCertificateIdentity {
  fingerprintSha256?: string | null;
  subject?: string | null;
  issuer?: string | null;
  notBefore?: string | null;
  notAfter?: string | null;
}

/**
 * 先按 SHA-256 指纹精确关联；设备 API 不提供指纹时，要求主题 CN、颁发者 CN、
 * 起始时间和截止时间全部命中且只有一个项目证书版本，避免同名证书被错误合并。
 */
export async function resolveCertificateVersionId(
  db: DatabasePort,
  tenantId: string,
  certificate: DiscoveredCertificateIdentity,
): Promise<string | undefined> {
  const fingerprint = normalizeFingerprint(certificate.fingerprintSha256);
  if (fingerprint) {
    const byFingerprint = await db.query<{ id: string }>(
      `select id
         from pg_certificate_versions
        where (tenant_id=$1 or tenant_id is null)
          and upper(regexp_replace(fingerprint_sha256, '[^A-Fa-f0-9]', '', 'g'))=$2
        limit 1`,
      [tenantId, fingerprint],
    );
    if (byFingerprint.rows[0]?.id) return byFingerprint.rows[0].id;
  }

  const subject = certificateName(certificate.subject);
  const issuer = certificateName(certificate.issuer);
  const notBefore = normalizeTimestamp(certificate.notBefore);
  const notAfter = normalizeTimestamp(certificate.notAfter);
  if (!subject || !issuer || !notBefore || !notAfter) return undefined;

  const byIdentity = await db.query<{ id: string }>(
    `select id
       from pg_certificate_versions
      where (tenant_id=$1 or tenant_id is null)
        and lower(common_name)=lower($2)
        and lower(coalesce(subject->>'commonName', subject->>'common_name', subject->>'CN', ''))=lower($2)
        and lower(coalesce(issuer->>'commonName', issuer->>'common_name', issuer->>'CN', ''))=lower($3)
        and not_before=$4::timestamptz
        and not_after=$5::timestamptz
      limit 2`,
    [tenantId, subject, issuer, notBefore, notAfter],
  );
  return byIdentity.rows.length === 1 ? byIdentity.rows[0]?.id : undefined;
}

export function normalizeFingerprint(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  return normalized?.length === 64 ? normalized : undefined;
}

function certificateName(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const match = /(?:^|,)\s*CN=([^,]+)/i.exec(value);
  return (match?.[1] ?? value).trim();
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}
