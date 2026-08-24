import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const CERTIFICATE_ASSETS_PATH = '/api/v1/certificate-assets'
const CERTIFICATE_VERSIONS_PATH = '/api/v1/certificate-versions'
const CERTIFICATE_FORMATS_PATH = '/api/v1/certificate-version-formats'
const CERTIFICATE_IMPORT_PATH = '/api/v1/certificate-versions/import'
const CERTIFICATE_USAGES_PATH = '/api/v1/certificate-bindings'

export function listCertificates(query?: BusinessListQuery) {
  // 中文说明：返回类型来自 generated 的 PageResponse，不在前端手写证书 DTO。
  return listRecords(CERTIFICATE_ASSETS_PATH, query)
}

export function listCertificateVersions(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_VERSIONS_PATH, query)
}

export function listCertificateFormats(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_FORMATS_PATH, query)
}

export function listCertificateUsages(query?: BusinessListQuery) {
  // 中文说明：后端当前没有独立 usage 详情端点，绑定列表按 certificateId 过滤就是证书使用关系。
  return listRecords(CERTIFICATE_USAGES_PATH, query)
}

export function importCertificate(payload: ApiBody) {
  return postAction(CERTIFICATE_IMPORT_PATH, payload, 'certificate_import')
}

export function createCertificateFormat(payload: ApiBody) {
  return postAction(CERTIFICATE_FORMATS_PATH, payload, 'certificate_format_create')
}

export function requestCertificateFormatExport(payload: ApiBody) {
  return postAction(`${CERTIFICATE_FORMATS_PATH}/export-plan`, payload, 'certificate_format_export')
}

export function generateCertificateFormatExport(payload: ApiBody) {
  return postAction(`${CERTIFICATE_FORMATS_PATH}/export`, payload, 'certificate_format_generate')
}
