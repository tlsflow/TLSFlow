import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260817000400_repair_terminal_certificate_task_errors.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

/** 中文说明：隔离目标迁移，避免后续迁移掩盖历史错误投影的修复效果。 */
async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyTarget(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('终态证书执行的真实 TLS 错误会覆盖历史 Worker 竞态错误', async () => {
  const db = new PgliteDatabase();
  try {
    await applyMigrationsBeforeTarget(db);
    await db.exec(`
      insert into task_runs (
        id, tenant_id, task_type, definition_version, category, status,
        trigger_source, payload, last_error_code, last_error_message
      ) values (
        'task-terminal-repair', 'tenant-certificate', 'CERTIFICATE_DEPLOY', 1, 'EXECUTION',
        'FAILED', 'execution.apply.enqueue',
        jsonb_build_object('runId', 'run-terminal-repair'),
        'TASK_EXECUTOR_THROWN', '只有 DISPATCHED 或 RUNNING 运行允许调度执行'
      );

      insert into task_attempts (
        id, task_run_id, attempt_no, worker_id, lease_expires_at, status, error_code, error_summary
      ) values (
        'attempt-terminal-repair', 'task-terminal-repair', 3, 'old-worker', now(),
        'FAILED', 'TASK_EXECUTOR_THROWN', '只有 DISPATCHED 或 RUNNING 运行允许调度执行'
      );

      insert into task_events (id, task_run_id, event_type, event_data, actor_type)
      values (
        'event-terminal-repair', 'task-terminal-repair', 'FAILED',
        jsonb_build_object('errorCode', 'TASK_EXECUTOR_THROWN'), 'SYSTEM'
      );

      insert into pg_documents (namespace, document_id, payload)
      values (
        'executions:runs', 'run-terminal-repair', jsonb_build_object(
          'id', 'run-terminal-repair',
          'status', 'FAILED',
          'errorCode', 'TLS_VERIFY_FINGERPRINT_MISMATCH',
          'errorMessage', '宿主证书验证发现远端 TLS 证书与目标证书不一致'
        )
      );
    `);

    await applyTarget(db);
    await applyTarget(db);

    const task = await db.query<{
      error_code: string;
      error_message: string;
      terminal_error_source: string | null;
    }>(`
      select last_error_code as error_code,
             last_error_message as error_message,
             progress->>'terminalErrorSource' as terminal_error_source
        from task_runs
       where id = 'task-terminal-repair'
    `);
    assert.deepEqual(task.rows[0], {
      error_code: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      error_message: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
      terminal_error_source: 'execution_run',
    });

    const attempt = await db.query<{ error_code: string; error_summary: string }>(`
      select error_code, error_summary
        from task_attempts
       where id = 'attempt-terminal-repair'
    `);
    assert.deepEqual(attempt.rows[0], {
      error_code: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      error_summary: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
    });

    const event = await db.query<{ error_code: string; source: string }>(`
      select event_data->>'errorCode' as error_code,
             event_data->>'source' as source
        from task_events
       where id = 'event-terminal-repair'
    `);
    assert.deepEqual(event.rows[0], {
      error_code: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      source: 'execution_run.terminal_error_repair',
    });
  } finally {
    await db.close();
  }
});
