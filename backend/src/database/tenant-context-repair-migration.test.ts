import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260814000400_repair_tenant_context_records.sql';
const migrationDirectory = join(process.cwd(), 'src/database/migrations');

describe('租户上下文数据修复迁移', () => {
  it('将唯一 default 租户下的零值凭据和安全文档补齐为 UUID 上下文', async () => {
    const db = new PgliteDatabase();
    await applyMigrationsBeforeTarget(db);

    const defaultTenant = (await db.query<{ id: string }>(
      `select id::text as id from tenants where code = 'default'`,
    )).rows[0]!.id;

    await db.query(
      `insert into credential_profiles (
         id, tenant_id, name, kind, scope_type, delivery, secret_slots,
         metadata, status, version, created_by, created_at, updated_at
       ) values (
         'cred_zero_uuid', '00000000-0000-0000-0000-000000000000',
         '测试凭据', 'USERNAME_PASSWORD', 'global', '{}'::jsonb,
         '{}'::jsonb, '{}'::jsonb, 'active', 1, 'migration-test', now(), now()
       )`,
    );
    await db.query(
      `insert into pg_documents (namespace, document_id, payload)
       values
         ('security.audit_logs', 'audit_missing_tenant', '{"id":"audit_missing_tenant","action":"test"}'::jsonb),
         ('security.secrets', 'secret_legacy_default', '{"id":"secret_legacy_default","tenantId":"default"}'::jsonb),
         ('security.execution_grants', 'grant_missing_tenant', '{"id":"grant_missing_tenant"}'::jsonb)`,
    );

    const migrationSql = await readFile(join(migrationDirectory, migrationName), 'utf8');
    await db.exec(migrationSql);

    const profile = (await db.query<{ tenant_id: string }>(
      `select tenant_id::text as tenant_id from credential_profiles where id = 'cred_zero_uuid'`,
    )).rows[0];
    assert.equal(profile?.tenant_id, defaultTenant);

    const documents = await db.query<{ document_id: string; tenant_id: string }>(
      `select document_id, payload->>'tenantId' as tenant_id
         from pg_documents
        where document_id in ('audit_missing_tenant', 'secret_legacy_default', 'grant_missing_tenant')
        order by document_id`,
    );
    assert.deepEqual(documents.rows, [
      { document_id: 'audit_missing_tenant', tenant_id: defaultTenant },
      { document_id: 'grant_missing_tenant', tenant_id: defaultTenant },
      { document_id: 'secret_legacy_default', tenant_id: defaultTenant },
    ]);

    const auditCount = (await db.query<{ count: string }>(
      `select count(*)::text as count
         from database_forward_cleanup_audits
        where migration_version = '20260814000400'`,
    )).rows[0]?.count;
    assert.equal(auditCount, '4');
    await db.close();
  });
});

async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}
