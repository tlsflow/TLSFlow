import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiRecord, type ApiRecordResult } from './common'

const ROOT = '/api/v1/application-onboarding'

export function listOnboardingPlatforms(locale?: string): Promise<ApiRecordResult> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return apiClient.get<ApiRecord>(toClientPath(`${ROOT}/platforms${suffix}`))
}

export function createOnboardingSession(platformKey: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions`), { platformKey }, { idempotencyKey: createIdempotencyKey('onboarding_session') })
}

export function getOnboardingSession(sessionId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}`))
}

export function listOnboardingDevices(sessionId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/devices`))
}

/** 返回插件声明格式下可用的证书资产与版本；版本已按平台接受格式过滤。 */
export function listOnboardingCertificateOptions(sessionId: string, certificateAssetId?: string): Promise<ApiRecordResult> {
  const params = certificateAssetId ? `?certificateAssetId=${encodeURIComponent(certificateAssetId)}` : ''
  return apiClient.get<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/certificate-options${params}`))
}

export function selectOnboardingResource(sessionId: string, body: Record<string, unknown>): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/resource-selection`), body, { idempotencyKey: createIdempotencyKey('onboarding_resource') })
}

export function testOnboardingConnection(sessionId: string, expectedStateVersion: number): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/test`), { expectedStateVersion }, { idempotencyKey: createIdempotencyKey('onboarding_test') })
}

export function discoverOnboardingTargets(sessionId: string, expectedStateVersion: number): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/discover`), { expectedStateVersion }, { idempotencyKey: createIdempotencyKey('onboarding_discover') })
}

export function listOnboardingTargets(sessionId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/targets`))
}

export function selectOnboardingTarget(sessionId: string, body: Record<string, unknown>): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/target-selection`), body, { idempotencyKey: createIdempotencyKey('onboarding_target') })
}

export function selectOnboardingCertificate(sessionId: string, body: Record<string, unknown>): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/certificate-selection`), body, { idempotencyKey: createIdempotencyKey('onboarding_certificate') })
}

export function completeOnboardingSession(sessionId: string, expectedStateVersion: number): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/complete`), { expectedStateVersion }, { idempotencyKey: createIdempotencyKey('onboarding_complete') })
}

export function cancelOnboardingSession(sessionId: string, expectedStateVersion: number): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/cancel`), { expectedStateVersion }, { idempotencyKey: createIdempotencyKey('onboarding_cancel') })
}
