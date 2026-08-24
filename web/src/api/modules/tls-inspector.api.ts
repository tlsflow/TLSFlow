import { ApiClient, createIdempotencyKey, readApiRequestContext } from '@/api/client'

export interface TlsInspectorListResult<T> {
  readonly data: {
    readonly items: T[]
    readonly page: number
    readonly pageSize: number
    readonly total: number
  }
  readonly requestId: string
  readonly timestamp: string
}

export interface TlsInspectorTargetRecord {
  readonly id: string
  readonly tenantId: string
  readonly serviceAssetId?: string | null
  readonly host: string
  readonly port: number
  readonly serverName?: string | null
  readonly status: string
  readonly schedule: {
    readonly intervalSeconds: number
  }
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastInspectedAt?: string | null
  readonly latestSnapshotId?: string | null
  readonly latestStatus?: string | null
  readonly latestSummary?: TlsInspectionSummary | null
}

export interface TlsInspectionSummary {
  readonly endpoint: string
  readonly lastInspectedAt?: string
  readonly certificateSubject?: string
  readonly expiresAt?: string
  readonly tls13Supported?: boolean
  readonly legacyProtocolEnabled?: boolean
  readonly weakCipherDetected?: boolean
  readonly trustPathIssueCount?: number
  readonly trustPathUnsupportedCount?: number
  readonly simulationFailedCount?: number
}

export interface TlsInspectionSnapshotListItem {
  readonly id: string
  readonly targetId: string
  readonly status: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly summary: TlsInspectionSummary
  readonly riskSummary: TlsInspectionRiskSummary
}

export interface TlsInspectionRiskSummary {
  readonly legacyProtocolEnabled: boolean
  readonly weakCipherDetected: boolean
  readonly tls13Supported: boolean
  readonly hstsTooShort: boolean
  readonly trustPathIssueCount: number
  readonly trustPathUnsupportedCount: number
  readonly simulationFailedCount: number
  readonly boundaryNotes: string[]
}

export interface TlsInspectionSnapshot {
  readonly id: string
  readonly tenantId: string
  readonly targetId: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: 'succeeded' | 'partial' | 'failed'
  readonly summary: TlsInspectionSummary
  readonly certificate?: {
    readonly subject?: string
    readonly issuer?: string
    readonly commonName?: string | null
    readonly fingerprintSha256?: string
    readonly pinSha256?: string | null
    readonly serialNumber?: string | null
    readonly notBefore?: string
    readonly notAfter?: string
    readonly signatureAlgorithm?: string | null
    readonly keyAlgorithm?: string | null
    readonly keySize?: string | number | null
    readonly subjectAltNames?: string[]
    readonly chain?: Array<{
      readonly subject?: string
      readonly issuer?: string
      readonly fingerprintSha256?: string
      readonly notBefore?: string
      readonly notAfter?: string
      readonly pem?: string
    }>
  } | null
  readonly trustPaths: Array<{
    readonly view: string
    readonly viewLabel: string
    readonly status: string
    readonly errorCode?: string | null
    readonly errorMessage?: string | null
    readonly catalogVersion?: string
    readonly boundaryNote?: string
    readonly path?: Array<{
      readonly position: number
      readonly source: string
      readonly subject?: string
      readonly issuer?: string
      readonly fingerprintSha256?: string
      readonly selfSigned?: boolean
    }>
  }>
  readonly protocols: Array<{
    readonly id: string
    readonly label: string
    readonly supported: boolean
    readonly negotiatedProtocol?: string | null
    readonly negotiatedCipherSuite?: string | null
    readonly errorMessage?: string | null
  }>
  readonly cipherSuites: Array<{
    readonly protocol: string
    readonly standardName: string
    readonly negotiatedName?: string | null
    readonly strengthBits?: number
    readonly forwardSecrecy?: boolean
    readonly insecure?: boolean
    readonly weak?: boolean
    readonly tags?: string[]
  }>
  readonly simulations: Array<{
    readonly profileId: string
    readonly profileName: string
    readonly profileVersion: string
    readonly reference?: boolean
    readonly capabilityNotes?: string[]
    readonly serverCertificate?: string | null
    readonly status: string
    readonly protocol?: string | null
    readonly protocolDisplay?: string | null
    readonly cipherSuite?: string | null
    readonly keyExchange?: string | null
    readonly resultFlags?: string[]
    readonly forwardSecrecy?: boolean | null
    readonly failureReason?: string | null
    readonly explanation?: string | null
    readonly boundaryNote: string
  }>
  readonly protocolDetails: {
    readonly secureRenegotiation?: boolean | null
    readonly insecureClientRenegotiation?: boolean | null
    readonly alpn?: string | null
    readonly serverNameRequired?: boolean | null
    readonly npn?: boolean | null
    readonly ocspStapling?: boolean | null
    readonly sessionResumptionTickets?: boolean | null
    readonly compression?: boolean | null
    readonly forwardSecrecy?: boolean | null
    readonly pqcSupported?: boolean | null
    readonly supportedNamedGroups?: string[]
    readonly hsts?: {
      readonly enabled: boolean
      readonly maxAge?: number | null
      readonly raw?: string | null
      readonly preload?: boolean
      readonly includeSubDomains?: boolean
    }
    readonly httpStatus?: number | null
    readonly httpProtocol?: string | null
    readonly serverHeader?: string | null
    readonly boundaryNotes?: string[]
  }
  readonly riskSummary: TlsInspectionRiskSummary
  readonly implementationVersion: string
  readonly profileCatalogVersion?: string
  readonly trustCatalogVersion?: string
  readonly errors?: Array<{
    readonly code: string
    readonly message: string
  }>
}

const tlsInspectorClient = new ApiClient({
  baseUrl: import.meta.env.VITE_TLS_INSPECTOR_BASE_URL ?? '/tls-inspector',
  getRequestContext: () => readApiRequestContext(),
})

function buildQuery(query: { page?: number; pageSize?: number } = {}): string {
  const params = new URLSearchParams()
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 20))
  return params.toString()
}

export function listTlsInspectorTargets(query?: { page?: number; pageSize?: number }) {
  return tlsInspectorClient.get<TlsInspectorListResult<TlsInspectorTargetRecord>['data']>(
    `/api/v1/tls-inspector/targets?${buildQuery(query)}`,
  ) as Promise<TlsInspectorListResult<TlsInspectorTargetRecord>>
}

export function createTlsInspectorTarget(payload: Readonly<Record<string, unknown>>) {
  return tlsInspectorClient.post<TlsInspectorTargetRecord>(
    '/api/v1/tls-inspector/targets',
    payload,
    { idempotencyKey: createIdempotencyKey('tls_inspector_target_create') },
  )
}

export function deleteTlsInspectorTarget(targetId: string) {
  return tlsInspectorClient.request<TlsInspectorTargetRecord>(
    `/api/v1/tls-inspector/targets/${encodeURIComponent(targetId)}`,
    {
      method: 'DELETE',
      idempotencyKey: createIdempotencyKey('tls_inspector_target_delete'),
    },
  )
}

export function runTlsInspection(targetId: string) {
  return tlsInspectorClient.post<TlsInspectionSnapshot>(
    `/api/v1/tls-inspector/targets/${encodeURIComponent(targetId)}/inspect`,
    {},
    { idempotencyKey: createIdempotencyKey('tls_inspector_scan') },
  )
}

export function getLatestTlsInspection(targetId: string) {
  return tlsInspectorClient.get<TlsInspectionSnapshot>(
    `/api/v1/tls-inspector/targets/${encodeURIComponent(targetId)}/latest`,
  )
}

export function listTlsInspectionSnapshots(targetId: string, query?: { page?: number; pageSize?: number }) {
  return tlsInspectorClient.get<TlsInspectorListResult<TlsInspectionSnapshotListItem>['data']>(
    `/api/v1/tls-inspector/targets/${encodeURIComponent(targetId)}/snapshots?${buildQuery(query)}`,
  ) as Promise<TlsInspectorListResult<TlsInspectionSnapshotListItem>>
}

export function getTlsInspectionSnapshot(snapshotId: string) {
  return tlsInspectorClient.get<TlsInspectionSnapshot>(
    `/api/v1/tls-inspector/snapshots/${encodeURIComponent(snapshotId)}`,
  )
}
