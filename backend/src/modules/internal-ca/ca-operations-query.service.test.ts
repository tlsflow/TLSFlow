import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AppError } from '../../common/errors/app-error.js';
import { CaOperationsQueryService } from './application/ca-operations-query.service.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';
import { InternalCaRepository } from './repository/internal-ca.repository.js';

const tenantId = 'tenant-query';
const providerId = 'provider-query';
const caId = 'ca-query';

test('统一运营查询合并原生与外部事实，使用稳定游标且拒绝非法排序', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const internalRepository = new InternalCaRepository(database);
  await internalRepository.saveProvider({
    id: providerId, tenantId, name: '内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded',
    availabilityMode: 'single', capabilities: {
      discoverHierarchy: true, createRoot: true, createIntermediate: true, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: {}, createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await internalRepository.saveAuthority({
    id: caId, tenantId, name: '查询测试 CA', role: 'root', topologyMode: 'root_only', providerId,
    securityDomain: 'test', status: 'active', subjectCommonName: 'Query Test CA',
    createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await database.query(
    `insert into pg_ca_issuance_records (
      id, tenant_id, ca_id, serial_number, status, record_origin, sans, payload, observed_at, created_at, updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $10)`,
    ['native-issuance', tenantId, caId, '01', 'issued', 'native', '[]', '{}', '2026-07-24T12:01:00.000Z', '2026-07-24T12:01:00.000Z'],
  );
  const observations = new CaOperationsRepository(database);
  await observations.upsertExternalObservation({
    id: 'external-old', tenantId, providerId, caId, objectType: 'issuance', externalObjectId: 'cert:old',
    normalizedStatus: 'issued', serialNumber: '02', rawSummary: { requestId: 1 },
    observedAt: '2026-07-24T12:00:00.000Z', firstObservedAt: '2026-07-24T12:00:00.000Z',
    createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await observations.upsertExternalObservation({
    id: 'external-new', tenantId, providerId, caId, objectType: 'issuance', externalObjectId: 'cert:new',
    normalizedStatus: 'issued', serialNumber: '03', rawSummary: { requestId: 2 },
    observedAt: '2026-07-24T12:02:00.000Z', firstObservedAt: '2026-07-24T12:02:00.000Z',
    createdAt: '2026-07-24T12:02:00.000Z', updatedAt: '2026-07-24T12:02:00.000Z',
  });
  await observations.createSyncRun({
    id: 'sync-succeeded', tenantId, providerId, caId, objectType: 'issuance', mode: 'incremental', status: 'succeeded',
    readCount: 2, upsertedCount: 2, skippedCount: 0, failedCount: 0, attemptCount: 0, requestedBy: 'system',
    startedAt: '2026-07-24T12:02:30.000Z', completedAt: '2026-07-24T12:03:00.000Z',
    createdAt: '2026-07-24T12:02:30.000Z', updatedAt: '2026-07-24T12:03:00.000Z',
  });
  await observations.createSyncRun({
    id: 'sync-queued', tenantId, providerId, caId, objectType: 'issuance', mode: 'incremental', status: 'queued',
    readCount: 0, upsertedCount: 0, skippedCount: 0, failedCount: 0, attemptCount: 0, requestedBy: 'system',
    createdAt: '2026-07-24T12:04:00.000Z', updatedAt: '2026-07-24T12:04:00.000Z',
  });

  const service = new CaOperationsQueryService(database, undefined, undefined, internalRepository);
  const firstPage = await service.records(tenantId, { caId, view: 'issuance', limit: 2, sort: 'observedAt:desc' });
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.integrity, 'syncing');
  assert.equal(firstPage.lastSuccessfulSyncAt, '2026-07-24T12:03:00.000Z');
  assert.deepEqual(firstPage.items.map((item) => item.recordKey), ['external:external-new', 'gcac:issuance:native-issuance']);
  assert.ok(firstPage.nextCursor);

  const secondPage = await service.records(tenantId, { caId, view: 'issuance', limit: 2, cursor: firstPage.nextCursor });
  assert.deepEqual(secondPage.items.map((item) => item.recordKey), ['external:external-old']);
  assert.equal(secondPage.nextCursor, undefined);

  const detail = await service.record(tenantId, 'gcac:issuance:native-issuance');
  assert.equal(detail.caId, caId);
  assert.equal(detail.source, 'gcac_native');
  await assert.rejects(
    () => service.record('other-tenant', 'gcac:issuance:native-issuance'),
    (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_NOT_FOUND',
  );

  const externalOnly = await service.records(tenantId, { caId, view: 'issuance', source: ['external_sync'], limit: 50 });
  assert.deepEqual(externalOnly.items.map((item) => item.recordKey), ['external:external-new', 'external:external-old']);
  await assert.rejects(
    () => service.records(tenantId, { caId, view: 'issuance', sort: 'serialNumber:asc', limit: 50 }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_OPERATIONS_QUERY_INVALID',
  );
});

test('资源树只返回通过同一读取范围校验的 CA', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  for (const suffix of ['visible', 'hidden']) {
    await repository.saveProvider({
      id: `provider-${suffix}`, tenantId, name: `Provider ${suffix}`, type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded',
      availabilityMode: 'single', capabilities: {
        discoverHierarchy: true, createRoot: true, createIntermediate: true, signCsr: true, queryIssuance: true,
        revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true, deviceLocalCsr: false,
        hardwareBackedKey: false, highAvailability: false,
      }, status: 'active', configuration: {}, createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
    });
    await repository.saveAuthority({
      id: `ca-${suffix}`, tenantId, name: `CA ${suffix}`, role: 'root', topologyMode: 'root_only', providerId: `provider-${suffix}`,
      securityDomain: 'test', status: 'active', subjectCommonName: `CA ${suffix}`,
      createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
    });
  }
  const service = new CaOperationsQueryService(database, undefined, undefined, repository);
  const tree = await service.tree(tenantId, async (authority) => authority.id === 'ca-visible');
  assert.deepEqual(tree.unassignedAuthorities.map((authority) => authority.id), ['ca-visible']);
});
