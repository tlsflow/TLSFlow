import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'

export type LicenseState = 'unlicensed' | 'active' | 'grace' | 'expired' | 'revoked' | 'clock_rollback_detected'

export interface LicenseStatus {
  readonly state: LicenseState
  readonly installationId: string
  readonly installationPublicKey: string
  readonly productCode: string
  readonly planCode?: string
  readonly grantId?: string
  readonly features: readonly string[]
  readonly quotas: {
    readonly managedTargets: number | null
    readonly concurrentExecutions: number | null
    readonly plugins: number | null
  }
  readonly issuedAt?: string
  readonly startsAt?: string
  readonly expiresAt?: string
  readonly graceEndsAt?: string
  readonly lastClockAt: string
  readonly clockRollbackDetected: boolean
  readonly reason?: string
}

export interface ActivationRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly nonce: string
  readonly kind: 'online' | 'offline'
  readonly productCode: string
  readonly installationId: string
  readonly installationPublicKey: string
  readonly productVersion: string
  readonly requestedAt: string
}

export interface ActivationResponse {
  readonly schemaVersion: 1
  readonly responseId: string
  readonly requestId: string
  readonly nonce: string
  readonly issuedAt: string
  readonly licenseGrant: Record<string, unknown>
  readonly revocationList?: Record<string, unknown>
}

export interface LicenseExport {
  readonly installation: {
    readonly installationId: string
    readonly publicKey: string
    readonly productCode: string
  }
  readonly licenseGrant?: Record<string, unknown>
  readonly revocationList?: Record<string, unknown>
}

export function getLicensingStatus(): Promise<ApiResult<LicenseStatus>> {
  return apiClient.get<LicenseStatus>('/v1/licensing/status')
}

export function exportLicense(): Promise<ApiResult<LicenseExport>> {
  return apiClient.get<LicenseExport>('/v1/licensing/license/export')
}

export function importLicense(body: {
  licenseGrant: Record<string, unknown>
  revocationList?: Record<string, unknown>
}): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/license/import', body)
}

export function createActivationRequest(kind: 'online' | 'offline'): Promise<ApiResult<{ request: ActivationRequest }>> {
  return apiClient.post<{ request: ActivationRequest }>('/v1/licensing/activation-requests', { kind })
}

export function importActivationResponse(activationResponse: ActivationResponse): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/activation-responses/import', { activationResponse })
}

export function importRevocationList(revocationList: Record<string, unknown>): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/revocations/import', { revocationList })
}
