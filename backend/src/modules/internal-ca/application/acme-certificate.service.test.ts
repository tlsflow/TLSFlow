import assert from 'node:assert/strict';
import test from 'node:test';
import { AcmeCertificateService } from './acme-certificate.service.js';
import type { CreateAcmeAccountServiceInput } from './acme-account.service.js';
import type { CreateSecretInput } from '../../secrets/secret.service.js';

test('简化 ACME 入口创建证书资产并保存续签策略', async () => {
  let createdAssetInput: Record<string, unknown> | undefined;
  let createdPolicyInput: Record<string, unknown> | undefined;
  let createdRequestInput: Record<string, unknown> | undefined;
  let createdJobInput: Record<string, unknown> | undefined;
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
    getRenewalJobByWindow: async () => undefined,
    saveRenewalJob: async (input: Record<string, unknown>) => {
      createdJobInput = input;
      return { ...input, id: 'job-1' };
    },
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
    undefined,
    undefined,
    undefined,
    {
      ensureAcmeIssuanceContext: async () => ({
        caId: 'ca-acme',
        profileVersionId: 'profile-version-acme',
        trustDomainId: 'trust-domain-acme',
      }),
      createCertificateRequest: async (_tenantId: string, input: Record<string, unknown>) => {
        createdRequestInput = input;
        return { id: 'request-1', ...input };
      },
    } as never,
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
  assert.equal(result.provisioningStatus, 'initial_job_scheduled');
  assert.equal(result.issuanceContextStatus, 'ready');
  assert.equal(result.certificateRequestId, 'request-1');
  assert.equal(result.renewalJobId, 'job-1');
  assert.deepEqual(createdAssetInput?.sans, ['www.example.com']);
  assert.equal(createdPolicyInput?.challengeType, 'dns-01');
  assert.equal(createdPolicyInput?.renewalWindowDays, 7);
  assert.equal(createdRequestInput?.caId, 'ca-acme');
  assert.equal(createdRequestInput?.deferIssuance, true);
  assert.equal(createdJobInput?.status, 'scheduled');
  assert.equal(createdJobInput?.sourceCertificateVersionId, undefined);
  assert.deepEqual(createdPolicyInput?.maintenanceWindow, {
    dnsProvider: 'cloudflare',
    dnsCredentialId: 'credential-cloudflare',
    contactEmail: 'ops@example.com',
    keyType: 'rsa',
    domains: ['example.com', 'www.example.com'],
  });
});

test('ACME 证书自动化支持编辑资产、DNS 凭据和续签策略', async () => {
  let assetPatch: Record<string, unknown> | undefined;
  let policyPatch: Record<string, unknown> | undefined;
  const policy = {
    id: 'policy-edit',
    tenantId: 'tenant-1',
    certificateAssetId: 'asset-edit',
    providerId: 'provider-old',
    accountId: 'account-old',
    enabled: true,
    renewalWindowDays: 7,
    challengeType: 'http-01',
    rotateKeyOnRenewal: true,
    deploymentMode: 'automatic',
    maxAttempts: 5,
    backoffSeconds: 300,
    status: 'active',
    version: 1,
    createdBy: 'user-1',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  };
  const service = new AcmeCertificateService(
    {
      getRepository: () => ({
        getAsset: async () => ({
          id: 'asset-edit',
          name: 'Old',
          primaryDomain: 'old.example.com',
          sans: [],
          sourceType: 'manual',
          status: 'active',
          tags: [],
        }),
        updateAsset: async (_id: string, patch: Record<string, unknown>) => {
          assetPatch = patch;
          return {
            id: 'asset-edit',
            sourceType: 'acme',
            status: 'active',
            tags: ['acme'],
            createdBy: 'user-1',
            createdAt: '2026-08-05T00:00:00.000Z',
            ...patch,
          };
        },
      }),
    } as never,
    {
      listProviders: async () => [{ id: 'provider-new', type: 'acme', status: 'active' }],
    } as never,
    {
      listRenewalJobs: async () => [{ id: 'job-failed', policyId: policy.id, status: 'failed' }],
      listAccounts: async () => [{ id: 'account-new', providerId: 'provider-new', status: 'active' }],
    } as never,
    {
      list: async () => [policy],
      update: async (_tenantId: string, _policyId: string, patch: Record<string, unknown>) => {
        policyPatch = patch;
        return { ...policy, ...patch, providerId: 'provider-new', accountId: 'account-new' };
      },
    } as never,
    {
      get: async () => ({
        kind: 'DNS_PROVIDER',
        status: 'active',
        metadata: { providerId: 'alidns' },
      }),
    } as never,
  );

  const result = await service.update({
    tenantId: 'tenant-1',
    certificateAssetId: 'asset-edit',
    name: 'Wildcard',
    domains: ['*.example.com', 'api.example.com'],
    contactEmail: 'ops@example.com',
    providerId: 'provider-new',
    challengeType: 'dns-01',
    dnsProvider: 'alidns',
    dnsCredentialId: 'credential-alidns',
    dnsPropagationSeconds: 90,
    keyType: 'rsa',
    autoRenew: true,
    renewalWindowDays: 7,
    actorId: 'user-1',
  });

  assert.equal(result.asset.name, 'Wildcard');
  assert.equal(assetPatch?.primaryDomain, '*.example.com');
  assert.deepEqual(assetPatch?.sans, ['api.example.com']);
  assert.equal(assetPatch?.sourceType, 'acme');
  assert.deepEqual(assetPatch?.tags, ['acme']);
  assert.equal(policyPatch?.providerId, 'provider-new');
  assert.equal(policyPatch?.accountId, 'account-new');
  assert.deepEqual(policyPatch?.maintenanceWindow, {
    contactEmail: 'ops@example.com',
    keyType: 'rsa',
    domains: ['*.example.com', 'api.example.com'],
    dnsProvider: 'alidns',
    dnsCredentialId: 'credential-alidns',
    dnsPropagationSeconds: 90,
  });
});

test('ACME 证书自动化删除会禁用策略并软删除资产，保留失败历史', async () => {
  let disabled = false;
  let deleted = false;
  const policy = {
    id: 'policy-delete',
    tenantId: 'tenant-1',
    certificateAssetId: 'asset-delete',
    enabled: true,
    status: 'active',
  };
  const service = new AcmeCertificateService(
    {
      getRepository: () => ({
        getAsset: async () => ({ id: 'asset-delete', sourceType: 'acme', status: 'active' }),
      }),
      deleteAsset: async () => {
        deleted = true;
        return { id: 'asset-delete', sourceType: 'acme', status: 'deleted' };
      },
    } as never,
    {} as never,
    {
      listRenewalJobs: async () => [{ id: 'job-failed', policyId: policy.id, status: 'failed' }],
    } as never,
    {
      list: async () => [policy],
      update: async (_tenantId: string, _policyId: string, patch: Record<string, unknown>) => {
        disabled = patch.enabled === false;
        return { ...policy, enabled: false, status: 'disabled' };
      },
    } as never,
  );

  const result = await service.delete('tenant-1', 'asset-delete', 'user-1');

  assert.equal(disabled, true);
  assert.equal(deleted, true);
  assert.equal(result.asset.status, 'deleted');
  assert.equal(result.policy.status, 'disabled');
});

test('ACME 证书自动化存在运行中任务时拒绝编辑和删除', async () => {
  const policy = {
    id: 'policy-running',
    tenantId: 'tenant-1',
    certificateAssetId: 'asset-running',
    enabled: true,
    status: 'active',
  };
  const service = new AcmeCertificateService(
    {} as never,
    {} as never,
    {
      listRenewalJobs: async () => [{ id: 'job-running', policyId: policy.id, status: 'issuing' }],
    } as never,
    {
      list: async () => [policy],
    } as never,
  );

  await assert.rejects(
    service.delete('tenant-1', 'asset-running', 'user-1'),
    /存在执行中的 ACME 任务/,
  );
  await assert.rejects(
    service.update({
      tenantId: 'tenant-1',
      certificateAssetId: 'asset-running',
      domains: ['example.com'],
      contactEmail: 'ops@example.com',
      providerId: 'provider-1',
      challengeType: 'http-01',
      keyType: 'rsa',
      autoRenew: true,
      renewalWindowDays: 7,
      actorId: 'user-1',
    }),
    /存在执行中的 ACME 任务/,
  );
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

test('新租户首次创建证书时自动准备默认 Provider 和 Account', async () => {
  let providers: Array<Record<string, unknown>> = [];
  let savedSecretInput: CreateSecretInput | undefined;
  let createdAccountInput: CreateAcmeAccountServiceInput | undefined;
  const accounts: Array<Record<string, unknown>> = [];
  const certificates = {
    createAsset: async (input: Record<string, unknown>) => ({
      id: 'asset-auto',
      name: String(input.name),
      primaryDomain: String(input.primaryDomain),
      sans: input.sans as string[],
      sourceType: 'acme',
      status: 'active',
      tags: ['acme'],
      createdBy: String(input.createdBy),
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    }),
  };
  const provider = {
    id: 'provider-default',
    tenantId: 'tenant-1',
    name: "Let's Encrypt",
    type: 'acme',
    status: 'active',
    configuration: { preset: 'letsencrypt', isBuiltIn: true, isDefault: true },
  };
  const caRepository = {
    listProviders: async () => providers,
  };
  const acmeRepository = {
    listAccounts: async () => accounts,
    getRenewalJobByWindow: async () => undefined,
    saveRenewalJob: async (input: Record<string, unknown>) => ({ ...input, id: 'job-auto' }),
  };
  const policies = {
    list: async () => [],
    create: async (input: Record<string, unknown>) => ({ id: 'policy-auto', ...input }),
    update: async () => {
      throw new Error('不应更新不存在的策略');
    },
  };
  const service = new AcmeCertificateService(
    certificates as never,
    caRepository as never,
    acmeRepository as never,
    policies as never,
    undefined,
    async () => {
      providers = [provider];
      return provider as never;
    },
    {
      create: async (input: CreateAcmeAccountServiceInput) => {
        createdAccountInput = input;
        const account = { id: 'account-auto', providerId: provider.id, status: 'active' };
        accounts.push(account);
        return account as never;
      },
    },
    {
      create: async (input: CreateSecretInput) => {
        savedSecretInput = input;
        return { secretRef: 'secret://certificate_private_key/generated#current' } as never;
      },
    },
    {
      ensureAcmeIssuanceContext: async () => ({
        caId: 'ca-acme-auto',
        profileVersionId: 'profile-version-acme-auto',
      }),
      createCertificateRequest: async () => ({
        id: 'request-auto',
        status: 'approved',
      }),
    } as never,
  );

  const result = await service.create({
    tenantId: 'tenant-1',
    domains: ['example.com'],
    contactEmail: 'ops@example.com',
    challengeType: 'http-01',
    termsOfServiceAgreed: true,
    actorId: 'user-1',
  });

  assert.equal(result.policy.id, 'policy-auto');
  assert.equal(savedSecretInput?.type, 'certificate_private_key');
  assert.equal(savedSecretInput?.scopeType, 'global');
  assert.match(String(savedSecretInput?.plainText), /BEGIN PRIVATE KEY/);
  assert.equal(createdAccountInput?.accountKeySecretRef, 'secret://certificate_private_key/generated#current');
  assert.deepEqual(createdAccountInput?.contact, ['mailto:ops@example.com']);
  assert.equal(result.certificateRequestId, 'request-auto');
  assert.equal(result.renewalJobId, 'job-auto');
});

test('需要 EAB 的 Provider 没有 Account 时要求高级配置', async () => {
  const service = new AcmeCertificateService(
    {
      createAsset: async () => {
        throw new Error('不应创建资产');
      },
    } as never,
    {
      listProviders: async () => [{
        id: 'provider-zerossl',
        type: 'acme',
        status: 'active',
        configuration: { preset: 'zerossl' },
      }],
    } as never,
    {
      listAccounts: async () => [],
    } as never,
    {} as never,
  );

  await assert.rejects(
    service.create({
      tenantId: 'tenant-1',
      domains: ['example.com'],
      contactEmail: 'ops@example.com',
      challengeType: 'http-01',
      providerId: 'provider-zerossl',
      termsOfServiceAgreed: true,
      actorId: 'user-1',
    }),
    /尚未配置 Account/,
  );
});
