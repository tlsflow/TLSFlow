import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260814000200_repair_dangling_plugin_workflow_bindings.sql';
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

test('清理悬空插件 Workflow 绑定及其执行引用并保留有效绑定', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  const hash = `sha256:${'a'.repeat(64)}`;
  await db.exec(`
    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values (
      'dangling-plugin-version', 'SYSTEM', 'cloud.aliyun', '2.0.1', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH',
      'OFFICIAL_SIGNED', 'OFFICIAL',
      jsonb_build_object(
        'pluginId', 'cloud.aliyun', 'version', '2.0.1',
        'resources', jsonb_build_object('runtimeEntrypoint', 'runtime/index.js')
      ),
      '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()
    );

    insert into pg_documents (namespace, document_id, payload)
    values
      ('workflow.templates', 'valid-plugin-template', jsonb_build_object(
        'id', 'valid-plugin-template', 'name', 'valid-plugin-template', 'origin', 'plugin_internal',
        'currentVersionId', 'valid-plugin-version'
      )),
      ('workflow.template_versions', 'valid-plugin-version', jsonb_build_object(
        'id', 'valid-plugin-version', 'templateId', 'valid-plugin-template', 'version', 1,
        'status', 'published', 'contentHash', '${hash}', 'executionMode', 'PLUGIN_RUNNER'
      ));

    insert into unified_plugin_workflow_bindings (
      plugin_version_id, owner_type, capability_key, workflow_key, workflow_resource_path,
      workflow_template_id, workflow_version_id, workflow_content_sha256, created_at
    ) values
      ('dangling-plugin-version', 'SYSTEM', 'certificate.deploy', 'certificate.deploy', 'workflows/deploy.json',
       'valid-plugin-template', 'valid-plugin-version', '${hash}', now()),
      ('dangling-plugin-version', 'SYSTEM', 'credential.acquire', 'credential.acquire', 'workflows/credential.json',
       'missing-plugin-template', 'missing-plugin-version', '${hash}', now());

    insert into workflow_execution_bindings (
      id, tenant_id, plugin_version_id, capability_key, workflow_key, workflow_template_id,
      workflow_version_selection, workflow_version_id, runner, gateway_id, input_bindings,
      status, version, created_at, updated_at
    ) values (
      'dangling-execution-binding', 'tenant-1', 'dangling-plugin-version', 'credential.acquire', 'credential.acquire',
      'missing-plugin-template', 'FIXED', 'missing-plugin-version', 'CONTROL_PLANE', null, '{}'::jsonb,
      'ACTIVE', 1, now(), now()
    );

    insert into browser_credential_sessions (
      id, tenant_id, asset_id, plugin_version_id, workflow_template_id, workflow_version_id,
      capability_key, runtime_session_id, one_time_url_hash, status, expires_at, created_by,
      created_at, updated_at
    ) values (
      'dangling-browser-session', 'tenant-1', 'asset-1', 'dangling-plugin-version',
      'missing-plugin-template', 'missing-plugin-version', 'credential.acquire',
      'dangling-runtime-session', '${hash}', 'created', now(), 'user-1', now(), now()
    );

    insert into plugin_workflow_ledgers (
      id, tenant_id, execution_run_id, execution_step_id, plugin_version_id, workflow_version_id,
      capability_key, target_hash, plan_hash, input_hash, status, recovery_classification,
      completed_step_ids, compensation_step_ids, created_at, updated_at
    ) values (
      'dangling-ledger', 'tenant-1', 'dangling-run', 'dangling-step', 'dangling-plugin-version',
      'missing-plugin-version', 'credential.acquire', repeat('a', 64), repeat('b', 64), repeat('c', 64),
      'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now()
    );
  `);

  await applyTarget(db);

  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id = 'dangling-plugin-version' and workflow_key = 'credential.acquire'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where workflow_key = 'certificate.deploy'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id = 'dangling-execution-binding'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from browser_credential_sessions where id = 'dangling-browser-session'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from plugin_workflow_ledgers where id = 'dangling-ledger'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260814000200'`)).rows[0]?.count, '4');

  await applyTarget(db);
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260814000200'`)).rows[0]?.count, '4');
});
