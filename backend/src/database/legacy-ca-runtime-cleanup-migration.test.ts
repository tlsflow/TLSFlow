import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260809000700_retire_legacy_ca_runtime_data.sql';
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
  await db.exec(`
    insert into pg_ca_providers (
      id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
      endpoint, credential_secret_ref, capabilities, status, payload, created_at, updated_at
    ) values
      ('provider-acme', 'tenant-ca', 'ACME Legacy', 'plugin', 'external', 'external', 'single',
       'https://acme.invalid', 'secret://acme', '{"signCsr":true}'::jsonb, 'active', '{}', now(), now()),
      ('provider-adcs', 'tenant-ca', 'Microsoft ADCS Legacy', 'plugin', 'external', 'windows', 'single',
       'https://adcs.invalid', 'secret://adcs', '{"queryIssuance":true}'::jsonb, 'active', '{}', now(), now()),
      ('provider-openssl', 'tenant-ca', 'OpenSSL Legacy', 'plugin', 'external', 'linux', 'single',
       'https://openssl.invalid', 'secret://openssl', '{"signCsr":true}'::jsonb, 'active', '{}', now(), now()),
      ('provider-generic', 'tenant-ca', 'Generic CA', 'plugin', 'external', 'external', 'single',
       'https://ca.invalid', 'secret://generic', '{"signCsr":true}'::jsonb, 'active', '{}', now(), now());

    insert into pg_cloud_account_assets (
      id, tenant_id, provider_key, display_name, credential_ref, identity_key
    ) values ('cloud-account-generic', 'tenant-cloud', 'cloud.aliyun', 'Generic Cloud Account', 'credential://cloud', 'cloud-account-generic');

    insert into pg_certificate_authorities (
      id, tenant_id, name, role, parent_ca_id, topology_mode, provider_id, security_domain,
      status, payload, created_at, updated_at
    ) values
      ('ca-acme', 'tenant-ca', 'ACME CA', 'root', null, 'external_managed', 'provider-acme', 'production', 'active', '{}', now(), now()),
      ('ca-generic', 'tenant-ca', 'Generic CA', 'root', null, 'external_managed', 'provider-generic', 'production', 'active', '{}', now(), now());

    insert into pg_ca_nodes (
      id, tenant_id, provider_id, name, platform, role, identity_fingerprint,
      key_backend, exportability, capabilities, health_status, payload, created_at, updated_at
    ) values (
      'node-acme', 'tenant-ca', 'provider-acme', 'ACME node', 'linux', 'worker', 'fingerprint-acme',
      'secret', 'non_exportable', '{}', 'online', '{}', now(), now()
    );

    insert into pg_ca_node_tasks (
      id, tenant_id, provider_id, node_id, task_type, idempotency_key, payload, status, created_at, updated_at
    ) values ('ca-task-acme', 'tenant-ca', 'provider-acme', 'node-acme', 'sync_records', 'ca-task-acme', '{}', 'queued', now(), now());

    insert into pg_ca_node_request_nonces (node_id, nonce, created_at, expires_at)
    values ('node-acme', 'nonce-acme', now(), now() + interval '1 hour');

    insert into pg_ca_capability_records (
      id, tenant_id, owner_type, owner_id, capability_key, state, source, payload, created_at, updated_at
    ) values ('cap-acme', 'tenant-ca', 'provider', 'provider-acme', 'signCsr', 'declared', 'seed', '{}', now(), now());

    insert into pg_ca_external_observations (
      id, tenant_id, provider_id, ca_id, object_type, external_object_id, normalized_status,
      raw_summary, observed_at, first_observed_at, created_at, updated_at
    ) values ('observation-acme', 'tenant-ca', 'provider-acme', 'ca-acme', 'issuance', 'external-acme',
      'issued', '{}', now(), now(), now(), now());

    insert into pg_ca_sync_runs (
      id, tenant_id, provider_id, ca_id, object_type, mode, status, requested_by, created_at, updated_at
    ) values ('sync-acme', 'tenant-ca', 'provider-acme', 'ca-acme', 'issuance', 'full', 'queued', 'seed', now(), now());

    insert into pg_ca_template_mappings (
      id, tenant_id, provider_id, ca_id, profile_version_id, external_template_id,
      status, validation_summary, version, created_by, updated_by, created_at, updated_at
    ) values ('mapping-acme', 'tenant-ca', 'provider-acme', 'ca-acme', 'profile-version', 'template-acme',
      'active', '{}', 1, 'seed', 'seed', now(), now());

    insert into task_runs (
      id, tenant_id, task_type, definition_version, category, status, trigger_source, payload, resource_summary
    ) values
      ('task-acme', 'tenant-ca', 'CA_RECORD_SYNC', 1, 'EXECUTION', 'QUEUED', 'ca.scheduler',
       '{"providerId":"provider-acme"}', '{"providerId":"provider-acme"}'),
      ('task-generic', 'tenant-ca', 'CA_RECORD_SYNC', 1, 'EXECUTION', 'QUEUED', 'ca.scheduler',
       '{"providerId":"provider-generic"}', '{"providerId":"provider-generic"}');

    insert into pg_documents (namespace, document_id, payload)
    values
      ('adcs:tasks', 'document-adcs-task', '{"providerId":"provider-adcs"}'),
      ('agents:tasks', 'document-generic-task', '{"providerId":"provider-generic"}');

    insert into pg_certificate_renewal_jobs (
      id, tenant_id, certificate_version_id, renewal_window_key, status, certificate_request_id,
      policy_id, acme_order_id, execution_run_id, promotion_status, attempt_count, policy_snapshot,
      scheduled_at, created_at, updated_at
    ) values (
      'renewal-acme', 'tenant-ca', null, 'legacy-window', 'pending', null,
      null, null, 'legacy-execution', 'pending', 1, '{}', now(), now(), now()
    );
  `);
}

test('清理旧 CA 运行数据但保留通用 Provider 和 Cloud Account 基础对象', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeCleanup(db);
  await seed(db);
  await applyCleanup(db);

  assert.deepEqual((await db.query(`
    select id, status, endpoint, credential_secret_ref, capabilities
    from pg_ca_providers
    order by id
  `)).rows, [
    { id: 'provider-acme', status: 'retired', endpoint: null, credential_secret_ref: null, capabilities: {} },
    { id: 'provider-adcs', status: 'retired', endpoint: null, credential_secret_ref: null, capabilities: {} },
    { id: 'provider-generic', status: 'active', endpoint: 'https://ca.invalid', credential_secret_ref: 'secret://generic', capabilities: { signCsr: true } },
    { id: 'provider-openssl', status: 'retired', endpoint: null, credential_secret_ref: null, capabilities: {} },
  ]);
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_node_tasks`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_external_observations`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_sync_runs`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from task_runs where id = 'task-acme'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from task_runs where id = 'task-generic'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where document_id = 'document-adcs-task'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where document_id = 'document-generic-task'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_cloud_account_assets where id = 'cloud-account-generic'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from information_schema.tables where table_name in ('pg_acme_accounts', 'pg_acme_orders', 'pg_acme_authorizations', 'pg_acme_challenges', 'pg_acme_renewal_policies', 'pg_acme_http01_presentations', 'pg_execution_runs', 'pg_execution_steps')`)).rows[0]?.count, '0');

  const renewalColumns = await db.query<{ column_name: string }>(`
    select column_name from information_schema.columns
    where table_name = 'pg_certificate_renewal_jobs'
      and column_name in ('policy_id', 'acme_order_id', 'execution_run_id', 'promotion_status', 'policy_snapshot')
  `);
  assert.deepEqual(renewalColumns.rows, []);
});

test('迁移是递增新增版本，且 Git 中没有改写历史迁移', async () => {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  assert.equal(files.filter((file) => file === migrationName).length, 1);
  const migrationIndex = files.indexOf(migrationName);
  assert.equal(migrationIndex >= 0, true);
  assert.equal(files.slice(0, migrationIndex).every((file) => file < migrationName), true);

  const changedHistoricalFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', '--', 'backend/src/database/migrations'],
    { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => file !== `backend/src/database/migrations/${migrationName}`);
  assert.deepEqual(changedHistoricalFiles, []);
});

test('迁移缺少可选旧表时仍可执行', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table pg_ca_providers (
      id text primary key, tenant_id text not null, name text not null, type text not null,
      deployment_mode text not null, runtime_platform text not null, availability_mode text not null,
      endpoint text, credential_secret_ref text, capabilities jsonb not null default '{}'::jsonb,
      status text not null, payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null, updated_at timestamptz not null
    );
  `);
  await applyCleanup(db);
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_providers`)).rows[0]?.count, '0');
});
