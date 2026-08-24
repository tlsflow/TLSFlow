import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationApprovalOrchestrator } from './application/automation-approval-orchestrator.js';
import { AutomationsRepository } from './repository/automations.repository.js';

test('审批已消费时仍视为批准完成并恢复自动化运行', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-08T00:00:00.000Z';
  await repository.createAutomation({ id: 'automation_consumed', tenantId: 'tenant_consumed', name: 'A', status: 'draft', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createRun({
    id: 'run_consumed',
    tenantId: 'tenant_consumed',
    automationId: 'automation_consumed',
    automationVersion: 1,
    automationNameSnapshot: 'A',
    triggerType: 'on_demand',
    idempotencyKey: 'consumed-key',
    approvalId: 'approval-consumed',
    status: 'waiting_approval',
    targetSummary: { total: 1, pending: 1, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    actionTypes: [],
    environmentSnapshots: [],
    createdBy: 'user_1',
    createdAt: now,
  });
  await repository.createRunTarget({
    id: 'target_consumed',
    tenantId: 'tenant_consumed',
    runId: 'run_consumed',
    sequenceNo: 1,
    targetSnapshot: { certificateId: 'certificate-1', certificateName: 'Certificate 1', tags: [] },
    actionTypes: [],
    status: 'pending',
    notificationRequestIds: [],
    createdAt: now,
    updatedAt: now,
  });
  let consumeCalled = false;
  const approvals = {
    get: async () => ({ id: 'approval-consumed', status: 'consumed' as const }),
    consume: async () => {
      consumeCalled = true;
      throw new Error('已消费审批不应重复消费');
    },
  };
  const orchestrator = new AutomationApprovalOrchestrator(approvals as never, repository, () => new Date(now));

  const result = await orchestrator.synchronizeRun('run_consumed', 'tenant_consumed');

  assert.deepEqual(result, { status: 'approved', approvalId: 'approval-consumed' });
  assert.equal(consumeCalled, false);
  assert.equal((await repository.getRun('run_consumed', 'tenant_consumed'))?.status, 'queued');
});
