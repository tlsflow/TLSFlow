import { X509Certificate } from 'node:crypto';

interface WorkflowCertificateFile {
  key?: unknown;
  name?: unknown;
  role?: unknown;
  content?: unknown;
  contentBase64?: unknown;
}

export interface OrderedIntermediateCertificate {
  index: number;
  sequence: number;
  nextSequence?: number;
  hasNext: boolean;
  pem: string;
  pemBase64: string;
  fingerprintSha256?: string;
}

export function enrichWorkflowCertificateMaterial(material: Record<string, unknown>): Record<string, unknown> {
  const files = Array.isArray(material.files)
    ? material.files.filter((item): item is WorkflowCertificateFile => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
  const declaredCertificatePem = readString(material.certificatePem)
    ?? readString(material.pem)
    ?? readPemFile(files, 'fullchain', 'public_certificate');
  const leafPem = readPemFile(files, 'public', 'public_certificate')
    ?? readString(material.leafPem)
    ?? readLeafCertificate(declaredCertificatePem)
    ?? readLeafFromFullchain(files);
  const privateKeyPem = readPemFile(files, 'private', 'private_key')
    ?? readString(material.privateKeyPem)
    ?? readString(material.privateKey);
  const rawOrderedChainPem = readPemFile(files, 'chain', 'certificate_chain')
    ?? readString(material.orderedChainPem)
    ?? readIntermediateChain(declaredCertificatePem)
    ?? readIntermediateChainFromFullchain(files)
    ?? '';
  const certificatePem = declaredCertificatePem
    ?? joinCertificateChain(leafPem, rawOrderedChainPem);
  // 证书链按叶到根保持原顺序，但相同证书的重复块不能再次提交给设备。
  const chainCertificates = deduplicateCertificates(splitCertificates(rawOrderedChainPem));
  const orderedChainPem = chainCertificates.join('');
  const orderedIntermediates = chainCertificates.map((pem, index) => ({
    index,
    sequence: index + 1,
    ...(index + 1 < chainCertificates.length ? { nextSequence: index + 2 } : {}),
    hasNext: index + 1 < chainCertificates.length,
    pem,
    pemBase64: Buffer.from(pem, 'utf8').toString('base64'),
    fingerprintSha256: certificateFingerprint(pem),
  }));
  const fingerprintSha256 = normalizeFingerprint(readString(material.fingerprintSha256)
    ?? readString(material.expectedFingerprintSha256)
    ?? certificateFingerprint(leafPem));

  return {
    ...material,
    leafPem,
    certificatePem,
    pem: certificatePem,
    leafPemBase64: encodeUtf8(leafPem),
    pemBase64: encodeUtf8(certificatePem),
    privateKeyPem,
    privateKey: privateKeyPem,
    privateKeyPemBase64: encodeUtf8(privateKeyPem),
    orderedChainPem,
    orderedChainPemBase64: encodeUtf8(orderedChainPem),
    orderedIntermediates,
    fingerprintSha256,
    deploymentMetadata: {
      certificateFormatId: material.certificateFormatId,
      certificateVersionId: material.certificateVersionId,
      format: material.format,
      intermediateCount: orderedIntermediates.length,
      fingerprintSha256,
    },
  };
}

function readLeafCertificate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return splitCertificates(value)[0] ?? value;
}

function readIntermediateChain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const certificates = splitCertificates(value);
  return certificates.length > 1 ? certificates.slice(1).join('') : undefined;
}

function joinCertificateChain(leafPem: string | undefined, orderedChainPem: string): string | undefined {
  if (!leafPem) return undefined;
  return `${leafPem.trimEnd()}\n${orderedChainPem}`;
}

function readIntermediateChainFromFullchain(files: WorkflowCertificateFile[]): string | undefined {
  const fullchain = readPemFile(files, 'fullchain', 'public_certificate');
  if (!fullchain) return undefined;
  const certificates = splitCertificates(fullchain);
  if (certificates.length <= 1) return undefined;
  return certificates.slice(1).join('');
}

function readLeafFromFullchain(files: WorkflowCertificateFile[]): string | undefined {
  const fullchain = readPemFile(files, 'fullchain', 'public_certificate');
  if (!fullchain) return undefined;
  return splitCertificates(fullchain)[0];
}

function readPemFile(files: WorkflowCertificateFile[], key: string, role: string): string | undefined {
  const file = files.find((item) => readString(item.key) === key || readString(item.name) === key)
    ?? files.find((item) => readString(item.role) === role && readString(item.key) !== 'fullchain');
  if (!file) return undefined;
  const content = readString(file.content);
  if (content) return content;
  const contentBase64 = readString(file.contentBase64);
  return contentBase64 ? Buffer.from(contentBase64, 'base64').toString('utf8') : undefined;
}

function splitCertificates(value: string): string[] {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    ?.map((item) => `${item.trim()}\n`) ?? [];
}

function deduplicateCertificates(certificates: string[]): string[] {
  const seenFingerprints = new Set<string>();
  return certificates.filter((pem) => {
    const fingerprint = certificateFingerprint(pem);
    if (!fingerprint) return true;
    if (seenFingerprints.has(fingerprint)) return false;
    seenFingerprints.add(fingerprint);
    return true;
  });
}

function certificateFingerprint(pem?: string): string | undefined {
  if (!pem) return undefined;
  try {
    return normalizeFingerprint(new X509Certificate(pem).fingerprint256);
  } catch {
    return undefined;
  }
}

function encodeUtf8(value?: string): string | undefined {
  return value ? Buffer.from(value, 'utf8').toString('base64') : undefined;
}

function normalizeFingerprint(value?: string): string | undefined {
  const normalized = value?.replace(/:/g, '').trim().toLowerCase();
  return normalized || undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
