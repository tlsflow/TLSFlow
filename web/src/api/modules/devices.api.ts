import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiBody, ApiPage, ApiPageResult, ApiRecord, ApiRecordResult, BusinessListQuery } from './common'
import { buildListPath, toClientPath } from './common'

const DEVICES_PATH = '/api/v1/devices'

export function listManagedDevices(query: BusinessListQuery = {}): Promise<ApiPageResult> {
  return apiClient.get<ApiPage>(buildListPath(DEVICES_PATH, query))
}

export function getManagedDevice(deviceId: string, locale?: string): Promise<ApiRecordResult> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return apiClient.get<ApiRecord>(`${toClientPath(DEVICES_PATH)}/${encodeURIComponent(deviceId)}${query}`)
}

export function listDeviceOnboardingPlatforms() {
  return apiClient.get<readonly Record<string, unknown>[]>(`${toClientPath(DEVICES_PATH)}/onboarding-platforms`)
}

export function onboardManagedDevice(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${toClientPath(DEVICES_PATH)}/onboarding`, payload, {
    idempotencyKey: createIdempotencyKey('device_onboarding'),
  })
}

export function executeManagedDeviceCapability(deviceId: string, capabilityKey: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${toClientPath(DEVICES_PATH)}/${encodeURIComponent(deviceId)}/actions`, { capabilityKey }, {
    idempotencyKey: createIdempotencyKey('device_capability'),
  })
}

export function deleteManagedDeviceAsset(deviceAssetId: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath('/api/v1/device-assets/delete'), { deviceAssetId }, {
    idempotencyKey: createIdempotencyKey('device_asset_delete'),
  })
}

export function refreshManagedDeviceDiscovery(deviceId: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`/api/v1/devices/${encodeURIComponent(deviceId)}/actions`), {
    capabilityKey: 'device.discover',
  }, {
    idempotencyKey: createIdempotencyKey('managed_device_discovery'),
  })
}
