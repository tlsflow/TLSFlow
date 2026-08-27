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
  const service = new CaOperationsQueryService(database, undefined, internalRepository);
  const firstPage = await service.records(tenantId, { caId, view: 'issuance', limit: 2, sort: 'observedAt:desc' });
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.integrity, 'complete');
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

test('没有运营适配器的 plugin CA 仍可读取已持久化的历史记录', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  const provider = await repository.saveProvider({
    id: 'provider-plugin', tenantId, name: 'Plugin CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
    capabilities: {
      discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: false, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: { providerKind: 'microsoft_adcs' }, createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  const authority = await repository.saveAuthority({
    id: 'ca-plugin', tenantId, name: 'Plugin CA', role: 'root', topologyMode: 'external_managed', providerId: provider.id,
    securityDomain: 'test', status: 'active', subjectCommonName: 'Plugin CA',
    createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await new CaOperationsRepository(database).upsertExternalObservation({
    id: 'plugin-request-1', tenantId, providerId: provider.id, caId: authority.id, objectType: 'request', externalObjectId: 'request:1',
    normalizedStatus: 'pending', subjectCommonName: 'plugin.example.test', rawSummary: { source: 'persisted' },
    observedAt: '2026-07-24T12:01:00.000Z', firstObservedAt: '2026-07-24T12:01:00.000Z',
    createdAt: '2026-07-24T12:01:00.000Z', updatedAt: '2026-07-24T12:01:00.000Z',
  });

  const service = new CaOperationsQueryService(database, undefined, repository);
  const page = await service.records(tenantId, { caId: authority.id, view: 'request', limit: 50 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.recordKey, 'external:plugin-request-1');
  const unsupportedView = await service.records(tenantId, { caId: authority.id, view: 'issuance', limit: 50 });
  assert.equal(unsupportedView.total, 0);

  const tree = await service.tree(tenantId, async () => true);
  assert.deepEqual(tree.unassignedAuthorities[0]?.views, [{ objectType: 'request', count: 1 }]);
});

test('新的 AD CS 主动观测保持最新状态', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  const provider = await repository.saveProvider({
    id: 'provider-adcs-freshness', tenantId, name: 'Freshness ADCS', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows',
    availabilityMode: 'single', capabilities: {
      discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: false, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: { providerKind: 'microsoft_adcs', caConfig: 'ADCS\\Freshness-CA' },
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
  });
  const authority = await repository.saveAuthority({
    id: 'ca-adcs-freshness', tenantId, name: 'Freshness-CA', role: 'root', topologyMode: 'external_managed', providerId: provider.id,
    securityDomain: 'test', status: 'active', subjectCommonName: 'Freshness-CA', configuration: { providerKind: 'microsoft_adcs', caConfig: 'ADCS\\Freshness-CA' },
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
  });
  const operations = new CaOperationsRepository(database);
  await operations.upsertExternalObservation({
    id: 'freshness-observation', tenantId, providerId: provider.id, caId: authority.id, objectType: 'request', externalObjectId: 'request:fresh',
    normalizedStatus: 'pending', rawSummary: {}, observedAt: '2026-08-26T12:01:00.000Z', firstObservedAt: '2026-08-26T12:01:00.000Z',
    createdAt: '2026-08-26T12:01:00.000Z', updatedAt: '2026-08-26T12:01:00.000Z',
  });
  const service = new CaOperationsQueryService(database, undefined, repository);
  const page = await service.records(tenantId, { caId: authority.id, view: 'request', limit: 50 });
  assert.equal(page.integrity, 'complete');
  assert.equal(page.total, 1);
  await database.close();
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
  const service = new CaOperationsQueryService(database, undefined, repository);
  const tree = await service.tree(tenantId, async (authority) => authority.id === 'ca-visible');
  assert.deepEqual(tree.unassignedAuthorities.map((authority) => authority.id), ['ca-visible']);
});

test('资源树隐藏已退休 CA，但退休记录仍可通过精确查询保留', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  await repository.saveProvider({
    id: 'provider-retired-tree', tenantId, name: 'AD CS Provider', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows',
    availabilityMode: 'single', capabilities: {
      discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: false, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: { providerKind: 'microsoft_adcs' }, createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await repository.saveAuthority({
    id: 'ca-active-tree', tenantId, name: '活动 CA', role: 'root', topologyMode: 'external_managed', providerId: 'provider-retired-tree',
    securityDomain: 'test', status: 'active', subjectCommonName: '活动 CA', createdAt: '2026-07-24T12:00:00.000Z', updatedAt: '2026-07-24T12:00:00.000Z',
  });
  await repository.saveAuthority({
    id: 'ca-retired-tree', tenantId, name: '已删除 CA', role: 'root', topologyMode: 'external_managed', providerId: 'provider-retired-tree',
    securityDomain: 'test', status: 'retired', subjectCommonName: '已删除 CA', createdAt: '2026-07-24T12:01:00.000Z', updatedAt: '2026-07-24T12:01:00.000Z',
  });

  const service = new CaOperationsQueryService(database, undefined, repository);
  const tree = await service.tree(tenantId, async () => true);
  assert.deepEqual(tree.unassignedAuthorities.map((authority) => authority.id), ['ca-active-tree']);
  const retired = await service.records(tenantId, { caId: 'ca-retired-tree', view: 'request', limit: 50 });
  assert.equal(retired.total, 0);
  await database.close();
});

test('AD CS 重建后的重复 Authority 自动归并，旧 caId 查询转到有数据的主记录', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  const provider = await repository.saveProvider({
    id: 'provider-adcs-dedup', tenantId, name: 'Jackson-DC-CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows',
    availabilityMode: 'single', capabilities: {
      discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: false, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-dedup', caConfig: 'ADCS-SERVER\\Jackson-DC-CA' },
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
  });
  const oldAuthority = await repository.saveAuthority({
    id: 'ca-adcs-dedup-old', tenantId, name: 'jackson-mgt', role: 'root', topologyMode: 'external_managed', providerId: provider.id,
    securityDomain: 'test', status: 'active', subjectCommonName: 'Jackson-DC-CA', configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-dedup' },
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  });
  const newAuthority = await repository.saveAuthority({
    id: 'ca-adcs-dedup-new', tenantId, name: 'Jackson-DC-CA', role: 'root', topologyMode: 'external_managed', providerId: provider.id,
    securityDomain: 'test', status: 'active', subjectCommonName: 'Jackson-DC-CA', configuration: {
      providerKind: 'microsoft_adcs', agentId: 'agent-dedup', caConfig: 'ADCS-SERVER\\Jackson-DC-CA',
    }, createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
  });
  await new CaOperationsRepository(database).upsertExternalObservation({
    id: 'adcs-dedup-record', tenantId, providerId: provider.id, caId: newAuthority.id, objectType: 'request', externalObjectId: 'request:1',
    normalizedStatus: 'pending', subjectCommonName: 'example.com', rawSummary: {}, observedAt: '2026-08-26T01:00:00.000Z',
    firstObservedAt: '2026-08-26T01:00:00.000Z', createdAt: '2026-08-26T01:00:00.000Z', updatedAt: '2026-08-26T01:00:00.000Z',
  });
  const service = new CaOperationsQueryService(database, undefined, repository);
  const tree = await service.tree(tenantId, async () => true);
  const visible = [...tree.trustDomains.flatMap((domain) => domain.authorities), ...tree.unassignedAuthorities];
  assert.deepEqual(visible.map((authority) => authority.id), [newAuthority.id]);
  const page = await service.records(tenantId, { caId: oldAuthority.id, view: 'request', limit: 50 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.caId, newAuthority.id);
  await database.close();
});

test('AD CS Authority 明确 caConfig 不同则不会错误归并', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new InternalCaRepository(database);
  const provider = await repository.saveProvider({
    id: 'provider-adcs-distinct', tenantId, name: 'ADCS Agent', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows',
    availabilityMode: 'single', capabilities: {
      discoverHierarchy: false, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
      revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: false, deviceLocalCsr: false,
      hardwareBackedKey: false, highAvailability: false,
    }, status: 'active', configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-distinct' },
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
  });
  for (const [id, name, caConfig] of [
    ['ca-adcs-distinct-one', 'CA One', 'ADCS\\CA-One'],
    ['ca-adcs-distinct-two', 'CA Two', 'ADCS\\CA-Two'],
  ] as const) {
    await repository.saveAuthority({
      id, tenantId, name, role: 'root', topologyMode: 'external_managed', providerId: provider.id,
      securityDomain: 'test', status: 'active', subjectCommonName: name,
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-distinct', caConfig },
      createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    });
  }
  const service = new CaOperationsQueryService(database, undefined, repository);
  const tree = await service.tree(tenantId, async () => true);
  const visible = [...tree.trustDomains.flatMap((domain) => domain.authorities), ...tree.unassignedAuthorities];
  assert.deepEqual(visible.map((authority) => authority.id).sort(), ['ca-adcs-distinct-one', 'ca-adcs-distinct-two']);
  await database.close();
});
