import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

test('原生 ACME 恢复后首次签发任务允许在证书版本生成前落库', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');

    const column = await db.query<{ is_nullable: string }>(`
      select is_nullable
        from information_schema.columns
       where table_name = 'pg_certificate_renewal_jobs'
         and column_name = 'certificate_version_id'
    `);
    const index = await db.query<{ indexdef: string }>(`
      select indexdef
        from pg_indexes
       where tablename = 'pg_certificate_renewal_jobs'
         and indexname = 'uq_pg_certificate_renewal_jobs_acme_initial'
    `);

    assert.equal(column.rows[0]?.is_nullable, 'YES');
    assert.match(index.rows[0]?.indexdef ?? '', /renewal_window_key/);
    assert.match(index.rows[0]?.indexdef ?? '', /source_certificate_version_id IS NULL/);

    const timestamp = '2026-08-13T10:00:00.000Z';
    await db.query(
      `insert into pg_ca_providers (
         id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
         capabilities, status, payload, created_at, updated_at
       ) values (
         'caprov-acme-initial', 'tenant-acme-initial', 'ACME Provider', 'acme', 'external', 'external', 'single',
         '{}'::jsonb, 'active', '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_acme_accounts (
         id, tenant_id, provider_id, directory_url_hash, account_key_secret_ref, contact,
         status, payload, created_at, updated_at
       ) values (
         'acmeacct-initial', 'tenant-acme-initial', 'caprov-acme-initial', $1, 'sec_acme_key', '[]'::jsonb,
         'active', '{}'::jsonb, $2, $2
       )`,
      ['a'.repeat(64), timestamp],
    );
    await db.query(
      `insert into pg_acme_renewal_policies (
         id, tenant_id, provider_id, account_id, enabled, renewal_window_days, challenge_type,
         rotate_key_on_renewal, deployment_mode, max_attempts, backoff_seconds, status, version,
         created_by, payload, created_at, updated_at
       ) values (
         'acmepolicy-initial', 'tenant-acme-initial', 'caprov-acme-initial', 'acmeacct-initial', true, 7, 'dns-01',
         true, 'manual', 5, 300, 'active', 1, 'user-admin', '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_certificate_renewal_jobs (
         id, tenant_id, certificate_version_id, renewal_window_key, status, certificate_request_id,
         policy_id, source_certificate_version_id, promotion_status, attempt_count, policy_snapshot,
         payload, scheduled_at, created_at, updated_at
       ) values (
         'acmerenew-initial', 'tenant-acme-initial', null, 'initial:certasset-acme', 'scheduled', null,
         'acmepolicy-initial', null, 'not_required', 0, '{}'::jsonb, '{}'::jsonb, $1, $1, $1
       )`,
      [timestamp],
    );
    const initialJob = await db.query<{ certificate_version_id: string | null }>(
      "select certificate_version_id from pg_certificate_renewal_jobs where id = 'acmerenew-initial'",
    );
    assert.equal(initialJob.rows[0]?.certificate_version_id, null);
  } finally {
    await db.close();
  }
});
