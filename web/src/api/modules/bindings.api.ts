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

export function patchBindingStatus(bindingId: string, status: string, payload: ApiBody = {}) {
  return patchAction(`${CERTIFICATE_BINDINGS_PATH}/status`, { ...payload, bindingId, status }, 'binding_status')
}

export function verifyBinding(bindingId: string, payload: ApiBody = {}) {
  // 中文说明：当前后端没有单资源 verify 路由，前端用 drift action 做最小验证入口，避免请求不存在的私有路径。
  return detectBindingDrift({ bindingId, ...payload })
}

function patchAction(path: string, body: ApiBody = {}, idempotencyPrefix = 'action'): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(path), {
    method: 'PATCH',
    body,
    idempotencyKey: createIdempotencyKey(idempotencyPrefix)
  })
}
