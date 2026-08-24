import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

describe('证书表租户隔离迁移', () => {
  it('为历史表补齐租户字段、复合唯一约束和跨租户父子约束', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);

    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_name in (
          'pg_certificate_assets',
          'pg_certificate_versions',
          'pg_certificate_version_formats',
          'pg_certificate_artifacts'
        )
          and column_name = 'tenant_id'`,
    );
    assert.equal(columns.rows.length, 4);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where tablename in (
          'pg_certificate_assets',
          'pg_certificate_versions',
          'pg_certificate_version_formats',
          'pg_certificate_artifacts'
        )`,
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    assert.ok(indexNames.has('uq_pg_certificate_assets_tenant_domain'));
    assert.ok(indexNames.has('uq_pg_certificate_versions_tenant_fingerprint'));
    assert.ok(indexNames.has('uq_pg_certificate_version_formats_tenant_natural'));
    assert.ok(indexNames.has('pg_certificate_artifacts_pkey'));

    await db.exec(`
      insert into pg_certificate_assets (
        id, tenant_id, name, primary_domain, source_type, status, created_by
      ) values
        ('asset_tenant_a', 'tenant_a', 'A', 'same.example.test', 'manual', 'active', 'tester'),
        ('asset_tenant_b', 'tenant_b', 'B', 'same.example.test', 'manual', 'active', 'tester');
    `);

    await insertVersion(db, 'version_tenant_a', 'tenant_a', 'asset_tenant_a', 'fingerprint-a');
    await insertVersion(db, 'version_tenant_b', 'tenant_b', 'asset_tenant_b', 'fingerprint-a');

    await assert.rejects(
      () => insertVersion(db, 'version_cross_parent', 'tenant_b', 'asset_tenant_a', 'fingerprint-cross'),
      /foreign key|violates/i,
    );
    await assert.rejects(
      () => insertVersion(db, 'version_duplicate_fingerprint', 'tenant_a', 'asset_tenant_a', 'fingerprint-a'),
      /unique|duplicate/i,
    );

    await db.query(
      `insert into pg_certificate_version_formats (
         id, tenant_id, certificate_version_id, format, artifact_ref, parameter_hash, created_by
       ) values ($1, $2, $3, 'pem', $4, $5, 'tester')`,
      ['format_tenant_a', 'tenant_a', 'version_tenant_a', 'artifact://same', 'parameter-a'],
    );
    await db.query(
      `insert into pg_certificate_version_formats (
         id, tenant_id, certificate_version_id, format, artifact_ref, parameter_hash, created_by
       ) values ($1, $2, $3, 'pem', $4, $5, 'tester')`,
      ['format_tenant_b', 'tenant_b', 'version_tenant_b', 'artifact://same', 'parameter-a'],
    );
    await assert.rejects(
      () => db.query(
        `insert into pg_certificate_version_formats (
           id, tenant_id, certificate_version_id, format, artifact_ref, parameter_hash, created_by
         ) values ('format_cross_parent', 'tenant_b', 'version_tenant_a', 'pem', 'artifact://cross', 'parameter-cross', 'tester')`,
      ),
      /foreign key|violates/i,
    );

    await db.query(
      `insert into pg_certificate_artifacts (
         tenant_id, artifact_ref, content, content_type, sha256, created_by
       ) values
         ('tenant_a', 'artifact://same', decode('61', 'hex'), 'text/plain', repeat('a', 64), 'tester'),
         ('tenant_b', 'artifact://same', decode('62', 'hex'), 'text/plain', repeat('b', 64), 'tester')`,
    );
    await assert.rejects(
      () => db.query(
        `insert into pg_certificate_artifacts (
           tenant_id, artifact_ref, content, content_type, sha256, created_by
         ) values ('tenant_a', 'artifact://same', decode('63', 'hex'), 'text/plain', repeat('c', 64), 'tester')`,
      ),
      /unique|duplicate/i,
    );
  });
});

async function insertVersion(
  db: PgliteDatabase,
  id: string,
  tenantId: string,
  assetId: string,
  fingerprintSuffix: string,
): Promise<void> {
  await db.query(
    `insert into pg_certificate_versions (
       id, tenant_id, certificate_asset_id, version_no, common_name, issuer, subject,
       serial_number, not_before, not_after, fingerprint_sha256, public_key_algorithm,
       signature_algorithm, leaf_storage_ref, chain_status, source_type, status, created_by
     ) values (
       $1, $2, $3, 1, 'same.example.test', '{}'::jsonb, '{}'::jsonb,
       'serial', now(), now() + interval '1 day', md5($4) || md5($4),
       'rsa', 'sha256WithRSAEncryption', 'artifact://leaf', 'valid', 'manual', 'active', 'tester'
     )`,
    [id, tenantId, assetId, fingerprintSuffix],
  );
}
