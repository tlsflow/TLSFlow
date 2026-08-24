import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260814000600_repair_secret_version_tenant_context.sql';
const migrationDirectory = join(process.cwd(), 'src/database/migrations');

describe('SecretVersion 租户上下文修复迁移', () => {
  it('从已验证父 Secret 回填缺失和历史逻辑租户，不改变密文正文', async () => {
    const db = new PgliteDatabase();
    await applyMigrationsBeforeTarget(db);
    const tenantId = (await db.query<{ id: string }>(
      `select id::text as id from tenants where code = 'default'`,
    )).rows[0]!.id;

    await db.query(
      `insert into pg_documents (namespace, document_id, payload)
       values
         ('security.secrets', 'secret_version_tenant_repair',
          '{"id":"secret_version_tenant_repair","tenantId":"${tenantId}","status":"active","currentVersionId":"secret_version_current"}'::jsonb),
         ('security.secret_versions', 'secret_version_current',
          '{"id":"secret_version_current","secretId":"secret_version_tenant_repair","encryptedData":"ciphertext","metadata":{"preserved":true}}'::jsonb),
         ('security.secret_versions', 'secret_version_legacy',
          '{"id":"secret_version_legacy","tenantId":"default","secretId":"secret_version_tenant_repair","encryptedData":"old-ciphertext"}'::jsonb)`,
    );

    await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));

    const versions = await db.query<{ document_id: string; tenant_id: string; encrypted_data: string }>(
      `select document_id, payload->>'tenantId' as tenant_id, payload->>'encryptedData' as encrypted_data
         from pg_documents
        where namespace = 'security.secret_versions'
          and document_id in ('secret_version_current', 'secret_version_legacy')
        order by document_id`,
    );
    assert.deepEqual(versions.rows, [
      { document_id: 'secret_version_current', tenant_id: tenantId, encrypted_data: 'ciphertext' },
      { document_id: 'secret_version_legacy', tenant_id: tenantId, encrypted_data: 'old-ciphertext' },
    ]);

    const auditCount = (await db.query<{ count: string }>(
      `select count(*)::text as count
         from database_forward_cleanup_audits
        where migration_version = '20260814000600'`,
    )).rows[0]?.count;
    assert.equal(auditCount, '2');
    await db.close();
  });
});

async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}
