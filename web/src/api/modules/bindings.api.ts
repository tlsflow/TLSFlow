import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type ApiRecordResult, type BusinessListQuery } from './common'

const CERTIFICATE_BINDINGS_PATH = '/api/v1/certificate-bindings'

export function listBindings(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_BINDINGS_PATH, query)
}

export function createBinding(payload: ApiBody) {
  return postAction(CERTIFICATE_BINDINGS_PATH, payload, 'binding_create')
}

export function detectBindingDrift(payload: ApiBody) {
  return postAction(`${CERTIFICATE_BINDINGS_PATH}/drift`, payload, 'binding_drift')
}

export function persistBindingDriftResult(payload: ApiBody) {
  return postAction(`${CERTIFICATE_BINDINGS_PATH}/drift-results`, payload, 'binding_drift_result')
}

export function listBindingUsages(query?: BusinessListQuery) {
  return listRecords(`${CERTIFICATE_BINDINGS_PATH}/usage`, query)
}

export function updateBinding(bindingId: string, payload: ApiBody) {
  return patchAction(CERTIFICATE_BINDINGS_PATH, { ...payload, id: bindingId }, 'binding_update')
}

export function patchBindingStatus(bindingId: string, status: string, payload: ApiBody = {}) {
  return patchAction(`${CERTIFICATE_BINDINGS_PATH}/status`, { ...payload, bindingId, status }, 'binding_status')
}

export function deleteBinding(bindingId: string, payload: ApiBody = {}) {
  return postAction(`${CERTIFICATE_BINDINGS_PATH}/delete`, { ...payload, bindingId }, 'binding_delete')
}

export function verifyBinding(bindingId: string, payload: ApiBody = {}) {
  // 中文说明：后端暴露的是集合 action，不拼单资源私有路径。
  return persistBindingDriftResult({ bindingId, ...payload })
}

function patchAction(path: string, body: ApiBody = {}, idempotencyPrefix = 'action'): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(path), {
    method: 'PATCH',
    body,
    idempotencyKey: createIdempotencyKey(idempotencyPrefix)
  })
}
