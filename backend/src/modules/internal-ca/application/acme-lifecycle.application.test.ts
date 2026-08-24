import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AcmeAccountService } from './acme-account.service.js';
import { AcmeChallengeService } from './acme-challenge.service.js';
import { AcmeOrderService } from './acme-order.service.js';
import { AcmeRenewalScheduler } from './acme-renewal-scheduler.js';
import { AcmeRenewalWorker } from './acme-renewal-worker.js';
import { CertificatePromotionService } from './certificate-promotion.service.js';
import type { AcmeAuthorizationSnapshot, AcmeProviderAdapter } from '../providers/acme-provider.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type {
  AcmeAccountEntity,
  AcmeAuthorizationEntity,
  AcmeChallengeEntity,
  AcmeOrderEntity,
  AcmeRenewalJobEntity,
  AcmeRenewalPolicyEntity,
} from '../schema/acme.schema.js';
import type { CaProviderEntity, CertificateRequestEntity } from '../schema/internal-ca.schema.js';

const tenantId = 'tenant-acme-application';
const now = '2026-08-05T00:00:00.000Z';

test('ACME Account Service 按 Provider、Directory 和 SecretRef 幂等且不返回私钥引用', async () => {
  const provider = providerEntity();
  const accountKeySecretRef = 'secret://certificate_private_key/account#current';
  const savedAccounts: AcmeAccountEntity[] = [];
  let createCalls = 0;
  const repository = {
    getAccountByKey: async () => savedAccounts[0],
    saveAccount: async (entity: AcmeAccountEntity) => {
      savedAccounts[0] = structuredClone(entity);
      return entity;
    },
  };
  const caRepository = { getProvider: async () => provider };
  const adapter = {
    createAccount: async () => {
      createCalls += 1;
      return { accountUrl: 'https://acme.example.test/acct/1', status: 'active' as const };
    },
  };
  const secrets = {
    resolveForService: async () => ({ plainText: 'resolved-secret' }),
  };
  const service = new AcmeAccountService(
    repository as unknown as AcmeRepository,
    caRepository as never,
    adapter as unknown as AcmeProviderAdapter,
    secrets as never,
  );

  const input = {
    tenantId,
    providerId: provider.id,
    accountKeySecretRef,
    contact: ['mailto:PKI@example.com'],
    termsOfServiceAgreed: true,
    actorId: 'user-acme',
  };
  const first = await service.create(input);
  const second = await service.create(input);

  assert.equal(first.status, 'active');
  assert.deepEqual(first.contact, ['mailto:pki@example.com']);
  assert.equal('accountKeySecretRef' in first, false);
  assert.equal(second.id, first.id);
  assert.equal(createCalls, 1);
});

test('ACME Order Service 固定 CSR/SAN 快照并创建对应 Authorization/Challenge', async () => {
  const provider = providerEntity();
  const account = accountEntity();
  const request = requestEntity();
  const order = orderEntity();
  const authorization = authorizationEntity();
  const challenge = challengeEntity();
  let savedRequest = request;
  let savedOrder: AcmeOrderEntity | undefined;
  let savedChallenge: AcmeChallengeEntity | undefined;
  const repository = {
    getAccount: async () => account,
    getOrderByRequest: async () => undefined,
    saveOrder: async (entity: AcmeOrderEntity) => {
      savedOrder = structuredClone(entity);
      return entity;
    },
    getAuthorizationByUrl: async () => undefined,
    saveAuthorization: async (entity: AcmeAuthorizationEntity) => entity,
    getChallengeByUrl: async () => undefined,
    saveChallenge: async (entity: AcmeChallengeEntity) => {
      savedChallenge = structuredClone(entity);
      return entity;
    },
    listChallenges: async () => savedChallenge ? [savedChallenge] : [],
  };
  const caRepository = {
    getProvider: async () => provider,
    getRequest: async () => request,
    saveRequest: async (entity: CertificateRequestEntity) => {
      savedRequest = structuredClone(entity);
      return entity;
    },
  };
  const adapter = {
    createOrder: async () => ({
      externalOrderUrl: order.externalOrderUrl,
      status: 'pending' as const,
      identifiers: order.identifiers,
      authorizationUrls: order.authorizationUrls,
      finalizeUrl: order.finalizeUrl,
    }),
    getAuthorization: async () => ({
      externalAuthorizationUrl: authorization.externalAuthorizationUrl,
      identifier: authorization.identifier,
      status: authorization.status,
      wildcard: authorization.wildcard,
      challenges: [{
        url: challenge.externalChallengeUrl,
        type: challenge.type,
        token: 'token-value',
        status: 'pending' as const,
      }],
    }),
    buildKeyAuthorization: async () => ({
      keyAuthorization: 'token-value.account-thumbprint',
      thumbprint: 'account-thumbprint',
    }),
  };
  const service = new AcmeOrderService(
    repository as unknown as AcmeRepository,
    caRepository as never,
    adapter as unknown as AcmeProviderAdapter,
  );

  const result = await service.create({
    tenantId,
    providerId: provider.id,
    accountId: account.id,
    certificateRequestId: request.id,
    challengeType: 'http-01',
    idempotencyKey: 'acme-order-idempotency-1',
    actorId: 'user-acme',
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.identifiers[0]?.value, 'app.example.com');
  assert.equal(result.challengeCount, 1);
  assert.equal(savedOrder?.csrSha256, request.csrSha256);
  assert.equal(savedRequest.status, 'issuing');
  assert.equal(savedChallenge?.tokenSha256, createHash('sha256').update('token-value').digest('hex'));
  assert.equal(savedChallenge?.keyAuthorizationSha256, createHash('sha256').update('token-value.account-thumbprint').digest('hex'));
  assert.equal(JSON.stringify(savedChallenge).includes('token-value'), false);
});

test('ACME Challenge Service 对 presented/processing 只刷新 CA 状态，不重复呈现', async () => {
  const provider = providerEntity();
  const account = accountEntity();
  const challenge = challengeEntity({ status: 'processing' });
  const authorization = authorizationEntity({
    challenges: [{
      url: challenge.externalChallengeUrl,
      type: challenge.type,
      token: 'token-value',
      status: 'processing',
    }],
  });
  let presentCalls = 0;
  let respondCalls = 0;
  const savedChallenges: AcmeChallengeEntity[] = [];
  const repository = {
    getChallenge: async () => challenge,
    getOrder: async () => orderEntity(),
    getAccount: async () => account,
    listAuthorizations: async () => [authorization],
    saveAuthorization: async (entity: AcmeAuthorizationEntity) => entity,
    saveChallenge: async (entity: AcmeChallengeEntity) => {
      savedChallenges.push(structuredClone(entity));
      return entity;
    },
    claimChallenge: async () => {
      throw new Error('不应重复获取呈现租约');
    },
  };
  const caRepository = { getProvider: async () => provider };
  const providerAdapter = {
    getAuthorization: async () => authorization,
    buildKeyAuthorization: async () => ({ keyAuthorization: 'token-value.account-thumbprint', thumbprint: 'account-thumbprint' }),
    respondToChallenge: async () => {
      respondCalls += 1;
      return { status: 'processing' };
    },
  };
  const adapter = {
    type: 'http-01' as const,
    validate: async () => ({ supported: true }),
    present: async () => {
      presentCalls += 1;
      return { presentationId: 'presentation-1' };
    },
    cleanup: async () => ({ cleaned: true }),
  };
  const service = new AcmeChallengeService({
    repository: repository as unknown as AcmeRepository,
    caRepository: caRepository as never,
    provider: providerAdapter as unknown as AcmeProviderAdapter,
    adapters: { 'http-01': adapter },
  });

  const result = await service.presentFromProvider({
    tenantId,
    challengeId: challenge.id,
    actorId: 'worker-acme',
    leaseOwner: 'worker-acme',
  });

  assert.equal(result.status, 'processing');
  assert.equal(presentCalls, 0);
  assert.equal(respondCalls, 0);
  assert.equal(savedChallenges.length, 1);
});

test('ACME Renewal Worker 失败时按策略退避并释放租约，旧证书不被触碰', async () => {
  let currentJob = renewalJobEntity();
  const policy = policyEntity();
  const repository = {
    listDueRenewalJobs: async () => [currentJob],
    claimRenewalJob: async () => currentJob,
    getPolicy: async () => policy,
    saveRenewalJob: async (entity: AcmeRenewalJobEntity) => {
      currentJob = structuredClone(entity);
      return currentJob;
    },
  };
  const internalCa = {
    getRepository: () => ({
      getIssuanceByCertificateVersion: async () => undefined,
    }),
  };
  const fixedNow = new Date(now);
  const worker = new AcmeRenewalWorker({
    repository: repository as unknown as AcmeRepository,
    certificates: {} as never,
    internalCa: internalCa as never,
    orders: {} as never,
    challenges: {} as never,
    leaseOwner: 'worker-acme',
    now: () => fixedNow,
  });

  const result = await worker.runOnce(1, 'worker-acme');

  assert.equal(result[0]?.status, 'retry_waiting');
  assert.equal(result[0]?.attemptCount, 1);
  assert.equal(result[0]?.failureCode, 'ACME_RENEWAL_FAILED');
  assert.equal(result[0]?.leaseOwner, undefined);
  assert.equal(result[0]?.nextAttemptAt, '2026-08-05T00:05:00.000Z');
});

test('ACME Renewal Scheduler 支持按 Binding 当前版本创建续签任务', async () => {
  const policy = {
    ...policyEntity(),
    certificateAssetId: undefined,
    bindingId: 'binding-acme-application',
  };
  const sourceVersion = {
    ...versionEntity(),
    id: 'version-acme-old',
    notAfter: '2026-08-20T00:00:00.000Z',
    activationState: 'promoted' as const,
  };
  let savedJob: AcmeRenewalJobEntity | undefined;
  const scheduler = new AcmeRenewalScheduler(
    {
      listActivePolicies: async () => [policy],
      getRenewalJobByWindow: async () => undefined,
      saveRenewalJob: async (job: AcmeRenewalJobEntity) => {
        savedJob = structuredClone(job);
        return job;
      },
    } as unknown as AcmeRepository,
    {
      getAsset: async () => {
        throw new Error('Binding 策略不应读取 certificateAssetId');
      },
      getVersion: async () => sourceVersion,
    } as never,
    {
      getCertificateBinding: async () => ({
        id: 'binding-acme-application',
        certificateVersionId: sourceVersion.id,
      }),
    } as never,
  );

  const result = await scheduler.runOnce(1, new Date(now));

  assert.equal(result.length, 1);
  assert.equal(savedJob?.sourceCertificateVersionId, sourceVersion.id);
  assert.equal(savedJob?.certificateVersionId, sourceVersion.id);
});

test('ACME Renewal Worker 在证书已暂存后恢复部署，不重复下载或导入证书', async () => {
  let currentJob: AcmeRenewalJobEntity = {
    ...renewalJobEntity(),
    certificateRequestId: 'request-acme-issued',
    certificateVersionId: 'version-acme-new',
    status: 'deploying',
    deploymentPlanId: 'plan-1',
    executionRunId: 'run-1',
  };
  let promoted = false;
  let markedActive = false;
  const issuedRequest: CertificateRequestEntity = {
    ...requestEntity(),
    id: 'request-acme-issued',
    status: 'issued',
    certificateVersionId: 'version-acme-new',
  };
  const repository = {
    listDueRenewalJobs: async () => [currentJob],
    claimRenewalJob: async () => currentJob,
    getPolicy: async () => policyEntity(),
    getRenewalJob: async () => currentJob,
    saveRenewalJob: async (entity: AcmeRenewalJobEntity) => {
      currentJob = structuredClone(entity);
      return currentJob;
    },
  };
  const internalCa = {
    getRepository: () => ({
      getIssuanceByCertificateVersion: async () => ({ certificateRequestId: requestEntity().id }),
      getRequest: async (_tenantId: string, requestId: string) => requestId === issuedRequest.id ? issuedRequest : requestEntity(),
    }),
    importAcmeCertificate: async () => {
      throw new Error('已暂存证书不应重复导入');
    },
    markRequestActive: async () => {
      markedActive = true;
      return issuedRequest;
    },
  };
  const deployments = {
    get: async () => ({
      id: 'plan-1',
      certificateVersionId: issuedRequest.certificateVersionId,
      status: 'SUCCESS',
    }),
  };
  const executions = {
    getRun: async () => ({ id: 'run-1', deploymentPlanId: 'plan-1', status: 'SUCCESS' }),
    listSteps: async () => [{
      stepType: 'VERIFY',
      status: 'SUCCESS',
      inputSnapshot: {
        resultDetail: {
          verify: {
            success: true,
            remoteCertificateSha256: versionEntity().fingerprintSha256,
          },
        },
      },
    }],
  };
  const worker = new AcmeRenewalWorker({
    repository: repository as unknown as AcmeRepository,
    certificates: {} as never,
    internalCa: internalCa as never,
    orders: {
      getEntity: async () => { throw new Error('已暂存证书不应读取 ACME Order'); },
    } as never,
    challenges: {} as never,
    deployments: deployments as never,
    executions: executions as never,
    promotion: {
      promote: async (input: { certificateVersionId: string }) => {
        assert.equal(input.certificateVersionId, issuedRequest.certificateVersionId);
        promoted = true;
        return versionEntity();
      },
    } as never,
    leaseOwner: 'worker-acme',
    now: () => new Date(now),
  });

  const result = await worker.runOnce(1, 'worker-acme');

  assert.equal(result[0]?.status, 'completed');
  assert.equal(promoted, true);
  assert.equal(markedActive, true);
  assert.equal(currentJob.certificateVersionId, issuedRequest.certificateVersionId);
});

test('Certificate Promotion Service 只接受匹配的部署、执行和 TLS Verify 结果', async () => {
  let promoted = false;
  const stagedVersion = {
    ...versionEntity(),
    activationState: 'staged' as const,
  };
  const certificates = {
    getRepository: () => ({
      getVersion: async () => stagedVersion,
    }),
    promoteVersion: async () => {
      promoted = true;
      return { ...stagedVersion, activationState: 'promoted' as const };
    },
  };
  const deploymentPlans = {
    getPlan: async () => ({
      id: 'plan-1',
      certificateVersionId: stagedVersion.id,
      status: 'SUCCESS',
    }),
  };
  const executions = {
    getRun: async () => ({
      id: 'run-1',
      deploymentPlanId: 'plan-1',
      status: 'SUCCESS',
    }),
  };
  const service = new CertificatePromotionService(
    certificates as never,
    deploymentPlans as never,
    executions as never,
  );

  await assert.rejects(
    () => service.promote({
      tenantId,
      certificateVersionId: stagedVersion.id,
      deploymentPlanId: 'plan-1',
      executionRunId: 'run-1',
      tlsVerify: { success: true, certificateFingerprintSha256: 'wrong-fingerprint' },
      actorId: 'user-acme',
    }),
    (error: unknown) => error instanceof Error && error.message.includes('TLS Verify 指纹'),
  );
  assert.equal(promoted, false);

  const result = await service.promote({
    tenantId,
    certificateVersionId: stagedVersion.id,
    deploymentPlanId: 'plan-1',
    executionRunId: 'run-1',
    tlsVerify: { success: true, certificateFingerprintSha256: stagedVersion.fingerprintSha256 },
    actorId: 'user-acme',
  });
  assert.equal(result.activationState, 'promoted');
  assert.equal(promoted, true);
});

function providerEntity(): CaProviderEntity {
  return {
    id: 'provider-acme-application',
    tenantId,
    name: 'ACME Test Provider',
    type: 'acme',
    deploymentMode: 'external',
    runtimePlatform: 'external',
    availabilityMode: 'active_active',
    capabilities: {
      discoverHierarchy: false,
      createRoot: false,
      createIntermediate: false,
      signCsr: false,
      queryIssuance: false,
      revokeCertificate: false,
      publishCrl: false,
      ocsp: false,
      listProfiles: false,
      deviceLocalCsr: false,
      hardwareBackedKey: false,
      highAvailability: false,
    },
    status: 'active',
    configuration: {
      directoryUrl: 'https://acme.example.test/directory',
      allowedChallenges: ['http-01'],
      verifyTls: true,
      termsOfServiceAgreed: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function accountEntity(): AcmeAccountEntity {
  return {
    id: 'account-acme-application',
    tenantId,
    providerId: providerEntity().id,
    directoryUrlHash: 'directory-hash',
    accountUrl: 'https://acme.example.test/acct/1',
    accountKeySecretRef: 'secret://certificate_private_key/account#current',
    contact: ['mailto:pki@example.com'],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function requestEntity(): CertificateRequestEntity {
  return {
    id: 'request-acme-application',
    tenantId,
    applicationAssetId: 'asset-app',
    caId: 'ca-acme',
    profileVersionId: 'profile-version-acme',
    keyReferenceId: 'key-acme',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'public-key-sha256',
    idempotencyKey: 'request-idempotency',
    status: 'approved',
    requestedBy: 'user-acme',
    subjectCommonName: 'app.example.com',
    sans: ['app.example.com', 'api.example.com'],
    requestedValidityDays: 90,
    createdAt: now,
    updatedAt: now,
  };
}

function orderEntity(): AcmeOrderEntity {
  return {
    id: 'order-acme-application',
    tenantId,
    providerId: providerEntity().id,
    accountId: accountEntity().id,
    certificateRequestId: requestEntity().id,
    externalOrderUrl: 'https://acme.example.test/order/1',
    status: 'pending',
    identifiers: [{ type: 'dns', value: 'app.example.com' }, { type: 'dns', value: 'api.example.com' }],
    authorizationUrls: ['https://acme.example.test/authz/1'],
    finalizeUrl: 'https://acme.example.test/order/1/finalize',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function authorizationEntity(
  input: Partial<AcmeAuthorizationEntity> & Partial<Pick<AcmeAuthorizationSnapshot, 'challenges'>> = {},
): AcmeAuthorizationEntity & Pick<AcmeAuthorizationSnapshot, 'challenges'> {
  return {
    id: 'authorization-acme-application',
    tenantId,
    orderId: orderEntity().id,
    externalAuthorizationUrl: 'https://acme.example.test/authz/1',
    identifier: { type: 'dns', value: 'app.example.com' },
    status: 'pending',
    wildcard: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  } as AcmeAuthorizationEntity & Pick<AcmeAuthorizationSnapshot, 'challenges'>;
}

function challengeEntity(input: Partial<AcmeChallengeEntity> = {}): AcmeChallengeEntity {
  return {
    id: 'challenge-acme-application',
    tenantId,
    orderId: orderEntity().id,
    authorizationId: authorizationEntity().id,
    externalChallengeUrl: 'https://acme.example.test/challenge/1',
    type: 'http-01',
    identifier: 'app.example.com',
    tokenSha256: createHash('sha256').update('token-value').digest('hex'),
    keyAuthorizationSha256: createHash('sha256').update('token-value.account-thumbprint').digest('hex'),
    status: 'pending',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function policyEntity(): AcmeRenewalPolicyEntity {
  return {
    id: 'policy-acme-application',
    tenantId,
    certificateAssetId: 'asset-app',
    providerId: providerEntity().id,
    accountId: accountEntity().id,
    enabled: true,
    renewalWindowDays: 30,
    challengeType: 'http-01',
    rotateKeyOnRenewal: true,
    deploymentMode: 'automatic',
    maxAttempts: 5,
    backoffSeconds: 300,
    status: 'active',
    version: 1,
    createdBy: 'user-acme',
    createdAt: now,
    updatedAt: now,
  };
}

function renewalJobEntity(): AcmeRenewalJobEntity {
  return {
    id: 'renewal-acme-application',
    tenantId,
    certificateVersionId: 'version-acme-old',
    sourceCertificateVersionId: 'version-acme-old',
    renewalWindowKey: '2026-08-20:policy-1',
    status: 'scheduled',
    policyId: policyEntity().id,
    promotionStatus: 'pending',
    attemptCount: 0,
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function versionEntity() {
  return {
    id: 'version-acme-new',
    certificateAssetId: 'asset-app',
    versionNo: 2,
    commonName: 'app.example.com',
    sans: ['app.example.com'],
    issuer: { raw: 'CN=ACME Test CA' },
    subject: { raw: 'CN=app.example.com' },
    serialNumber: '01',
    notBefore: now,
    notAfter: '2026-11-03T00:00:00.000Z',
    fingerprintSha256: 'a'.repeat(64),
    publicKeyAlgorithm: 'rsa',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: 'artifact://certificate-leaf/new',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid' as const,
    deployable: true,
    activationState: 'staged' as const,
    sourceType: 'acme' as const,
    status: 'active' as const,
    createdBy: 'user-acme',
    createdAt: now,
  };
}
