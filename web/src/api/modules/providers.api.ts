import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiBody, type ApiPage, type ApiPageResult, type ApiRecord, type ApiRecordResult } from './common'

const CLOUD_ASSETS_PATH = '/api/v1/cloud-account-assets'

export function listCloudAccountAssets(): Promise<ApiPageResult> {
  return apiClient.get<ApiPage>(toClientPath(CLOUD_ASSETS_PATH))
}

export function getCloudAccountAsset(id: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}`))
}

export function updateCloudAccountAsset(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(CLOUD_ASSETS_PATH), {
    method: 'PATCH',
    body: payload,
    idempotencyKey: createIdempotencyKey('cloud_account_asset_update')
  })
}

export function deleteCloudAccountAsset(id: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/delete`), { id }, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_delete')
  })
}

export function listCloudAccountResources(id: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/resources`))
}

/** 重新发现标准云服务资产的资源并刷新持久化投影。 */
export function discoverServiceAssetResources(id: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`/api/v1/service-assets/${encodeURIComponent(id)}/discover`), {}, {
    idempotencyKey: createIdempotencyKey('service_asset_discovery'),
    timeoutMs: 90_000,
  })
}
