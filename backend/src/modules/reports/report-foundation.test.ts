import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { RiskEvent, RiskStatusHistory } from '../monitors/schema/monitors.schema.js';
import { MetricSnapshotWorker } from './application/metric-snapshot-worker.js';
import { calculateRiskTiming, incidentWindowMetricKey } from './domain/report-calculations.js';
import { ReportsRepository } from './repository/reports.repository.js';

test('事故窗口覆盖 30/15/7/3/1/0 和过期边界', () => {
  const asOf = '2026-07-21T12:00:00.000Z';
  const cases = [
    ['2026-08-20T00:00:00.000Z', 'certificates.expiring.30d'],
    ['2026-08-05T00:00:00.000Z', 'certificates.expiring.15d'],
    ['2026-07-28T00:00:00.000Z', 'certificates.expiring.7d'],
    ['2026-07-24T00:00:00.000Z', 'certificates.expiring.3d'],
    ['2026-07-22T00:00:00.000Z', 'certificates.expiring.1d'],
    ['2026-07-21T23:59:59.000Z', 'certificates.expiring.1d'],
    ['2026-07-20T23:59:59.000Z', 'certificates.expired.in_use'],
  ] as const;

  for (const [notAfter, metricKey] of cases) {
    assert.equal(incidentWindowMetricKey(notAfter, asOf, 'in_use'), metricKey);
  }
  assert.equal(incidentWindowMetricKey('2026-07-20T23:59:59.000Z', asOf, 'idle'), undefined);
});

test('TTA/TTR 区分完成样本、未完成样本、SLA 和 reopen', () => {
  const completed = calculateRiskTiming({
    risk: risk('RESOLVED'),
    history: [history('acknowledged', '2026-07-21T00:10:00.000Z'), history('resolved', '2026-07-21T02:00:00.000Z')],
    slaPolicy: { version: 1, severity: 'critical', acknowledgementSeconds: 900, resolutionSeconds: 14400 },
  }, '2026-07-21T03:00:00.000Z');
  assert.deepEqual(completed, {
    acknowledgementSeconds: 600,
    resolutionSeconds: 7200,
    acknowledgementComplete: true,
    resolutionComplete: true,
    acknowledgementWithinSla: true,
    resolutionWithinSla: true,
    reopenedCount: 0,
  });

  const incomplete = calculateRiskTiming({
    risk: risk('OPEN'),
    history: [history('resolved', '2026-07-21T02:00:00.000Z'), history('reopened', '2026-07-21T02:30:00.000Z')],
    slaPolicy: { version: 1, severity: 'critical', acknowledgementSeconds: 900, resolutionSeconds: 14400 },
  }, '2026-07-21T05:00:00.000Z');
  assert.equal(incomplete.acknowledgementSeconds, 18_000);
  assert.equal(incomplete.resolutionComplete, false);
  assert.equal(incomplete.reopenedCount, 1);
});

test('每日快照重跑幂等并保留历史维度快照', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const repository = new ReportsRepository(db);
  let ownerLabel = '旧负责人名称';
  const worker = new MetricSnapshotWorker(repository, async () => [{
    metricKey: 'risks.created',
    metricVersion: 1,
    value: 2,
    sampleCount: 2,
    dimensions: { owner_id: ownerLabel },
  }]);

  await worker.run({ tenantId: 'tenant_snapshot', snapshotDate: '2026-07-20', asOf: '2026-07-20T23:59:59.000Z' });
  ownerLabel = '新负责人名称';
  await worker.run({ tenantId: 'tenant_snapshot', snapshotDate: '2026-07-21', asOf: '2026-07-21T23:59:59.000Z' });
  await worker.run({ tenantId: 'tenant_snapshot', snapshotDate: '2026-07-21', asOf: '2026-07-21T23:59:59.000Z' });

  const snapshots = await repository.listSnapshots('tenant_snapshot', '2026-07-20', '2026-07-21');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.dimensions.owner_id, '旧负责人名称');
  assert.equal(snapshots[1]?.dimensions.owner_id, '新负责人名称');
});

test('快照失败可重跑且不会写入半成品', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const repository = new ReportsRepository(db);
  let fail = true;
  const worker = new MetricSnapshotWorker(repository, async () => {
    if (fail) throw new Error('fixture failure');
    return [{ metricKey: 'risks.created', metricVersion: 1, value: 1, sampleCount: 1 }];
  });

  await assert.rejects(worker.run({ tenantId: 'tenant_retry', snapshotDate: '2026-07-21', asOf: '2026-07-21T23:59:59.000Z' }));
  assert.equal((await repository.listSnapshots('tenant_retry', '2026-07-21', '2026-07-21')).length, 0);
  fail = false;
  await worker.run({ tenantId: 'tenant_retry', snapshotDate: '2026-07-21', asOf: '2026-07-21T23:59:59.000Z' });
  assert.equal((await repository.listSnapshots('tenant_retry', '2026-07-21', '2026-07-21')).length, 1);
});

function risk(status: RiskEvent['status']): RiskEvent {
  return {
    id: 'risk_1',
    dedupKey: 'risk_1',
    type: 'certificate_expired',
    source: 'certificate',
    status,
    severity: 'critical',
    title: '风险',
    summary: '风险',
    scope: { tenantId: 'tenant_1' },
    metadata: {},
    firstDetectedAt: '2026-07-21T00:00:00.000Z',
    lastDetectedAt: '2026-07-21T00:00:00.000Z',
    occurrenceCount: 1,
  };
}

function history(action: RiskStatusHistory['action'], occurredAt: string): RiskStatusHistory {
  return {
    id: `history_${action}`,
    tenantId: 'tenant_1',
    riskEventId: 'risk_1',
    action,
    fromStatus: 'OPEN',
    toStatus: action === 'resolved' ? 'RESOLVED' : action === 'reopened' ? 'OPEN' : 'ACKED',
    actorType: 'user',
    actorId: 'operator_1',
    occurredAt,
    metadata: {},
  };
}
