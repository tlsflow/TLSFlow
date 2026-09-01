import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

test('高基数业务关系清理只删除废弃明细类型并保留低基数关系与授权', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table pg_business_permission_relations (
      id text primary key, related_object_type text not null
    );
    create table pg_documents (
      namespace text not null, document_id text not null, payload jsonb not null,
      primary key (namespace, document_id)
    );
  `);
  await db.query(`insert into pg_business_permission_relations (id, related_object_type) values
    ('high', 'monitor_probe_result'), ('low', 'certificate_binding')`);
  await db.query(`insert into pg_documents (namespace, document_id, payload) values
    ('security.business_permission_relations', 'high', '{"relatedObjectType":"monitor_risk"}'),
    ('security.business_permission_relations', 'low', '{"relatedObjectType":"certificate_binding"}')`);
  const sql = await readFile('src/database/migrations/20260901000000_cleanup_high_cardinality_business_permission_relations.sql', 'utf8');
  await db.exec(sql);
  assert.deepEqual((await db.query<{ id: string }>('select id from pg_business_permission_relations order by id')).rows, [{ id: 'low' }]);
  assert.deepEqual((await db.query<{ document_id: string }>('select document_id from pg_documents order by document_id')).rows, [{ document_id: 'low' }]);
});
