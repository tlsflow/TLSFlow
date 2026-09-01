export const applicationCertificateSupplyModes = ['manual', 'dedicated'] as const;
export const applicationCertificateProviderTypes = ['internal_ca', 'acme'] as const;
export const applicationCertificateCustodyModes = ['agent_local', 'device_local', 'managed_secret'] as const;
export const applicationCertificateArtifactModes = ['certificate_only', 'certificate_with_private_key'] as const;
export const applicationCertificateLifecycleStatuses = [
  'draft', 'provisioning', 'issued', 'ready_to_deploy', 'deployed', 'tls_verified',
  'trust_pending', 'renewing', 'needs_attention', 'disabled',
] as const;

export type ApplicationCertificateSupplyMode = typeof applicationCertificateSupplyModes[number];
export type ApplicationCertificateProviderType = typeof applicationCertificateProviderTypes[number];
export type ApplicationCertificateCustodyMode = typeof applicationCertificateCustodyModes[number];
export type ApplicationCertificateArtifactMode = typeof applicationCertificateArtifactModes[number];
export type ApplicationCertificateLifecycleStatus = typeof applicationCertificateLifecycleStatuses[number];

export interface ApplicationCertificatePolicyEntity {
  id: string;
  tenantId: string;
  applicationAssetId: string;
  currentVersionId?: string;
  currentDedicatedCertificateAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationCertificatePolicyVersionEntity {
  id: string;
  policyId: string;
  tenantId: string;
  applicationAssetId: string;
  versionNo: number;
  isActive: boolean;
  primaryDomain: string;
  supplyMode: ApplicationCertificateSupplyMode;
  certificateAssetId?: string;
  certificateVersionId?: string;
  providerType?: ApplicationCertificateProviderType;
  providerId?: string;
  certificateAuthorityId?: string;
  acmeProviderProfileId?: string;
  dnsProviderId?: string;
  credentialRef?: string;
  certificateProfileVersionId?: string;
  custodyMode?: ApplicationCertificateCustodyMode;
  deploymentArtifactMode?: ApplicationCertificateArtifactMode;
  autoRenew: boolean;
  renewalWindowDays?: number;
  rotateKeyOnRenewal: boolean;
  status: ApplicationCertificateLifecycleStatus;
  policySnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
