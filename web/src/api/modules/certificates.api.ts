import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type BusinessListQuery, type ApiRecord, type ApiRecordResult } from './common'

const CERTIFICATE_ASSETS_PATH = '/api/v1/certificate-assets'
const CERTIFICATE_ASSET_DETAIL_PATH = '/api/v1/certificate-assets/detail'
const CERTIFICATE_VERSIONS_PATH = '/api/v1/certificate-versions'
const CERTIFICATE_VERSION_DETAIL_PATH = '/api/v1/certificate-versions/detail'
const CERTIFICATE_VERSION_USAGE_PATH = '/api/v1/certificate-versions/usage'
const CERTIFICATE_FORMATS_PATH = '/api/v1/certificate-version-formats'
const CERTIFICATE_IMPORT_PATH = '/api/v1/certificate-versions/import'
const CERTIFICATE_VALIDATE_IMPORT_PATH = '/api/v1/certificate-versions/validate-import'
const CERTIFICATE_USAGES_PATH = '/api/v1/certificate-bindings'
const CERTIFICATE_TRUST_ROOTS_PATH = '/api/v1/certificate-trust-roots'

export function listCertificates(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_ASSETS_PATH, query)
}

export function createCertificateAsset(payload: ApiBody) {
  return postAction(CERTIFICATE_ASSETS_PATH, payload, 'certificate_asset_create')
}

export function getCertificateAssetDetail(assetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(CERTIFICATE_ASSET_DETAIL_PATH)}?id=${encodeURIComponent(assetId)}`)
}

export function listCertificateVersions(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_VERSIONS_PATH, query)
}

export function getCertificateVersionDetail(versionId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(CERTIFICATE_VERSION_DETAIL_PATH)}?id=${encodeURIComponent(versionId)}`)
}

export function getCertificateVersionUsage(versionId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(CERTIFICATE_VERSION_USAGE_PATH)}?id=${encodeURIComponent(versionId)}`)
}

export function listCertificateFormats(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_FORMATS_PATH, query)
}

export function listCertificateFormatsByVersionId(versionId: string, query: BusinessListQuery = {}) {
  return listRecords(`${CERTIFICATE_VERSIONS_PATH}/${encodeURIComponent(versionId)}/formats`, { page: 1, pageSize: 100, ...query })
}

export function listCertificateUsages(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_USAGES_PATH, query)
}

export function listCertificateTrustRoots(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_TRUST_ROOTS_PATH, query)
}

export function getCertificateTrustRootDetail(rootId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(`${CERTIFICATE_TRUST_ROOTS_PATH}/${encodeURIComponent(rootId)}`)}`)
}

export function importCertificate(payload: ApiBody) {
  return postAction(CERTIFICATE_IMPORT_PATH, payload, 'certificate_import')
}

export function validateCertificateImport(payload: ApiBody) {
  return postAction(CERTIFICATE_VALIDATE_IMPORT_PATH, payload, 'certificate_import_validate')
}

export function deleteCertificateVersion(id: string) {
  return apiClient.request<ApiRecord>(`${toClientPath(`${CERTIFICATE_VERSIONS_PATH}/delete`)}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    idempotencyKey: createIdempotencyKey('certificate_version_delete'),
  })
}

export function createCertificateFormat(payload: ApiBody) {
  return postAction(CERTIFICATE_FORMATS_PATH, payload, 'certificate_format_create')
}

export function updateCertificateFormat(payload: ApiBody) {
  return apiClient.request<ApiRecord>(toClientPath(CERTIFICATE_FORMATS_PATH), {
    method: 'PATCH',
    body: payload,
    idempotencyKey: createIdempotencyKey('certificate_format_update'),
  })
}

export function deleteCertificateFormat(id: string) {
  return postAction(`${CERTIFICATE_FORMATS_PATH}/delete`, { id }, 'certificate_format_delete')
}
