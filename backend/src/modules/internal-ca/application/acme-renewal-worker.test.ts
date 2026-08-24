import assert from 'node:assert/strict';
import test from 'node:test';
import { AcmeRenewalWorker } from './acme-renewal-worker.js';

const tenantId = 'tenant-acme-initial-worker';
const now = new Date('2026-08-13T10:00:00.000Z');

test('恢复的首次 ACME 任务复用已批准申请签发，不重复创建 CSR 或申请', async () => {
  const initialJob = {
    id: 'acmerenew-initial',
    tenantId,
    renewalWindowKey: 'initial:certasset-acme',
    status: 'scheduled' as const,
    certificateRequestId: 'certreq-initial',
    policyId: 'acmepolicy-initial',
    promotionStatus: 'not_required' as const,
    attemptCount: 0,
    scheduledAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const request = {
    id: 'certreq-initial',
    tenantId,
    applicationAssetId: 'certasset-acme',
    caId: 'ca-acme',
    trustDomainId: 'catd-acme',
    profileVersionId: 'certprofv-acme',
    keyReferenceId: 'keyref-acme',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'key-sha256',
    idempotencyKey: 'acme-initial-request:certasset-acme',
    status: 'approved' as const,
    requestedBy: 'user-admin',
    deferIssuance: true,
    subjectCommonName: '*.example.com',
    sans: [],
    requestedValidityDays: 90,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const policy = {
    id: 'acmepolicy-initial',
    tenantId,
    certificateAssetId: request.applicationAssetId,
    providerId: 'caprov-letsencrypt',
    accountId: 'acmeacct-active',
    enabled: true,
    renewalWindowDays: 7,
    challengeType: 'dns-01' as const,
    rotateKeyOnRenewal: true,
    deploymentMode: 'manual' as const,
    maxAttempts: 5,
    backoffSeconds: 300,
    maintenanceWindow: {
      dnsProvider: 'cloudflare',
      dnsCredentialId: 'cred-cloudflare',
      contactEmail: 'admin@example.com',
    },
    status: 'active' as const,
    version: 1,
    createdBy: 'user-admin',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const saved: unknown[] = [];
  let createRequestCalls = 0;
  let legoRequestId: string | undefined;
  let promotedVersionId: string | undefined;
  const worker = new AcmeRenewalWorker({
    repository: {
      listDueRenewalJobs: async () => [initialJob],
      claimRenewalJob: async () => initialJob,
      getPolicy: async () => policy,
      saveRenewalJob: async (job: unknown) => {
        saved.push(job);
        return job;
      },
    } as never,
    certificates: {
      getVersion: async () => ({
        id: 'certver-issued',
        certificateAssetId: request.applicationAssetId,
        status: 'active',
        activationState: 'staged',
      }),
      promoteVersionAtomic: async (certificateVersionId: string) => {
        promotedVersionId = certificateVersionId;
        return {
          id: certificateVersionId,
          certificateAssetId: request.applicationAssetId,
          status: 'active',
          activationState: 'promoted',
        };
      },
    } as never,
    internalCa: {
      getRepository: () => ({
        getRequest: async () => request,
        getProvider: async () => ({ id: policy.providerId, type: 'acme' }),
      }),
      createCertificateRequest: async () => {
        createRequestCalls += 1;
        throw new Error('恢复任务不应创建第二条证书申请');
      },
      importAcmeCertificate: async () => ({
        ...request,
        status: 'issued' as const,
        certificateVersionId: 'certver-issued',
      }),
    } as never,
    orders: {} as never,
    challenges: {} as never,
    lego: {
      issue: async (input: { request: { id: string } }) => {
        legoRequestId = input.request.id;
        return {
          certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
          certificateChainPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        };
      },
    } as never,
    leaseOwner: 'test-worker',
    now: () => now,
  });

  const jobs = await worker.runOnce();

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.status, 'completed');
  assert.equal(jobs[0]?.certificateRequestId, request.id);
  assert.equal(jobs[0]?.certificateVersionId, 'certver-issued');
  assert.equal(jobs[0]?.promotionStatus, 'promoted');
  assert.equal(promotedVersionId, 'certver-issued');
  assert.equal(legoRequestId, request.id);
  assert.equal(createRequestCalls, 0);
  assert.equal(saved.length, 1);
});

test('已签发证书被删除后，首次恢复任务会创建新申请而不是重试旧版本', async () => {
  const job = {
    id: 'acmerenew-recover-deleted-version',
    tenantId,
    renewalWindowKey: 'manual-initial:certasset-deleted',
    status: 'scheduled' as const,
    certificateRequestId: 'certreq-deleted',
    policyId: 'acmepolicy-deleted',
    promotionStatus: 'not_required' as const,
    attemptCount: 0,
    scheduledAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const deletedRequest = {
    id: job.certificateRequestId,
    tenantId,
    applicationAssetId: 'certasset-deleted',
    caId: 'ca-acme',
    trustDomainId: 'catd-acme',
    profileVersionId: 'certprofv-acme',
    keyReferenceId: 'keyref-deleted',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'key-sha256',
    idempotencyKey: 'acme-initial-request:certasset-deleted',
    status: 'issued' as const,
    certificateVersionId: 'certver-deleted',
    requestedBy: 'user-admin',
    deferIssuance: true,
    subjectCommonName: '*.example.com',
    sans: [],
    requestedValidityDays: 90,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const recoveredRequest = {
    ...deletedRequest,
    id: 'certreq-recovered',
    idempotencyKey: `acme-renewal-recovery-request:${job.id}`,
    status: 'approved' as const,
    certificateVersionId: undefined,
  };
  const policy = {
    id: job.policyId,
    tenantId,
    certificateAssetId: deletedRequest.applicationAssetId,
    providerId: 'caprov-letsencrypt',
    accountId: 'acmeacct-active',
    enabled: true,
    renewalWindowDays: 7,
    challengeType: 'dns-01' as const,
    rotateKeyOnRenewal: true,
    deploymentMode: 'manual' as const,
    maxAttempts: 5,
    backoffSeconds: 300,
    maintenanceWindow: {
      domains: ['*.example.com'],
      dnsProvider: 'cloudflare',
      dnsCredentialId: 'cred-cloudflare',
      contactEmail: 'admin@example.com',
    },
    status: 'active' as const,
    version: 1,
    createdBy: 'user-admin',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const saved: Array<Record<string, unknown>> = [];
  let createdIdempotencyKey: string | undefined;
  let legoRequestId: string | undefined;
  let promotedVersionId: string | undefined;
  const worker = new AcmeRenewalWorker({
    repository: {
      listDueRenewalJobs: async () => [job],
      claimRenewalJob: async () => job,
      getPolicy: async () => policy,
      saveRenewalJob: async (value: Record<string, unknown>) => {
        saved.push(value);
        return value;
      },
    } as never,
    certificates: {
      getAsset: async () => ({
        id: deletedRequest.applicationAssetId,
        primaryDomain: deletedRequest.subjectCommonName,
        sans: [],
      }),
      getVersion: async (certificateVersionId: string) => certificateVersionId === 'certver-reissued'
        ? { id: certificateVersionId, certificateAssetId: deletedRequest.applicationAssetId, status: 'active', activationState: 'staged' }
        : undefined,
      promoteVersionAtomic: async (certificateVersionId: string) => {
        promotedVersionId = certificateVersionId;
        return { id: certificateVersionId, certificateAssetId: deletedRequest.applicationAssetId, status: 'active', activationState: 'promoted' };
      },
    } as never,
    internalCa: {
      getRepository: () => ({
        getRequest: async (_tenantId: string, requestId: string) => requestId === deletedRequest.id ? deletedRequest : recoveredRequest,
        getProvider: async () => ({ id: policy.providerId, type: 'acme' }),
      }),
      ensureAcmeIssuanceContext: async () => ({
        caId: 'ca-acme',
        trustDomainId: 'catd-acme',
        profileVersionId: 'certprofv-acme',
      }),
      createCertificateRequest: async (_tenantId: string, input: { idempotencyKey: string }) => {
        createdIdempotencyKey = input.idempotencyKey;
        return recoveredRequest;
      },
      importAcmeCertificate: async (_tenantId: string, requestId: string) => ({
        ...recoveredRequest,
        id: requestId,
        status: 'issued' as const,
        certificateVersionId: 'certver-reissued',
      }),
    } as never,
    orders: {} as never,
    challenges: {} as never,
    lego: {
      issue: async (input: { request: { id: string } }) => {
        legoRequestId = input.request.id;
        return {
          certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
          certificateChainPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        };
      },
    } as never,
    leaseOwner: 'test-worker',
    now: () => now,
  });

  const [result] = await worker.runOnce();

  assert.equal(result?.status, 'completed');
  assert.equal(result?.certificateRequestId, recoveredRequest.id);
  assert.equal(result?.certificateVersionId, 'certver-reissued');
  assert.equal(createdIdempotencyKey, `acme-renewal-recovery-request:${job.id}`);
  assert.equal(legoRequestId, recoveredRequest.id);
  assert.equal(promotedVersionId, 'certver-reissued');
  assert.equal(saved[0]?.certificateRequestId, undefined);
  assert.equal(saved[1]?.certificateRequestId, recoveredRequest.id);
});

test('DNS-01 签发失败时保留已持久化的证书申请和原始失败原因', async () => {
  const job = {
    id: 'acmerenew-failed-dns',
    tenantId,
    certificateVersionId: 'certver-source',
    sourceCertificateVersionId: 'certver-source',
    renewalWindowKey: 'manual:certver-source',
    status: 'scheduled' as const,
    policyId: 'acmepolicy-dns',
    promotionStatus: 'not_required' as const,
    attemptCount: 0,
    scheduledAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const policy = {
    id: 'acmepolicy-dns',
    tenantId,
    certificateAssetId: 'certasset-dns',
    providerId: 'caprov-letsencrypt',
    accountId: 'acmeacct-active',
    enabled: true,
    renewalWindowDays: 7,
    challengeType: 'dns-01' as const,
    rotateKeyOnRenewal: true,
    deploymentMode: 'manual' as const,
    maxAttempts: 5,
    backoffSeconds: 300,
    maintenanceWindow: {
      domains: ['*.example.com'],
      dnsProvider: 'cloudflare',
      dnsCredentialId: 'cred-cloudflare',
      contactEmail: 'admin@example.com',
    },
    status: 'active' as const,
    version: 1,
    createdBy: 'user-admin',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const request = {
    id: 'certreq-dns',
    tenantId,
    applicationAssetId: 'certasset-dns',
    caId: 'ca-acme',
    trustDomainId: 'catd-acme',
    profileVersionId: 'certprofv-acme',
    keyReferenceId: 'keyref-dns',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'key-sha256',
    idempotencyKey: 'acme-renewal-request:acmerenew-failed-dns',
    status: 'approved' as const,
    requestedBy: 'user-admin',
    deferIssuance: true,
    subjectCommonName: '*.example.com',
    sans: [],
    requestedValidityDays: 90,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const sourceRequest = {
    ...request,
    id: 'certreq-source',
    keyReferenceId: 'keyref-source',
  };
  const persisted = { ...job, certificateRequestId: request.id, status: 'issuing' as const };
  const saved: Record<string, unknown>[] = [];
  const worker = new AcmeRenewalWorker({
    repository: {
      listDueRenewalJobs: async () => [job],
      claimRenewalJob: async () => job,
      getPolicy: async () => policy,
      getRenewalJob: async () => persisted,
      saveRenewalJob: async (value: Record<string, unknown>) => {
        saved.push(value);
        return value;
      },
    } as never,
    certificates: {} as never,
    internalCa: {
      getRepository: () => ({
        getIssuanceByCertificateVersion: async () => ({ certificateRequestId: sourceRequest.id }),
        getRequest: async (_tenantId: string, requestId: string) => requestId === sourceRequest.id ? sourceRequest : request,
        getKeyReference: async () => ({ custodyMode: 'managed_secret' }),
        getProvider: async () => ({ id: policy.providerId, type: 'acme' }),
      }),
      createCertificateRequest: async () => request,
    } as never,
    orders: {} as never,
    challenges: {} as never,
    lego: {
      issue: async () => {
        throw new Error('Cloudflare API 返回 403');
      },
    } as never,
    leaseOwner: 'test-worker',
    now: () => now,
  });

  const [result] = await worker.runOnce();

  assert.equal(result?.status, 'retry_waiting');
  assert.equal(result?.certificateRequestId, request.id);
  assert.equal(result?.failureMessage, 'Cloudflare API 返回 403');
  assert.equal(saved.at(-1)?.certificateRequestId, request.id);
});

test('DNS-01 签发期间取消任务后不导入证书，也不覆盖取消状态', async () => {
  const job = {
    id: 'acmerenew-cancelled-dns',
    tenantId,
    renewalWindowKey: 'initial:certasset-cancelled',
    status: 'issuing' as const,
    certificateRequestId: 'certreq-cancelled',
    policyId: 'acmepolicy-cancelled',
    promotionStatus: 'not_required' as const,
    attemptCount: 0,
    scheduledAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const request = {
    id: job.certificateRequestId,
    tenantId,
    applicationAssetId: 'certasset-cancelled',
    caId: 'ca-acme',
    trustDomainId: 'catd-acme',
    profileVersionId: 'certprofv-acme',
    keyReferenceId: 'keyref-cancelled',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'key-sha256',
    idempotencyKey: `acme-renewal-request:${job.id}`,
    status: 'approved' as const,
    requestedBy: 'user-admin',
    deferIssuance: true,
    subjectCommonName: '*.example.com',
    sans: [],
    requestedValidityDays: 90,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const cancelled = { ...job, status: 'cancelled' as const, failureCode: 'ACME_RENEWAL_CANCELLED' };
  let current: typeof job | typeof cancelled = job;
  let imported = false;
  const worker = new AcmeRenewalWorker({
    repository: {
      listDueRenewalJobs: async () => [job],
      claimRenewalJob: async () => job,
      getPolicy: async () => ({
        id: job.policyId,
        tenantId,
        certificateAssetId: request.applicationAssetId,
        providerId: 'caprov-letsencrypt',
        accountId: 'acmeacct-active',
        enabled: true,
        renewalWindowDays: 7,
        challengeType: 'dns-01' as const,
        rotateKeyOnRenewal: true,
        deploymentMode: 'manual' as const,
        maxAttempts: 5,
        backoffSeconds: 300,
        maintenanceWindow: { dnsProvider: 'cloudflare', dnsCredentialId: 'cred-cloudflare', contactEmail: 'admin@example.com' },
        status: 'active' as const,
        version: 1,
        createdBy: 'user-admin',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
      getRenewalJob: async () => current,
      saveRenewalJob: async (value: typeof job) => value,
    } as never,
    certificates: {} as never,
    internalCa: {
      getRepository: () => ({
        getRequest: async () => request,
        getProvider: async () => ({ id: 'caprov-letsencrypt', type: 'acme' }),
      }),
      importAcmeCertificate: async () => {
        imported = true;
        return { ...request, certificateVersionId: 'certver-cancelled' };
      },
    } as never,
    orders: {} as never,
    challenges: {} as never,
    lego: {
      issue: async () => {
        current = cancelled;
        return {
          certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
          certificateChainPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        };
      },
    } as never,
    leaseOwner: 'test-worker',
    now: () => now,
  });

  const [result] = await worker.runOnce();

  assert.equal(result?.status, 'cancelled');
  assert.equal(imported, false);
});
