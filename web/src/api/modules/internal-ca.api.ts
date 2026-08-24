import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath, type ApiBody } from './common'

export type InternalCaRecord = Record<string, unknown>

function getList(path: string) {
  return apiClient.get<InternalCaRecord[]>(toClientPath(path))
}

function post(path: string, body: ApiBody = {}) {
  return apiClient.post<InternalCaRecord>(toClientPath(path), body, { idempotencyKey: createIdempotencyKey('internal_ca') })
}

function patch(path: string, body: ApiBody = {}) {
  return apiClient.request<InternalCaRecord>(toClientPath(path), { method: 'PATCH', body })
}

function remove(path: string) {
  return apiClient.request<InternalCaRecord>(toClientPath(path), { method: 'DELETE' })
}

export const internalCaApi = {
  listProviders: () => getList('/api/v1/ca-providers'),
  createProvider: (body: ApiBody) => post('/api/v1/ca-providers', body),
  deleteProvider: (providerId: string) => remove(`/api/v1/ca-providers/${encodeURIComponent(providerId)}`),
  listTrustDomains: () => getList('/api/v1/ca-trust-domains'),
  createTrustDomain: (body: ApiBody) => post('/api/v1/ca-trust-domains', body),
  updateTrustDomain: (trustDomainId: string, body: ApiBody) => patch(`/api/v1/ca-trust-domains/${encodeURIComponent(trustDomainId)}`, body),
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
  createNodeEnrollmentToken: (providerId: string, ttlMinutes = 30) => post('/api/v1/ca-nodes/enrollment-tokens', { providerId, ttlMinutes }),
  createAdcsAgentInstallSession: (body: ApiBody = {}) => post('/api/v1/adcs-agents/install-sessions', body),
  createAdcsAgentUpdateSession: (providerId: string) => post(`/api/v1/adcs-agents/providers/${encodeURIComponent(providerId)}/update-sessions`),
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
  listAcmeAccounts: (providerId?: string) => getList(`/api/v1/acme/accounts${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ''}`),
  createAcmeAccount: (body: ApiBody) => post('/api/v1/acme/accounts', body),
  getAcmeAccount: (accountId: string) => apiClient.get<InternalCaRecord>(toClientPath(`/api/v1/acme/accounts/${encodeURIComponent(accountId)}`)),
  listAcmeOrders: () => getList('/api/v1/acme/orders'),
  createAcmeOrder: (body: ApiBody) => post('/api/v1/acme/orders', body),
  getAcmeOrder: (orderId: string) => apiClient.get<InternalCaRecord>(toClientPath(`/api/v1/acme/orders/${encodeURIComponent(orderId)}`)),
  reconcileAcmeOrder: (orderId: string) => post(`/api/v1/acme/orders/${encodeURIComponent(orderId)}/reconcile`),
  finalizeAcmeOrder: (orderId: string) => post(`/api/v1/acme/orders/${encodeURIComponent(orderId)}/finalize`),
  listAcmeRenewalPolicies: () => getList('/api/v1/acme/renewal-policies'),
  createAcmeRenewalPolicy: (body: ApiBody) => post('/api/v1/acme/renewal-policies', body),
  updateAcmeRenewalPolicy: (policyId: string, body: ApiBody) => patch(`/api/v1/acme/renewal-policies/${encodeURIComponent(policyId)}`, body),
  listAcmeRenewalJobs: () => getList('/api/v1/acme/renewal-jobs'),
  scanAcmeRenewalJobs: (limit = 50) => post('/api/v1/acme/renewal-jobs/scan', { limit }),
  runAcmeRenewalJobs: (limit = 10) => post('/api/v1/acme/renewal-jobs/run', { limit }),
  retryAcmeRenewalJob: (jobId: string) => post(`/api/v1/acme/renewal-jobs/${encodeURIComponent(jobId)}/retry`),
}
