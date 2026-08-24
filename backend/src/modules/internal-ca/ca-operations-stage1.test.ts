import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

test('CA 运营常用状态分页查询可使用组合索引', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  await database.query('set enable_seqscan = off');
  const result = await database.query<{ 'QUERY PLAN': string }>(
    `explain select id from pg_ca_external_observations
     where tenant_id = $1 and ca_id = $2 and object_type = $3 and normalized_status = $4
     order by observed_at desc, id desc limit 200`,
    ['tenant-1', 'ca-1', 'request', 'issued'],
  );
  const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
  assert.match(plan, /idx_ca_external_observations_status/);
  assert.match(plan, /Index Only Scan|Index Scan/);
});
