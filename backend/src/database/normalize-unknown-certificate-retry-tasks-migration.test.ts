import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260817000300_normalize_unknown_certificate_retry_tasks.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

/** 中文说明：只应用目标迁移之前的不可变历史，精确验证本迁移的升级行为。 */
async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyTarget(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('未知证书写入的历史部署产物指纹会进入主动 TLS 核验队列', async () => {
  const db = new PgliteDatabase();
  try {
    await applyMigrationsBeforeTarget(db);
    await db.exec(`
      insert into task_runs (
        id, tenant_id, task_type, definition_version, category, status,
        trigger_source, payload, progress
      ) values (
        'task-unknown-certificate', 'tenant-certificate', 'CERTIFICATE_DEPLOY', 1, 'EXECUTION',
        'RETRY_WAITING', 'execution.apply.enqueue',
        jsonb_build_object('runId', 'run-unknown-certificate'),
        '{}'::jsonb
      );

      insert into task_attempts (
        id, task_run_id, attempt_no, worker_id, lease_expires_at, status, error_code
      ) values (
        'attempt-unknown-certificate', 'task-unknown-certificate', 1, 'old-worker',
        now(), 'FAILED', 'PLUGIN_OPERATION_UNKNOWN_STATE'
      );

      insert into pg_documents (namespace, document_id, payload)
      values (
        'executions:steps', 'step-unknown-certificate', jsonb_build_object(
          'id', 'step-unknown-certificate',
          'executionRunId', 'run-unknown-certificate',
          'status', 'RUNNING',
          'lastErrorCode', 'PLUGIN_OPERATION_UNKNOWN_STATE',
          'inputSnapshot', jsonb_build_object(
            'resultDetail', jsonb_build_object('executionStatus', 'UNKNOWN'),
            'certificateVerification', jsonb_build_object(
              'capabilityKey', 'certificate.verify',
              'schemaVersion', '1.0'
            ),
            'deploymentArtifact', jsonb_build_object(
              'expectedFingerprintSha256', repeat('a', 64)
            )
          )
        )
      );
    `);

    await applyTarget(db);
    await applyTarget(db);

    const task = await db.query<{
      status: string;
      next_attempt_at: string | null;
      waiting_status: string | null;
      automatic_recovery: string | null;
    }>(`
      select status,
             next_attempt_at::text,
             progress->>'waitingStatus' as waiting_status,
             progress->>'automaticRecovery' as automatic_recovery
        from task_runs
       where id = 'task-unknown-certificate'
    `);
    assert.equal(task.rows[0]?.status, 'WAITING_RESULT');
    assert.notEqual(task.rows[0]?.next_attempt_at, null);
    assert.equal(task.rows[0]?.waiting_status, 'WAITING_RESULT');
    assert.equal(task.rows[0]?.automatic_recovery, 'true');

    const attempt = await db.query<{ status: string }>(`
      select status
        from task_attempts
       where id = 'attempt-unknown-certificate'
    `);
    assert.equal(attempt.rows[0]?.status, 'WAITING');
  } finally {
    await db.close();
  }
});
