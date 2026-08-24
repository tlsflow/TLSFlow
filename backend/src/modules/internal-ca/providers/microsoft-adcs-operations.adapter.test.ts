import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaNodeTaskEntity, CaProviderEntity, CertificateAuthorityEntity } from '../schema/internal-ca.schema.js';
import { MicrosoftAdcsOperationsAdapter, type AdcsNodeTaskClient } from './microsoft-adcs-operations.adapter.js';

const provider: CaProviderEntity = {
  id: 'provider-adcs', tenantId: 'tenant-operations', name: 'AD CS', type: 'microsoft_adcs',
  deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', capabilities: {
    discoverHierarchy: true, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
    revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true, deviceLocalCsr: false,
    hardwareBackedKey: true, highAvailability: false,
  }, status: 'active', configuration: { discovered: { caConfig: 'host\\Contoso CA' } },
  createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
};

const authority: CertificateAuthorityEntity = {
  id: 'ca-adcs', tenantId: provider.tenantId, name: 'AD CS CA', role: 'root', topologyMode: 'external_managed',
  providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'AD CS CA',
  createdAt: provider.createdAt, updatedAt: provider.updatedAt,
};

function task(result?: Record<string, unknown>): CaNodeTaskEntity {
  return {
    id: 'task-adcs-sync', tenantId: provider.tenantId, providerId: provider.id, nodeId: 'node-adcs',
    taskType: 'sync_adcs_records', idempotencyKey: 'test', payload: {}, status: 'succeeded', result,
    createdAt: provider.createdAt, updatedAt: provider.updatedAt,
  };
}

test('AD CS 运营适配器只投递固定同步合同并转换 Agent 记录', async () => {
  let queued: Parameters<AdcsNodeTaskClient['enqueue']>[0] | undefined;
  const client: AdcsNodeTaskClient = {
    async enqueue(input) {
      queued = input;
      return task();
    },
    async waitForResult() {
      return task({
        records: [{
          externalObjectId: 'request:2', externalParentId: '2', normalizedStatus: 'issued',
          sourceStatus: '20', subjectCommonName: 'web.example.test',
          rawSummary: { disposition: 20, nested: { ignored: true } },
        }],
        nextCursor: '2', complete: false, sourceWatermark: '2026-07-25T01:00:00.000Z',
      });
    },
  };
  const batch = await new MicrosoftAdcsOperationsAdapter(client).listOperationRecords({
    provider, authority, objectType: 'request', cursor: '1', limit: 100, changedAfter: '2026-07-25T00:00:00.000Z',
  });
  assert.deepEqual(queued?.payload, {
    caConfig: 'host\\Contoso CA', objectType: 'request', cursor: '1', limit: 100,
    changedAfter: '2026-07-25T00:00:00.000Z',
  });
  assert.equal(queued?.taskType, 'sync_adcs_records');
  assert.equal(batch.complete, false);
  assert.equal(batch.nextCursor, '2');
  assert.deepEqual(batch.records[0], {
    externalObjectId: 'request:2', externalParentId: '2', normalizedStatus: 'issued', sourceStatus: '20',
    sourceRevision: undefined, subjectCommonName: 'web.example.test', serialNumber: undefined,
    templateExternalId: undefined, requestedByDisplay: undefined, submittedAt: undefined, issuedAt: undefined,
    revokedAt: undefined, notBefore: undefined, notAfter: undefined,
    rawSummary: { objectType: 'request', disposition: 20, nested: '[object Object]' },
  });
});

test('AD CS 运营适配器没有 CA Config 时拒绝投递任务', async () => {
  const adapter = new MicrosoftAdcsOperationsAdapter({
    async enqueue() { throw new Error('不应投递任务'); },
    async waitForResult() { throw new Error('不应等待任务'); },
  });
  await assert.rejects(
    () => adapter.listOperationRecords({ provider: { ...provider, configuration: {} }, authority, objectType: 'issuance', limit: 20 }),
    { errorCode: 'CA_PROVIDER_UNAVAILABLE' },
  );
});