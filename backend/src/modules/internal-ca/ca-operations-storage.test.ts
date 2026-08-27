import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';

const now = '2026-07-24T12:00:00.000Z';

async function createRepository(): Promise<CaOperationsRepository> {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  return new CaOperationsRepository(database);
}

test('外部观测按 CA 范围内稳定对象 ID 幂等更新并保留首次观测时间', async () => {
  const repository = await createRepository();
  const original = {
    id: 'obs-1', tenantId: 'tenant-1', providerId: 'provider-1', caId: 'ca-1', objectType: 'request' as const,
    externalObjectId: 'request:2', normalizedStatus: 'pending' as const, rawSummary: { disposition: 9 },
    observedAt: now, firstObservedAt: now, createdAt: now, updatedAt: now,
  };
  await repository.upsertExternalObservation(original);
  const updated = await repository.upsertExternalObservation({
    ...original, id: 'obs-ignored', normalizedStatus: 'issued', rawSummary: { disposition: 20 },
    observedAt: '2026-07-24T12:01:00.000Z', firstObservedAt: '2026-07-24T12:01:00.000Z', updatedAt: '2026-07-24T12:01:00.000Z',
  });

  assert.equal(updated.id, 'obs-1');
  assert.equal(updated.normalizedStatus, 'issued');
  assert.equal(updated.firstObservedAt, now);
  assert.deepEqual(updated.rawSummary, { disposition: 20 });
});

test('模板映射新增冲突和版本不匹配必须拒绝', async () => {
  const repository = await createRepository();
  const mapping = {
    id: 'mapping-1', tenantId: 'tenant-1', providerId: 'provider-1', caId: 'ca-1', profileVersionId: 'profile-v1',
    externalTemplateId: 'template:web-server', status: 'active' as const, validationSummary: { compatible: true },
    version: 1, createdBy: 'admin-1', updatedBy: 'admin-1', createdAt: now, updatedAt: now,
  };
  assert.equal(await repository.saveTemplateMapping(mapping), true);
  assert.equal(await repository.saveTemplateMapping({ ...mapping, id: 'mapping-2' }), false);
  assert.equal(await repository.saveTemplateMapping({ ...mapping, version: 2, updatedAt: '2026-07-24T12:01:00.000Z' }, 1), true);
  assert.equal(await repository.saveTemplateMapping({ ...mapping, version: 3, updatedAt: '2026-07-24T12:02:00.000Z' }, 1), false);
});
