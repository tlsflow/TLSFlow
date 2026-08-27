import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { PluginCaOperationsAdapter } from './plugin-ca-operations-adapter.js';

const provider = {
  id: 'provider-adcs', tenantId: 'tenant-1', type: 'plugin', configuration: { providerKind: 'microsoft_adcs' },
} as never;
const authority = { id: 'ca-1', tenantId: 'tenant-1', providerId: 'provider-adcs', configuration: {} } as never;
const binding = { id: 'binding-1', listAction: { actionId: 'ca.certificate.list.v1', actionVersion: 'v1' } } as never;

test('AD CS 运营适配器把 Agent 历史批次转换为受限观察记录', async () => {
  const adapter = new PluginCaOperationsAdapter({
    async execute(input) {
      assert.equal(input.action, 'list');
      assert.equal(input.payload.operation, 'ca.certificate.list');
      return {
        records: [{ externalObjectId: 'request:1', normalizedStatus: 'issued', subjectCommonName: 'ca.example.test', rawSummary: { requestId: 1, ignored: { secret: true } } }],
        complete: true,
      };
    },
  }, { getActiveProviderActionBinding: async () => binding });
  const result = await adapter.listOperationRecords({
    syncRunId: 'run-1', provider, authority, objectType: 'request', limit: 50,
  });
  assert.equal(result.complete, true);
  assert.equal(result.records[0]?.externalObjectId, 'request:1');
  assert.deepEqual(result.records[0]?.rawSummary, { requestId: 1 });
});

test('Agent 任务尚未完成时同步适配器保持可重试状态', async () => {
  const adapter = new PluginCaOperationsAdapter({
    async execute() { return { status: 'pending', detail: 'task-1' }; },
  }, { getActiveProviderActionBinding: async () => binding });
  await assert.rejects(
    () => adapter.listOperationRecords({ syncRunId: 'run-1', provider, authority, objectType: 'request', limit: 50 }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_SYNC_SOURCE_UNAVAILABLE' && Boolean(error.details && (error.details as { pending?: boolean }).pending),
  );
});
