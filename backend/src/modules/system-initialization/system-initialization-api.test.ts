import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';

describe('系统初始化向导 API', () => {
  it('只允许完成一次，并保存 Admin 偏好与浏览器会话', async () => {
    const previousSeed = process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED;
    process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED = 'false';
    try {
      const db = new PgliteDatabase();
      await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
      const security = createPersistedSecurityServices(db).services;
      const app = createApp({ db, security, corePersistence: { mode: 'memory', strict: false } });

      const before = await app.inject({ method: 'GET', path: '/api/v1/system/initialization' });
      assert.equal(before.statusCode, 200);
      assert.deepEqual(before.body, { initialized: false, status: 'pending' });

      const initialized = await app.inject({
        method: 'POST',
        path: '/api/v1/system/initialization',
        body: {
          username: 'owner',
          displayName: 'Owner',
          password: 'correct-horse',
          passwordConfirmation: 'correct-horse',
          locale: 'en-US',
          theme: 'dark',
        },
      });
      assert.equal(initialized.statusCode, 200);
      const cookie = initialized.headers['Set-Cookie'];
      assert.ok(cookie);

      const preferences = await app.inject({ method: 'GET', path: '/api/v1/auth/preferences', headers: { cookie } });
      assert.equal(preferences.statusCode, 200);
      assert.deepEqual(preferences.body, { theme: 'dark', locale: 'en-US', version: 1 });

      const duplicate = await app.inject({
        method: 'POST',
        path: '/api/v1/system/initialization',
        body: {
          username: 'second',
          displayName: 'Second',
          password: 'correct-horse',
          passwordConfirmation: 'correct-horse',
          locale: 'zh-CN',
          theme: 'light',
        },
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal((duplicate.body as { errorCode: string }).errorCode, 'RESOURCE_ALREADY_EXISTS');

      const login = await app.inject({ method: 'POST', path: '/api/v1/auth/login', body: { username: 'owner', password: 'correct-horse' } });
      assert.equal(login.statusCode, 200);
      assert.equal((login.body as { user: { username: string } }).user.username, 'owner');
    } finally {
      if (previousSeed === undefined) delete process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED;
      else process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED = previousSeed;
    }
  });
});
