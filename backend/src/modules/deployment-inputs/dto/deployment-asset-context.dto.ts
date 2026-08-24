import type { CertificateLocationV1 } from './certificate-location.dto.js';

export const DEPLOYMENT_ASSET_CONTEXT_API_VERSION = 'gcac.deployment-asset-context/v1' as const;

export interface DeploymentAssetContextV1 {
  apiVersion: typeof DEPLOYMENT_ASSET_CONTEXT_API_VERSION;
  application: {
    id: string;
    address: string;
    serverName: string;
    port: number;
    protocol: string;
  };
  host?: {
    id: string;
    hostname?: string;
    primaryIp?: string;
    osType?: string;
  };
  site?: {
    id: string;
    type?: string;
    name?: string;
    key?: string;
    bindingInformation?: string;
    hostHeader?: string;
    listenIp?: string;
    port?: number;
    protocol?: string;
    metadata: Record<string, unknown>;
  };
  target?: {
    id: string;
    type: string;
    key: string;
    bindingKey?: string;
    certificateLocation?: CertificateLocationV1;
    metadata: Record<string, unknown>;
  };
  deployment: {
    targets: Array<{
      id?: string;
      name: string;
      serverName?: string;
      port?: number;
      sni?: boolean;
      certificateLocation?: CertificateLocationV1;
      metadata: Record<string, unknown>;
    }>;
    certificateResourceName: string;
  };
}
