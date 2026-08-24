import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

test('云账号资产支持四类 Provider、作用域幂等冲突和无 Host 创建', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, allowLegacyHeaderContext: true });
  const security = app.getResource<any>('securityServices');
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  await security.auth.currentSession('user_admin');
  const headers = { 'x-tenant-id': 'tenant-provider-api', 'x-actor-id': 'user_admin' };
  const payload = {
    displayName: '测试阿里云账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-1',
    credentialRef: 'credential://cred_provider',
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

  const queued = await app.inject({
    method: 'POST',
    path: `/api/v1/cloud-account-assets/${encodeURIComponent(assetId)}/execute-task`,
    headers,
    body: {
      frameworkType: 'cloud.aliyun.cdn',
      operationKey: 'certificate.deploy',
      target: {
        frameworkType: 'cloud.aliyun.cdn',
        resourceId: 'cdn-domain-1',
        domain: 'cdn.example.test',
      },
      input: {
        certificateRef: 'secret://certificates/example#current',
      },
    },
  });
  assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
  const taskId = (queued.body as { taskId: string }).taskId;
  const taskRow = await db.query<{ task_type: string; payload: Record<string, unknown> }>(
    'select task_type, payload from task_runs where id = $1',
    [taskId],
  );
  assert.equal(taskRow.rows[0]?.task_type, 'PROVIDER_OPERATION');
  const taskPayload = taskRow.rows[0]?.payload ?? {};
  assert.equal((taskPayload.input as Record<string, unknown>)?.certificateRef, 'secret://certificates/example#current');
  assert.equal(JSON.stringify(taskPayload).includes('certificatePem'), false);

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

test('云账号草稿探测支持未落库凭据校验且不会提前创建资产', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, allowLegacyHeaderContext: true });
  const security = app.getResource<any>('securityServices');
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  await security.auth.currentSession('user_admin');
  const headers = { 'x-tenant-id': 'tenant-provider-draft', 'x-actor-id': 'user_admin' };

  const credential = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers,
    body: {
      name: '阿里云草稿凭据',
      kind: 'CLOUD_PROVIDER',
      scopeType: 'global',
      metadata: { providerKey: 'cloud.aliyun' },
      secretValues: {
        accessKeyId: { plainText: 'draft-ak' },
        accessKeySecret: { plainText: 'draft-sk' },
      },
    },
  });
  assert.equal(credential.statusCode, 201, JSON.stringify(credential.body));
  const credentialId = String((credential.body as { id: string }).id);

  const preview = await app.inject({
    method: 'POST',
    path: '/api/v1/providers/cloud.aliyun/draft-discovery',
    headers,
    body: {
      displayName: '阿里云草稿账号',
      accountId: 'draft-account',
      credentialRef: `credential://${credentialId}`,
      scope: { regions: ['cn-hangzhou'] },
      frameworkTypes: [],
    },
  });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  const previewBody = preview.body as Record<string, unknown>;
  assert.equal(previewBody.providerKey, 'cloud.aliyun');
  assert.deepEqual(previewBody.availableFrameworks, [
    'cloud.aliyun.cdn',
    'cloud.aliyun.alb',
    'cloud.aliyun.clb',
    'cloud.aliyun.oss',
    'cloud.aliyun.waf-cname',
    'cloud.aliyun.waf-cloud',
    'cloud.aliyun.live',
    'cloud.aliyun.vod',
  ]);
  assert.equal((previewBody.connection as { reachable: boolean }).reachable, true);
  assert.equal((previewBody.connection as { accountId: string }).accountId, 'draft-account');
  assert.equal(((previewBody.summary as Record<string, number>).frameworks), 0);

  const listed = await app.inject({
    method: 'GET',
    path: '/api/v1/cloud-account-assets',
    headers,
  });
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.equal((listed.body as { items: unknown[] }).items.length, 0);
});

test('Application 新入口与旧 ServiceAsset 入口指向同一事实', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, allowLegacyHeaderContext: true });
  const security = app.getResource<any>('securityServices');
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  await security.auth.currentSession('user_admin');
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
