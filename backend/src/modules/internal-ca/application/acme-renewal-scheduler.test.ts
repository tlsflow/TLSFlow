import assert from 'node:assert/strict';
import test from 'node:test';
import { AcmeRenewalScheduler } from './acme-renewal-scheduler.js';

const tenantId = 'tenant-acme-renewal';
const assetId = 'certasset-acme-renewal';
const requestId = 'certreq-acme-initial';
const fixedNow = new Date('2026-08-13T10:00:00.000Z');

function policy() {
  return {
    id: 'acmepolicy-initial',
    tenantId,
    certificateAssetId: assetId,
    providerId: 'caprov-letsencrypt',
    accountId: 'acmeacct-active',
    enabled: true,
    renewalWindowDays: 7,
    challengeType: 'dns-01',
    rotateKeyOnRenewal: true,
    deploymentMode: 'manual',
    maxAttempts: 5,
    backoffSeconds: 300,
    status: 'active',
    version: 1,
    createdBy: 'user-admin',
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
}

function approvedInitialRequest() {
  return {
    id: requestId,
    tenantId,
    applicationAssetId: assetId,
    caId: 'ca-acme',
    trustDomainId: 'catd-acme',
    profileVersionId: 'certprofv-acme',
    keyReferenceId: 'keyref-acme',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'key-sha256',
    idempotencyKey: `acme-initial-request:${assetId}`,
    status: 'approved',
    requestedBy: 'user-admin',
    deferIssuance: true,
    subjectCommonName: '*.ginease.cn',
    sans: [],
    requestedValidityDays: 90,
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
}

function asset() {
  return {
    id: assetId,
    tenantId,
    name: '*.ginease.cn',
    primaryDomain: '*.ginease.cn',
    sans: [],
    sourceType: 'acme',
    status: 'active',
    tags: ['acme'],
    createdBy: 'user-admin',
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
}

test('手动续签会从缺失任务的已批准首次申请恢复，而不生成重复申请', async () => {
  const saved: unknown[] = [];
  let createRequestCalls = 0;
  const scheduler = new AcmeRenewalScheduler({
    listPolicies: async () => [policy()],
    getRenewalJobByWindow: async () => undefined,
    saveRenewalJob: async (job: unknown) => {
      saved.push(job);
      return job;
    },
  } as never, {
    getAsset: async () => asset(),
  } as never, undefined, {
    getRequestByIdempotencyKey: async () => approvedInitialRequest(),
    ensureAcmeIssuanceContext: async () => {
      throw new Error('不应为已有首次申请重复创建签发上下文');
    },
    createCertificateRequest: async () => {
      createRequestCalls += 1;
      throw new Error('不应为已有首次申请重复生成 CSR');
    },
  } as never);

  const job = await scheduler.scheduleManualRenewal(tenantId, assetId, 'user-admin', fixedNow);

  assert.equal(job.certificateRequestId, requestId);
  assert.equal(job.renewalWindowKey, `initial:${assetId}`);
  assert.equal(job.status, 'scheduled');
  assert.equal(createRequestCalls, 0);
  assert.equal(saved.length, 1);
});

test('自动扫描同样从已批准的首次申请恢复缺失任务', async () => {
  const saved: unknown[] = [];
  const enqueued: unknown[] = [];
  const scheduler = new AcmeRenewalScheduler({
    listActivePolicies: async () => [policy()],
    getRenewalJobByWindow: async () => undefined,
    saveRenewalJob: async (job: unknown) => {
      saved.push(job);
      return job;
    },
  } as never, {
    getAsset: async () => asset(),
  } as never, undefined, {
    getRequestByIdempotencyKey: async () => approvedInitialRequest(),
    ensureAcmeIssuanceContext: async () => {
      throw new Error('不应创建重复上下文');
    },
    createCertificateRequest: async () => {
      throw new Error('不应创建重复申请');
    },
  } as never, {
    enqueue: async (input: unknown) => {
      enqueued.push(input);
      return {};
    },
  } as never);

  const jobs = await scheduler.runOnce(10, fixedNow);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.certificateRequestId, requestId);
  assert.equal(saved.length, 1);
  assert.deepEqual(enqueued, [{
    tenantId,
    taskType: 'ACME_CERTIFICATE_RENEWAL',
    triggerSource: 'acme.renewal.scheduler',
    idempotencyKey: `acme-renewal:${jobs[0]!.id}`,
    payload: { renewalJobId: jobs[0]!.id },
    resourceRefs: [{ resourceType: 'acmeRenewalJob', resourceId: jobs[0]!.id }],
  }]);
});

test('已有 ACME 策略的复用资产不因历史来源类型而丢失首次续签上下文', async () => {
  const saved: unknown[] = [];
  const reusedAsset = { ...asset(), sourceType: 'manual' as const };
  const scheduler = new AcmeRenewalScheduler({
    listActivePolicies: async () => [policy()],
    getRenewalJobByWindow: async () => undefined,
    saveRenewalJob: async (job: unknown) => {
      saved.push(job);
      return job;
    },
  } as never, {
    getAsset: async () => reusedAsset,
  } as never, undefined, {
    getRequestByIdempotencyKey: async () => approvedInitialRequest(),
    ensureAcmeIssuanceContext: async () => {
      throw new Error('已有申请不应重新创建上下文');
    },
    createCertificateRequest: async () => {
      throw new Error('已有申请不应重新生成');
    },
  } as never);

  const jobs = await scheduler.runOnce(10, fixedNow);

  assert.equal(jobs.length, 1);
  assert.equal(saved.length, 1);
  assert.equal((jobs[0] as { certificateRequestId?: string }).certificateRequestId, requestId);
});

test('手动续签会重新排队失败的首次申请任务', async () => {
  const failed = {
    id: 'acmerenew-failed',
    tenantId,
    renewalWindowKey: `initial:${assetId}`,
    status: 'failed',
    certificateRequestId: requestId,
    policyId: policy().id,
    promotionStatus: 'not_required',
    attemptCount: 5,
    scheduledAt: fixedNow.toISOString(),
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
  let retried = false;
  const scheduler = new AcmeRenewalScheduler({
    listPolicies: async () => [policy()],
    getRenewalJobByWindow: async () => failed,
    retryRenewalJob: async () => {
      retried = true;
      return { ...failed, status: 'scheduled', attemptCount: 0 };
    },
  } as never, {
    getAsset: async () => asset(),
  } as never, undefined, undefined);

  const job = await scheduler.scheduleManualRenewal(tenantId, assetId, 'user-admin', fixedNow);

  assert.equal(retried, true);
  assert.equal(job.status, 'scheduled');
});

test('首次任务已完成但资产没有当前版本时，手动续签会创建恢复任务', async () => {
  const completed = {
    id: 'acmerenew-completed-without-current-version',
    tenantId,
    renewalWindowKey: `initial:${assetId}`,
    status: 'completed',
    certificateRequestId: requestId,
    policyId: policy().id,
    promotionStatus: 'not_required',
    attemptCount: 1,
    scheduledAt: fixedNow.toISOString(),
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
  const saved: Array<Record<string, unknown>> = [];
  const scheduler = new AcmeRenewalScheduler({
    listPolicies: async () => [policy()],
    getRenewalJobByWindow: async (_tenant: string, _source: string | undefined, windowKey: string) => (
      windowKey === `initial:${assetId}` ? completed : undefined
    ),
    saveRenewalJob: async (job: Record<string, unknown>) => {
      saved.push(job);
      return job;
    },
  } as never, {
    getAsset: async () => asset(),
  } as never, undefined, {
    getRequestByIdempotencyKey: async () => approvedInitialRequest(),
    ensureAcmeIssuanceContext: async () => {
      throw new Error('已有首次申请不应重复创建签发上下文');
    },
    createCertificateRequest: async () => {
      throw new Error('已有首次申请不应重复生成');
    },
  } as never);

  const job = await scheduler.scheduleManualRenewal(tenantId, assetId, 'user-admin', fixedNow);

  assert.equal(job.status, 'scheduled');
  assert.notEqual(job.id, completed.id);
  assert.equal(job.certificateRequestId, requestId);
  assert.equal(job.renewalWindowKey, `manual-initial:${assetId}:${fixedNow.toISOString()}`);
  assert.equal(saved.length, 1);
});
