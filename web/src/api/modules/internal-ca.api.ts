import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiBody } from './common'

export type InternalCaRecord = Record<string, unknown>

function getList(path: string) {
  return apiClient.get<InternalCaRecord[]>(toClientPath(path))
}

function post(path: string, body: ApiBody = {}) {
  return apiClient.post<InternalCaRecord>(toClientPath(path), body, { idempotencyKey: createIdempotencyKey('internal_ca') })
}

export const internalCaApi = {
  listProviders: () => getList('/api/v1/ca-providers'),
  createProvider: (body: ApiBody) => post('/api/v1/ca-providers', body),
  listAuthorities: () => getList('/api/v1/certificate-authorities'),
  previewAuthority: (body: ApiBody) => post('/api/v1/certificate-authorities/preview', body),
  createAuthority: (body: ApiBody) => post('/api/v1/certificate-authorities', body),
  listProfiles: () => getList('/api/v1/certificate-profiles'),
  createProfile: (body: ApiBody) => post('/api/v1/certificate-profiles', body),
  listRequests: () => getList('/api/v1/certificate-requests'),
  createRequest: (body: ApiBody) => post('/api/v1/certificate-requests', body),
  approveRequest: (requestId: string, approvalId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/approve`, { approvalId }),
  retryRequest: (requestId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/retry`),
  queryRequest: (requestId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/query`),
  listNodes: () => getList('/api/v1/ca-nodes'),
  listRenewals: () => getList('/api/v1/certificate-renewals'),
  scanRenewals: () => post('/api/v1/certificate-renewals/scan'),
  listRevocations: () => getList('/api/v1/certificate-revocations'),
  createRevocation: (body: ApiBody) => post('/api/v1/certificate-revocations', body),
  approveRevocation: (revocationId: string, approvalId: string) => post(`/api/v1/certificate-revocations/${encodeURIComponent(revocationId)}/approve`, { approvalId }),
  listTrustDistributions: () => getList('/api/v1/ca-trust-distributions'),
  createTrustDistribution: (body: ApiBody) => post('/api/v1/ca-trust-distributions', body),
  approveTrustDistribution: (distributionId: string, approvalId: string) => post(`/api/v1/ca-trust-distributions/${encodeURIComponent(distributionId)}/approve`, { approvalId }),
  listReuseRisks: () => getList('/api/v1/reports/certificate-reuse/items'),
  reuseRiskOverview: () => apiClient.get<InternalCaRecord>(toClientPath('/api/v1/reports/certificate-reuse/overview')),
  previewRemediation: (riskId: string) => post(`/api/v1/reports/certificate-reuse/${encodeURIComponent(riskId)}/remediation-preview`),
}
