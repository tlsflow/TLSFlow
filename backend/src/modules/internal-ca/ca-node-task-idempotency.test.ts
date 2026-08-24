import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { InternalCaRepository } from './repository/internal-ca.repository.js';

test('CA Node Task 可按幂等键恢复同一任务', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  await repository.saveProvider({
    id: 'provider-1', tenantId: 'tenant-1', name: '通用 CA 插件', type: 'plugin',
    deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single',
    capabilities: {
      discoverHierarchy: true, createRoot: false, createIntermediate: false, signCsr: true,
      queryIssuance: true, revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true,
      deviceLocalCsr: false, hardwareBackedKey: true, highAvailability: false,
    },
    status: 'active', configuration: {}, createdAt: '2026-07-25T08:00:00.000Z', updatedAt: '2026-07-25T08:00:00.000Z',
  });
  const task = await repository.saveNodeTask({
    id: 'task-1', tenantId: 'tenant-1', providerId: 'provider-1', taskType: 'sync_records',
    idempotencyKey: 'sync:run-1:request:initial', payload: { objectType: 'request' }, status: 'queued',
    createdAt: '2026-07-25T08:00:00.000Z', updatedAt: '2026-07-25T08:00:00.000Z',
  });

  const recovered = await repository.getNodeTaskByIdempotencyKey('tenant-1', task.idempotencyKey);
  assert.equal(recovered?.id, task.id);
  assert.deepEqual(recovered?.payload, { objectType: 'request' });
});
