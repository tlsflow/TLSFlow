import type { PageResponse } from '../../../../shared/dto/page-response.js';
import type {
  CertificateVersionTrustRootEntity,
  RootCertificateRecordEntity,
  RootCertificateSourceObservationEntity,
  RootCertificateSourceType,
} from '../schema/trust-roots.schema.js';

export interface RootCertificateRecordDto extends RootCertificateRecordEntity {}

export interface RootCertificateSourceObservationDto extends RootCertificateSourceObservationEntity {}

export interface CertificateVersionTrustRootDto extends CertificateVersionTrustRootEntity {}

export interface RootCertificateDetailDto extends RootCertificateRecordDto {
  observations: RootCertificateSourceObservationDto[];
  versionRelations: CertificateVersionTrustRootDto[];
}

export interface RootCertificateListPageDto extends PageResponse<RootCertificateRecordDto> {
  managedSummary: ManagedCertificateTrustRootSummaryDto;
}

export interface ManagedCertificateTrustRootStatusDto {
  certificateVersionId: string;
  certificateAssetId: string;
  certificateName: string;
  fingerprintSha256: string;
  chainStatus: 'unknown' | 'valid' | 'incomplete' | 'invalid';
  rootStatus: 'resolved' | 'missing' | 'invalid_chain';
  rootFingerprintSha256?: string;
  rootCertificateId?: string;
  rootValidationStatus?: RootCertificateRecordEntity['validationStatus'];
  relation?: CertificateVersionTrustRootEntity['relation'];
  selectionReason?: string;
}

export interface ManagedCertificateTrustRootSummaryDto {
  totalVersions: number;
  resolvedVersions: number;
  missingVersions: number;
  invalidChainVersions: number;
  rootsInLibrary: number;
  items: ManagedCertificateTrustRootStatusDto[];
}

export interface ImportRootCertificateInput {
  tenantId?: string;
  certificatePem?: string;
  certificateDerBase64?: string;
  certificateVersionId?: string;
  sourceRef?: string;
  createdBy: string;
}

export interface DiscoverRootCertificateInput {
  tenantId?: string;
  fingerprintSha256?: string;
  certificateVersionId?: string;
  allowedSources?: RootCertificateSourceType[];
  createdBy: string;
}

export interface DiscoverRootCertificateResult {
  fingerprintSha256: string;
  root?: RootCertificateRecordDto;
  sourceType?: RootCertificateSourceType;
  status: 'found' | 'not_found' | 'failed';
  failureCode?: string;
}

export function toRootCertificateRecordDto(entity: RootCertificateRecordEntity): RootCertificateRecordDto {
  return { ...entity };
}

export function toRootCertificateSourceObservationDto(entity: RootCertificateSourceObservationEntity): RootCertificateSourceObservationDto {
  return { ...entity };
}

export function toCertificateVersionTrustRootDto(entity: CertificateVersionTrustRootEntity): CertificateVersionTrustRootDto {
  return { ...entity };
}
