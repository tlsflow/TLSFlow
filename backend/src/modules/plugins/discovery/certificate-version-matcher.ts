import type { DatabasePort } from '../../../database/database-port.js';

/** 证书发现结果中可用于关联项目证书版本的公开身份字段。 */
export interface DiscoveredCertificateIdentity {
  domainName?: string | null;
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

  // 部分云厂商的域名接口只返回 CertId/CertName，不返回证书指纹。
  // 仅当主域名或 SAN 在项目证书库中唯一命中时才回退关联，多个版本一律不猜。
  const domainName = certificate.domainName?.trim().toLowerCase();
  if (domainName) {
    const byDomain = await db.query<{ id: string }>(
      `select version.id
         from pg_certificate_versions version
         join pg_certificate_assets asset on asset.id=version.certificate_asset_id
        where (version.tenant_id=$1 or version.tenant_id is null)
          and version.status='active'
          and (lower(coalesce(version.common_name, ''))=$2
            or lower(asset.primary_domain)=$2
            or exists (select 1 from jsonb_array_elements_text(coalesce(asset.sans, '[]'::jsonb)) san where lower(san)=$2))
        order by version.created_at desc, version.id
        limit 2`,
      [tenantId, domainName],
    );
    if (byDomain.rows.length === 1 && byDomain.rows[0]?.id) return byDomain.rows[0].id;
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
  if (byIdentity.rows.length === 1) return byIdentity.rows[0]?.id;

  // 阿里云 CDN 证书接口常只返回证书域名和有效期；在主题/颁发者格式不完整时，
  // 仍可用主题 CN 加完整有效期唯一锁定版本，多个结果继续保持未纳管。
  if (notBefore && notAfter) {
    const byValidity = await db.query<{ id: string }>(
      `select id
         from pg_certificate_versions
        where (tenant_id=$1 or tenant_id is null)
          and lower(common_name)=lower($2)
          and not_before=$3::timestamptz
          and not_after=$4::timestamptz
        limit 2`,
      [tenantId, subject, notBefore, notAfter],
    );
    return byValidity.rows.length === 1 ? byValidity.rows[0]?.id : undefined;
  }
  return undefined;
}

export function normalizeFingerprint(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/^sha256:/i, '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
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
