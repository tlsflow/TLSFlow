import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

async function apply(db: PgliteDatabase, file: string): Promise<void> {
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations', file), 'utf8'));
}

test('自动化旧目标选择器记录被前向迁移直接清除且旧列被删除', async () => {
  const db = new PgliteDatabase();
  await apply(db, '20260721000100_automation_tables.sql');
  await apply(db, '20260807000100_automation_platform_extensions.sql');
  await apply(db, '20260807000300_automation_run_execution_options.sql');
  await db.exec(`
    insert into automation_definitions
      (id, tenant_id, name, status, current_version, created_by, created_at, updated_at, version)
    values ('legacy-automation', 'tenant-1', 'old', 'draft', 1, 'user-1', now(), now(), 1);
    insert into automation_versions
      (id, tenant_id, automation_id, version, trigger_config, target_selector, target_resolver, actions, guardrails, checksum, created_by, created_at)
    values ('legacy-version', 'tenant-1', 'legacy-automation', 1, '{"type":"on_demand"}', '{}',
      '{"type":"legacy_target_selector","selector":{}}', '[]', '{}', repeat('a', 64), 'user-1', now());
  `);

  await apply(db, '20260809000400_automation_canonical_target_resolver.sql');

  const oldRecord = await db.query<{ count: string }>(
    `select count(*)::text as count from automation_versions where id = 'legacy-version'`,
  );
  assert.equal(oldRecord.rows[0]?.count, '0');
  const oldColumn = await db.query<{ column_name: string | null }>(
    `select column_name from information_schema.columns where table_name = 'automation_versions' and column_name = 'target_selector'`,
  );
  assert.equal(oldColumn.rows.length, 0);
});
