import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AppError } from '../../common/errors/app-error.js';
import { CaSyncCoordinator } from './application/ca-sync-coordinator.js';
import { CaOperationsAdapterRegistry, type CaOperationRecordBatch, type CaOperationsAdapter } from './providers/ca-operations.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';
import { InternalCaRepository } from './repository/internal-ca.repository.js';

const tenantId = 'tenant-sync';
const providerId = 'provider-sync';
const caId = 'ca-sync';

class FakeSyncAdapter implements CaOperationsAdapter {
  calls = 0;
  failUntil = 0;

  getOperationsCapabilities() {
    return {
      listRequests: true, listIssuedCertificates: true, listRevokedCertificates: true, listTemplates: true,
      synchronizeHistory: true, approvePendingRequest: false, denyPendingRequest: false, publishCrl: false,
    };
  }

  async listOperationRecords(): Promise<CaOperationRecordBatch> {
    this.calls += 1;
    if (this.calls <= this.failUntil) throw new AppError('CA_SYNC_SOURCE_UNAVAILABLE', 'Agent 离线');
    if (this.calls === this.failUntil + 1) {
      return {
        records: [{ externalObjectId: 'request:1', normalizedStatus: 'pending', rawSummary: { disposition: 9 } }],
        nextCursor: 'cursor:1', complete: false,
      };
    }
    return {
      records: [{ externalObjectId: 'request:2', normalizedStatus: 'issued', rawSummary: { disposition: 20 } }],
      nextCursor: 'cursor:2', complete: true,
    };
  }
}

async function fixture(adapter = new FakeSyncAdapter()) {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  await repository.saveProvider({
    id: providerId, tenantId, name: 'Microsoft AD CS', type: 'microsoft_adcs', deploymentMode: 'external',
    runtimePlatform: 'windows', availabilityMode: 'single', capabilities: {
      discoverHierarchy: true, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true, deviceLocalCsr: false,
      hardwareBackedKey: true, highAvailability: false,
    }, status: 'active', configuration: {}, createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await repository.saveAuthority({
    id: caId, tenantId, name: 'AD CS CA', role: 'root', topologyMode: 'external_managed', providerId,
    securityDomain: 'production', status: 'active', subjectCommonName: 'AD CS CA',
    createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  const auditEvents: Array<Record<string, unknown>> = [];
  const registry = new CaOperationsAdapterRegistry().register('microsoft_adcs', adapter);
  const coordinator = new CaSyncCoordinator(database, registry, {
    async write(input) {
      auditEvents.push(input as unknown as Record<string, unknown>);
    },
  });
  return { database, coordinator, adapter, auditEvents };
}

test('同步协调器拒绝重复活动范围并逐批原子推进游标', async () => {
  const { coordinator, auditEvents } = await fixture();
  const [run] = await coordinator.createRuns({
    tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental', actor: { id: 'admin-1', type: 'user' },
  });
  assert.ok(run);
  await assert.rejects(
    () => coordinator.createRuns({ tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental', actor: { id: 'admin-1', type: 'user' } }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_SYNC_ALREADY_RUNNING',
  );

  const first = await coordinator.processNextBatch(tenantId, run.id, 'worker-1', new Date('2026-07-24T12:01:00.000Z'));
  assert.equal(first.status, 'queued');
  assert.equal(first.cursorAfter, 'cursor:1');
  assert.equal(first.upsertedCount, 1);
  const completed = await coordinator.processNextBatch(tenantId, run.id, 'worker-2', new Date('2026-07-24T12:02:00.000Z'));
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.cursorAfter, 'cursor:2');
  assert.equal(completed.upsertedCount, 2);
  assert.deepEqual(auditEvents.map((event) => event.eventType), ['ca.operations.sync.started', 'ca.operations.sync.completed']);
});

test('Agent 离线后运行进入指数退避，并在到期后使用同一运行恢复', async () => {
  const adapter = new FakeSyncAdapter();
  adapter.failUntil = 1;
  const { coordinator, auditEvents } = await fixture(adapter);
  const [run] = await coordinator.createRuns({
    tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental', actor: { id: 'admin-1', type: 'user' },
  });
  const failed = await coordinator.processNextBatch(tenantId, run.id, 'worker-1', new Date('2026-07-24T12:01:00.000Z'));
  assert.equal(failed.status, 'queued');
  assert.equal(failed.attemptCount, 1);
  assert.equal(failed.nextAttemptAt, '2026-07-24T12:01:05.000Z');
  await assert.rejects(
    () => coordinator.processNextBatch(tenantId, run.id, 'worker-2', new Date('2026-07-24T12:01:04.000Z')),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_SYNC_ALREADY_RUNNING',
  );
  const recovered = await coordinator.processNextBatch(tenantId, run.id, 'worker-2', new Date('2026-07-24T12:01:05.000Z'));
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.cursorAfter, 'cursor:1');
  assert.equal(recovered.attemptCount, 0);
  assert.deepEqual(auditEvents.map((event) => event.eventType), ['ca.operations.sync.started', 'ca.operations.sync.failed']);
});

test('多 Worker 竞争同一运行时只有租约持有者调用 Adapter', async () => {
  const { coordinator, adapter } = await fixture();
  const [run] = await coordinator.createRuns({
    tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental', actor: { id: 'admin-1', type: 'user' },
  });
  assert.ok(run);

  const results = await Promise.allSettled([
    coordinator.processNextBatch(tenantId, run.id, 'worker-1', new Date('2026-07-24T12:01:00.000Z')),
    coordinator.processNextBatch(tenantId, run.id, 'worker-2', new Date('2026-07-24T12:01:00.000Z')),
  ]);

  assert.equal(adapter.calls, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(rejected.reason instanceof AppError);
  assert.equal(rejected.reason.errorCode, 'CA_SYNC_ALREADY_RUNNING');
});

test('服务重启后的 Worker 可以接管过期租约并继续原运行', async () => {
  const { database, coordinator, adapter } = await fixture();
  const [run] = await coordinator.createRuns({
    tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental', actor: { id: 'admin-1', type: 'user' },
  });
  assert.ok(run);
  const operationsRepository = new CaOperationsRepository(database);
  await operationsRepository.updateSyncRun({
    ...run,
    status: 'running',
    leaseOwner: 'stopped-worker',
    leaseExpiresAt: '2026-07-24T12:00:30.000Z',
    startedAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
  });

  const recovered = await coordinator.processNextBatch(
    tenantId,
    run.id,
    'replacement-worker',
    new Date('2026-07-24T12:01:00.000Z'),
  );

  assert.equal(adapter.calls, 1);
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.cursorAfter, 'cursor:1');
  assert.equal(recovered.leaseOwner, undefined);
});

test('带 changedAfter 的状态回查从空游标开始并在分页期间保持固定窗口', async () => {
  const adapter = new FakeSyncAdapter();
  const { coordinator } = await fixture(adapter);
  const [run] = await coordinator.createRuns({
    tenantId, providerId, caId, objectTypes: ['request'], mode: 'incremental',
    changedAfter: '2026-07-24T11:55:00.000Z', actor: { id: 'system_ca_auto_sync', type: 'system' },
  });
  assert.ok(run);
  assert.equal(run.cursorBefore, undefined);
  assert.equal(run.cursorAfter, undefined);
  assert.equal(run.changedAfter, '2026-07-24T11:55:00.000Z');

  const first = await coordinator.processNextBatch(tenantId, run.id, 'worker-1', new Date('2026-07-24T12:01:00.000Z'));
  assert.equal(first.cursorAfter, 'cursor:1');
  assert.equal(first.changedAfter, '2026-07-24T11:55:00.000Z');
});
