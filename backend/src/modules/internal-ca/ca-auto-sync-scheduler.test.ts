import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { CaAutoSyncScheduler } from './application/ca-auto-sync-scheduler.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';
import { InternalCaRepository } from './repository/internal-ca.repository.js';
import type { CaSyncRunEntity } from './schema/internal-ca.schema.js';

const now = new Date('2026-07-25T08:00:00.000Z');

test('自动调度器首次只为同一插件 Provider 创建一个高优先级运行', async () => {
  const { operationsRepository } = await fixture();
  const inputs: Array<Record<string, unknown>> = [];
  const scheduler = new CaAutoSyncScheduler(operationsRepository, {
    async createCaSyncRuns(input) {
      inputs.push(input as unknown as Record<string, unknown>);
      return [];
    },
  });

  assert.equal(await scheduler.runOnce(8, now), 1);
  assert.deepEqual(inputs.map((input) => input.objectTypes), [['request']]);
  assert.ok(inputs.every((input) => input.mode === 'incremental' && input.changedAfter === undefined));
  assert.ok(inputs.every((input) => (input.actor as { id: string }).id === 'system_ca_auto_sync'));
});

test('自动调度使用五分钟重叠窗口且状态回查不携带旧游标', async () => {
  const { operationsRepository } = await fixture();
  await operationsRepository.createSyncRun(createRun('previous', {
    status: 'succeeded',
    cursorBefore: '100',
    cursorAfter: '200',
    sourceWatermark: '2026-07-25T07:59:40.000Z',
    completedAt: '2026-07-25T07:59:40.000Z',
    createdAt: '2026-07-25T07:59:30.000Z',
    updatedAt: '2026-07-25T07:59:40.000Z',
  }));
  const created: CaSyncRunEntity[] = [];
  const scheduler = new CaAutoSyncScheduler(operationsRepository, {
    async createCaSyncRuns(input) {
      const run = createRun('scheduled', {
        objectType: input.objectTypes[0],
        changedAfter: input.changedAfter,
        requestedBy: input.actor.id,
      });
      created.push(run);
      return [run];
    },
  });

  await operationsRepository.createSyncRun(createRun('issuance-recent', {
    status: 'succeeded', objectType: 'issuance', completedAt: '2026-07-25T07:59:50.000Z',
    createdAt: '2026-07-25T07:59:45.000Z', updatedAt: '2026-07-25T07:59:50.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('revocation-recent', {
    status: 'succeeded', objectType: 'revocation', completedAt: '2026-07-25T07:59:50.000Z',
    createdAt: '2026-07-25T07:59:45.000Z', updatedAt: '2026-07-25T07:59:50.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('template-recent', {
    status: 'succeeded', objectType: 'template', completedAt: '2026-07-25T07:59:50.000Z',
    createdAt: '2026-07-25T07:59:45.000Z', updatedAt: '2026-07-25T07:59:50.000Z',
  }));
  await scheduler.runOnce(8, now);
  const requestRun = created.find((run) => run.objectType === 'request');
  assert.equal(requestRun?.changedAfter, '2026-07-25T07:54:40.000Z');
  assert.equal(requestRun?.cursorBefore, undefined);
  assert.equal(requestRun?.cursorAfter, undefined);
});

test('自动调度遵守分级周期、活动运行去重和失败退避', async () => {
  const { operationsRepository } = await fixture();
  await operationsRepository.createSyncRun(createRun('request-recent', {
    status: 'succeeded', objectType: 'request', completedAt: '2026-07-25T07:59:55.000Z',
    createdAt: '2026-07-25T07:59:50.000Z', updatedAt: '2026-07-25T07:59:55.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('issuance-active', {
    status: 'queued', objectType: 'issuance', createdAt: '2026-07-25T07:50:00.000Z', updatedAt: '2026-07-25T07:50:00.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('revocation-failed', {
    status: 'failed', objectType: 'revocation', completedAt: '2026-07-25T07:58:00.000Z',
    createdAt: '2026-07-25T07:57:00.000Z', updatedAt: '2026-07-25T07:58:00.000Z',
  }));

  const due = await operationsRepository.listDueAutomaticSyncTargets(now.toISOString(), 8);
  assert.deepEqual(due.map((target) => target.objectType), []);
});

test('自动调度按超期比例公平选择对象，避免低频对象饿死', async () => {
  const { operationsRepository } = await fixture();
  await operationsRepository.createSyncRun(createRun('request-old', {
    status: 'succeeded', objectType: 'request', completedAt: '2026-07-25T07:59:40.000Z',
    createdAt: '2026-07-25T07:59:30.000Z', updatedAt: '2026-07-25T07:59:40.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('issuance-old', {
    status: 'succeeded', objectType: 'issuance', completedAt: '2026-07-25T07:57:00.000Z',
    createdAt: '2026-07-25T07:56:50.000Z', updatedAt: '2026-07-25T07:57:00.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('revocation-old', {
    status: 'succeeded', objectType: 'revocation', completedAt: '2026-07-25T07:59:20.000Z',
    createdAt: '2026-07-25T07:59:10.000Z', updatedAt: '2026-07-25T07:59:20.000Z',
  }));
  await operationsRepository.createSyncRun(createRun('template-old', {
    status: 'succeeded', objectType: 'template', completedAt: '2026-07-25T07:50:00.000Z',
    createdAt: '2026-07-25T07:49:50.000Z', updatedAt: '2026-07-25T07:50:00.000Z',
  }));

  const due = await operationsRepository.listDueAutomaticSyncTargets(now.toISOString(), 8);
  assert.deepEqual(due.map((target) => target.objectType), ['issuance']);
});

async function fixture() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const internalRepository = new InternalCaRepository(database);
  await internalRepository.saveProvider({
    id: 'provider-plugin', tenantId: 'tenant-1', name: '通用 CA 插件', type: 'plugin',
    deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single',
    capabilities: {
      discoverHierarchy: true, createRoot: false, createIntermediate: false, signCsr: true,
      queryIssuance: true, revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true,
      deviceLocalCsr: false, hardwareBackedKey: true, highAvailability: false,
    },
    status: 'active', configuration: { discovered: { caConfig: 'host\\CA' } },
    createdAt: '2026-07-25T07:00:00.000Z', updatedAt: '2026-07-25T07:00:00.000Z',
  });
  await internalRepository.saveAuthority({
    id: 'ca-plugin', tenantId: 'tenant-1', name: '通用 CA', role: 'root', topologyMode: 'external_managed',
    providerId: 'provider-plugin', securityDomain: 'production', status: 'active', subjectCommonName: '通用 CA',
    createdAt: '2026-07-25T07:00:00.000Z', updatedAt: '2026-07-25T07:00:00.000Z',
  });
  return { database, operationsRepository: new CaOperationsRepository(database) };
}

function createRun(id: string, overrides: Partial<CaSyncRunEntity> = {}): CaSyncRunEntity {
  return {
    id,
    tenantId: 'tenant-1',
    providerId: 'provider-plugin',
    caId: 'ca-plugin',
    objectType: 'request',
    mode: 'incremental',
    status: 'queued',
    readCount: 0,
    upsertedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    attemptCount: 0,
    requestedBy: 'system_ca_auto_sync',
    createdAt: '2026-07-25T07:00:00.000Z',
    updatedAt: '2026-07-25T07:00:00.000Z',
    ...overrides,
  };
}
