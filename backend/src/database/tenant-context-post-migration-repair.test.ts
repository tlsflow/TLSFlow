import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260814000500_repair_post_migration_audit_context.sql';
const migrationDirectory = join(process.cwd(), 'src/database/migrations');

describe('迁移后审计租户上下文修复', () => {
  it('只在唯一活动租户时补齐新增的缺失审计上下文并保留修复证据', async () => {
    const db = new PgliteDatabase();
    await applyMigrationsBeforeTarget(db);
    const defaultTenant = (await db.query<{ id: string }>(
      `select id::text as id from tenants where code = 'default'`,
    )).rows[0]!.id;

    await db.query(
      `insert into pg_documents (namespace, document_id, payload)
       values
         ('security.audit_logs', 'audit_post_migration_missing', '{"id":"audit_post_migration_missing","action":"task.create"}'::jsonb),
         ('security.audit_logs', 'audit_post_migration_legacy', '{"id":"audit_post_migration_legacy","tenantId":"default"}'::jsonb)`,
    );

    await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));

    const rows = await db.query<{ document_id: string; tenant_id: string }>(
      `select document_id, payload->>'tenantId' as tenant_id
         from pg_documents
        where document_id like 'audit_post_migration_%'
        order by document_id`,
    );
    assert.deepEqual(rows.rows, [
      { document_id: 'audit_post_migration_legacy', tenant_id: defaultTenant },
      { document_id: 'audit_post_migration_missing', tenant_id: defaultTenant },
    ]);

    const auditCount = (await db.query<{ count: string }>(
      `select count(*)::text as count
         from database_forward_cleanup_audits
        where migration_version = '20260814000500'`,
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
