import type { StandardDeviceDiscoveryV2 } from '../discovery/device-discovery.dto.js';

export interface PluginPromotionPreviewInput {
  sourcePluginBindingId: string;
  displayName: string;
  deviceFamily: string;
  managementAddress: string;
  managementPort: number;
  authMode: string;
  tlsVerify: boolean;
  gatewayId?: string;
  applicationAssetId?: string;
  discovery: StandardDeviceDiscoveryV2;
}

export interface PluginPromotionConflict {
  code: string;
  path: string;
  message: string;
  blocking: boolean;
}

export interface PluginPromotionPreview {
  promotionId: string;
  status: 'PREVIEWED' | 'CONFLICT';
  sourcePluginBindingId: string;
  pluginVersionId: string;
  mappings: {
    host: { action: 'CREATE' | 'REUSE'; address: string };
    device: { action: 'CREATE'; displayName: string; deviceFamily: string };
    frameworks: Array<{ stableKey: string; displayName: string }>;
    sites: Array<{ stableKey: string; displayName: string }>;
    managedTargets: Array<{ stableKey: string; displayName: string }>;
    secretBindings: Array<{ slot: string; secretRef: string; action: 'REUSE' }>;
    variableBindings: string[];
    certificateArtifactBindings: string[];
  };
  conflicts: PluginPromotionConflict[];
}

export interface PluginPromotionRecord {
  id: string;
  tenantId: string;
  sourcePluginBindingId: string;
  targetPluginBindingId?: string;
  deviceAssetId?: string;
  applicationAssetId?: string;
  status: 'PREVIEWED' | 'CONFLICT' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'REVOKED';
  previewSnapshot: PluginPromotionPreviewInput & { pluginVersionId: string };
  createdResources: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  revokedAt?: string;
  version: number;
}
