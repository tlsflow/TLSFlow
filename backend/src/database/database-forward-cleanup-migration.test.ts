import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260809000500_database_forward_cleanup.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforeCleanup(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyCleanup(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

async function seed(db: PgliteDatabase): Promise<void> {
  const hash = `sha256:${'a'.repeat(64)}`;
  const ledgerHash = 'a'.repeat(64);
  await db.exec(`
    insert into app_documents (namespace, document_id, payload)
    values
      ('compatibility.catalog', 'old-catalog', '{"schemaVersion":"gcac.compatibility-catalog/v1"}'::jsonb),
      ('provider', 'old-baseline', '{"apiVersion":"gcac.runtime-baseline/v1","baselineId":"old"}'::jsonb),
      ('provider', 'old-recipe', '{"apiVersion":"gcac.execution-recipe/v1","recipeId":"old"}'::jsonb),
      ('provider', 'current-plugin-contract', '{"apiVersion":"gcac.plugin-manifest/v1","pluginId":"web.nginx"}'::jsonb);

    insert into pg_documents (namespace, document_id, payload)
    values
      ('plugins:legacy', 'old-alias', '{"apiVersion":"gcac.plugin-action-aliases/v1","kind":"PluginActionAliases"}'::jsonb),
      ('plugins:legacy', 'old-mapping', '{"apiVersion":"gcac.agent-discovery-mapping/v1","kind":"AgentCapabilityDiscoveryMapping"}'::jsonb),
      ('agents:tasks', 'legacy-task', '{"actionType":"agent.atomic_plan.execute","status":"queued"}'::jsonb),
      ('agents:tasks', 'current-task', '{"actionType":"agent.plan.execute","status":"queued"}'::jsonb),
      ('agents:taskLogs', 'legacy-log', '{"taskId":"legacy-task"}'::jsonb),
      ('agents:taskLogCursors', 'legacy-cursor', '{"taskId":"legacy-task"}'::jsonb),
      ('workflow.templates', 'legacy-workflow', '{"id":"legacy-workflow","name":"apache-8444-cert-switch","currentVersionId":"legacy-workflow-v1"}'::jsonb),
      ('workflow.template_versions', 'legacy-workflow-v1', '{"id":"legacy-workflow-v1","templateId":"legacy-workflow","version":1}'::jsonb),
      ('workflow.templates', 'synology-dsm-cert-import', '{"id":"synology-dsm-cert-import","name":"legacy-synology-cert-import","currentVersionId":"synology-workflow-v1"}'::jsonb),
      ('workflow.template_versions', 'synology-workflow-v1', '{"id":"synology-workflow-v1","templateId":"synology-dsm-cert-import","version":1}'::jsonb),
      ('workflow.templates', 'canonical-workflow', '{"id":"canonical-workflow","name":"canonical-workflow","origin":"plugin_internal"}'::jsonb),
      ('workflow.template_versions', 'canonical-workflow-v1', '{"id":"canonical-workflow-v1","templateId":"canonical-workflow","version":1}'::jsonb);

    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values
      (
        'canonical-version', 'tenant-1', 'web.nginx', '1.0.0', 'BUILTIN', 'AGENT_ATOMIC', 'BOTH',
        'OFFICIAL_SIGNED', 'OFFICIAL',
        jsonb_build_object('pluginId','web.nginx','canonicalPluginId','web.nginx','executionMode','isolated_process','version','1.0.0'),
        '${hash}', '${hash}', '{"workflows/current.json":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
        'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      ),
      (
        'legacy-version', 'tenant-1', 'web.apache', '0.1.0', 'BUILTIN', 'AGENT_ATOMIC', 'BOTH',
        'OFFICIAL_SIGNED', 'OFFICIAL', '{"pluginId":"web.apache","canonicalPluginId":"web.apache","executionMode":"isolated_process","version":"0.1.0"}'::jsonb,
        '${hash}', '${hash}', jsonb_build_object(
          'runtime-baselines/old.json', '${hash}',
          'execution-recipes/old.json', '${hash}',
          'agent-recipes/old.json', '${hash}',
          'agent-discovery-mappings/old.json', '${hash}',
          'discovery-mappings/old.json', '${hash}',
          'action-aliases/old.json', '${hash}'
        ),
        'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
      );

    insert into plugin_runner_version_bindings (
      plugin_version_id, tenant_id, canonical_plugin_id, plugin_version, execution_mode,
      package_sha256, manifest_sha256, resource_sha256, protocol_version, created_at, updated_at
    ) values
      ('canonical-version', 'tenant-1', 'web.nginx', '1.0.0', 'isolated_process', '${hash}', '${hash}', '{"workflows/current.json":"${hash}"}'::jsonb, 'gcac.plugin-runner/v1', now(), now()),
      ('legacy-version', 'tenant-1', 'web.apache', '0.1.0', 'isolated_process', '${hash}', '${hash}', jsonb_build_object(
        'runtime-baselines/old.json', '${hash}',
        'execution-recipes/old.json', '${hash}',
        'agent-recipes/old.json', '${hash}',
        'agent-discovery-mappings/old.json', '${hash}',
        'discovery-mappings/old.json', '${hash}',
        'action-aliases/old.json', '${hash}'
      ), 'gcac.plugin-runner/v1', now(), now());

    insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, input_bindings, status, version, created_at, updated_at
    ) values (
      'canonical-binding', 'tenant-1', 'canonical-version', 'MANAGED',
      '{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}}'::jsonb,
      'ACTIVE', 1, now(), now()
    ), (
      'legacy-binding', 'tenant-1', 'legacy-version', 'MANAGED',
      '{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}}'::jsonb,
      'ACTIVE', 1, now(), now()
    );

    insert into plugin_capability_assignments (
      id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id,
      plugin_binding_id, precedence, status, created_at, updated_at
    ) values (
      'canonical-assignment', 'tenant-1', 'DEVICE', 'device-1', 'certificate.deploy',
      'canonical-version', 'canonical-binding', 'DEVICE_DEFAULT', 'ACTIVE', now(), now()
    ), (
      'legacy-assignment', 'tenant-1', 'DEVICE', 'legacy-device-1', 'certificate.deploy',
      'legacy-version', 'legacy-binding', 'DEVICE_DEFAULT', 'ACTIVE', now(), now()
    );

    insert into unified_plugin_resources (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
    values
      ('legacy-version', 'runtime-baselines/old.json', '{}', '${hash}', now()),
      ('legacy-version', 'execution-recipes/old.json', '{}', '${hash}', now()),
      ('legacy-version', 'agent-recipes/old.json', '{}', '${hash}', now()),
      ('legacy-version', 'agent-discovery-mappings/old.json', '{}', '${hash}', now()),
      ('legacy-version', 'discovery-mappings/old.json', '{}', '${hash}', now()),
      ('legacy-version', 'action-aliases/old.json', '{}', '${hash}', now()),
      ('canonical-version', 'workflows/current.json', '{}', '${hash}', now());

    insert into unified_plugin_workflow_bindings (
      plugin_version_id, capability_key, workflow_resource_path, workflow_template_id,
      workflow_version_id, workflow_content_sha256, created_at
    ) values
      ('canonical-version', 'certificate.deploy', 'workflows/current.json', 'canonical-workflow', 'canonical-workflow-v1', '${hash}', now()),
      ('legacy-version', 'legacy.workflow', 'workflows/legacy.json', 'canonical-workflow', 'canonical-workflow-v1', '${hash}', now()),
      ('canonical-version', 'legacy.apache.workflow', 'workflows/apache-8444-cert-switch.json', 'legacy-workflow', 'legacy-workflow-v1', '${hash}', now()),
      ('canonical-version', 'legacy.synology.workflow', 'workflows/synology-dsm-cert-import.json', 'synology-dsm-cert-import', 'synology-workflow-v1', '${hash}', now());

    insert into workflow_execution_bindings (
      id, tenant_id, workflow_template_id, workflow_version_selection, workflow_version_id,
      runner, gateway_id, input_bindings, status, version, created_at, updated_at
    ) values
      ('legacy-execution-binding', 'tenant-1', 'legacy-workflow', 'PINNED', 'legacy-workflow-v1', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('legacy-synology-execution-binding', 'tenant-1', 'synology-dsm-cert-import', 'PINNED', 'synology-workflow-v1', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('canonical-execution-binding', 'tenant-1', 'canonical-workflow', 'PINNED', 'canonical-workflow-v1', 'CONTROL_PLANE', null, '{}'::jsonb, 'ACTIVE', 1, now(), now());

    insert into browser_credential_sessions (
      id, tenant_id, asset_id, plugin_version_id, workflow_template_id, workflow_version_id,
      capability_key, runtime_session_id, one_time_url_hash, idempotency_key_hash,
      status, credential_profile_id, expires_at, created_by, last_error_code,
      last_error_message, created_at, updated_at
    ) values
      ('legacy-apache-session', 'tenant-1', 'asset-1', 'canonical-version', 'legacy-workflow', 'legacy-workflow-v1',
       'credential.acquire', 'runtime-session-apache', '${hash}', null, 'created', null, now(), 'user-1', null, null, now(), now()),
      ('legacy-synology-session', 'tenant-1', 'asset-2', 'canonical-version', 'synology-dsm-cert-import', 'synology-workflow-v1',
       'credential.acquire', 'runtime-session-synology', '${hash}', null, 'created', null, now(), 'user-1', null, null, now(), now());

    insert into plugin_workflow_ledgers (
      id, tenant_id, execution_run_id, execution_step_id, deployment_plan_target_id,
      plugin_version_id, workflow_version_id, capability_key, target_hash, plan_hash,
      input_hash, status, recovery_classification, completed_step_ids,
      compensation_step_ids, created_at, updated_at
    ) values
      ('legacy-apache-ledger', 'tenant-1', 'legacy-run-apache', 'legacy-step-apache', null,
       'canonical-version', 'legacy-workflow-v1', 'certificate.deploy', '${ledgerHash}', '${ledgerHash}',
       '${ledgerHash}', 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now()),
      ('legacy-synology-ledger', 'tenant-1', 'legacy-run-synology', 'legacy-step-synology', null,
       'canonical-version', 'synology-workflow-v1', 'certificate.deploy', '${ledgerHash}', '${ledgerHash}',
       '${ledgerHash}', 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now());
  `);
}

async function assertCleanupSchema(db: PgliteDatabase): Promise<void> {
  const requiredColumns = [
    ['app_documents', 'namespace'],
    ['app_documents', 'document_id'],
    ['app_documents', 'payload'],
    ['pg_documents', 'namespace'],
    ['pg_documents', 'document_id'],
    ['pg_documents', 'payload'],
    ['unified_plugin_versions', 'id'],
    ['unified_plugin_versions', 'plugin_id'],
    ['unified_plugin_versions', 'status'],
    ['unified_plugin_resources', 'plugin_version_id'],
    ['unified_plugin_resources', 'resource_path'],
    ['unified_plugin_workflow_bindings', 'plugin_version_id'],
    ['unified_plugin_workflow_bindings', 'workflow_template_id'],
    ['workflow_execution_bindings', 'id'],
    ['workflow_execution_bindings', 'workflow_template_id'],
    ['workflow_execution_bindings', 'workflow_version_id'],
    ['plugin_workflow_ledgers', 'id'],
    ['plugin_workflow_ledgers', 'workflow_version_id'],
    ['browser_credential_sessions', 'id'],
    ['browser_credential_sessions', 'workflow_template_id'],
    ['browser_credential_sessions', 'workflow_version_id'],
    ['plugin_runner_version_bindings', 'plugin_version_id'],
    ['unified_plugin_bindings', 'plugin_version_id'],
    ['plugin_capability_assignments', 'plugin_version_id'],
  ] as const;
  const result = await db.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name
    from information_schema.columns
    where (table_name, column_name) in (
      select * from unnest($1::text[], $2::text[])
    )
  `, [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)]);
  const actual = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  assert.deepEqual(
    requiredColumns.filter(([table, column]) => !actual.has(`${table}.${column}`)),
    [],
    '迁移引用的真实表/列必须存在',
  );
}

async function counts(db: PgliteDatabase): Promise<Record<string, string>> {
  const result = await db.query<{ name: string; count: string }>(`
    select 'audits' as name, count(*)::text as count from database_forward_cleanup_audits
    union all select 'legacy_resources', count(*)::text from unified_plugin_resources where plugin_version_id = 'legacy-version'
    union all select 'canonical_resources', count(*)::text from unified_plugin_resources where plugin_version_id = 'canonical-version'
    union all select 'legacy_plugin_versions', count(*)::text from unified_plugin_versions where id = 'legacy-version'
    union all select 'canonical_plugin_versions', count(*)::text from unified_plugin_versions where id = 'canonical-version'
    union all select 'legacy_runner_bindings', count(*)::text from plugin_runner_version_bindings where plugin_version_id = 'legacy-version'
    union all select 'canonical_runner_bindings', count(*)::text from plugin_runner_version_bindings where plugin_version_id = 'canonical-version'
    union all select 'legacy_plugin_bindings', count(*)::text from unified_plugin_bindings where id = 'legacy-binding'
    union all select 'legacy_assignments', count(*)::text from plugin_capability_assignments where id = 'legacy-assignment'
    union all select 'legacy_plugin_workflow_bindings', count(*)::text from unified_plugin_workflow_bindings where plugin_version_id = 'legacy-version'
    union all select 'legacy_host_plugin_workflow_bindings', count(*)::text from unified_plugin_workflow_bindings where workflow_template_id in ('legacy-workflow', 'synology-dsm-cert-import')
    union all select 'canonical_plugin_workflow_bindings', count(*)::text from unified_plugin_workflow_bindings where plugin_version_id = 'canonical-version'
    union all select 'legacy_tasks', count(*)::text from pg_documents where namespace = 'agents:tasks' and document_id = 'legacy-task'
    union all select 'current_tasks', count(*)::text from pg_documents where namespace = 'agents:tasks' and document_id = 'current-task'
    union all select 'legacy_workflows', count(*)::text from pg_documents where document_id in ('legacy-workflow', 'legacy-workflow-v1', 'synology-dsm-cert-import', 'synology-workflow-v1')
    union all select 'canonical_workflows', count(*)::text from pg_documents where document_id in ('canonical-workflow', 'canonical-workflow-v1')
    union all select 'legacy_execution_bindings', count(*)::text from workflow_execution_bindings where id in ('legacy-execution-binding', 'legacy-synology-execution-binding')
    union all select 'canonical_execution_bindings', count(*)::text from workflow_execution_bindings where id = 'canonical-execution-binding'
    union all select 'legacy_host_sessions', count(*)::text from browser_credential_sessions where workflow_template_id in ('legacy-workflow', 'synology-dsm-cert-import')
    union all select 'legacy_host_ledgers', count(*)::text from plugin_workflow_ledgers where workflow_version_id in ('legacy-workflow-v1', 'synology-workflow-v1')
  `);
  return Object.fromEntries(result.rows.map((row) => [row.name, row.count]));
}

async function auditReasons(db: PgliteDatabase): Promise<Record<string, string>> {
  const result = await db.query<{ reason: string; count: string }>(`
    select reason, count(*)::text as count
    from database_forward_cleanup_audits
    group by reason
    order by reason
  `);
  return Object.fromEntries(result.rows.map((row) => [row.reason, row.count]));
}

test('前向清退彻底删除旧合同与旧 Workflow，并退休受影响 PluginVersion', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeCleanup(db);
  await assertCleanupSchema(db);
  await seed(db);
  await applyCleanup(db);

  assert.deepEqual(await counts(db), {
    audits: '31',
    legacy_resources: '0',
    canonical_resources: '1',
    legacy_plugin_versions: '1',
    canonical_plugin_versions: '1',
    legacy_runner_bindings: '0',
    canonical_runner_bindings: '1',
    legacy_plugin_bindings: '1',
    legacy_assignments: '1',
    legacy_plugin_workflow_bindings: '0',
    legacy_host_plugin_workflow_bindings: '0',
    canonical_plugin_workflow_bindings: '1',
    legacy_tasks: '0',
    current_tasks: '1',
    legacy_workflows: '0',
    canonical_workflows: '2',
    legacy_execution_bindings: '0',
    canonical_execution_bindings: '1',
    legacy_host_sessions: '0',
    legacy_host_ledgers: '0',
  });
  assert.deepEqual(await auditReasons(db), {
    DISABLED_LEGACY_PLUGIN_ASSIGNMENT: '1',
    DISABLED_LEGACY_PLUGIN_BINDING: '1',
    ORPHANED_AGENT_LEGACY_TASK_CURSOR: '1',
    ORPHANED_AGENT_LEGACY_TASK_LOG: '1',
    REMOVED_AGENT_LEGACY_ACTION: '1',
    REMOVED_COMPATIBILITY_CONTRACT: '5',
    REMOVED_LEGACY_HOST_PLUGIN_WORKFLOW_BINDING: '2',
    REMOVED_LEGACY_HOST_WORKFLOW: '2',
    REMOVED_LEGACY_HOST_WORKFLOW_BINDING: '2',
    REMOVED_LEGACY_HOST_WORKFLOW_LEDGER: '2',
    REMOVED_LEGACY_HOST_WORKFLOW_SESSION: '2',
    REMOVED_LEGACY_HOST_WORKFLOW_VERSION: '2',
    REMOVED_LEGACY_PLUGIN_RESOURCE: '6',
    REMOVED_LEGACY_PLUGIN_RUNNER_BINDING: '1',
    REMOVED_LEGACY_PLUGIN_WORKFLOW_BINDING: '1',
    RETIRED_LEGACY_PLUGIN_VERSION: '1',
  });
  assert.equal((await db.query(`
    select count(*)::text as count
    from app_documents
    where payload->>'apiVersion' in (
      'gcac.compatibility/v1', 'gcac.compatibility/v2', 'gcac.runtime-baseline/v1',
      'gcac.execution-recipe/v1', 'gcac.certification-record/v1', 'gcac.adapter/v1',
      'gcac.plugin-action-aliases/v1', 'gcac.agent-discovery-mapping/v1'
    ) or payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from pg_documents
    where payload->>'apiVersion' in (
      'gcac.compatibility/v1', 'gcac.compatibility/v2', 'gcac.runtime-baseline/v1',
      'gcac.execution-recipe/v1', 'gcac.certification-record/v1', 'gcac.adapter/v1',
      'gcac.plugin-action-aliases/v1', 'gcac.agent-discovery-mapping/v1'
    ) or payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from unified_plugin_resources
    where resource_path like 'runtime-baselines/%'
       or resource_path like 'execution-recipes/%'
       or resource_path like 'agent-recipes/%'
       or resource_path like 'agent-discovery-mappings/%'
       or resource_path like 'discovery-mappings/%'
       or resource_path like 'action-aliases/%'
  `)).rows[0]?.count, '0');
  assert.deepEqual((await db.query(`
    select status, validation_report->'pluginRunnerCleanup'->>'status' as cleanup_status,
           validation_report->'pluginRunnerCleanup'->>'reason' as cleanup_reason
    from unified_plugin_versions
    where id = 'legacy-version'
  `)).rows[0], {
    status: 'RETIRED',
    cleanup_status: 'RETIRED',
    cleanup_reason: 'REMOVED_LEGACY_PLUGIN_RESOURCE',
  });
  assert.equal((await db.query(`select count(*)::text as count from plugin_runner_version_bindings where plugin_version_id = 'legacy-version'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id = 'legacy-version'`)).rows[0]?.count, '0');
  assert.deepEqual((await db.query<{ status: string; version: number }>(`select status, version from unified_plugin_bindings where id = 'legacy-binding'`)).rows[0], { status: 'DISABLED', version: 2 });
  assert.deepEqual((await db.query(`select status from plugin_capability_assignments where id = 'legacy-assignment'`)).rows[0], { status: 'DISABLED' });
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where workflow_template_id in ('legacy-workflow', 'synology-dsm-cert-import')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id in ('legacy-execution-binding', 'legacy-synology-execution-binding')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from browser_credential_sessions where id in ('legacy-apache-session', 'legacy-synology-session')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from plugin_workflow_ledgers where id in ('legacy-apache-ledger', 'legacy-synology-ledger')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where document_id in ('legacy-workflow', 'legacy-workflow-v1', 'synology-dsm-cert-import', 'synology-workflow-v1')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from app_documents where document_id = 'current-plugin-contract'`)).rows[0]?.count, '1');
  assert.deepEqual((await db.query(`select status from unified_plugin_versions where id = 'canonical-version'`)).rows[0], { status: 'ENABLED' });
  assert.equal((await db.query(`select count(*)::text as count from plugin_runner_version_bindings where plugin_version_id = 'canonical-version'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id = 'canonical-version'`)).rows[0]?.count, '1');
  assert.deepEqual((await db.query(`select status from unified_plugin_bindings where id = 'canonical-binding'`)).rows[0], { status: 'ACTIVE' });
  assert.deepEqual((await db.query(`select status from plugin_capability_assignments where id = 'canonical-assignment'`)).rows[0], { status: 'ACTIVE' });
  assert.equal((await db.query(`select count(*)::text as count from information_schema.tables where table_name in ('unified_plugin_versions','unified_plugin_resources','unified_plugin_workflow_bindings','workflow_execution_bindings','plugin_workflow_ledgers','browser_credential_sessions')`)).rows[0]?.count, '6');
});

test('前向清退重复执行稳定且事务回滚不留半成品', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeCleanup(db);
  await seed(db);
  const sql = await readFile(join(migrationDirectory, migrationName), 'utf8');

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec(sql);
      throw new Error('模拟迁移后事务失败');
    }),
    /模拟迁移后事务失败/,
  );
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where namespace = 'agents:tasks' and document_id = 'legacy-task'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from information_schema.tables where table_name = 'database_forward_cleanup_audits'`)).rows[0]?.count, '0');

  await applyCleanup(db);
  const first = await counts(db);
  await applyCleanup(db);
  assert.deepEqual(await counts(db), first);
});
