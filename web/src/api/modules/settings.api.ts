import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import type { HealthResponse } from '@/api/generated/schemas'
import { listRecords, type BusinessListQuery } from './common'

const SETTINGS_PATH = '/api/v1/secrets/metadata'
const HEALTH_PATH = '/v1/health'

export function listSettings(query?: BusinessListQuery) {
  return listRecords(SETTINGS_PATH, query)
}

export function getSystemHealth(): Promise<ApiResult<HealthResponse>> {
  return apiClient.get<HealthResponse>(HEALTH_PATH)
}
