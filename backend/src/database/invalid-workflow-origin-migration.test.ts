import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260811000200_remove_invalid_workflow_origin_records.sql';
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

test('清除不符合 Workflow 来源合同的历史记录及其运行引用', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  await db.exec(`
    insert into pg_documents (namespace, document_id, payload)
    values
      ('workflow.templates', 'legacy-origin-template', jsonb_build_object(
        'id', 'legacy-origin-template', 'name', 'legacy-origin-template', 'origin', 'legacy',
        'currentVersionId', 'legacy-origin-version'
      )),
      ('workflow.templates', 'current-template', jsonb_build_object(
        'id', 'current-template', 'name', 'current-template', 'origin', 'user'
      )),
      ('workflow.template_versions', 'legacy-origin-version', jsonb_build_object(
        'id', 'legacy-origin-version', 'templateId', 'legacy-origin-template', 'version', 1
      )),
      ('workflow.template_versions', 'current-version', jsonb_build_object(
        'id', 'current-version', 'templateId', 'current-template', 'version', 1
      ));

    insert into workflow_execution_bindings (
      id, tenant_id, workflow_template_id, workflow_version_selection, workflow_version_id,
      runner, input_bindings, status, version, created_at, updated_at
    ) values (
      'legacy-execution-binding', 'tenant-1', 'legacy-origin-template', 'PINNED', 'legacy-origin-version',
      'CONTROL_PLANE', '{}'::jsonb, 'ACTIVE', 1, now(), now()
    );

    insert into plugin_workflow_ledgers (
      id, tenant_id, execution_run_id, execution_step_id, plugin_version_id,
      workflow_version_id, capability_key, target_hash, plan_hash, input_hash,
      status, recovery_classification, completed_step_ids, compensation_step_ids,
      created_at, updated_at
    ) values (
      'legacy-ledger', 'tenant-1', 'legacy-run', 'legacy-step', 'plugin-version',
      'legacy-origin-version', 'certificate.deploy', repeat('a', 64), repeat('b', 64), repeat('c', 64),
      'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now()
    );
  `);

  await applyTarget(db);

  assert.equal((await db.query(`
    select count(*)::text as count
    from pg_documents
    where document_id in ('legacy-origin-template', 'legacy-origin-version')
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from pg_documents
    where document_id in ('current-template', 'current-version')
  `)).rows[0]?.count, '2');
  assert.equal((await db.query(`
    select count(*)::text as count
    from workflow_execution_bindings
    where id = 'legacy-execution-binding'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from plugin_workflow_ledgers
    where id = 'legacy-ledger'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260811000200'
  `)).rows[0]?.count, '4');

  await applyTarget(db);
  assert.equal((await db.query(`
    select count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260811000200'
  `)).rows[0]?.count, '4');
});
