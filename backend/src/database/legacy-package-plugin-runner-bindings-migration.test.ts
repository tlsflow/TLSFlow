import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260817000900_remove_legacy_package_plugin_runner_bindings.sql';
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

test('清理包级 Runner 绑定及引用并保留普通 DSL Workflow', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  const hash = `sha256:${'a'.repeat(64)}`;
  await db.exec(`
    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values
      ('legacy-mode-plugin', 'SYSTEM', 'legacy.mode', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       jsonb_build_object('pluginId', 'legacy.mode', 'version', '1.0.0'), '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('legacy-kind-plugin', 'SYSTEM', 'legacy.kind', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       jsonb_build_object('pluginId', 'legacy.kind', 'version', '1.0.0'), '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('normal-plugin', 'SYSTEM', 'normal.dsl', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       jsonb_build_object('pluginId', 'normal.dsl', 'version', '1.0.0'), '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now());

    insert into pg_documents (namespace, document_id, payload)
    values
      ('workflow.templates', 'legacy-mode-template', jsonb_build_object('id', 'legacy-mode-template', 'origin', 'plugin_internal', 'currentVersionId', 'legacy-mode-version')),
      ('workflow.templates', 'legacy-kind-template', jsonb_build_object('id', 'legacy-kind-template', 'origin', 'plugin_internal', 'currentVersionId', 'legacy-kind-version')),
      ('workflow.templates', 'normal-template', jsonb_build_object('id', 'normal-template', 'origin', 'plugin_internal', 'currentVersionId', 'normal-version')),
      ('workflow.template_versions', 'legacy-mode-version', jsonb_build_object(
        'id', 'legacy-mode-version', 'templateId', 'legacy-mode-template', 'version', 1, 'status', 'published', 'contentHash', '${hash}',
        'executionMode', 'PLUGIN_RUNNER', 'content', jsonb_build_object('kind', 'CurlSshWorkflow')
      )),
      ('workflow.template_versions', 'legacy-kind-version', jsonb_build_object(
        'id', 'legacy-kind-version', 'templateId', 'legacy-kind-template', 'version', 1, 'status', 'published', 'contentHash', '${hash}',
        'content', jsonb_build_object('kind', 'PluginWorkflow')
      )),
      ('workflow.template_versions', 'normal-version', jsonb_build_object(
        'id', 'normal-version', 'templateId', 'normal-template', 'version', 1, 'status', 'published', 'contentHash', '${hash}',
        'content', jsonb_build_object('kind', 'CurlSshWorkflow')
      ));

    insert into unified_plugin_workflow_bindings (
      plugin_version_id, owner_type, capability_key, workflow_key, workflow_resource_path,
      workflow_template_id, workflow_version_id, workflow_content_sha256, created_at
    ) values
      ('legacy-mode-plugin', 'SYSTEM', 'certificate.deploy', 'certificate.deploy', 'workflows/deploy.json', 'legacy-mode-template', 'legacy-mode-version', '${hash}', now()),
      ('legacy-kind-plugin', 'SYSTEM', 'credential.acquire', 'credential.acquire', 'workflows/credential.json', 'legacy-kind-template', 'legacy-kind-version', '${hash}', now()),
      ('normal-plugin', 'SYSTEM', 'certificate.deploy', 'certificate.deploy', 'workflows/deploy.json', 'normal-template', 'normal-version', '${hash}', now());

    insert into workflow_execution_bindings (
      id, tenant_id, plugin_version_id, capability_key, workflow_key, workflow_template_id,
      workflow_version_selection, workflow_version_id, runner, gateway_id, input_bindings,
      status, version, created_at, updated_at
    ) values
      ('legacy-mode-execution', 'tenant-1', 'legacy-mode-plugin', 'certificate.deploy', 'certificate.deploy', 'legacy-mode-template', 'FIXED', 'legacy-mode-version', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('legacy-kind-execution', 'tenant-1', 'legacy-kind-plugin', 'credential.acquire', 'credential.acquire', 'legacy-kind-template', 'FIXED', 'legacy-kind-version', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('normal-execution', 'tenant-1', 'normal-plugin', 'certificate.deploy', 'certificate.deploy', 'normal-template', 'FIXED', 'normal-version', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now());

    insert into browser_credential_sessions (
      id, tenant_id, asset_id, plugin_version_id, workflow_template_id, workflow_version_id,
      capability_key, runtime_session_id, one_time_url_hash, status, expires_at, created_by,
      created_at, updated_at
    ) values (
      'legacy-kind-session', 'tenant-1', 'asset-1', 'legacy-kind-plugin', 'legacy-kind-template', 'legacy-kind-version',
      'credential.acquire', 'legacy-kind-runtime-session', '${hash}', 'created', now(), 'user-1', now(), now()
    );

    insert into plugin_workflow_ledgers (
      id, tenant_id, execution_run_id, execution_step_id, plugin_version_id, workflow_version_id,
      capability_key, target_hash, plan_hash, input_hash, status, recovery_classification,
      completed_step_ids, compensation_step_ids, created_at, updated_at
    ) values
      ('legacy-mode-ledger', 'tenant-1', 'legacy-mode-run', 'legacy-mode-step', 'legacy-mode-plugin', 'legacy-mode-version', 'certificate.deploy', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now()),
      ('legacy-kind-ledger', 'tenant-1', 'legacy-kind-run', 'legacy-kind-step', 'legacy-kind-plugin', 'legacy-kind-version', 'credential.acquire', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now());
  `);

  await applyTarget(db);

  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id like 'legacy-%'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id like 'legacy-%'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from plugin_workflow_ledgers where id like 'legacy-%'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from browser_credential_sessions where id = 'legacy-kind-session'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id = 'normal-plugin'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id = 'normal-execution'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260817000900'`)).rows[0]?.count, '7');

  await applyTarget(db);
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260817000900'`)).rows[0]?.count, '7');
});
