import type {
  ApplicationCertificateArtifactMode,
  ApplicationCertificateCustodyMode,
  ApplicationCertificateLifecycleStatus,
  ApplicationCertificateProviderType,
  ApplicationCertificateSupplyMode,
} from '../schema/application-certificate-supply.schema.js';

export interface UpdateApplicationCertificatePolicyDto {
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
  autoRenew?: boolean;
  renewalWindowDays?: number;
  rotateKeyOnRenewal?: boolean;
  status?: ApplicationCertificateLifecycleStatus;
}

export interface CertificateSupplyCandidateDto {
  certificateAssetId: string;
  certificateVersionId?: string;
  versionNo?: number;
  name: string;
  primaryDomain: string;
  commonName?: string;
  sans: string[];
  sourceType: string;
  issuer?: {
    raw?: string;
    commonName?: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    state?: string;
    locality?: string;
  };
  notAfter?: string;
  deployable: boolean;
  matchesPrimaryDomain: boolean;
}

export interface CertificateSupplyProviderDto {
  id: string;
  name: string;
  type: string;
  status: string;
  capabilities?: Record<string, unknown>;
}

export interface ApplicationCertificateSupplyResponse {
  applicationAssetId: string;
  primaryDomain: string;
  policy?: import('../schema/application-certificate-supply.schema.js').ApplicationCertificatePolicyEntity;
  currentVersion?: import('../schema/application-certificate-supply.schema.js').ApplicationCertificatePolicyVersionEntity;
  /** 当前专属策略对应的签发申请状态；用于区分“已入队”和“实际签发失败”。 */
  issuance?: {
    requestId: string;
    status: string;
    certificateVersionId?: string;
    failureCode?: string;
    failureMessage?: string;
  };
  certificateCandidates: CertificateSupplyCandidateDto[];
  providers: {
    ca: CertificateSupplyProviderDto[];
    acme: CertificateSupplyProviderDto[];
    dns: Array<{ id: string; name: string; requiresSecretRef: true; credentialTemplate: string }>;
    acmeProviderProfiles: Array<{ id: string; name: string; version?: string }>;
    authorities: Array<{ id: string; name: string; providerId: string; status: string }>;
    profiles: Array<{ id: string; name: string; currentVersion: number; versions: Array<{ id: string; versionNo: number }> }>;
  };
  capability: {
    custodyMode: ApplicationCertificateCustodyMode;
    deploymentArtifactMode: ApplicationCertificateArtifactMode;
    evidence: Record<string, unknown>;
  };
  readiness: {
    canSave: boolean;
    canIssue: boolean;
    canDeploy: boolean;
    reasons: string[];
  };
}

export interface CertificateSupplyPreviewDto extends Partial<UpdateApplicationCertificatePolicyDto> {
  supplyMode: ApplicationCertificateSupplyMode;
}
