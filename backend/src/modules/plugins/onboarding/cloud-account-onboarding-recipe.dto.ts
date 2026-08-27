import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

export const cloudAccountOnboardingProtocol = 'gcac.cloud-account-onboarding/v2' as const;

/** 云账号平台卡片使用的统一业务接入说明。 */
export interface CloudAccountOnboardingPlatformMetadataV2 {
  capabilityVersion: string;
  compatibilityKeys: string[];
  requiredInformationKeys: string[];
}

export interface CloudAccountOnboardingRecipeV2 {
  protocol: typeof cloudAccountOnboardingProtocol;
  assetKind: 'CLOUD_ACCOUNT';
  providerKey: string;
  display: { nameKey: string; descriptionKey?: string; logoResource?: string };
  platformMetadata: CloudAccountOnboardingPlatformMetadataV2;
  credentialContractResource: string;
  capabilities: { connectionTest: string; discover: string };
  submit: { target: 'CLOUD_ACCOUNT_ASSET'; scopeSchema: string };
  projection: { apiVersion: 'gcac.cloud-service/v1'; resourceMapping: string };
  defaults?: { request?: Record<string, unknown> };
}

export interface LoadedCloudAccountOnboardingRecipe {
  recipe: CloudAccountOnboardingRecipeV2;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  resourcePath: string;
  recipeHash: string;
}

export interface CloudAccountOnboardingRecipeValidationContext {
  manifest: UnifiedPluginManifestV1;
}
