import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';

async function setup() {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  return { db, repository: new AutomationsRepository(db) };
}

test('自动化迁移可重复执行且 Repository 保留不可变历史', async () => {
  const { db, repository } = await setup();
  await applyAutomationMigrations(db);
  const now = new Date().toISOString();
  await repository.createAutomation({ id: 'aut_1', tenantId: 'tenant_1', name: '证书更新', status: 'draft', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_1', tenantId: 'tenant_1', automationId: 'aut_1', version: 1,
    trigger: { type: 'on_demand' }, targetSelector: { certificateIds: ['cert_1'] },
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'automation.result', eventKey: 'completed' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'a'.repeat(64), createdBy: 'user_1', createdAt: now,
  });
  await repository.createRun({
    id: 'arun_1', tenantId: 'tenant_1', automationId: 'aut_1', automationVersion: 1, automationNameSnapshot: '证书更新',
    triggerType: 'on_demand', idempotencyKey: 'manual_1', status: 'queued',
    targetSummary: { total: 1, pending: 1, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    actionTypes: ['send_notification'], environmentSnapshots: ['production'], createdBy: 'user_1', createdAt: now,
  });
  await repository.createRunTarget({
    id: 'art_1', tenantId: 'tenant_1', runId: 'arun_1', sequenceNo: 1,
    targetSnapshot: { certificateId: 'cert_1', certificateName: 'example.com', environment: 'production', tags: [] },
    environmentSnapshot: 'production', actionTypes: ['send_notification'], status: 'pending', notificationRequestIds: [], createdAt: now, updatedAt: now,
  });
  await repository.updateAutomation('aut_1', 'tenant_1', { status: 'deleted', deletedAt: now, updatedAt: now });

  assert.equal(await repository.getAutomation('aut_1', 'tenant_1'), undefined);
  assert.equal((await repository.listVersions('aut_1', 'tenant_1')).length, 1);
  assert.equal((await repository.listRuns('tenant_1', 'aut_1'))[0]?.automationNameSnapshot, '证书更新');
  assert.equal((await repository.listRunTargets('arun_1', 'tenant_1'))[0]?.targetSnapshot.certificateName, 'example.com');
});

test('运行幂等键由数据库唯一约束保护', async () => {
  const { repository } = await setup();
  const now = new Date().toISOString();
  await repository.createAutomation({ id: 'aut_2', tenantId: 'tenant_1', name: '定时任务', status: 'active', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  const run = {
    id: 'arun_2', tenantId: 'tenant_1', automationId: 'aut_2', automationVersion: 1, automationNameSnapshot: '定时任务',
    triggerType: 'schedule' as const, idempotencyKey: 'schedule:aut_2:2026-07-21T00:00:00.000Z', status: 'queued' as const,
    targetSummary: { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    actionTypes: ['send_notification' as const], environmentSnapshots: [], createdBy: 'system', createdAt: now,
  };
  await repository.createRun(run);
  await assert.rejects(() => repository.createRun({ ...run, id: 'arun_3' }));
});
