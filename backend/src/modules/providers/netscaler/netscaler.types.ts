export const NetscalerSupportedVersions = ['10.5', '11.1', '12.1', '13.0', '13.1', '14.1'] as const;
export type NetscalerSupportedVersion = (typeof NetscalerSupportedVersions)[number];

export type NetscalerSupportTier = 'SUPPORTED' | 'COMPATIBLE' | 'READ_ONLY' | 'UNSUPPORTED';
export type NetscalerAuthMode = 'AUTO' | 'SESSION' | 'PER_REQUEST';
export type NetscalerVirtualServerType = 'LB' | 'CS' | 'VPN' | 'GSLB';

export interface NetscalerVersion {
  major: number;
  minor: number;
  build?: string;
  raw: string;
  normalized?: NetscalerSupportedVersion;
}

export interface NetscalerCapabilityProfile {
  supportTier: NetscalerSupportTier;
  auth: {
    session: boolean;
    perRequestHeaders: boolean;
  };
  discovery: {
    sslCertKey: boolean;
    lbVirtualServer: boolean;
    csVirtualServer: boolean;
    vpnVirtualServer: boolean;
    gslbVirtualServer: boolean;
    sslBindings: boolean;
  };
  deployment: {
    systemFileUpload: boolean;
    updateSslCertKey: boolean;
    addSslCertKey: boolean;
    bindSslCertKey: boolean;
    unbindSslCertKey: boolean;
    saveConfig: boolean;
  };
  fieldMappingVersion: string;
  limitations: string[];
}

export interface NetscalerDeviceFacts {
  productName: string;
  softwareVersion: string;
  softwareBuild?: string;
  runtimeMode?: string;
  haMode?: string;
  rawSummary: Record<string, unknown>;
}

export interface NetscalerVirtualServer {
  type: NetscalerVirtualServerType;
  name: string;
  address?: string;
  port?: number;
  protocol?: string;
  state?: string;
  sniNames: string[];
  sourceVersion: string;
  rawSummary: Record<string, unknown>;
}

export interface NetscalerCertificateResource {
  certKeyName: string;
  certificatePath?: string;
  privateKeyPath?: string;
  fingerprintSha256?: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  status?: string;
  signatureAlgorithm?: string;
  publicKeyAlgorithm?: string;
  publicKeySize?: number;
  linkedCertKeyName?: string;
  sourceVersion: string;
  rawFieldSummary: Record<string, unknown>;
}

export interface NetscalerCertificateBinding {
  virtualServerType: NetscalerVirtualServerType;
  virtualServerName: string;
  certKeyName: string;
  sniCertificate: boolean;
  priority?: number;
  sourceVersion: string;
  rawSummary: Record<string, unknown>;
}

export interface NetscalerCertKeyUsage {
  certKeyName: string;
  virtualServerType: NetscalerVirtualServerType;
  virtualServerName: string;
}

export type NetscalerDeploymentStrategy = 'UPDATE_EXISTING' | 'CREATE_AND_REBIND';

export interface NetscalerRollbackSnapshot {
  certKeyName: string;
  certificatePath?: string;
  privateKeyPath?: string;
  bindings: NetscalerCertificateBinding[];
}

export interface NetscalerCertificatePreflightResult {
  deviceVersion: NetscalerVersion;
  virtualServer: Pick<NetscalerVirtualServer, 'type' | 'name' | 'address' | 'port' | 'sniNames'>;
  currentCertKeyName: string;
  currentFingerprintSha256?: string;
  sharedUsage: NetscalerCertKeyUsage[];
  selectedStrategy: NetscalerDeploymentStrategy;
  rollbackSnapshot: NetscalerRollbackSnapshot;
  warnings: string[];
  blockingReasons: string[];
}

export type NetscalerErrorCode =
  | 'NETSCALER_UNREACHABLE'
  | 'NETSCALER_TLS_UNTRUSTED'
  | 'NETSCALER_AUTH_FAILED'
  | 'NETSCALER_MFA_REQUIRED'
  | 'NETSCALER_PERMISSION_DENIED'
  | 'NETSCALER_UNSUPPORTED_VERSION'
  | 'NETSCALER_CAPABILITY_MISSING'
  | 'NETSCALER_RESOURCE_NOT_FOUND'
  | 'NETSCALER_CONCURRENT_CHANGE'
  | 'NETSCALER_CERTKEY_SHARED'
  | 'NETSCALER_CERTIFICATE_INVALID'
  | 'NETSCALER_UPLOAD_FAILED'
  | 'NETSCALER_UPDATE_FAILED'
  | 'NETSCALER_BINDING_FAILED'
  | 'NETSCALER_SAVE_FAILED'
  | 'NETSCALER_VERIFY_FAILED'
  | 'NETSCALER_ROLLBACK_FAILED'
  | 'NETSCALER_RESPONSE_INVALID';

export interface NetscalerFixtureManifestEntry {
  version: NetscalerSupportedVersion;
  build: string;
  source: 'OFFICIAL_DOCS' | 'REAL_DEVICE' | 'SANITIZED_CAPTURE';
  resources: string[];
  containsSecrets: false;
}

export function assertSafeFixtureManifest(entries: NetscalerFixtureManifestEntry[]): void {
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.version)) throw new Error(`fixture 版本重复: ${entry.version}`);
    if (!entry.build.trim()) throw new Error(`fixture 缺少 Build: ${entry.version}`);
    if (entry.containsSecrets !== false) throw new Error(`fixture 不得包含 Secret: ${entry.version}`);
    if (entry.resources.length === 0) throw new Error(`fixture 缺少资源清单: ${entry.version}`);
    versions.add(entry.version);
  }
  for (const version of NetscalerSupportedVersions) {
    if (!versions.has(version)) throw new Error(`fixture 缺少目标版本: ${version}`);
  }
}
