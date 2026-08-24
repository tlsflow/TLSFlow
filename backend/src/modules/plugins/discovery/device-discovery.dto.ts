export interface StandardDeviceDiscoveryV1 {
  apiVersion: 'gcac.device-discovery/v1';
  device: {
    stableKey: string;
    displayName: string;
    productFamily: string;
    softwareVersion?: string;
    managementAddress?: string;
    metadata?: Record<string, unknown>;
  };
  capabilities: Array<{ key: string; available: boolean; metadata?: Record<string, unknown> }>;
  frameworks: Array<{ stableKey: string; type: string; displayName: string; version?: string; metadata?: Record<string, unknown> }>;
  sites: Array<{
    stableKey: string;
    frameworkStableKey?: string;
    displayName: string;
    addresses: string[];
    port?: number;
    protocol?: string;
    metadata?: Record<string, unknown>;
  }>;
  certificates: Array<{
    stableKey: string;
    sha256Fingerprint?: string;
    subject?: string;
    issuer?: string;
    notBefore?: string;
    notAfter?: string;
    metadata?: Record<string, unknown>;
  }>;
  certificateBindings: Array<{
    stableKey: string;
    siteStableKey: string;
    certificateStableKey: string;
    bindingName?: string;
    metadata?: Record<string, unknown>;
  }>;
  warnings: Array<{ code: string; messageKey: string; metadata?: Record<string, unknown> }>;
  rawFacts?: Record<string, unknown>;
}
