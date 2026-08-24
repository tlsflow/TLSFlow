export const CERTIFICATE_LOCATION_API_VERSION = 'gcac.certificate-location/v1' as const;

export type CertificateStorageKind = 'PEM_FILES' | 'KEYSTORE' | 'WINDOWS_CERTIFICATE_STORE';
export type CertificateLocationConfidence = 'EXACT' | 'INFERRED' | 'UNKNOWN';

export interface CertificateLocationV1 {
  apiVersion: typeof CERTIFICATE_LOCATION_API_VERSION;
  storageKind: CertificateStorageKind;
  certificatePath?: string;
  privateKeyPath?: string;
  chainPath?: string;
  keystorePath?: string;
  keystoreType?: 'JKS' | 'PKCS12' | 'PEM' | 'UNKNOWN';
  keyAlias?: string;
  storeName?: string;
  storeLocation?: string;
  storeThumbprint?: string;
  sourceConfigPath?: string;
  serviceName?: string;
  programPath?: string;
  testCommand?: string;
  reloadCommand?: string;
  configFingerprint?: string;
  confidence: CertificateLocationConfidence;
  observedAt: string;
  warnings?: string[];
}

export function readCertificateLocation(metadata: Record<string, unknown>, observedAtFallback: unknown): CertificateLocationV1 | undefined {
  const current = readRecord(metadata.certificateLocation);
  if (current) return normalizeCurrentLocation(current, observedAtFallback);

  const certificatePath = readString(metadata.certPath, metadata.certificatePath);
  const privateKeyPath = readString(metadata.keyPath, metadata.privateKeyPath, metadata.certificateKeyPath);
  const keystorePath = readString(metadata.keystorePath);
  const storeThumbprint = readString(metadata.storeThumbprint);
  if (!certificatePath && !privateKeyPath && !keystorePath && !storeThumbprint) return undefined;

  return compactLocation({
    apiVersion: CERTIFICATE_LOCATION_API_VERSION,
    storageKind: keystorePath ? 'KEYSTORE' : storeThumbprint && !certificatePath ? 'WINDOWS_CERTIFICATE_STORE' : 'PEM_FILES',
    certificatePath,
    privateKeyPath,
    chainPath: readString(metadata.chainPath),
    keystorePath,
    keystoreType: normalizeKeystoreType(readString(metadata.keystoreType)),
    keyAlias: readString(metadata.keyAlias),
    storeName: readString(metadata.storeName),
    storeLocation: readString(metadata.storeLocation),
    storeThumbprint,
    sourceConfigPath: readString(metadata.configPath, metadata.sourceConfigPath),
    serviceName: readString(metadata.serviceName),
    programPath: readString(metadata.programPath, metadata.binaryPath),
    testCommand: readString(metadata.testCommand),
    reloadCommand: readString(metadata.reloadCommand),
    configFingerprint: readString(metadata.configFingerprint),
    confidence: 'EXACT',
    observedAt: readString(metadata.observedAt) ?? normalizeObservedAt(observedAtFallback),
  });
}

function normalizeCurrentLocation(value: Record<string, unknown>, observedAtFallback: unknown): CertificateLocationV1 | undefined {
  const certificatePath = readString(value.certificatePath);
  const privateKeyPath = readString(value.privateKeyPath);
  const keystorePath = readString(value.keystorePath);
  const storeThumbprint = readString(value.storeThumbprint);
  if (!certificatePath && !privateKeyPath && !keystorePath && !storeThumbprint) return undefined;

  const storageKind = readString(value.storageKind);
  return compactLocation({
    apiVersion: CERTIFICATE_LOCATION_API_VERSION,
    storageKind: storageKind === 'KEYSTORE' || storageKind === 'WINDOWS_CERTIFICATE_STORE' ? storageKind : 'PEM_FILES',
    certificatePath,
    privateKeyPath,
    chainPath: readString(value.chainPath),
    keystorePath,
    keystoreType: normalizeKeystoreType(readString(value.keystoreType)),
    keyAlias: readString(value.keyAlias),
    storeName: readString(value.storeName),
    storeLocation: readString(value.storeLocation),
    storeThumbprint,
    sourceConfigPath: readString(value.sourceConfigPath),
    serviceName: readString(value.serviceName),
    programPath: readString(value.programPath),
    testCommand: readString(value.testCommand),
    reloadCommand: readString(value.reloadCommand),
    configFingerprint: readString(value.configFingerprint),
    confidence: normalizeConfidence(readString(value.confidence)),
    observedAt: readString(value.observedAt) ?? normalizeObservedAt(observedAtFallback),
    warnings: readStrings(value.warnings),
  });
}

function compactLocation(value: CertificateLocationV1): CertificateLocationV1 {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as unknown as CertificateLocationV1;
}

function normalizeConfidence(value: string | undefined): CertificateLocationConfidence {
  return value === 'INFERRED' || value === 'UNKNOWN' ? value : 'EXACT';
}

function normalizeKeystoreType(value: string | undefined): CertificateLocationV1['keystoreType'] {
  const normalized = value?.toUpperCase();
  return normalized === 'JKS' || normalized === 'PKCS12' || normalized === 'PEM' ? normalized : value ? 'UNKNOWN' : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function normalizeObservedAt(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return new Date(0).toISOString();
}
