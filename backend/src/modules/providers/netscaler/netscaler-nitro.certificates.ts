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

function safeSummary(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/(password|passphrase|privatekey|keytext)/i.test(key)));
}

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
