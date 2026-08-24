import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

test('业务权限递增迁移建立授权和关系表，并拒绝租户通配范围', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const tables = (await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema='public' and table_name in ('pg_business_permission_grants', 'pg_business_permission_relations')`,
  )).rows.map((item) => item.table_name).sort();
  assert.deepEqual(tables, ['pg_business_permission_grants', 'pg_business_permission_relations']);

  await assert.rejects(
    db.query(
      `insert into pg_business_permission_grants (
        id, tenant_id, principal_type, principal_id, role_id, domain, level, root_object_type,
        effect, status, resolver_version, related_resource_version, created_by
      ) values ('bp_invalid', '*', 'user', 'u1', 'r1', 'application', 'manager', 'service_asset', 'allow', 'active', 'bpmap_v1', 'bpr_empty', 'admin')`,
    ),
  );
});
