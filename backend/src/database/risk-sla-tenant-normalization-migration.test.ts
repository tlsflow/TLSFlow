import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

describe('risk_sla_policies 默认租户归一化迁移', () => {
  it('会把历史零值 UUID 归一化为 default 根租户 UUID', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'risk-sla-tenant-normalization-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    const defaultTenant = await db.query<{ id: string }>(
      `select id::text as id
         from tenants
        where code = 'default'
          and deleted_at is null`,
    );
    const defaultTenantId = defaultTenant.rows[0]?.id;
    assert.ok(defaultTenantId);

    const policies = await db.query<{ tenant_id: string; count: number }>(
      `select tenant_id, count(*)::int as count
         from risk_sla_policies
        group by tenant_id
        order by tenant_id`,
    );
    assert.deepEqual(policies.rows, [
      {
        tenant_id: defaultTenantId,
        count: 4,
      },
    ]);

    const zeroUuidPolicies = await db.query<{ count: number }>(
      `select count(*)::int as count
         from risk_sla_policies
        where tenant_id = '00000000-0000-0000-0000-000000000000'`,
    );
    assert.equal(zeroUuidPolicies.rows[0]?.count, 0);
  });
});
