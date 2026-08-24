import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiBody, ApiPage, ApiPageResult, ApiRecord, ApiRecordResult, BusinessListQuery } from './common'
import { buildListPath, toClientPath } from './common'

const DEVICES_PATH = '/api/v1/devices'

export function listManagedDevices(query: BusinessListQuery = {}): Promise<ApiPageResult> {
  return apiClient.get<ApiPage>(buildListPath(DEVICES_PATH, query))
}

export function getManagedDevice(deviceId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(DEVICES_PATH)}/${encodeURIComponent(deviceId)}`)
}

export function listDeviceOnboardingPlatforms() {
  return apiClient.get<readonly Record<string, unknown>[]>(`${toClientPath(DEVICES_PATH)}/onboarding-platforms`)
}

export function onboardManagedDevice(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(`${toClientPath(DEVICES_PATH)}/onboarding`, payload, {
    idempotencyKey: createIdempotencyKey('device_onboarding'),
  })
}
