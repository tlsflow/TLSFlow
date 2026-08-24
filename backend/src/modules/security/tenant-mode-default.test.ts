import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createPersistedSecurityServices } from './security-services.persistence.js';

describe('租户模式首次初始化默认值', () => {
  it('没有持久化状态时即使设置 GCAC_TENANT_MODE 也固定为 single', async () => {
    const previous = process.env.GCAC_TENANT_MODE;
    process.env.GCAC_TENANT_MODE = 'hierarchical';
    try {
      const db = new PgliteDatabase();
      await runMigrations(db, undefined, {
        appliedBy: 'tenant-mode-default',
        checksum: (content) => createHash('sha256').update(content).digest('hex'),
      });
      const security = createPersistedSecurityServices(db).services;
      assert.equal(await security.tenantMode?.getCurrentMode(), 'single');
    } finally {
      if (previous === undefined) delete process.env.GCAC_TENANT_MODE;
      else process.env.GCAC_TENANT_MODE = previous;
    }
  });

  it('测试 fixture 可以显式构造 hierarchical，且不依赖生产环境变量', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tenant-mode-default-fixture',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const security = createPersistedSecurityServices(db, { initialTenantMode: 'hierarchical' }).services;
    assert.equal(await security.tenantMode?.getCurrentMode(), 'hierarchical');
  });
});
