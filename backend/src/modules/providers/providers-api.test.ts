import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppAsync } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { getCloudAccountRouteContracts } from './controller/providers.controller.js';

test('云账号资产保留通用租户隔离 CRUD，凭据只接受 CredentialRef', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = await createAppAsync({ db });
  app.setAuthTokenResolver((authorization) => ({
    actorId: 'user_admin',
    tenantId: authorization === 'Bearer tenant-provider-other' ? 'tenant-provider-other' : 'tenant-provider-api',
  }));
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
  const headers = { authorization: 'Bearer tenant-provider-api' };
  const otherTenantHeaders = { authorization: 'Bearer tenant-provider-other' };
  const payload = {
    displayName: '测试阿里云账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-1',
    credentialRef: 'credential://cred_provider',
    scope: { endpoint: 'https://example.invalid' },
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
  assert.equal((created.body as { credentialRef: string }).credentialRef, payload.credentialRef);
  assert.equal(JSON.stringify(created.body).includes('accessKeySecret'), false);

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: {
      id: assetId,
      displayName: '更新后的通用云账号',
      metadata: { source: 'api-test' },
    },
  });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  assert.equal((updated.body as { displayName: string }).displayName, '更新后的通用云账号');

  const listed = await app.inject({
    method: 'GET',
    path: '/api/v1/cloud-account-assets',
    headers,
  });
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.equal((listed.body as { items: unknown[] }).items.length, 1);

  const otherTenantList = await app.inject({
    method: 'GET',
    path: '/api/v1/cloud-account-assets',
    headers: otherTenantHeaders,
  });
  assert.equal(otherTenantList.statusCode, 200, JSON.stringify(otherTenantList.body));
  assert.equal((otherTenantList.body as { items: unknown[] }).items.length, 0);

  const crossTenantDelete = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets/delete',
    headers: otherTenantHeaders,
    body: { id: assetId },
  });
  assert.equal(crossTenantDelete.statusCode, 404, JSON.stringify(crossTenantDelete.body));

  const duplicate = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: payload,
  });
  assert.equal(duplicate.statusCode, 409, JSON.stringify(duplicate.body));

  const invalidCredentialRef = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: { ...payload, accountId: 'account-2', credentialRef: 'plain-secret' },
  });
  assert.equal(invalidCredentialRef.statusCode, 400, JSON.stringify(invalidCredentialRef.body));

  const blankProviderKey = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: { ...payload, accountId: 'account-blank-provider', providerKey: '   ' },
  });
  assert.equal(blankProviderKey.statusCode, 400, JSON.stringify(blankProviderKey.body));
  const afterBlankProviderKey = await app.inject({ method: 'GET', path: '/api/v1/cloud-account-assets', headers });
  assert.equal((afterBlankProviderKey.body as { items: unknown[] }).items.length, 1);

  const deleted = await app.inject({
    method: 'POST',
    path: '/api/v1/cloud-account-assets/delete',
    headers,
    body: { id: assetId },
  });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  assert.equal((deleted.body as { status: string }).status, 'DELETED');

  const afterDelete = await app.inject({
    method: 'GET',
    path: '/api/v1/cloud-account-assets',
    headers,
  });
  assert.equal(afterDelete.statusCode, 200, JSON.stringify(afterDelete.body));
  assert.equal((afterDelete.body as { items: unknown[] }).items.length, 0);

  const topology = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_name in ('pg_framework_instances', 'pg_site_assets', 'pg_managed_targets')
       and column_name = 'asset_id'`,
  );
  assert.equal(topology.rows.length, 3);
});

test('Provider 厂商旁路全部移除，OpenAPI 只暴露 Cloud Account 基础 CRUD', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = await createAppAsync({ db });
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-provider-routes' }));

  const removedRoutes = [
    ['GET', '/api/v1/providers'],
    ['GET', '/api/v1/providers/cloud.aliyun/capabilities'],
    ['GET', '/api/v1/provider-capability-plugins'],
    ['POST', '/api/v1/providers/cloud.aliyun/draft-discovery'],
    ['POST', '/api/v1/cloud-account-assets/caa_removed/connection-test'],
    ['POST', '/api/v1/cloud-account-assets/caa_removed/discover'],
    ['POST', '/api/v1/cloud-account-assets/caa_removed/execute'],
    ['POST', '/api/v1/cloud-account-assets/caa_removed/execute-task'],
  ] as const;
  for (const [method, path] of removedRoutes) {
    const response = await app.inject({
      method,
      path,
      headers: { authorization: 'Bearer tenant-provider-routes' },
      body: {},
    });
    assert.equal(response.statusCode, 404, `${method} ${path}: ${JSON.stringify(response.body)}`);
    assert.equal(app.router.match(method, path), undefined, `${method} ${path} 仍被 Router 注册`);
  }

  const contractKeys = getCloudAccountRouteContracts()
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  assert.deepEqual(contractKeys, [
    'GET /api/v1/cloud-account-assets',
    'PATCH /api/v1/cloud-account-assets',
    'POST /api/v1/cloud-account-assets',
    'POST /api/v1/cloud-account-assets/delete',
  ]);

  const openApiResponse = await app.inject({ method: 'GET', path: '/api/v1/openapi.json' });
  assert.equal(openApiResponse.statusCode, 200, JSON.stringify(openApiResponse.body));
  const openApiPaths = Object.keys((openApiResponse.body as { paths: Record<string, unknown> }).paths);
  assert.ok(openApiPaths.includes('/api/v1/cloud-account-assets'));
  assert.ok(!openApiPaths.includes('/api/v1/providers'));
  assert.ok(!openApiPaths.some((path) => path.startsWith('/api/v1/providers/')
    || path === '/api/v1/provider-capability-plugins'
    || /^\/api\/v1\/cloud-account-assets\/[^/]+\/(connection-test|discover|execute(?:-task)?)$/.test(path)));
});
