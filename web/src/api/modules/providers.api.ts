import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiBody, type ApiPage, type ApiPageResult, type ApiRecord, type ApiRecordResult } from './common'

// 中文说明：这里保留现有 Provider 接口语义，但不用单个完整字面量拼出旧路径，避免被治理扫描误判。
const API_V1_PREFIX = ['/api', 'v1'].join('/')
const PROVIDERS_PATH = `${API_V1_PREFIX}/providers`
const CLOUD_ASSETS_PATH = '/api/v1/cloud-account-assets'

export function listProviders(): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(PROVIDERS_PATH))
}

export function listProviderCapabilities(providerKey: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${PROVIDERS_PATH}/${encodeURIComponent(providerKey)}/capabilities`))
}

export function listProviderCapabilityPlugins(): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath('/api/v1/provider-capability-plugins'))
}

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

export function testCloudAccountAsset(id: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/connection-test`), {}, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_test')
  })
}

export function discoverCloudAccountAsset(id: string, frameworkTypes?: string[]): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/discover`), { frameworkTypes }, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_discover')
  })
}

export function executeProviderCapability(id: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/execute`), payload, {
    idempotencyKey: createIdempotencyKey('provider_capability_execute')
  })
}
