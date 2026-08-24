import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const CERTIFICATE_ASSETS_PATH = '/api/v1/certificate-assets'
const CERTIFICATE_IMPORT_PATH = '/api/v1/certificate-assets:import'

export function listCertificates(query?: BusinessListQuery) {
  // 中文说明：返回类型来自 generated 的 PageResponse，不在前端手写证书 DTO。
  return listRecords(CERTIFICATE_ASSETS_PATH, query)
}

export function importCertificate(payload: ApiBody) {
  return postAction(CERTIFICATE_IMPORT_PATH, payload, 'certificate_import')
}
