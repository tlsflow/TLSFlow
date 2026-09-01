import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { AcmeOrderService } from './acme-order.service.js';

const tenantId = 'tenant-acme-order';
const providerId = 'provider-acme-order';
const requestId = 'request-acme-order';

function provider() {
  return {
    id: providerId,
    tenantId,
    name: 'ACME Test',
    type: 'acme',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
    endpoint: 'https://acme.example.test/directory',
    configuration: {
      directoryUrl: 'https://acme.example.test/directory',
      allowedChallenges: ['dns-01'],
      verifyTls: true,
    },
    capabilities: {},
    status: 'active',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    tenantId,
    applicationAssetId: 'application-acme-order',
    certificateAssetId: 'certificate-acme-order',
    applicationCertificatePolicyVersionId: 'policy-version-acme-order',
    caId: 'ca-acme-order',
    profileVersionId: 'profile-version-acme-order',
    keyReferenceId: 'keyref-acme-order',
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
    csrSha256: 'csr-sha256',
    publicKeyFingerprintSha256: 'spki-sha256',
    idempotencyKey: 'idempotency-acme-order',
    status: 'approved',
    requestedBy: 'operator',
    subjectCommonName: 'app.example.com',
    sans: [],
    requestedValidityDays: 90,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    policyVersionId: 'policy-version-acme-order',
    tenantId,
    applicationAssetId: 'application-acme-order',
    supplyMode: 'dedicated',
    providerType: 'acme',
    providerId,
    certificateAssetId: 'certificate-acme-order',
    dnsProviderId: 'cloudflare',
    credentialRef: 'secret://password/dns-acme-order#current',
    assetTenantId: tenantId,
    assetApplicationAssetId: 'application-acme-order',
    ...overrides,
  };
}

function createHarness(options: {
  currentRequest?: Record<string, unknown>;
  currentBinding?: Record<string, unknown>;
  resolveSecret?: () => Promise<{ plainText: string }>;
  existingOrder?: Record<string, unknown>;
} = {}) {
  let createOrderCalls = 0;
  const service = new AcmeOrderService(
    {
      getAccount: async () => ({
        id: 'account-acme-order',
        tenantId,
        providerId,
        directoryUrlHash: 'directory-hash',
        accountKeySecretRef: 'secret://certificate_private_key/account#current',
        contact: ['mailto:ops@example.com'],
        status: 'active',
      }),
      getOrderByRequest: async () => options.existingOrder,
      listChallenges: async () => [],
    } as never,
    {
      getRequest: async () => options.currentRequest ?? request(),
      getProvider: async () => provider(),
      getApplicationCertificatePolicyBinding: async () => options.currentBinding ?? binding(),
    } as never,
    {
      createOrder: async () => {
        createOrderCalls += 1;
        throw new Error('不应调用 ACME Provider');
      },
    } as never,
    options.resolveSecret ? { resolveForService: options.resolveSecret } as never : undefined,
  );
  return { service, getCreateOrderCalls: () => createOrderCalls };
}

const input = {
  tenantId,
  providerId,
  accountId: 'account-acme-order',
  certificateRequestId: requestId,
  challengeType: 'dns-01' as const,
  idempotencyKey: 'idempotency-acme-order',
  actorId: 'operator',
};

test('专属 ACME 的应用、策略版本和证书资产归属不一致时拒绝创建 Order', async () => {
  const harness = createHarness({ currentBinding: binding({ applicationAssetId: 'other-application' }) });

  await assert.rejects(
    () => harness.service.create(input),
    (error: unknown) => error instanceof AppError && error.errorCode === 'DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT',
  );
  assert.equal(harness.getCreateOrderCalls(), 0);
});

test('专属 ACME 缺少 DNS SecretRef 时拒绝且不触碰 Provider', async () => {
  const harness = createHarness({ currentBinding: binding({ credentialRef: undefined }) });

  await assert.rejects(
    () => harness.service.create(input),
    (error: unknown) => error instanceof AppError && error.errorCode === 'ACME_DNS_AUTHORIZATION_REQUIRED',
  );
  assert.equal(harness.getCreateOrderCalls(), 0);
});

test('专属 ACME 的 DNS Secret 解析或内容校验失败时拒绝且不创建 Order', async () => {
  const harness = createHarness({
    resolveSecret: async () => { throw new Error('secret unavailable'); },
  });

  await assert.rejects(
    () => harness.service.create(input),
    (error: unknown) => error instanceof AppError && error.errorCode === 'ACME_DNS_AUTHORIZATION_REQUIRED',
  );
  assert.equal(harness.getCreateOrderCalls(), 0);
});

test('无应用策略版本的历史 ACME 申请保持兼容', async () => {
  const existingOrder = {
    id: 'acme-order-existing',
    tenantId,
    providerId,
    accountId: 'account-acme-order',
    certificateRequestId: requestId,
    externalOrderUrl: 'https://acme.example.test/order/1',
    status: 'processing',
    identifiers: [{ type: 'dns', value: 'app.example.com' }],
    authorizationUrls: [],
    attemptCount: 1,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
  const harness = createHarness({
    currentRequest: request({
      applicationCertificatePolicyVersionId: undefined,
      certificateAssetId: undefined,
    }),
    existingOrder,
  });

  const result = await harness.service.create(input);
  assert.equal(result.id, existingOrder.id);
  assert.equal(harness.getCreateOrderCalls(), 0);
});
