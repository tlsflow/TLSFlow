import assert from 'node:assert/strict';
import test from 'node:test';
import { RunRecoveryWorker } from './application/run-recovery-worker.js';

test('UNKNOWN Agent 写操作不会被恢复 worker 重放', async () => {
  const unknownStep = {
    id: 'step_unknown',
    status: 'RUNNING',
    idempotent: true,
    stepNo: 1,
    inputSnapshot: { resultDetail: { executionStatus: 'UNKNOWN' } },
  };
  const pendingStep = {
    id: 'step_pending',
    status: 'PENDING',
    idempotent: true,
    stepNo: 2,
    inputSnapshot: {},
  };
  const worker = new RunRecoveryWorker({
    listRuns: async () => [{ id: 'run_unknown', status: 'RUNNING' }],
    listSteps: async () => [unknownStep, pendingStep],
  } as never);

  const [candidate] = await worker.recoverableRuns('tenant_unknown');

  assert.deepEqual(candidate.stepsToResume.map((step) => step.id), ['step_pending']);
  assert.deepEqual(candidate.skippedStepIds, []);
});

test('重启恢复不会自动重放没有结果账本的 Agent v2 写操作', async () => {
  const writeStep = {
    id: 'step_write_without_result',
    status: 'RUNNING',
    idempotent: true,
    stepNo: 1,
    inputSnapshot: { actionType: 'agent.plan.execute', plan: { writeEffect: true } },
  };
  const worker = new RunRecoveryWorker({
    listRuns: async () => [{ id: 'run_write_without_result', status: 'RUNNING' }],
    listSteps: async () => [writeStep],
  } as never);

  const [candidate] = await worker.recoverableRuns('tenant_recovery_write');

  assert.deepEqual(candidate.stepsToResume, []);
  assert.deepEqual(candidate.unknownStepIds, ['step_write_without_result']);
});
