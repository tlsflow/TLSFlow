import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260815000100_remove_monitoring_task_audit_logs.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyTarget(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('清理历史监控任务审计但保留其他任务审计', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  await db.exec(`
    insert into task_runs (
      id, tenant_id, task_type, definition_version, category, status,
      trigger_source, payload
    ) values (
      'monitor-task-cancel', 'tenant-a', 'MONITORING_BATCH', 1, 'MONITORING',
      'CANCELLED', 'monitoring.scheduler', '{}'::jsonb
    );

    insert into pg_documents (namespace, document_id, payload)
    values
      ('security.audit_logs', 'audit-monitor-created', jsonb_build_object(
        'id', 'audit-monitor-created', 'eventType', 'task.created',
        'resourceType', 'task', 'resourceId', 'monitor-task-created',
        'detail', jsonb_build_object('taskType', 'MONITORING_BATCH', 'category', 'MONITORING')
      )),
      ('security.audit_logs', 'audit-monitor-cancelled', jsonb_build_object(
        'id', 'audit-monitor-cancelled', 'eventType', 'task.cancelled',
        'resourceType', 'task', 'resourceId', 'monitor-task-cancel'
      )),
      ('security.audit_logs', 'audit-monitor-probe', jsonb_build_object(
        'id', 'audit-monitor-probe', 'eventType', 'task.created',
        'resourceType', 'task', 'resourceId', 'monitor-task-probe',
        'detail', jsonb_build_object('taskType', 'MONITORING_PROBE')
      )),
      ('security.audit_logs', 'audit-execution-created', jsonb_build_object(
        'id', 'audit-execution-created', 'eventType', 'task.created',
        'resourceType', 'task', 'resourceId', 'execution-task',
        'detail', jsonb_build_object('taskType', 'CERTIFICATE_DRY_RUN', 'category', 'EXECUTION')
      )),
      ('security.audit_logs', 'audit-secret-used', jsonb_build_object(
        'id', 'audit-secret-used', 'eventType', 'secret.used',
        'resourceType', 'secret', 'resourceId', 'secret-1'
      ));
  `);

  await applyTarget(db);

  const remaining = await db.query<{ document_id: string }>(
    `select document_id
       from pg_documents
      where namespace = 'security.audit_logs'
      order by document_id`,
  );
  assert.deepEqual(remaining.rows.map((row) => row.document_id), [
    'audit-execution-created',
    'audit-secret-used',
  ]);

  await applyTarget(db);
  const count = await db.query<{ count: string }>(
    `select count(*)::text as count
       from pg_documents
      where namespace = 'security.audit_logs'`,
  );
  assert.equal(count.rows[0]?.count, '2');
  await db.close();
});
