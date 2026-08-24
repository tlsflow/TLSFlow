import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import type { SupportedLocale } from '@/i18n'
import type { ThemeMode } from '@/preferences/app-preferences'
import type { AuthSessionResponse } from './security.api'

export type SystemInitializationStatus = 'pending' | 'initializing' | 'initialized'

export interface SystemInitializationStatusResponse {
  readonly initialized: boolean
  readonly status: SystemInitializationStatus
}

export interface SystemInitializationResponse {
  readonly initialized: true
  readonly session: AuthSessionResponse
}

export function getSystemInitializationStatus(): Promise<ApiResult<SystemInitializationStatusResponse>> {
  return apiClient.get('/v1/system/initialization')
}

export function initializeSystem(body: {
  username: string
  displayName: string
  password: string
  passwordConfirmation: string
  locale: SupportedLocale
  theme: ThemeMode
}): Promise<ApiResult<SystemInitializationResponse>> {
  return apiClient.post('/v1/system/initialization', body)
}
