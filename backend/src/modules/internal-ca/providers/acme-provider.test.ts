import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import { AcmeProviderAdapter } from './acme-provider.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const accountKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const provider: CaProviderEntity = {
  id: 'provider-acme-test',
  tenantId: 'tenant-acme-test',
  name: '测试 ACME',
  type: 'acme',
  deploymentMode: 'external',
  runtimePlatform: 'external',
  availabilityMode: 'active_active',
  status: 'active',
  endpoint: 'https://acme.example.test',
  capabilities: {
    discoverHierarchy: false,
    createRoot: false,
    createIntermediate: false,
    signCsr: true,
    queryIssuance: true,
    revokeCertificate: true,
    publishCrl: false,
    ocsp: false,
    listProfiles: false,
    deviceLocalCsr: false,
    hardwareBackedKey: false,
    highAvailability: true,
  },
  configuration: {
    directoryUrl: 'https://acme.example.test/directory',
    allowedChallenges: ['http-01', 'dns-01'],
    requestTimeoutMs: 5_000,
  },
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

function secrets(): SecretService {
  return {
    resolveForService: async (input: { secretRef: string }) => ({
      secretRef: input.secretRef,
      versionId: 'version-1',
      plainText: accountKeyPem,
      fingerprint: 'fingerprint',
    }),
  } as unknown as SecretService;
}

test('ACME Provider 完成 Directory、Nonce、RSA JWS Account/Order 请求并处理 badNonce', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let orderAttempts = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ method, url, body });
    if (method === 'GET') {
      return new Response(JSON.stringify({
        newNonce: 'https://acme.example.test/nonce',
        newAccount: 'https://acme.example.test/account',
        newOrder: 'https://acme.example.test/order',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'replay-nonce': `nonce-${requests.length}` } });
    }
    if (url.endsWith('/account')) {
      return new Response(JSON.stringify({ status: 'valid' }), {
        status: 201,
        headers: { location: 'https://acme.example.test/account/1', 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/order')) {
      orderAttempts += 1;
      if (orderAttempts === 1) {
        return new Response(JSON.stringify({ type: 'urn:ietf:params:acme:error:badNonce', detail: 'retry' }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json', 'replay-nonce': 'rejected-nonce' },
        });
      }
      return new Response(JSON.stringify({
        status: 'pending',
        identifiers: [{ type: 'dns', value: 'example.com' }],
        authorizations: ['https://acme.example.test/authz/1'],
        finalize: 'https://acme.example.test/order/1/finalize',
      }), {
        status: 201,
        headers: {
          location: 'https://acme.example.test/order/1',
          'content-type': 'application/json',
          'retry-after': '2',
        },
      });
    }
    throw new Error(`未处理的测试请求 ${method} ${url}`);
  }) as typeof fetch;
  try {
    const adapter = new AcmeProviderAdapter(secrets());
    const account = await adapter.createAccount({
      provider,
      accountKeySecretRef: 'secret://certificate_private_key/account-key#current',
      contact: ['mailto:pki@example.com'],
      termsOfServiceAgreed: true,
      actorId: 'actor-1',
    });
    assert.deepEqual(account, { accountUrl: 'https://acme.example.test/account/1', status: 'active' });

    const order = await adapter.createOrder({
      provider,
      account: {
        id: 'account-1',
        tenantId: provider.tenantId,
        providerId: provider.id,
        directoryUrlHash: 'hash',
        accountUrl: account.accountUrl,
        accountKeySecretRef: 'secret://certificate_private_key/account-key#current',
        contact: ['mailto:pki@example.com'],
        status: 'active',
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      },
      identifiers: [{ type: 'dns', value: 'example.com' }],
      actorId: 'actor-1',
    });
    assert.equal(order.status, 'pending');
    assert.equal(order.externalOrderUrl, 'https://acme.example.test/order/1');
    assert.equal(order.retryAfterAt !== undefined, true);

    const jws = requests.find((request) => request.url.endsWith('/order') && request.body)?.body;
    assert.ok(jws);
    assert.equal(typeof jws?.protected, 'string');
    const protectedHeader = JSON.parse(Buffer.from(String(jws?.protected), 'base64url').toString('utf8')) as Record<string, unknown>;
    assert.equal(protectedHeader.kid, account.accountUrl);
    assert.equal(typeof jws?.signature, 'string');
    assert.equal(requests.filter((request) => request.url.endsWith('/order')).length, 2);
    assert.equal(requests.some((request) => JSON.stringify(request.body ?? {}).includes(accountKeyPem)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ACME Provider 将 Retry-After HTTP 日期保留为可调度时间', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({
        newNonce: 'https://acme.example.test/nonce',
        newAccount: 'https://acme.example.test/account',
        newOrder: 'https://acme.example.test/order',
      }), { status: 200 });
    }
    if ((init?.method ?? 'GET') === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'replay-nonce': 'nonce-1' } });
    }
    if (url.endsWith('/order')) {
      return new Response(JSON.stringify({ type: 'urn:ietf:params:acme:error:rateLimited' }), {
        status: 429,
        headers: { 'retry-after': 'Wed, 05 Aug 2026 00:00:30 GMT' },
      });
    }
    throw new Error(`未处理的测试请求 ${url}`);
  }) as typeof fetch;
  try {
    const adapter = new AcmeProviderAdapter(secrets());
    await assert.rejects(() => adapter.createOrder({
      provider,
      account: {
        id: 'account-1',
        tenantId: provider.tenantId,
        providerId: provider.id,
        directoryUrlHash: 'hash',
        accountUrl: 'https://acme.example.test/account/1',
        accountKeySecretRef: 'secret://certificate_private_key/account-key#current',
        contact: [],
        status: 'active',
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      },
      identifiers: [{ type: 'dns', value: 'example.com' }],
      actorId: 'actor-1',
    }), (error: unknown) => {
      return error instanceof Error
        && 'errorCode' in error
        && error.errorCode === 'ACME_RATE_LIMITED'
        && typeof (error as { details?: { retryAfterAt?: string } }).details?.retryAfterAt === 'string';
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
