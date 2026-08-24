import assert from 'node:assert/strict';
import test from 'node:test';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CaProviderEntity, CertificateAuthorityEntity, CertificateProfileRules } from '../schema/internal-ca.schema.js';
import { createDefaultCaProviderRegistry } from './ca-provider.js';

const providerBase: Omit<CaProviderEntity, 'id' | 'type' | 'capabilities' | 'configuration'> = {
  tenantId: 'tenant-provider-contract',
  name: 'Provider',
  deploymentMode: 'external',
  runtimePlatform: 'external',
  availabilityMode: 'single',
  endpoint: 'https://ca.example.test',
  status: 'active',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

const authority: CertificateAuthorityEntity = {
  id: 'ca-external', tenantId: providerBase.tenantId, name: 'External CA', role: 'intermediate',
  topologyMode: 'external_managed', providerId: 'provider', securityDomain: 'production', status: 'active',
  subjectCommonName: 'External CA', createdAt: providerBase.createdAt, updatedAt: providerBase.updatedAt,
};

const profileRules: CertificateProfileRules = {
  allowedDnsSuffixes: ['.example.com'], allowedIpCidrs: [], allowedSanTypes: ['dns'], keyAlgorithms: ['rsa'], minimumRsaBits: 2048,
  extendedKeyUsages: ['serverAuth'], maximumValidityDays: 90, renewalWindowDays: 30, rotateKeyOnRenewal: true,
  requireApproval: false, allowWildcard: false,
};

test('AD CS、ACME、EST、SCEP 使用独立协议路径并保留 pending 状态', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
    });
    return new Response(JSON.stringify({ status: 'pending', providerRequestId: `remote-${requests.length}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const registry = createDefaultCaProviderRegistry({} as SecretService);
    const cases = [
      { type: 'microsoft_adcs' as const, path: '/adcs/requests', configuration: { template: 'WebServer' } },
      { type: 'acme' as const, path: '/acme/orders', configuration: {} },
      { type: 'est' as const, path: '/.well-known/est/simpleenroll', configuration: {} },
      { type: 'scep' as const, path: '/scep/pkiooperation', configuration: {} },
    ];
    for (const item of cases) {
      const adapter = registry.get(item.type);
      const provider: CaProviderEntity = {
        ...providerBase,
        id: `provider-${item.type}`,
        type: item.type,
        configuration: item.configuration,
        capabilities: adapter.getCapabilities(),
      };
      const result = await adapter.signCsr({
        provider, authority: { ...authority, providerId: provider.id }, csrPem: 'CSR', sans: ['app.example.com'],
        validityDays: 30, profileRules, idempotencyKey: `request-${item.type}`, actorId: 'user-admin',
      });
      assert.equal(result.status, 'pending');
      assert.equal(requests.at(-1)?.path, item.path);
    }
    assert.equal(requests[0]?.body?.template, 'WebServer');
    assert.deepEqual(requests[1]?.body?.identifiers, [{ type: 'dns', value: 'app.example.com' }]);
    assert.equal(registry.get('est').getCapabilities().revokeCertificate, false);
    assert.equal(registry.get('scep').getCapabilities().revokeCertificate, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AD CS 基线记录 JSON 契约和当前尚未验证的能力声明', () => {
  const registry = createDefaultCaProviderRegistry({} as SecretService);
  const adapter = registry.get('microsoft_adcs');
  const capabilities = adapter.getCapabilities();

  assert.equal(capabilities.signCsr, true);
  assert.equal(capabilities.queryIssuance, true);
  assert.equal(capabilities.revokeCertificate, true);
  assert.equal(capabilities.publishCrl, false);
  assert.equal(capabilities.ocsp, false);
  assert.equal(capabilities.hardwareBackedKey, true);
  assert.equal(capabilities.highAvailability, true);
});
