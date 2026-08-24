import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { scalar } from '../../database/database-port.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { TenantIdentityService } from './tenant-identity.service.js';

describe('TenantIdentityService', () => {
  it('将 default 逻辑编码解析为唯一租户 UUID，并接受已解析 UUID', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tenant-identity-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
    const service = new TenantIdentityService(db);

    assert.match(tenantId, /^[0-9a-f-]{36}$/i);
    assert.equal(await service.resolve('default'), tenantId);
    assert.equal(await service.resolve(tenantId), tenantId);
    assert.equal(await service.resolveDefault(), tenantId);
  });

  it('未知租户和已停用租户均失败关闭', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tenant-identity-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
    const service = new TenantIdentityService(db);

    await assert.rejects(() => service.resolve('missing-tenant'), { errorCode: 'AUTH_FORBIDDEN' });
    await db.query(`update tenants set status = 'SUSPENDED' where id = $1::uuid`, [tenantId]);
    await assert.rejects(() => service.resolve('default'), { errorCode: 'AUTH_FORBIDDEN' });
  });
});
