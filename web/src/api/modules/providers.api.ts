import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiBody, type ApiPage, type ApiPageResult, type ApiRecord, type ApiRecordResult } from './common'

const CLOUD_ASSETS_PATH = '/api/v1/cloud-account-assets'

export function listCloudAccountAssets(): Promise<ApiPageResult> {
  return apiClient.get<ApiPage>(toClientPath(CLOUD_ASSETS_PATH))
}

export function createCloudAccountAsset(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(CLOUD_ASSETS_PATH), payload, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_create')
  })
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
