import type { AcmeChallengeType } from '../schema/acme.schema.js';

export interface CreateAcmeProviderDto {
  name: string;
  directoryUrl: string;
  accountKeySecretRef?: string;
  allowedChallenges?: AcmeChallengeType[];
  requestTimeoutMs?: number;
  verifyTls?: boolean;
  userAgent?: string;
}

export interface CreateAcmeAccountDto {
  providerId: string;
  accountKeySecretRef: string;
  contact?: string[];
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

export interface AcmeOrderView {
  id: string;
  status: string;
  certificateRequestId: string;
  certificateAssetId?: string;
  externalOrderUrl: string;
  identifiers: Array<{ type: string; value: string }>;
  authorizationCount: number;
  challengeCount: number;
  retryAfterAt?: string;
  failureCode?: string;
  failureSummary?: string;
  createdAt: string;
  updatedAt: string;
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
