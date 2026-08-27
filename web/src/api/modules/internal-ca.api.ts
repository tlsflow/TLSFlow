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
  updateProvider: (providerId: string, body: ApiBody) => patch(`/api/v1/ca-providers/${encodeURIComponent(providerId)}`, body),
  deleteProvider: (providerId: string) => remove(`/api/v1/ca-providers/${encodeURIComponent(providerId)}`),
  listTrustDomains: () => getList('/api/v1/ca-trust-domains'),
  createTrustDomain: (body: ApiBody) => post('/api/v1/ca-trust-domains', body),
  updateTrustDomain: (trustDomainId: string, body: ApiBody) => patch(`/api/v1/ca-trust-domains/${encodeURIComponent(trustDomainId)}`, body),
  listAuthorities: () => getList('/api/v1/certificate-authorities'),
  deleteAuthority: (authorityId: string) => remove(`/api/v1/certificate-authorities/${encodeURIComponent(authorityId)}`),
  previewAuthority: (body: ApiBody) => post('/api/v1/certificate-authorities/preview', body),
  createAuthority: (body: ApiBody) => post('/api/v1/certificate-authorities', body),
  listProfiles: () => getList('/api/v1/certificate-profiles'),
  createProfile: (body: ApiBody) => post('/api/v1/certificate-profiles', body),
  listRequests: () => getList('/api/v1/certificate-requests'),
  createRequest: (body: ApiBody) => post('/api/v1/certificate-requests', body),
  generateLocalCsr: (requestId: string, body: ApiBody) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/generate-local-csr`, body),
  approveRequest: (requestId: string, approvalId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/approve`, { approvalId }),
  retryRequest: (requestId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/retry`),
  queryRequest: (requestId: string) => post(`/api/v1/certificate-requests/${encodeURIComponent(requestId)}/query`),
  listRenewals: () => getList('/api/v1/certificate-renewals'),
  scanRenewals: () => post('/api/v1/certificate-renewals/scan'),
  listRevocations: () => getList('/api/v1/certificate-revocations'),
  createRevocation: (body: ApiBody) => post('/api/v1/certificate-revocations', body),
  approveRevocation: (revocationId: string, approvalId: string) => post(`/api/v1/certificate-revocations/${encodeURIComponent(revocationId)}/approve`, { approvalId }),
  listProviderActionBindings: (providerId: string) => getList(`/api/v1/ca-providers/${encodeURIComponent(providerId)}/action-bindings`),
  refreshAdcsObservations: (caId: string, force = false) => post('/api/v1/ca-operations/refresh', { caId, force }),
  createProviderActionBinding: (providerId: string, body: ApiBody) => post(`/api/v1/ca-providers/${encodeURIComponent(providerId)}/action-bindings`, body),
  listCertificatePolicies: () => getList('/api/v1/certificate-policies'),
  createCertificatePolicyVersion: (policyId: string, body: ApiBody) => post(`/api/v1/certificate-policies/${encodeURIComponent(policyId)}/versions`, body),
  listCrlPublications: (caId?: string) => getList(`/api/v1/ca-crl-publications${caId ? `?caId=${encodeURIComponent(caId)}` : ''}`),
  publishCrl: (caId: string) => post(`/api/v1/certificate-authorities/${encodeURIComponent(caId)}/crl/publish`),
  listCertificateRotations: () => getList('/api/v1/certificate-rotations'),
  createCertificateRotation: (body: ApiBody) => post('/api/v1/certificate-rotations', body),
  getCertificateRotation: (rotationId: string) => apiClient.get<InternalCaRecord>(toClientPath(`/api/v1/certificate-rotations/${encodeURIComponent(rotationId)}`)),
  getCertificateRotationInstallAction: (rotationId: string) => apiClient.get<InternalCaRecord>(toClientPath(`/api/v1/certificate-rotations/${encodeURIComponent(rotationId)}/install-action`)),
  markCertificateRotationTlsVerified: (rotationId: string, body: ApiBody) => post(`/api/v1/certificate-rotations/${encodeURIComponent(rotationId)}/tls-verify`, body),
  listTrustDistributions: () => getList('/api/v1/ca-trust-distributions'),
  createTrustDistribution: (body: ApiBody) => post('/api/v1/ca-trust-distributions', body),
  approveTrustDistribution: (distributionId: string, approvalId: string) => post(`/api/v1/ca-trust-distributions/${encodeURIComponent(distributionId)}/approve`, { approvalId }),
  listReuseRisks: () => getList('/api/v1/reports/certificate-reuse/items'),
  reuseRiskOverview: () => apiClient.get<InternalCaRecord>(toClientPath('/api/v1/reports/certificate-reuse/overview')),
  previewRemediation: (riskId: string) => post(`/api/v1/reports/certificate-reuse/${encodeURIComponent(riskId)}/remediation-preview`),
  /** 查询宿主 ACME 能力；该状态不经过插件 Runner。 */
  getAcmeStatus: () => apiClient.get<InternalCaRecord>(toClientPath('/api/v1/acme/status')),
  listAcmeAccounts: (providerId?: string) => getList(`/api/v1/acme/accounts${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ''}`),
  createAcmeAccount: (body: ApiBody) => post('/api/v1/acme/accounts', body),
  listAcmeProviderProfiles: () => apiClient.get<InternalCaRecord>(toClientPath('/api/v1/acme/provider-profiles')),
  probeAcmeDirectory: (body: ApiBody) => post('/api/v1/acme/providers/probe-directory', body),
  listAcmeProviders: () => apiClient.get<InternalCaRecord>(toClientPath('/api/v1/acme/providers')),
  createAcmeProvider: (body: ApiBody) => post('/api/v1/acme/providers', body),
  updateAcmeProvider: (providerId: string, body: ApiBody) => patch(`/api/v1/acme/providers/${encodeURIComponent(providerId)}`, body),
  testAcmeProvider: (providerId: string) => post(`/api/v1/acme/providers/${encodeURIComponent(providerId)}/test`),
  listAcmeDnsProviders: () => getList('/api/v1/acme/dns-providers'),
  createAcmeCertificate: (body: ApiBody) => post('/api/v1/acme/certificates', body),
  updateAcmeCertificate: (certificateAssetId: string, body: ApiBody) => patch(`/api/v1/acme/certificates/${encodeURIComponent(certificateAssetId)}`, body),
  deleteAcmeCertificate: (certificateAssetId: string) => remove(`/api/v1/acme/certificates/${encodeURIComponent(certificateAssetId)}`),
  manualRenewAcmeCertificate: (certificateAssetId: string) => post(`/api/v1/acme/certificates/${encodeURIComponent(certificateAssetId)}/renew`),
  listAcmeOrders: (status?: string) => getList(`/api/v1/acme/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  listAcmeRenewalPolicies: () => getList('/api/v1/acme/renewal-policies'),
  updateAcmeRenewalPolicy: (policyId: string, body: ApiBody) => patch(`/api/v1/acme/renewal-policies/${encodeURIComponent(policyId)}`, body),
  listAcmeRenewalJobs: () => getList('/api/v1/acme/renewal-jobs'),
  scanAcmeRenewalJobs: (limit = 50) => post('/api/v1/acme/renewal-jobs/scan', { limit }),
  retryAcmeRenewalJob: (jobId: string) => post(`/api/v1/acme/renewal-jobs/${encodeURIComponent(jobId)}/retry`),
  cancelAcmeRenewalJob: (jobId: string, reason?: string) => post(`/api/v1/acme/renewal-jobs/${encodeURIComponent(jobId)}/cancel`, reason ? { reason } : {}),
}
