import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

test('云账号资产支持四类 Provider、作用域幂等冲突和无 Host 创建', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, allowLegacyHeaderContext: true });
  const headers = { 'x-tenant-id': 'tenant-provider-api', 'x-actor-id': 'user-provider-api' };
  const payload = {
    displayName: '测试阿里云账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-1',
    credentialRef: 'secret://provider/sec_provider#current',
    scope: { regions: ['cn-hangzhou'], endpoint: 'https://example.invalid' },
  };

  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: payload,
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const assetId = (created.body as { id: string }).id;
  assert.match(assetId, /^caa_/);

  const listed = await app.inject({
    method: 'GET',
    path: '/api/v1/cloud-account-assets',
    headers,
  });
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.equal((listed.body as { items: unknown[] }).items.length, 1);

  const duplicate = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: payload,
  });
  assert.equal(duplicate.statusCode, 409, JSON.stringify(duplicate.body));

  const topology = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_name in ('pg_framework_instances', 'pg_site_assets', 'pg_managed_targets')
       and column_name = 'asset_id'`,
  );
  assert.equal(topology.rows.length, 3);
});

test('Application 新入口与旧 ServiceAsset 入口指向同一事实', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, allowLegacyHeaderContext: true });
  const headers = { 'x-tenant-id': 'tenant-application-alias', 'x-actor-id': 'user_admin' };
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/applications',
    headers,
    body: {
      address: 'application-alias.example.test',
      port: 443,
      protocol: 'HTTPS',
      displayName: 'Application 别名测试',
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = (created.body as { id: string }).id;

  const fromNew = await app.inject({
    method: 'GET',
    path: `/api/v1/applications/detail?applicationId=${encodeURIComponent(id)}`,
    headers,
  });
  const fromLegacy = await app.inject({
    method: 'GET',
    path: `/api/v1/service-assets/detail?serviceAssetId=${encodeURIComponent(id)}`,
    headers,
  });
  assert.equal(fromNew.statusCode, 200, JSON.stringify(fromNew.body));
  assert.equal(fromLegacy.statusCode, 200, JSON.stringify(fromLegacy.body));
  assert.equal((fromNew.body as { id: string }).id, (fromLegacy.body as { id: string }).id);
});
