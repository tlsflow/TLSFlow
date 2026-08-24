import type { AcmeChallengeType } from '../schema/acme.schema.js';

export interface CreateAcmeProviderDto {
  displayName?: string;
  name?: string;
  profileKey?: string;
  directoryUrl?: string;
  accountKeySecretRef?: string;
  allowedChallenges?: AcmeChallengeType[];
  requestTimeoutMs?: number;
  verifyTls?: boolean;
  userAgent?: string;
}

export interface CreateAcmeAccountDto {
  providerId: string;
  accountKeySecretRef?: string;
  contact?: string[];
  eabSecretRef?: string;
  eabKeyIdSecretRef?: string;
  eabHmacSecretRef?: string;
  termsOfServiceAgreed?: boolean;
}

export interface CreateAcmeOrderDto {
  providerId: string;
  accountId: string;
  certificateRequestId: string;
  identifiers: Array<{ type: 'dns' | 'ip'; value: string }>;
  challengeType: AcmeChallengeType;
  idempotencyKey: string;
}

export interface CreateAcmeRenewalPolicyDto {
  certificateAssetId?: string;
  bindingId?: string;
  providerId: string;
  accountId: string;
  enabled?: boolean;
  renewalWindowDays?: number;
  challengeType: AcmeChallengeType;
  rotateKeyOnRenewal?: boolean;
  maxAttempts?: number;
  backoffSeconds?: number;
  maintenanceWindow?: Record<string, unknown>;
}

export interface AcmeRenewalView {
  id: string;
  status: string;
  sourceCertificateVersionId?: string;
  acmeOrderId?: string;
  attemptCount: number;
  nextAttemptAt?: string;
  failureCode?: string;
  failureMessage?: string;
  scheduledAt: string;
  updatedAt: string;
}
