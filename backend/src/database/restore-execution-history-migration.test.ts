import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260813000200_restore_execution_history.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforeRestore(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyRestore(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('恢复执行历史迁移幂等，并保留可验证状态和脱敏边界', async () => {
  const db = new PgliteDatabase();
  try {
    await applyMigrationsBeforeRestore(db);
    await db.exec(`
      insert into pg_documents (namespace, document_id, payload) values
        ('deployment-plans:transitions', 'run-pending', '{"entityType":"executionRun","entityId":"run_restore_1","tenantId":"tenant-a","toStatus":"PENDING","event":"run.created","actorId":"user-a","createdAt":"2026-08-01T00:00:00Z"}'),
        ('deployment-plans:transitions', 'run-success', '{"entityType":"executionRun","entityId":"run_restore_1","tenantId":"tenant-a","toStatus":"SUCCESS","event":"runner.success","actorId":"user-a","createdAt":"2026-08-01T00:00:01Z"}'),
        ('deployment-plans:transitions', 'step-pending', '{"entityType":"executionStep","entityId":"step_restore_1","tenantId":"tenant-a","toStatus":"PENDING","event":"step.created","actorId":"user-a","createdAt":"2026-08-01T00:00:00Z"}'),
        ('deployment-plans:transitions', 'step-success', '{"entityType":"executionStep","entityId":"step_restore_1","tenantId":"tenant-a","toStatus":"SUCCESS","event":"step.success","actorId":"user-a","createdAt":"2026-08-01T00:00:01Z"}'),
        ('deployment-plans:transitions', 'run-grant-pending', '{"entityType":"executionRun","entityId":"run_restore_grant_1","tenantId":"tenant-a","toStatus":"PENDING","event":"run.created","actorId":"user-a","createdAt":"2026-08-01T00:00:02Z"}'),
        ('deployment-plans:transitions', 'run-grant-success', '{"entityType":"executionRun","entityId":"run_restore_grant_1","tenantId":"tenant-a","toStatus":"SUCCESS","event":"runner.success","actorId":"user-a","createdAt":"2026-08-01T00:00:03Z"}'),
        ('deployment-plans:transitions', 'step-grant-pending', '{"entityType":"executionStep","entityId":"step_restore_grant_1","tenantId":"tenant-a","toStatus":"PENDING","event":"step.created","actorId":"user-a","createdAt":"2026-08-01T00:00:02Z"}'),
        ('deployment-plans:transitions', 'step-grant-success', '{"entityType":"executionStep","entityId":"step_restore_grant_1","tenantId":"tenant-a","toStatus":"SUCCESS","event":"step.success","actorId":"user-a","createdAt":"2026-08-01T00:00:03Z"}'),
        ('security.audit_logs', 'audit-restore-run', '{"resourceType":"executionRun","resourceId":"run_restore_1","action":"execution.apply.enqueue","detail":{"deploymentPlanId":"plan_restore_1","jobId":"job_restore_1"}}'),
        ('agents:tasks', 'task-restore-step', '{"executionRunId":"run_restore_1","executionStepId":"step_restore_1","tenantId":"tenant-a","status":"succeeded","payload":{"actionType":"windows.iis.deploy_certificate","privateKeyPem":"DO_NOT_COPY","pfxPassword":"DO_NOT_COPY"}}'),
        ('security.execution_grants', 'grant-restore-step', '{"runId":"run_restore_grant_1","stepId":"step_restore_grant_1:workflow.deploy:1","tenantId":"tenant-a","executorType":"workflow.deploy","status":"revoked"}');
    `);

    await applyRestore(db);
    await applyRestore(db);

    assert.equal((await db.query(`select count(*)::int as count from pg_documents where namespace = 'executions:runs'`)).rows[0]?.count, 2);
    assert.equal((await db.query(`select count(*)::int as count from pg_documents where namespace = 'executions:steps'`)).rows[0]?.count, 2);
    assert.deepEqual((await db.query(`
      select payload->>'status' as status, payload->>'deploymentPlanId' as plan_id,
             payload->'summary'->>'restoredFromHistory' as restored,
             payload->'summary'->'restoredFrom' as restored_from
      from pg_documents where namespace = 'executions:runs' and document_id = 'run_restore_1'
    `)).rows[0], {
      status: 'SUCCESS',
      plan_id: 'plan_restore_1',
      restored: 'true',
      restored_from: ['deployment-plans:transitions', 'security.audit_logs', 'agents:tasks', 'security.execution_grants'],
    });
    assert.deepEqual((await db.query(`
      select payload->>'status' as status, payload->>'executionRunId' as run_id
      from pg_documents where namespace = 'executions:steps' and document_id = 'step_restore_1'
    `)).rows[0], { status: 'SUCCESS', run_id: 'run_restore_1' });
    assert.deepEqual((await db.query(`
      select payload->>'status' as status, payload->>'executionRunId' as run_id
      from pg_documents where namespace = 'executions:steps' and document_id = 'step_restore_grant_1'
    `)).rows[0], { status: 'SUCCESS', run_id: 'run_restore_grant_1' });
    const restoredPayload = JSON.stringify((await db.query(`
      select payload from pg_documents where namespace in ('executions:runs', 'executions:steps')
    `)).rows);
    assert.equal(restoredPayload.includes('DO_NOT_COPY'), false);
    assert.equal(restoredPayload.includes('privateKeyPem'), false);
    assert.equal(restoredPayload.includes('pfxPassword'), false);
  } finally {
    await db.close();
  }
});
