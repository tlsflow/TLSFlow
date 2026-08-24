import type { CertificateRequestEntity, CertificateRenewalJobEntity } from './internal-ca.schema.js';

export const acmeChallengeTypes = ['http-01', 'dns-01', 'tls-alpn-01'] as const;
export const acmeAccountStatuses = ['pending', 'active', 'deactivated', 'revoked', 'error'] as const;
export const acmeOrderStatuses = ['pending', 'ready', 'processing', 'valid', 'invalid', 'expired', 'cancelled'] as const;
export const acmeAuthorizationStatuses = ['pending', 'valid', 'invalid', 'deactivated', 'expired', 'revoked'] as const;
export const acmeChallengeStatuses = ['pending', 'presented', 'processing', 'valid', 'invalid', 'cleanup_pending', 'cleaned', 'failed'] as const;
export const acmeRenewalPolicyStatuses = ['active', 'disabled', 'error'] as const;
export const acmeRenewalDeploymentModes = ['manual', 'approval', 'automatic'] as const;

export type AcmeChallengeType = (typeof acmeChallengeTypes)[number];
export type AcmeAccountStatus = (typeof acmeAccountStatuses)[number];
export type AcmeOrderStatus = (typeof acmeOrderStatuses)[number];
export type AcmeAuthorizationStatus = (typeof acmeAuthorizationStatuses)[number];
export type AcmeChallengeStatus = (typeof acmeChallengeStatuses)[number];
export type AcmeRenewalPolicyStatus = (typeof acmeRenewalPolicyStatuses)[number];
export type AcmeRenewalDeploymentMode = (typeof acmeRenewalDeploymentModes)[number];

export interface AcmeDirectoryMetadata {
  directoryUrl: string;
  newNonceUrl: string;
  newAccountUrl: string;
  newOrderUrl: string;
  revokeCertUrl?: string;
  keyChangeUrl?: string;
  meta?: {
    termsOfService?: string;
    website?: string;
    caaIdentities?: string[];
    externalAccountRequired?: boolean;
  };
  fetchedAt: string;
}

export interface AcmeProviderConfiguration {
  directoryUrl: string;
  allowedChallenges: AcmeChallengeType[];
  requestTimeoutMs?: number;
  verifyTls?: boolean;
  userAgent?: string;
  termsOfServiceAgreed?: boolean;
  preset?: string;
  termsOfServiceUrl?: string;
  isDefault?: boolean;
  isBuiltIn?: boolean;
  profileKey?: string;
  profileVersion?: string;
  verificationLevel?: 'unconfigured' | 'directory_reachable' | 'account_active' | 'issuance_verified' | 'blocked' | 'reverification_required';
  verification?: Record<string, unknown>;
  trustBundleSecretRef?: string;
}

export interface AcmeAccountEntity {
  id: string;
  tenantId: string;
  providerId: string;
  directoryUrlHash: string;
  accountUrl?: string;
  accountKeySecretRef: string;
  contact: string[];
  eabKeyIdSecretRef?: string;
  eabHmacSecretRef?: string;
  eabSecretRef?: string;
  status: AcmeAccountStatus;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeOrderEntity {
  id: string;
  tenantId: string;
  providerId: string;
  accountId: string;
  certificateRequestId: string;
  externalOrderUrl: string;
  status: AcmeOrderStatus;
  identifiers: Array<{ type: 'dns' | 'ip'; value: string }>;
  authorizationUrls: string[];
  finalizeUrl?: string;
  certificateUrl?: string;
  csrSha256?: string;
  retryAfterAt?: string;
  attemptCount: number;
  failureCode?: string;
  failureSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeAuthorizationEntity {
  id: string;
  tenantId: string;
  orderId: string;
  externalAuthorizationUrl: string;
  identifier: { type: 'dns' | 'ip'; value: string };
  status: AcmeAuthorizationStatus;
  expiresAt?: string;
  wildcard: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeChallengeEntity {
  id: string;
  tenantId: string;
  orderId: string;
  authorizationId: string;
  externalChallengeUrl: string;
  type: AcmeChallengeType;
  identifier: string;
  tokenSha256: string;
  keyAuthorizationSha256: string;
  presentationId?: string;
  status: AcmeChallengeStatus;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  retryAfterAt?: string;
  failureCode?: string;
  failureSummary?: string;
  cleanupError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeRenewalPolicyEntity {
  id: string;
  tenantId: string;
  certificateAssetId?: string;
  bindingId?: string;
  providerId: string;
  accountId: string;
  enabled: boolean;
  renewalWindowDays: number;
  challengeType: AcmeChallengeType;
  rotateKeyOnRenewal: boolean;
  deploymentMode: AcmeRenewalDeploymentMode;
  maxAttempts: number;
  backoffSeconds: number;
  maintenanceWindow?: Record<string, unknown>;
  status: AcmeRenewalPolicyStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeRenewalJobEntity extends Omit<CertificateRenewalJobEntity, 'status' | 'certificateVersionId'> {
  status: CertificateRenewalJobEntity['status'] | 'retry_waiting' | 'cancelled' | 'issued_waiting_for_installation';
  certificateVersionId?: string;
  /** Worker 首次领取任务的时间；历史任务缺少该字段时回退到 scheduledAt。 */
  startedAt?: string;
  policyId?: string;
  sourceCertificateVersionId?: string;
  acmeOrderId?: string;
  deploymentPlanId?: string;
  executionRunId?: string;
  promotionStatus: 'pending' | 'verified' | 'promoted' | 'blocked' | 'failed' | 'not_required';
  attemptCount: number;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  failureCode?: string;
  failureMessage?: string;
  policySnapshot?: Record<string, unknown>;
}

export interface AcmeCertificateRequestContext {
  request: CertificateRequestEntity;
  account: AcmeAccountEntity;
  order: AcmeOrderEntity;
}

export interface AcmeChallengePresentation {
  presentationId: string;
  expiresAt?: string;
  detail?: Record<string, unknown>;
}

export function isAcmeChallengeType(value: unknown): value is AcmeChallengeType {
  return typeof value === 'string' && (acmeChallengeTypes as readonly string[]).includes(value);
}

export function isAcmeProviderConfiguration(value: unknown): value is AcmeProviderConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.directoryUrl === 'string'
    && candidate.directoryUrl.startsWith('https://')
    && Array.isArray(candidate.allowedChallenges)
    && candidate.allowedChallenges.length > 0
    && candidate.allowedChallenges.every(isAcmeChallengeType);
}
