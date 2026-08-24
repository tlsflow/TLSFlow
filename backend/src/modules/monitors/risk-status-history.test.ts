import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgMonitorsRepository } from './repository/monitors.repository.js';

test('风险创建、确认、解决和重新打开会保存完整历史', async () => {
  const repository = await createRepository();
  const created = await repository.upsertRiskEvent(riskInput('2026-07-01T00:00:00.000Z'));

  await repository.changeRiskStatus({
    tenantId: 'tenant_history',
    riskEventId: created.id,
    action: 'acknowledged',
    actorType: 'user',
    actorId: 'operator_1',
    occurredAt: '2026-07-01T00:10:00.000Z',
  });
  await repository.changeRiskStatus({
    tenantId: 'tenant_history',
    riskEventId: created.id,
    action: 'resolved',
    actorType: 'user',
    actorId: 'operator_1',
    occurredAt: '2026-07-01T02:00:00.000Z',
  });
  await repository.changeRiskStatus({
    tenantId: 'tenant_history',
    riskEventId: created.id,
    action: 'reopened',
    reason: '证书再次被检测为过期',
    actorType: 'user',
    actorId: 'operator_2',
    occurredAt: '2026-07-02T00:00:00.000Z',
  });

  const history = await repository.listRiskStatusHistory('tenant_history', created.id);
  assert.deepEqual(history.map((item) => item.action), ['created', 'acknowledged', 'resolved', 'reopened']);
  assert.deepEqual(history.map((item) => item.toStatus), ['OPEN', 'ACKED', 'RESOLVED', 'OPEN']);
});

test('持续风险 occurrence 增加不会重复新增历史或清除确认状态', async () => {
  const repository = await createRepository();
  const created = await repository.upsertRiskEvent(riskInput('2026-07-01T00:00:00.000Z'));
  await repository.changeRiskStatus({
    tenantId: 'tenant_history',
    riskEventId: created.id,
    action: 'acknowledged',
    actorType: 'user',
    actorId: 'operator_1',
    occurredAt: '2026-07-01T00:10:00.000Z',
  });

  const repeated = await repository.upsertRiskEvent(riskInput('2026-07-01T01:00:00.000Z'));
  const history = await repository.listRiskStatusHistory('tenant_history', created.id);

  assert.equal(repeated.id, created.id);
  assert.equal(repeated.status, 'ACKED');
  assert.equal(repeated.occurrenceCount, 2);
  assert.deepEqual(history.map((item) => item.action), ['created', 'acknowledged']);
});

test('已解决风险再次被扫描时自动记录 reopened', async () => {
  const repository = await createRepository();
  const created = await repository.upsertRiskEvent(riskInput('2026-07-01T00:00:00.000Z'));
  await repository.changeRiskStatus({
    tenantId: 'tenant_history',
    riskEventId: created.id,
    action: 'resolved',
    actorType: 'user',
    actorId: 'operator_1',
    occurredAt: '2026-07-01T02:00:00.000Z',
  });

  const reopened = await repository.upsertRiskEvent(riskInput('2026-07-02T00:00:00.000Z'));
  const history = await repository.listRiskStatusHistory('tenant_history', created.id);

  assert.equal(reopened.status, 'OPEN');
  assert.equal(reopened.resolvedAt, undefined);
  assert.deepEqual(history.map((item) => item.action), ['created', 'resolved', 'reopened']);
});

test('只有已解决风险允许重新打开', async () => {
  const repository = await createRepository();
  const created = await repository.upsertRiskEvent(riskInput('2026-07-01T00:00:00.000Z'));

  await assert.rejects(
    repository.changeRiskStatus({
      tenantId: 'tenant_history',
      riskEventId: created.id,
      action: 'reopened',
      actorType: 'user',
      actorId: 'operator_1',
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
  );
});

async function createRepository(): Promise<PgMonitorsRepository> {
  const db = new PgliteDatabase();
  await runMigrations(db);
  return new PgMonitorsRepository(db);
}

function riskInput(detectedAt: string) {
  return {
    dedupKey: 'certificate-expired:asset_1',
    type: 'certificate_expired' as const,
    source: 'certificate' as const,
    severity: 'critical' as const,
    title: '证书已过期',
    summary: '证书已过期',
    scope: { tenantId: 'tenant_history', certificateAssetId: 'asset_1' },
    metadata: {},
    detectedAt,
  };
}
