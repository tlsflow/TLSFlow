import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { LegoDnsIssuer } from './lego-dns-issuer.js';

test('lego 不存在时将 DNS-01 任务标记为不可重试的能力缺失', async () => {
  const issuer = new LegoDnsIssuer({
    credentials: {
      get: async () => ({
        id: 'cred-cloudflare',
        kind: 'DNS_PROVIDER',
        status: 'active',
        metadata: { providerId: 'cloudflare' },
        secretSlots: { config: 'secret://password/secret-cloudflare#current' },
      }),
    } as never,
    secrets: {
      resolveForService: async () => ({ plainText: 'CLOUDFLARE_DNS_API_TOKEN=test-token' }),
    } as never,
    runner: {
      run: async () => {
        const error = Object.assign(new Error('spawn lego ENOENT'), { code: 'ENOENT' });
        throw error;
      },
    },
    legoPath: 'lego',
  });

  await assert.rejects(
    issuer.issue({
      tenantId: 'tenant-acme',
      jobId: 'acmerenew-missing-lego',
      request: {
        csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
        subjectCommonName: '*.example.com',
        sans: [],
      },
      provider: { endpoint: 'https://acme-v02.api.letsencrypt.org/directory' },
      dnsProviderId: 'cloudflare',
      dnsCredentialId: 'cred-cloudflare',
      contactEmail: 'admin@example.com',
      actorId: 'system:test',
    }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'CAPABILITY_MISSING'
      && error.message === 'DNS-01 执行节点未安装或无法执行 lego',
  );
});

test('lego 将 DNS-01 标志放在 run 子命令之后，兼容 v5 命令行解析', async () => {
  let capturedArgs: string[] | undefined;
  const issuer = new LegoDnsIssuer({
    credentials: {
      get: async () => ({
        id: 'cred-cloudflare',
        kind: 'DNS_PROVIDER',
        status: 'active',
        metadata: { providerId: 'cloudflare' },
        secretSlots: { config: 'secret://password/secret-cloudflare#current' },
      }),
    } as never,
    secrets: {
      resolveForService: async () => ({ plainText: 'CLOUDFLARE_DNS_API_TOKEN=test-token' }),
    } as never,
    runner: {
      run: async (_command, args) => {
        capturedArgs = args;
        throw new Error('DNS API 返回 403');
      },
    },
  });

  await assert.rejects(
    issuer.issue({
      tenantId: 'tenant-acme',
      jobId: 'acmerenew-argument-order',
      request: {
        csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
        subjectCommonName: '*.example.com',
        sans: [],
      },
      provider: { endpoint: 'https://acme-v02.api.letsencrypt.org/directory' },
      dnsProviderId: 'cloudflare',
      dnsCredentialId: 'cred-cloudflare',
      contactEmail: 'admin@example.com',
      propagationSeconds: 60,
      actorId: 'system:test',
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'ACME_RENEWAL_FAILED',
  );

  assert.equal(capturedArgs?.[0], 'run');
  assert.deepEqual(capturedArgs?.slice(1, 9), [
    '--accept-tos',
    '--email', 'admin@example.com',
    '--server', 'https://acme-v02.api.letsencrypt.org/directory',
    '--dns', 'cloudflare',
    '--path',
  ]);
  assert.equal(capturedArgs?.at(-2), '--dns.propagation.wait');
  assert.equal(capturedArgs?.at(-1), '60s');
});

test('专属策略可直接用 DNS SecretRef，且不读取旧 Credential 明文', async () => {
  let credentialLookups = 0;
  let resolvedSecretRef: string | undefined;
  const issuer = new LegoDnsIssuer({
    credentials: {
      get: async () => { credentialLookups += 1; throw new Error('不应读取历史 Credential'); },
    } as never,
    secrets: {
      resolveForService: async (input: { secretRef: string }) => { resolvedSecretRef = input.secretRef; return { plainText: 'ALICLOUD_ACCESS_KEY=test' }; },
    } as never,
    runner: {
      run: async () => { throw new Error('DNS API 返回 403'); },
    },
  });
  await assert.rejects(() => issuer.issue({
    tenantId: 'tenant-acme',
    jobId: 'acmerenew-secret-ref',
    request: { csrPem: 'csr', subjectCommonName: 'app.example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'alidns',
    dnsCredentialRef: 'secret://password/dns-acme#current',
    contactEmail: 'admin@example.com',
    actorId: 'system:test',
  }), (error: unknown) => error instanceof AppError && error.errorCode === 'ACME_RENEWAL_FAILED');
  assert.equal(credentialLookups, 0);
  assert.equal(resolvedSecretRef, 'secret://password/dns-acme#current');
});
