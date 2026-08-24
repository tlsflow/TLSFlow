import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260809000800_remove_legacy_provider_runtime_records.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforePurge(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyPurge(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

async function seedLegacyRuntime(db: PgliteDatabase): Promise<void> {
  await db.exec(`
    insert into pg_ca_providers (
      id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
      endpoint, credential_secret_ref, capabilities, status, payload, created_at, updated_at
    ) values
      ('provider-openssl-retired', 'tenant-ca', 'OpenSSL Legacy', 'plugin', 'external', 'linux', 'single',
       null, null, '{}'::jsonb, 'retired', '{"gcacCleanup":{"status":"RETIRED"}}'::jsonb, now(), now()),
      ('provider-generic', 'tenant-ca', 'Generic CA', 'plugin', 'external', 'external', 'single',
       'https://ca.invalid', 'secret://generic', '{"signCsr":true}'::jsonb, 'active', '{}'::jsonb, now(), now());

    insert into pg_cloud_account_assets (
      id, tenant_id, provider_key, display_name, credential_ref, identity_key
    ) values ('cloud-account-generic', 'tenant-cloud', 'cloud.aliyun', 'Generic Cloud Account', 'credential://cloud', 'cloud-account-generic');

    insert into pg_provider_operation_ledger (
      id, tenant_id, cloud_account_asset_id, provider_key, framework_type, operation_key,
      target_ref, checkpoint, created_at
    ) values (
      'legacy-provider-ledger', 'tenant-cloud', 'cloud-account-generic', 'openssl', 'certificate.deploy',
      'legacy-operation', '{}'::jsonb, '{}'::jsonb, now()
    );

    insert into pg_certificate_renewal_jobs (
      id, tenant_id, certificate_version_id, renewal_window_key, status,
      certificate_request_id, scheduled_at, created_at, updated_at
    ) values (
      'legacy-acme-renewal', 'tenant-ca', null, 'legacy-window', 'pending',
      null, now(), now(), now()
    );
  `);
}

async function migrationSql(): Promise<string> {
  return readFile(join(migrationDirectory, migrationName), 'utf8');
}

test('彻底删除旧 Provider 运行时记录并保留通用 Cloud Account', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforePurge(db);
  await seedLegacyRuntime(db);
  await applyPurge(db);

  assert.equal((await db.query(`
    select count(*)::text as count
    from pg_ca_providers
    where lower(concat_ws('|', id, name, type, payload::text)) like any (array['%acme%', '%adcs%', '%openssl%'])
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_providers where id = 'provider-generic'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_cloud_account_assets where id = 'cloud-account-generic'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`
    select count(*)::text as count
    from information_schema.tables
    where table_name in (
      'pg_acme_accounts', 'pg_acme_orders', 'pg_acme_authorizations', 'pg_acme_challenges',
      'pg_acme_renewal_policies', 'pg_acme_http01_presentations', 'pg_provider_operation_ledger',
      'provider_registry', 'pg_execution_runs', 'pg_execution_steps'
    )
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from information_schema.columns
    where table_name = 'pg_certificate_versions' and column_name = 'activation_state'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from information_schema.columns
    where table_name = 'pg_certificate_renewal_jobs'
      and column_name in (
        'policy_id', 'source_certificate_version_id', 'acme_order_id', 'deployment_plan_id',
        'execution_run_id', 'promotion_status', 'attempt_count', 'next_attempt_at',
        'lease_owner', 'lease_expires_at', 'failure_code', 'failure_message', 'policy_snapshot'
      )
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`
    select count(*)::text as count
    from information_schema.columns
    where table_name = 'pg_certificate_renewal_jobs'
      and column_name = 'certificate_version_id'
      and is_nullable = 'YES'
  `)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_certificate_renewal_jobs where id = 'legacy-acme-renewal'`)).rows[0]?.count, '0');
  assert.deepEqual((await db.query<{ reason: string; count: string }>(`
    select reason, count(*)::text as count
    from database_forward_cleanup_audits
    where migration_version = '20260809000800'
    group by reason
    order by reason
  `)).rows, [
    { reason: 'REMOVED_LEGACY_ACME_RENEWAL_JOB', count: '1' },
    { reason: 'REMOVED_LEGACY_CA_PROVIDER_RECORD', count: '1' },
    { reason: 'REMOVED_LEGACY_PROVIDER_OPERATION_LEDGER', count: '1' },
  ]);
});

test('旧 Provider 清理迁移可重复执行，失败回滚不留下半成品', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforePurge(db);
  await seedLegacyRuntime(db);
  const sql = await migrationSql();

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec(sql);
      throw new Error('模拟旧 Provider 清理事务失败');
    }),
    /模拟旧 Provider 清理事务失败/,
  );
  assert.equal((await db.query(`select count(*)::text as count from pg_ca_providers where id = 'provider-openssl-retired'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from information_schema.tables where table_name = 'pg_provider_operation_ledger'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`
    select count(*)::text as count
    from information_schema.columns
    where table_name = 'pg_certificate_versions' and column_name = 'activation_state'
  `)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_certificate_renewal_jobs where id = 'legacy-acme-renewal'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260809000800'`)).rows[0]?.count, '0');

  await applyPurge(db);
  const first = await db.query(`
    select
      (select count(*) from pg_ca_providers where id = 'provider-openssl-retired')::text as old_provider,
      (select count(*) from pg_certificate_renewal_jobs)::text as renewal_jobs,
      (select count(*) from database_forward_cleanup_audits where migration_version = '20260809000800')::text as audits
  `);
  await applyPurge(db);
  const second = await db.query(`
    select
      (select count(*) from pg_ca_providers where id = 'provider-openssl-retired')::text as old_provider,
      (select count(*) from pg_certificate_renewal_jobs)::text as renewal_jobs,
      (select count(*) from database_forward_cleanup_audits where migration_version = '20260809000800')::text as audits
  `);
  assert.deepEqual(second.rows, first.rows);
});
