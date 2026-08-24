import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LegoDnsIssuer, type LegoProcessRunner } from './lego-dns-issuer.js';

const leafCertificate = '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n';
const issuerCertificate = '-----BEGIN CERTIFICATE-----\nISSUER\n-----END CERTIFICATE-----\n';

test('lego DNS Issuer 使用参数数组、临时 env 文件和原生阿里云 Provider code', async () => {
  const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number }> = [];
  let capturedEnvContent = '';
  const runner: LegoProcessRunner = {
    async run(command, args, options) {
      calls.push({ command, args, env: options?.env, timeoutMs: options?.timeoutMs });
      if (options?.cwd) capturedEnvContent = await readFile(join(options.cwd, 'dns-credentials.env'), 'utf8');
      const path = args[args.indexOf('--path') + 1]!;
      const certificates = join(path, 'certificates');
      await mkdir(certificates, { recursive: true });
      await writeFile(join(certificates, 'example.com.crt'), leafCertificate);
      await writeFile(join(certificates, 'example.com.issuer.crt'), issuerCertificate);
      return { stdout: '', stderr: '' };
    },
  };
  const issuer = new LegoDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'alidns' },
          secretSlots: { config: 'secret:password/credential-config/current' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return {
          plainText: 'ALICLOUD_ACCESS_KEY=access-key\nALICLOUD_SECRET_KEY=secret-key',
        } as never;
      },
    },
    runner,
    legoPath: 'lego-test',
  });

  const material = await issuer.issue({
    tenantId: 'tenant-1',
    jobId: 'job-1',
    request: {
      csrPem: 'CSR',
      subjectCommonName: 'example.com',
      sans: ['www.example.com'],
    },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'alidns',
    dnsCredentialId: 'credential-1',
    contactEmail: 'ops@example.com',
    propagationSeconds: 30,
    actorId: 'worker-1',
  });

  assert.equal(material.certificatePem, leafCertificate);
  assert.equal(material.certificateChainPem, `${leafCertificate.trim()}\n${issuerCertificate.trim()}\n`);
  assert.equal(material.certificateUrl, 'lego://job-1');
  assert.equal(calls[0]?.command, 'lego-test');
  assert.equal(calls[0]?.args[0], '--accept-tos');
  assert.equal(calls[0]?.args.at(-1), 'run');
  assert.equal(calls[0]?.args.includes('--dns'), true);
  assert.equal(calls[0]?.args.includes('alidns'), true);
  assert.equal(calls[0]?.args.includes('--env-file'), false);
  assert.equal(calls[0]?.args.includes('--csr'), true);
  assert.equal(calls[0]?.args.includes('--domains'), false);
  assert.equal(calls[0]?.args.includes('--cert.name'), false);
  assert.equal(calls[0]?.args.includes('--no-random-sleep'), false);
  assert.equal(calls[0]?.args.includes('--dns.propagation-wait'), true);
  assert.equal(calls[0]?.args.includes('30s'), true);
  assert.equal(calls[0]?.timeoutMs, 600_000);
  assert.equal(calls[0]?.env?.ALICLOUD_ACCESS_KEY, 'access-key');
  assert.equal(calls[0]?.env?.ALICLOUD_SECRET_KEY, 'secret-key');

  assert.match(capturedEnvContent, /ALICLOUD_ACCESS_KEY=access-key/);
  assert.match(capturedEnvContent, /ALICLOUD_SECRET_KEY=secret-key/);
  assert.equal(capturedEnvContent.includes('dns_aliyun_access_key'), false);
});

test('lego DNS Issuer 支持注释、export 和引号格式的原生环境文件', async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const issuer = new LegoDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'alidns' },
          secretSlots: { config: 'secret:password/credential-config/current' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return {
          plainText: [
            '# 阿里云 DNS',
            'export ALICLOUD_ACCESS_KEY="access-key"',
            "ALICLOUD_SECRET_KEY='secret-key'",
          ].join('\n'),
        } as never;
      },
    },
    runner: {
      async run(_command, args, options) {
        capturedEnv = options?.env;
        const path = args[args.indexOf('--path') + 1]!;
        const certificates = join(path, 'certificates');
        await mkdir(certificates, { recursive: true });
        await writeFile(join(certificates, 'example.com.crt'), leafCertificate);
        return { stdout: '', stderr: '' };
      },
    },
  });

  await issuer.issue({
    tenantId: 'tenant-1',
    jobId: 'job-env-format',
    request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'alidns',
    dnsCredentialId: 'credential-1',
    contactEmail: 'ops@example.com',
    actorId: 'worker-1',
  });

  assert.equal(capturedEnv?.ALICLOUD_ACCESS_KEY, 'access-key');
  assert.equal(capturedEnv?.ALICLOUD_SECRET_KEY, 'secret-key');
});

test('lego DNS Issuer 拒绝不在原生目录中的 Provider code', async () => {
  const issuer = new LegoDnsIssuer({
    credentials: { async get() { return {} as never; } },
    secrets: { async resolveForService() { return {} as never; } },
    runner: { async run() { throw new Error('不应执行'); } },
  });

  await assert.rejects(
    () => issuer.issue({
      tenantId: 'tenant-1',
      jobId: 'job-unsupported',
      request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
      provider: { endpoint: 'https://acme.example.test/directory' },
      dnsProviderId: 'unsupported-provider',
      dnsCredentialId: 'credential-1',
      contactEmail: 'ops@example.com',
      actorId: 'worker-1',
    }),
    /DNS Provider 未注册/,
  );
});

test('lego DNS Issuer 原样写入用户提供的环境文件，不启动字段转换', async () => {
  let called = false;
  const issuer = new LegoDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'alidns' },
          secretSlots: { config: 'secret:password/credential-config/current' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return { plainText: 'ALICLOUD_ACCESS_KEY=access-key' } as never;
      },
    },
    runner: {
      async run() {
        called = true;
        throw new Error('不应执行');
      },
    },
  });

  await assert.rejects(() => issuer.issue({
    tenantId: 'tenant-1',
    jobId: 'job-invalid-credential',
    request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'alidns',
    dnsCredentialId: 'credential-1',
    contactEmail: 'ops@example.com',
    actorId: 'worker-1',
  }), /lego DNS-01 签发失败/);
  assert.equal(called, true);
});

test('lego DNS Issuer 拒绝向子进程注入非 Provider 环境变量', async () => {
  const issuer = new LegoDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'alidns' },
          secretSlots: { config: 'secret:password/credential-config/current' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return {
          plainText: 'ALICLOUD_ACCESS_KEY=access-key\nALICLOUD_SECRET_KEY=secret-key\nPATH=C:\\\\malicious',
        } as never;
      },
    },
    runner: {
      async run() {
        throw new Error('不应执行');
      },
    },
  });

  await assert.rejects(() => issuer.issue({
    tenantId: 'tenant-1',
    jobId: 'job-dangerous-env',
    request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'alidns',
    dnsCredentialId: 'credential-1',
    contactEmail: 'ops@example.com',
    actorId: 'worker-1',
  }), /不属于当前 DNS Provider/);
});
