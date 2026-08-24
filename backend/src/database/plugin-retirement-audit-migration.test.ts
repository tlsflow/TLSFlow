import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260811000100_plugin_retirement_audit_and_input_binding_repair.sql';
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

async function seed(db: PgliteDatabase): Promise<void> {
  const hash = `sha256:${'a'.repeat(64)}`;
  const inputBindings = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: { certificatePath: '/etc/gcac/cert.pem' },
    connections: {},
    credentials: {},
    artifacts: {},
    legacyField: 'must-be-removed',
  });
  const resourcePaths = [
    'agent-recipes/builtin.linux.nginx.pem.json',
    'agent-recipes/builtin.windows.iis.pfx.json',
    'agent-recipes/builtin.windows.nginx.pem.json',
    'agent-recipes/builtin.windows.apache.pem.json',
    'agent-recipes/builtin.windows.tomcat.pkcs12.json',
    'agent-recipes/builtin.windows.custom.certificate.json',
    'agent-recipes/builtin.rabbitmq.pem.json',
    'agent-recipes/builtin.java.pkcs12.json',
    'agent-recipes/builtin.windows-service.certificate-file.json',
    'discovery-mappings/iis.json',
    'discovery-mappings/nginx.json',
    'discovery-mappings/apache.json',
    'discovery-mappings/tomcat.json',
    'discovery-mappings/windows-nginx.json',
    'discovery-mappings/windows-apache.json',
    'discovery-mappings/windows-tomcat.json',
    'workflows/apache-8444-cert-switch.json',
    'workflows/synology-dsm-cert-import.json',
  ];
  const resourceArrayLiteral = `{${resourcePaths.join(',')}}`;

  await db.exec(`
    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values (
      'retirement-test-version', 'tenant-1', 'web.apache', '1.0.0', 'BUILTIN', 'AGENT_PLAN', 'BOTH',
      'OFFICIAL_SIGNED', 'OFFICIAL',
      jsonb_build_object('pluginId', 'web.apache', 'canonicalPluginId', 'web.apache', 'executionMode', 'isolated_process', 'version', '1.0.0'),
      '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
    );

    insert into plugin_runner_version_bindings (
      plugin_version_id, tenant_id, canonical_plugin_id, plugin_version, execution_mode,
      package_sha256, manifest_sha256, resource_sha256, protocol_version, created_at, updated_at
    ) values (
      'retirement-test-version', 'tenant-1', 'web.apache', '1.0.0', 'isolated_process',
      '${hash}', '${hash}', '{}'::jsonb, 'gcac.plugin-runner/v1', now(), now()
    );

    insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, input_bindings, status, version, created_at, updated_at
    ) values (
      'retirement-test-binding', 'tenant-1', 'retirement-test-version', 'MANAGED', '${inputBindings}'::jsonb,
      'ACTIVE', 1, now(), now()
    );

    insert into plugin_capability_assignments (
      id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id,
      plugin_binding_id, precedence, status, created_at, updated_at
    ) values (
      'retirement-test-assignment', 'tenant-1', 'DEVICE', 'device-retirement-test', 'certificate.deploy',
      'retirement-test-version', 'retirement-test-binding', 'DEVICE_DEFAULT', 'ACTIVE', now(), now()
    );

    insert into unified_plugin_resources (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
    select 'retirement-test-version', path, '{}', '${hash}', now()
    from unnest('${resourceArrayLiteral}'::text[]) as paths(path);

    insert into pg_documents (namespace, document_id, payload)
    values
      ('workflow.templates', 'retirement-apache-template', '{"name":"apache-8444-cert-switch"}'::jsonb),
      ('workflow.templates', 'retirement-synology-template', '{"name":"synology-dsm-cert-import"}'::jsonb),
      ('workflow.template_versions', 'retirement-apache-version', '{"templateId":"retirement-apache-template"}'::jsonb),
      ('workflow.template_versions', 'retirement-synology-version', '{"templateId":"retirement-synology-template"}'::jsonb);

    insert into unified_plugin_workflow_bindings (
      plugin_version_id, capability_key, workflow_resource_path, workflow_template_id,
      workflow_version_id, workflow_content_sha256, created_at
    ) values
      ('retirement-test-version', 'legacy.apache', 'workflows/apache-8444-cert-switch.json', 'retirement-apache-template', 'retirement-apache-version', '${hash}', now()),
      ('retirement-test-version', 'legacy.synology', 'workflows/synology-dsm-cert-import.json', 'retirement-synology-template', 'retirement-synology-version', '${hash}', now());

    insert into workflow_execution_bindings (
      id, tenant_id, workflow_template_id, workflow_version_selection, workflow_version_id,
      runner, gateway_id, input_bindings, status, version, created_at, updated_at
    ) values
      ('retirement-apache-execution', 'tenant-1', 'retirement-apache-template', 'PINNED', 'retirement-apache-version',
       'CONTROL_PLANE', null, '${inputBindings}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('retirement-synology-execution', 'tenant-1', 'retirement-synology-template', 'PINNED', 'retirement-synology-version',
       'CONTROL_PLANE', null, '${inputBindings}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('retirement-survivor-execution', 'tenant-1', 'canonical-workflow', 'PINNED', 'canonical-workflow-v1',
       'CONTROL_PLANE', null, '${inputBindings}'::jsonb, 'ACTIVE', 1, now(), now());

    insert into browser_credential_sessions (
      id, tenant_id, asset_id, plugin_version_id, workflow_template_id, workflow_version_id,
      capability_key, runtime_session_id, one_time_url_hash, idempotency_key_hash,
      status, credential_profile_id, expires_at, created_by, last_error_code,
      last_error_message, created_at, updated_at
    ) values
      ('retirement-apache-session', 'tenant-1', 'asset-1', 'retirement-test-version', 'retirement-apache-template', 'retirement-apache-version',
       'credential.acquire', 'session-apache', '${hash}', null, 'created', null, now(), 'user-1', null, null, now(), now()),
      ('retirement-synology-session', 'tenant-1', 'asset-2', 'retirement-test-version', 'retirement-synology-template', 'retirement-synology-version',
       'credential.acquire', 'session-synology', '${hash}', null, 'created', null, now(), 'user-1', null, null, now(), now());

    insert into plugin_workflow_ledgers (
      id, tenant_id, execution_run_id, execution_step_id, deployment_plan_target_id,
      plugin_version_id, workflow_version_id, capability_key, target_hash, plan_hash,
      input_hash, status, recovery_classification, completed_step_ids,
      compensation_step_ids, created_at, updated_at
    ) values
      ('retirement-apache-ledger', 'tenant-1', 'run-apache', 'step-apache', null, 'retirement-test-version', 'retirement-apache-version', 'certificate.deploy', '${'a'.repeat(64)}', '${'a'.repeat(64)}', '${'a'.repeat(64)}', 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now()),
      ('retirement-synology-ledger', 'tenant-1', 'run-synology', 'step-synology', null, 'retirement-test-version', 'retirement-synology-version', 'certificate.deploy', '${'a'.repeat(64)}', '${'a'.repeat(64)}', '${'a'.repeat(64)}', 'ACTIVE', 'RESUMABLE', '[]'::jsonb, '[]'::jsonb, now(), now());
  `);
}

test('逐项清退审计、输入字段修复和现有记录更新可重放', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  await seed(db);
  await applyTarget(db);

  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where audit_id is null`)).rows[0]?.count, '0');
  assert.deepEqual((await db.query<{ count: string }>(`
    select count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260811000100'
  `)).rows[0], { count: '20' });
  assert.deepEqual((await db.query<{ kind: string; count: string }>(`
    select metadata->>'kind' as kind, count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260811000100'
      and metadata ? 'kind'
    group by metadata->>'kind'
    order by kind
  `)).rows, [
    { kind: 'BARE_WORKFLOW', count: '2' },
    { kind: 'DISCOVERY_MAPPING', count: '7' },
    { kind: 'RECIPE', count: '9' },
  ]);
  assert.deepEqual((await db.query<{ audit_id: string }>(`
    select audit_id
    from database_forward_cleanup_audits
    where migration_version = '20260811000100'
      and metadata->>'kind' in ('RECIPE', 'DISCOVERY_MAPPING', 'BARE_WORKFLOW')
    order by audit_id
  `)).rows.map((row) => row.audit_id), [
    ...Array.from({ length: 9 }, (_, index) => `P1-F-DB-20260811-REC-${String(index + 1).padStart(3, '0')}`),
    ...Array.from({ length: 7 }, (_, index) => `P1-F-DB-20260811-MAP-${String(index + 1).padStart(3, '0')}`),
    ...Array.from({ length: 2 }, (_, index) => `P1-F-DB-20260811-WFL-${String(index + 1).padStart(3, '0')}`),
  ].sort());

  assert.equal((await db.query(`
    select count(*)::text as count
    from unified_plugin_resources
    where resource_path like 'agent-recipes/%'
       or resource_path in (
         'discovery-mappings/iis.json', 'discovery-mappings/nginx.json', 'discovery-mappings/apache.json',
         'discovery-mappings/tomcat.json', 'discovery-mappings/windows-nginx.json',
         'discovery-mappings/windows-apache.json', 'discovery-mappings/windows-tomcat.json',
         'workflows/apache-8444-cert-switch.json', 'workflows/synology-dsm-cert-import.json'
       )
  `)).rows[0]?.count, '0');
  assert.deepEqual((await db.query(`select status from unified_plugin_versions where id = 'retirement-test-version'`)).rows[0], { status: 'RETIRED' });
  assert.deepEqual((await db.query(`select status, version, input_bindings from unified_plugin_bindings where id = 'retirement-test-binding'`)).rows[0], {
    status: 'DISABLED',
    version: 3,
    input_bindings: {
      apiVersion: 'gcac.input-bindings/v1',
      variables: { certificatePath: '/etc/gcac/cert.pem' },
      connections: {},
      credentials: {},
      artifacts: {},
    },
  });
  assert.deepEqual((await db.query(`select status from plugin_capability_assignments where id = 'retirement-test-assignment'`)).rows[0], { status: 'DISABLED' });
  assert.equal((await db.query(`select count(*)::text as count from plugin_runner_version_bindings where plugin_version_id = 'retirement-test-version'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id = 'retirement-test-version'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id in ('retirement-apache-execution', 'retirement-synology-execution')`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from browser_credential_sessions where id like 'retirement-%'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from plugin_workflow_ledgers where id like 'retirement-%'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where document_id like 'retirement-%'`)).rows[0]?.count, '0');

  assert.deepEqual((await db.query(`
    select input_bindings, version
    from workflow_execution_bindings
    where id = 'retirement-survivor-execution'
  `)).rows[0], {
    input_bindings: {
      apiVersion: 'gcac.input-bindings/v1',
      variables: { certificatePath: '/etc/gcac/cert.pem' },
      connections: {},
      credentials: {},
      artifacts: {},
    },
    version: 2,
  });

  await applyTarget(db);
  assert.deepEqual((await db.query<{ count: string }>(`
    select count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260811000100'
  `)).rows[0], { count: '20' });
});
