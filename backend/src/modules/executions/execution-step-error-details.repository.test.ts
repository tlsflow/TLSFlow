import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import type { ExecutionStepEntity } from './schema/executions.schema.js';

test('执行步骤错误详情通过新迁移写入并从数据库完整回读', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const repository = new ExecutionsRepository(db);
  const now = '2026-07-30T00:00:00.000Z';
  const issues = ['VARIABLE', 'CONNECTION', 'CREDENTIAL', 'ARTIFACT'].map((category) => ({
    category,
    code: `DEPLOYMENT_INPUT_${category}_MISSING`,
    slot: category.toLowerCase(),
    path: `${category.toLowerCase()}s.slot`,
    bindingLayer: 'DEVICE',
    messageKey: `deploymentInputs.issues.${category}`,
  }));
  const step: ExecutionStepEntity = {
    id: 'step_error_details_1',
    tenantId: 'tenant_1',
    executionRunId: 'run_error_details_1',
    stepNo: 1,
    stepType: 'INSTALL',
    name: 'INSTALL target_1',
    attemptCount: 1,
    maxAttempts: 1,
    lastFailureCategory: 'unsafe',
    lastErrorCode: 'VALIDATION_FAILED',
    lastErrorMessage: '部署输入校验失败',
    lastErrorDetails: { issues },
    inputSnapshot: {},
    status: 'FAILED',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await repository.createStep(step);
  const stored = await repository.getStepOrThrow(step.id, step.tenantId);

  assert.deepEqual(stored.lastErrorDetails, { issues });
  const persisted = await db.query<{ payload: Record<string, unknown> }>(
    `select payload from pg_documents
      where namespace = 'executions:steps' and document_id = $1`,
    [step.id],
  );
  assert.deepEqual(persisted.rows[0]?.payload.lastErrorDetails, { issues });
});
