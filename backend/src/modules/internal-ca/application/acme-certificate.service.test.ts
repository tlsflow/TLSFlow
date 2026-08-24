import assert from 'node:assert/strict';
import test from 'node:test';
import { AcmeCertificateService } from './acme-certificate.service.js';

test('简化 ACME 入口创建证书资产并保存续签策略', async () => {
  let createdAssetInput: Record<string, unknown> | undefined;
  let createdPolicyInput: Record<string, unknown> | undefined;
  const certificates = {
    createAsset: async (input: Record<string, unknown>) => {
      createdAssetInput = input;
      return {
        id: 'asset-1',
        name: String(input.name),
        primaryDomain: String(input.primaryDomain),
        sans: input.sans as string[],
        sourceType: 'acme',
        status: 'active',
        tags: ['acme'],
        createdBy: String(input.createdBy),
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
      };
    },
  };
  const caRepository = {
    listProviders: async () => [{ id: 'provider-1', type: 'acme', status: 'active' }],
  };
  const acmeRepository = {
    listAccounts: async () => [{ id: 'account-1', providerId: 'provider-1', status: 'active' }],
  };
  const policies = {
    list: async () => [],
    create: async (input: Record<string, unknown>) => {
      createdPolicyInput = input;
      return { id: 'policy-1', ...input };
    },
    update: async () => {
      throw new Error('不应更新不存在的策略');
    },
  };
  const credentials = {
    get: async () => ({
      id: 'credential-cloudflare',
      kind: 'DNS_PROVIDER',
      status: 'active',
      metadata: { providerId: 'cloudflare' },
    }),
  };
  const service = new AcmeCertificateService(
    certificates as never,
    caRepository as never,
    acmeRepository as never,
    policies as never,
    credentials as never,
  );

  const result = await service.create({
    tenantId: 'tenant-1',
    name: 'Example certificate',
    domains: [' Example.COM ', 'www.example.com', 'www.example.com'],
    contactEmail: 'ops@example.com',
    challengeType: 'dns-01',
    dnsProvider: 'cloudflare',
    dnsCredentialId: 'credential-cloudflare',
    autoRenew: true,
    renewalWindowDays: undefined,
    termsOfServiceAgreed: true,
    actorId: 'user-1',
  });

  assert.equal(result.asset.id, 'asset-1');
  assert.equal(result.policy.id, 'policy-1');
  assert.equal(result.provisioningStatus, 'policy_saved');
  assert.equal(result.issuanceContextStatus, 'requires_application_context');
  assert.deepEqual(createdAssetInput?.sans, ['www.example.com']);
  assert.equal(createdPolicyInput?.challengeType, 'dns-01');
  assert.equal(createdPolicyInput?.renewalWindowDays, 7);
  assert.deepEqual(createdPolicyInput?.maintenanceWindow, {
    dnsProvider: 'cloudflare',
    dnsCredentialId: 'credential-cloudflare',
    contactEmail: 'ops@example.com',
    keyType: 'rsa',
  });
});

test('简化 ACME 入口拒绝未同意服务条款', async () => {
  const service = new AcmeCertificateService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    service.create({
      tenantId: 'tenant-1',
      domains: ['example.com'],
      contactEmail: 'ops@example.com',
      challengeType: 'http-01',
      termsOfServiceAgreed: false,
      actorId: 'user-1',
    }),
    /必须同意服务条款/,
  );
});
