import { Buffer } from 'node:buffer';
import { createHash, X509Certificate } from 'node:crypto';
import type { NetscalerNitroClient } from './netscaler-nitro.client.js';
import type { NetscalerCertificateResource } from './netscaler.types.js';

export function normalizeNetscalerCertificates(value: unknown, sourceVersion: string): NetscalerCertificateResource[] {
  return asArray(value).flatMap((item) => {
    const row = asRecord(item);
    const certKeyName = text(row.certkey) ?? text(row.certkeyname);
    if (!certKeyName) return [];
    return [{
      certKeyName,
      certificatePath: text(row.cert),
      privateKeyPath: text(row.key),
      subject: text(row.subject),
      issuer: text(row.issuer),
      serialNumber: text(row.serial),
      notBefore: text(row.clientcertnotbefore) ?? text(row.notbefore),
      notAfter: text(row.clientcertnotafter) ?? text(row.notafter),
      status: text(row.status),
      signatureAlgorithm: text(row.signaturealg),
      publicKeyAlgorithm: text(row.publickeyalg),
      publicKeySize: number(row.publickeysize),
      linkedCertKeyName: text(row.linkcertkeyname),
      sourceVersion,
      rawFieldSummary: safeSummary(row),
    }];
  });
}

export async function enrichNetscalerCertificateFingerprints(
  client: NetscalerNitroClient,
  certificates: NetscalerCertificateResource[],
  warnings: string[],
): Promise<NetscalerCertificateResource[]> {
  const enriched: NetscalerCertificateResource[] = [];
  for (const certificate of certificates) {
    enriched.push(await enrichCertificateFingerprint(client, certificate, warnings));
  }
  return enriched;
}

async function enrichCertificateFingerprint(
  client: NetscalerNitroClient,
  certificate: NetscalerCertificateResource,
  warnings: string[],
): Promise<NetscalerCertificateResource> {
  const file = splitCertificatePath(certificate.certificatePath);
  if (!file) return certificate;
  if (isPkcs12(certificate)) {
    warnings.push(`sslcertkey:${certificate.certKeyName}:UNSUPPORTED_CERTIFICATE_FORMAT`);
    return certificate;
  }
  try {
    const response = await client.request({
      path: '/nitro/v1/config/systemfile',
      nitroArgs: { filename: file.filename, filelocation: file.filelocation },
    });
    const row = firstRecord(response.systemfile);
    const fileContent = text(row.filecontent);
    if (!fileContent) throw new Error('CERTIFICATE_FILE_CONTENT_MISSING');
    const x509 = new X509Certificate(Buffer.from(fileContent.replace(/\s/g, ''), 'base64'));
    return {
      ...certificate,
      fingerprintSha256: createHash('sha256').update(x509.raw).digest('hex'),
    };
  } catch (error) {
    warnings.push(`sslcertkey:${certificate.certKeyName}:${warningCode(error)}`);
    return certificate;
  }
}

function splitCertificatePath(value: string | undefined): { filename: string; filelocation: string } | undefined {
  const path = value?.trim().replaceAll('\\', '/');
  if (!path) return undefined;
  const separator = path.lastIndexOf('/');
  const filename = separator >= 0 ? path.slice(separator + 1) : path;
  if (!filename) return undefined;
  const location = separator > 0 ? path.slice(0, separator) : separator === 0 ? '/' : '/nsconfig/ssl';
  return {
    filename,
    filelocation: location.startsWith('/') ? location : `/${location}`,
  };
}

function isPkcs12(certificate: NetscalerCertificateResource): boolean {
  const format = text(certificate.rawFieldSummary.inform)?.toUpperCase();
  return format === 'PFX' || format === 'PKCS12' || /\.(pfx|p12)$/i.test(certificate.certificatePath ?? '');
}

function warningCode(error: unknown): string {
  return error instanceof Error && error.message === 'CERTIFICATE_FILE_CONTENT_MISSING'
    ? error.message
    : 'CERTIFICATE_FILE_READ_FAILED';
}

function safeSummary(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/(password|passphrase|privatekey|keytext)/i.test(key)));
}

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function firstRecord(value: unknown): Record<string, unknown> { return asRecord(Array.isArray(value) ? value[0] : value); }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
