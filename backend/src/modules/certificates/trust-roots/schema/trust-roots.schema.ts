import type { CertificateDistinguishedName } from '../../schema/certificates.schema.js';

export const rootCertificateValidationStatuses = ['pending', 'verified', 'rejected', 'expired'] as const;
export const rootCertificateObservationStatuses = ['candidate', 'accepted', 'rejected', 'failed'] as const;
export const certificateVersionTrustRootRelations = ['selected_root', 'candidate'] as const;
export const certificateVersionTrustRootResolutionStatuses = ['resolved', 'ambiguous', 'missing', 'invalid'] as const;
export const rootCertificateSourceTypes = ['internet', 'manual', 'managed_host_inspect'] as const;

export type RootCertificateValidationStatus = (typeof rootCertificateValidationStatuses)[number];
export type RootCertificateObservationStatus = (typeof rootCertificateObservationStatuses)[number];
export type CertificateVersionTrustRootRelation = (typeof certificateVersionTrustRootRelations)[number];
export type CertificateVersionTrustRootResolutionStatus = (typeof certificateVersionTrustRootResolutionStatuses)[number];
export type RootCertificateSourceType = (typeof rootCertificateSourceTypes)[number];

export interface RootCertificateRecordEntity {
  id: string;
  fingerprintSha256: string;
  certificateArtifactRef: string;
  subject: CertificateDistinguishedName;
  issuer: CertificateDistinguishedName;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  basicConstraints: {
    ca: boolean;
    pathLen?: number;
  };
  validationStatus: RootCertificateValidationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RootCertificateSourceObservationEntity {
  id: string;
  rootCertificateId: string;
  sourceType: RootCertificateSourceType;
  sourceRef?: string;
  observedFingerprint: string;
  observedAt: string;
  status: RootCertificateObservationStatus;
  failureCode?: string;
}

export interface CertificateVersionTrustRootEntity {
  id: string;
  tenantId?: string;
  certificateVersionId: string;
  rootCertificateId: string;
  relation: CertificateVersionTrustRootRelation;
  chainPath: string[];
  selectionReason?: string;
  resolutionStatus: CertificateVersionTrustRootResolutionStatus;
  createdAt: string;
  updatedAt: string;
}
