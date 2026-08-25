import assert from 'node:assert/strict';
import test from 'node:test';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import { createDefaultCaProviderRegistry } from './ca-provider.js';

const provider: CaProviderEntity = {
  id: 'provider-plugin-boundary',
  tenantId: 'tenant-plugin-boundary',
  name: '未接入执行器的 Provider',
  type: 'plugin',
  deploymentMode: 'external',
  runtimePlatform: 'external',
  availabilityMode: 'single',
  endpoint: 'https://ca.example.test',
  status: 'active',
  capabilities: {
    discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true,
    queryIssuance: true, revokeCertificate: true, publishCrl: true, ocsp: false,
    listProfiles: false, deviceLocalCsr: false, hardwareBackedKey: false, highAvailability: false,
  },
  configuration: {},
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

test('默认 Provider Registry 不注册宿主 CA 执行实现', async () => {
  const registry = createDefaultCaProviderRegistry({} as SecretService);
  const adapter = registry.get(provider.type);
  assert.deepEqual(adapter.getCapabilities(), provider.capabilities);
  const health = await adapter.validateConnection(provider);
  assert.equal(health.reachable, false);
  assert.match(health.detail ?? '', /CA_PLUGIN_RUNNER_UNAVAILABLE/);
  await assert.rejects(
    () => adapter.signCsr({
      provider,
      authority: { id: 'ca-1', tenantId: provider.tenantId, name: 'CA', role: 'root', topologyMode: 'external_managed', providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'CA', createdAt: provider.createdAt, updatedAt: provider.updatedAt },
      csrPem: 'CSR', sans: [], validityDays: 30, profileRules: {} as never, idempotencyKey: 'request-1', actorId: 'actor-1',
      actionBinding: { id: 'binding-1', tenantId: provider.tenantId, providerId: provider.id, pluginVersionId: 'plugin-v1', executionLocation: 'control_plane', issueAction: { actionId: 'ca.issue', actionVersion: 'v1' }, createdBy: 'actor-1', createdAt: provider.createdAt, updatedAt: provider.updatedAt, status: 'active', approvalMode: 'none', capabilityEvidence: {} },
    }),
    (error: unknown) => error instanceof Error
      && 'errorCode' in error && error.errorCode === 'CA_PROVIDER_UNAVAILABLE'
      && error.message.includes('未接入 ca.* Plugin Runner'),
  );
});
