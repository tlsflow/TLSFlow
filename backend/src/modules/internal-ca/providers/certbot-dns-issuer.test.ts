import assert from 'node:assert/strict';
import test from 'node:test';
import { CertbotDnsIssuer, type CertbotProcessRunner } from './certbot-dns-issuer.js';

test('Certbot DNS Issuer 使用参数数组、临时凭据和完整 DNS-01 参数', async () => {
  const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner: CertbotProcessRunner = {
    async run(command, args, options) {
      calls.push({ command, args, env: options?.env });
      if (command === 'certbot') {
        await import('node:fs/promises').then(async ({ writeFile }) => {
          await writeFile(args[args.indexOf('--cert-path') + 1]!, 'CERTIFICATE');
          await writeFile(args[args.indexOf('--fullchain-path') + 1]!, 'FULLCHAIN');
        });
      }
      return { stdout: '', stderr: '' };
    },
  };
  const issuer = new CertbotDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'cloudflare' },
          secretSlots: { config: 'secret:password/credential-config/current' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return { plainText: 'dns_cloudflare_api_token = test-token' } as never;
      },
    },
    runner,
    certbotVersion: '5.7.0',
    autoInstallPlugins: true,
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
    dnsProviderId: 'cloudflare',
    dnsCredentialId: 'credential-1',
    contactEmail: 'ops@example.com',
    propagationSeconds: 30,
    actorId: 'worker-1',
  });

  assert.equal(material.certificatePem, 'CERTIFICATE');
  assert.equal(material.certificateChainPem, 'FULLCHAIN');
  assert.equal(calls[0]?.command, 'python3');
  assert.deepEqual(calls[0]?.args.slice(0, 4), ['-m', 'pip', 'install', '--disable-pip-version-check']);
  const certbotCall = calls.find((item) => item.command === 'certbot');
  assert.ok(certbotCall);
  assert.equal(Array.isArray(certbotCall.args), true);
  assert.equal(certbotCall.args.includes('--authenticator'), true);
  assert.equal(certbotCall.args.includes('dns-cloudflare'), true);
  assert.equal(certbotCall.args.includes('--dns-cloudflare-credentials'), true);
  assert.equal(certbotCall.args.includes('--dns-cloudflare-propagation-seconds'), true);
  assert.equal(certbotCall.args.includes('dns_cloudflare_api_token = test-token'), false);
  assert.equal(calls[0]?.args.includes('acme=={{certbot-version}}'), false);
  assert.equal(calls[0]?.args.includes('acme==5.7.0'), true);
});

test('Certbot Route53 使用临时 AWS 配置文件且不传已移除的传播参数', async () => {
  const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner: CertbotProcessRunner = {
    async run(command, args, options) {
      calls.push({ command, args, env: options?.env });
      if (command === 'certbot') {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(args[args.indexOf('--cert-path') + 1]!, 'CERTIFICATE');
        await writeFile(args[args.indexOf('--fullchain-path') + 1]!, 'FULLCHAIN');
      }
      return { stdout: '', stderr: '' };
    },
  };
  const issuer = new CertbotDnsIssuer({
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'route53' },
          secretSlots: { config: 'secret:password/credential-config/route53' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return { plainText: '[default]\naws_access_key_id=test\naws_secret_access_key=test' } as never;
      },
    },
    runner,
    autoInstallPlugins: false,
  });

  await issuer.issue({
    tenantId: 'tenant-1',
    jobId: 'job-route53',
    request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'route53',
    dnsCredentialId: 'credential-route53',
    contactEmail: 'ops@example.com',
    propagationSeconds: 30,
    actorId: 'worker-1',
  });

  const certbotCall = calls.find((item) => item.command === 'certbot');
  assert.ok(certbotCall);
  assert.equal(certbotCall.args.includes('--dns-route53-propagation-seconds'), false);
  assert.equal(certbotCall.env?.AWS_CONFIG_FILE?.includes('dns-credentials.ini'), true);
  assert.equal(certbotCall.args.includes('test'), false);
});

test('Certbot 插件安装失败后不会永久阻塞后续重试', async () => {
  let installAttempts = 0;
  const runner: CertbotProcessRunner = {
    async run(command, args) {
      if (command === 'python3') {
        installAttempts += 1;
        if (installAttempts === 1) throw new Error('pip failed');
      } else {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(args[args.indexOf('--cert-path') + 1]!, 'CERTIFICATE');
        await writeFile(args[args.indexOf('--fullchain-path') + 1]!, 'FULLCHAIN');
      }
      return { stdout: '', stderr: '' };
    },
  };
  const dependencies = {
    credentials: {
      async get() {
        return {
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'cloudflare' },
          secretSlots: { config: 'secret:password/credential-config/retry' },
        } as never;
      },
    },
    secrets: {
      async resolveForService() {
        return { plainText: 'dns_cloudflare_api_token=test-token' } as never;
      },
    },
    runner,
    autoInstallPlugins: true,
  };
  const issuer = new CertbotDnsIssuer(dependencies);
  const input = {
    tenantId: 'tenant-1',
    jobId: 'job-retry',
    request: { csrPem: 'CSR', subjectCommonName: 'example.com', sans: [] },
    provider: { endpoint: 'https://acme.example.test/directory' },
    dnsProviderId: 'cloudflare',
    dnsCredentialId: 'credential-retry',
    contactEmail: 'ops@example.com',
    actorId: 'worker-1',
  };

  await assert.rejects(() => issuer.issue(input), /Certbot DNS-01 (签发失败|插件准备失败)/);
  const material = await issuer.issue(input);
  assert.equal(material.certificatePem, 'CERTIFICATE');
  assert.equal(installAttempts, 2);
});
