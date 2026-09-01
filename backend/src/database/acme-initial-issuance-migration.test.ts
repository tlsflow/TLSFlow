import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('历史 ACME 申请迁移清空错误应用列但保留 payload 证据', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');
    const timestamp = '2026-08-28T10:00:00.000Z';
    await db.query(
      `insert into pg_ca_providers (
         id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
         capabilities, status, payload, created_at, updated_at
       ) values (
         'caprov-legacy-acme', 'tenant-legacy-acme', 'Legacy ACME', 'acme', 'external', 'external', 'single',
         '{}'::jsonb, 'active', '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_certificate_authorities (
         id, tenant_id, name, role, topology_mode, provider_id, security_domain, status, payload, created_at, updated_at
       ) values (
         'ca-legacy-acme', 'tenant-legacy-acme', 'Legacy CA', 'root', 'single', 'caprov-legacy-acme',
         'legacy', 'active', '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_key_references (
         id, tenant_id, owner_type, owner_id, custody_mode, backend_type,
         public_key_fingerprint_sha256, exportability, protection_level, status,
         payload, created_at, updated_at
       ) values (
         'key-legacy', 'tenant-legacy-acme', 'certificate_request', 'request-legacy-acme',
         'managed_secret', 'test', repeat('c', 64), 'non_exportable', 'software', 'active',
         '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_certificate_profiles (
         id, tenant_id, name, security_domain, status, current_version, payload, created_at, updated_at
       ) values (
         'profile-legacy', 'tenant-legacy-acme', 'Legacy Profile', 'legacy', 'active', 1, '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    await db.query(
      `insert into pg_certificate_profile_versions (
         id, profile_id, version_no, rules, created_by, payload, created_at, updated_at
       ) values (
         'profile-version-legacy', 'profile-legacy', 1, '{}'::jsonb, 'migration-test', '{}'::jsonb, $1, $1
       )`,
      [timestamp],
    );
    const payload = { applicationAssetId: 'certasset-legacy', certificateAssetId: 'certasset-legacy', source: 'historical-import' };
    await db.query(
      `insert into pg_certificate_requests (
         id, tenant_id, application_asset_id, ca_id, profile_version_id, key_reference_id,
         csr_pem, csr_sha256, public_key_fingerprint_sha256, idempotency_key, status,
         requested_by, payload, created_at, updated_at
       ) values (
         'request-legacy-acme', 'tenant-legacy-acme', 'certasset-legacy', 'ca-legacy-acme', 'profile-version-legacy',
         'key-legacy', '-----BEGIN CERTIFICATE REQUEST-----', repeat('a', 64), repeat('b', 64),
         'acme-initial-request:certasset-legacy', 'pending', 'migration-test', $1::jsonb, $2, $2
       )`,
      [JSON.stringify(payload), timestamp],
    );

    // 迁移文件已随 baseline 执行过；再次执行正文验证其幂等性和数据修复语义。
    const migrationSql = await readFile('src/database/migrations/20260828030000_legacy_acme_request_application_nullable.sql', 'utf8');
    await db.exec(migrationSql);
    const row = await db.query<{ application_asset_id: string | null; payload: Record<string, unknown> }>(
      `select application_asset_id, payload
         from pg_certificate_requests
        where id = 'request-legacy-acme'`,
    );
    assert.equal(row.rows[0]?.application_asset_id, null);
    assert.deepEqual(row.rows[0]?.payload, payload);
  } finally {
    await db.close();
  }
});
