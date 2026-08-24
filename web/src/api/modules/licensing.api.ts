import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'

export type LicenseState = 'none' | 'active' | 'upgrade_grace' | 'grace' | 'expired' | 'revoked' | 'clock_rollback_detected'
export type LicenseIntegrityStatus = 'not_configured' | 'verified' | 'tampered' | 'invalid'

export interface LicenseStatus {
  readonly state: LicenseState
  readonly integrityStatus: LicenseIntegrityStatus
  readonly installationId: string
  readonly installationPublicKey: string
  readonly deviceId: string
  readonly productCode: string
  readonly currentVersion: string
  readonly planCode?: string
  readonly licenseSchemaVersion?: 1 | 2
  readonly grantId?: string
  readonly features: readonly string[]
  readonly quotas: {
    readonly applicationAssets: number | null
    readonly managedTargets: number | null
    readonly concurrentExecutions: number | null
    readonly plugins: number | null
  }
  readonly usage?: {
    readonly applicationAssets: number
  }
  readonly issuedAt?: string
  readonly startsAt?: string
  readonly expiresAt?: string
  readonly graceEndsAt?: string
  readonly versionRange?: {
    readonly min?: string
    readonly max?: string
  }
  readonly versionCompatible: boolean
  readonly versionMismatchDetectedAt?: string
  readonly upgradeGraceEndsAt?: string
  readonly lastClockAt: string
  readonly clockRollbackDetected: boolean
  readonly reason?: string
}

export interface ActivationRequest {
  readonly schemaVersion: 1 | 2
  readonly requestId: string
  readonly nonce: string
  readonly kind: 'offline'
  readonly productCode: string
  readonly installationId: string
  readonly installationPublicKey: string
  readonly deviceId?: string
  readonly productVersion: string
  readonly requestedAt: string
}

export interface ActivationResponse {
  readonly schemaVersion: 1 | 2
  readonly responseId: string
  readonly requestId: string
  readonly nonce: string
  readonly issuedAt: string
  readonly licenseGrant: Record<string, unknown>
  readonly revocationList?: Record<string, unknown>
}

export function getLicensingStatus(): Promise<ApiResult<LicenseStatus>> {
  return apiClient.get<LicenseStatus>('/v1/licensing/status')
}

export function importLicense(body: {
  licenseGrant: Record<string, unknown>
  revocationList?: Record<string, unknown>
}): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/license/import', body)
}

export function createActivationRequest(): Promise<ApiResult<{ request: ActivationRequest }>> {
  return apiClient.post<{ request: ActivationRequest }>('/v1/licensing/activation-requests', { kind: 'offline' })
}

export function importActivationResponse(activationResponse: ActivationResponse): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/activation-responses/import', { activationResponse })
}

export function importRevocationList(revocationList: Record<string, unknown>): Promise<ApiResult<LicenseStatus>> {
  return apiClient.post<LicenseStatus>('/v1/licensing/revocations/import', { revocationList })
}
