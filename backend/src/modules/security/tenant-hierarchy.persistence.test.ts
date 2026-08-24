import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { scalar } from '../../database/database-port.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

describe('租户层级数据库迁移', () => {
  it('保留 default 租户 UUID 和历史业务对象归属，并建立成员约束', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, { appliedBy: 'tenant-hierarchy-baseline-test' });
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
    const assetId = await scalar<string>(
      db,
      `insert into certificate_assets (tenant_id, name, primary_domain, source_type)
       values ($1::uuid, '历史默认业务对象', 'history.example.com', 'MANUAL')
       returning id::text`,
      [tenantId],
    );

    const tenant = await db.query<{ id: string; type: string; parent_id: string | null }>(
      `select id::text as id, tenant_type as type, parent_id::text
         from tenants
        where code = 'default'`,
    );
    assert.deepEqual(tenant.rows[0], { id: tenantId, type: 'GROUP', parent_id: null });

    const defaultMembership = await db.query<{ subject_id: string; tenant_id: string; membership_type: string }>(
      `select subject_id, tenant_id::text, membership_type
         from tenant_memberships
        where subject_type = 'user'
          and subject_id = 'user_admin'`,
    );
    assert.deepEqual(defaultMembership.rows[0], {
      subject_id: 'user_admin',
      tenant_id: tenantId,
      membership_type: 'owner',
    });

    const asset = await db.query<{ tenant_id: string }>(
      'select tenant_id::text from certificate_assets where id = $1::uuid',
      [assetId],
    );
    assert.equal(asset.rows[0]?.tenant_id, tenantId);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'uq_tenant_memberships_active_subject_tenant',
            'idx_tenant_memberships_subject_status',
            'idx_tenant_memberships_tenant_status'
          )
        order by indexname`,
    );
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      'idx_tenant_memberships_subject_status',
      'idx_tenant_memberships_tenant_status',
      'uq_tenant_memberships_active_subject_tenant',
    ]);
  });

  it('完整迁移可以重复校验新租户表和 default 根节点', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tenant-hierarchy-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    const result = await db.query<{ type: string; parent_id: string | null }>(
      `select tenant_type as type, parent_id::text
         from tenants
        where code = 'default'`,
    );
    assert.deepEqual(result.rows[0], { type: 'GROUP', parent_id: null });
  });

});
