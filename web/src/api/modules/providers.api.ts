import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiBody, ApiRecord, ApiRecordResult } from './common'

const PROVIDERS_PATH = '/api/v1/providers'
const CLOUD_ASSETS_PATH = '/api/v1/cloud-account-assets'

export function listProviders(): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(PROVIDERS_PATH)
}

export function listProviderCapabilities(providerKey?: string): Promise<ApiRecordResult> {
  const query = providerKey ? `?providerKey=${encodeURIComponent(providerKey)}` : ''
  return apiClient.get<ApiRecord>(`/api/v1/provider-capability-plugins${query}`)
}

export function listProviderCapabilityPlugins(): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>('/api/v1/provider-capability-plugins')
}

export function listCloudAccountAssets(): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(CLOUD_ASSETS_PATH)
}

export function createCloudAccountAsset(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(CLOUD_ASSETS_PATH, payload, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_create')
  })
}

export function updateCloudAccountAsset(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(CLOUD_ASSETS_PATH, {
    method: 'PATCH',
    body: payload,
    idempotencyKey: createIdempotencyKey('cloud_account_asset_update')
  })
}

export function deleteCloudAccountAsset(id: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${CLOUD_ASSETS_PATH}/delete`, { id }, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_delete')
  })
}

export function testCloudAccountAsset(id: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/connection-test`, {}, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_test')
  })
}

export function discoverCloudAccountAsset(id: string, frameworkTypes?: string[]): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/discover`, { frameworkTypes }, {
    idempotencyKey: createIdempotencyKey('cloud_account_asset_discover')
  })
}

export function executeProviderCapability(id: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${CLOUD_ASSETS_PATH}/${encodeURIComponent(id)}/execute`, payload, {
    idempotencyKey: createIdempotencyKey('provider_capability_execute')
  })
}
