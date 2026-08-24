import assert from 'node:assert/strict';
import test from 'node:test';
import { AcmeCertificateService } from './acme-certificate.service.js';

test('补全历史 ACME 资产时只创建该资产的续签策略，不创建重复证书资产', async () => {
  const tenantId = 'tenant-legacy-acme';
  const asset = {
    id: 'certasset-legacy',
    tenantId,
    name: '*.legacy.example.com',
    primaryDomain: '*.legacy.example.com',
    sans: ['legacy.example.com'],
    sourceType: 'acme',
    status: 'active',
    tags: ['acme'],
    createdBy: 'user-admin',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  let assetUpdateCount = 0;
  let updatedAssetPatch: Record<string, unknown> | undefined;
  let createdPolicy: Record<string, unknown> | undefined;
  const service = new AcmeCertificateService(
    {
      getRepository: () => ({
        getAsset: async () => asset,
        updateAsset: async (_id: string, patch: Record<string, unknown>) => {
          assetUpdateCount += 1;
          updatedAssetPatch = patch;
          return { ...asset, ...patch };
        },
        listVersionsByAsset: async () => [{
          id: 'certver-latest', certificateAssetId: asset.id, status: 'active', activationState: 'promoted', notAfter: '2026-11-04T00:00:00.000Z',
        }],
      }),
    } as never,
    {
      listProviders: async () => [{
        id: 'caprov-letsencrypt', tenantId, name: "Let's Encrypt", type: 'acme', status: 'active',
        configuration: { isBuiltIn: true, preset: 'letsencrypt' },
      }],
    } as never,
    {
      listAccounts: async () => [{ id: 'acmeacct-active', tenantId, providerId: 'caprov-letsencrypt', status: 'active' }],
      listRenewalJobs: async () => [],
    } as never,
    {
      list: async () => [],
      create: async (input: Record<string, unknown>) => {
        createdPolicy = input;
        return { id: 'acmepolicy-recovered', ...input };
      },
    } as never,
    {
      get: async () => ({
        id: 'cred-dns', kind: 'DNS_PROVIDER', status: 'active', metadata: { providerId: 'cloudflare' },
      }),
    } as never,
  );

  const result = await service.update({
    tenantId,
    certificateAssetId: asset.id,
    name: asset.name,
    domains: [asset.primaryDomain, ...asset.sans],
    contactEmail: 'admin@example.com',
    providerId: 'caprov-letsencrypt',
    challengeType: 'dns-01',
    dnsProvider: 'cloudflare',
    dnsCredentialId: 'cred-dns',
    dnsPropagationSeconds: 60,
    keyType: 'rsa',
    autoRenew: true,
    renewalWindowDays: 7,
    actorId: 'user-admin',
  });

  assert.equal(assetUpdateCount, 1);
  assert.equal(result.asset.id, asset.id);
  assert.equal(updatedAssetPatch?.currentVersionId, 'certver-latest');
  assert.equal(createdPolicy?.certificateAssetId, asset.id);
  assert.equal(createdPolicy?.providerId, 'caprov-letsencrypt');
  assert.equal(createdPolicy?.accountId, 'acmeacct-active');
  assert.equal(createdPolicy?.challengeType, 'dns-01');
  assert.equal(createdPolicy?.renewalWindowDays, 7);
  assert.deepEqual(createdPolicy?.maintenanceWindow, {
    contactEmail: 'admin@example.com',
    keyType: 'rsa',
    domains: ['*.legacy.example.com', 'legacy.example.com'],
    dnsProvider: 'cloudflare',
    dnsCredentialId: 'cred-dns',
    dnsPropagationSeconds: 60,
  });
});
