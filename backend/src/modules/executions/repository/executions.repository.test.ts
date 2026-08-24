import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { ExecutionsRepository } from './executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

test('执行仓储的精确 SQL 会初始化文档表并保持租户和资源边界', async () => {
  const db = new PgliteDatabase();
  const repository = new ExecutionsRepository(db);

  try {
    await repository.createRun(createRun('run-tenant-a-old', 'tenant-a', '2026-08-17T01:00:00.000Z'));
    await repository.createRun(createRun('run-tenant-a-new', 'tenant-a', '2026-08-17T02:00:00.000Z'));
    await repository.createRun(createRun('run-tenant-b', 'tenant-b', '2026-08-17T03:00:00.000Z'));

    const tenantRuns = await repository.listRuns('tenant-a', 'plan-1');
    assert.deepEqual(tenantRuns.map((run) => run.id), ['run-tenant-a-old', 'run-tenant-a-new']);
    assert.equal((await repository.findRunByIdempotencyKey('tenant-a', 'idempotency-run-tenant-a-old'))?.id, 'run-tenant-a-old');
    assert.equal(await repository.findRunByIdempotencyKey('tenant-b', 'idempotency-run-tenant-a-old'), undefined);

    await repository.createStep(createStep('step-tenant-a', 'tenant-a', 'run-tenant-a-old'));
    await repository.createStep(createStep('step-tenant-b', 'tenant-b', 'run-tenant-b'));
    const tenantSteps = await repository.listSteps('tenant-a', 'run-tenant-a-old');
    assert.deepEqual(tenantSteps.map((step) => step.id), ['step-tenant-a']);
  } finally {
    await db.close();
  }
});

function createRun(id: string, tenantId: string, createdAt: string): ExecutionRunEntity {
  return {
    id,
    tenantId,
    deploymentPlanId: 'plan-1',
    runNo: 1,
    type: 'apply',
    idempotencyKey: `idempotency-${id}`,
    requestHash: 'a'.repeat(64),
    status: 'PENDING',
    summary: {},
    createdAt,
    updatedAt: createdAt,
    createdBy: 'tester',
    version: 1,
  };
}

function createStep(id: string, tenantId: string, executionRunId: string): ExecutionStepEntity {
  return {
    id,
    tenantId,
    executionRunId,
    stepNo: 1,
    stepType: 'INSTALL',
    name: '安装',
    attemptCount: 0,
    maxAttempts: 1,
    inputSnapshot: {},
    status: 'PENDING',
    createdAt: '2026-08-17T01:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
    createdBy: 'tester',
    version: 1,
  };
}
