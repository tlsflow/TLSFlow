import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppAsync } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { getCloudAccountRouteContracts } from './controller/providers.controller.js';

async function insertCloudCredential(db: PgliteDatabase, tenantId: string, id: string, providerKey: string): Promise<void> {
  const now = new Date().toISOString();
  await db.query(
    `insert into credential_profiles
      (id, tenant_id, name, kind, scope_type, delivery, secret_slots, metadata, status, version, created_by, created_at, updated_at)
     values ($1,$2,$3,'CLOUD_PROVIDER','global','{}'::jsonb,$4::jsonb,$5::jsonb,'active',1,'test',$6::timestamptz,$6::timestamptz)`,
    [id, tenantId, `${providerKey} 测试凭据`, JSON.stringify({ credential: 'secret://api_token/sec_test#current' }), JSON.stringify({ providerKey }), now],
  );
}

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
  await insertCloudCredential(db, 'tenant-provider-api', 'cred_provider', 'cloud.aliyun');
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
  const binding = await db.query<{ id: string; plugin_version_id: string; cloud_account_asset_id: string }>(
    `select id, plugin_version_id, managed_context->>'cloudAccountAssetId' as cloud_account_asset_id
       from unified_plugin_bindings
      where tenant_id=$1 and managed_context->>'cloudAccountAssetId'=$2`,
    ['tenant-provider-api', assetId],
  );
  assert.equal(binding.rows.length, 1);
  assert.equal(binding.rows[0]?.cloud_account_asset_id, assetId);
  const assignments = await db.query<{ capability_key: string; plugin_version_id: string; plugin_binding_id: string }>(
    `select capability_key, plugin_version_id, plugin_binding_id
       from plugin_capability_assignments
      where tenant_id=$1 and owner_type='CLOUD_ACCOUNT_ASSET' and owner_id=$2 and status='ACTIVE'
      order by capability_key`,
    ['tenant-provider-api', assetId],
  );
  assert.deepEqual(assignments.rows.map((row) => row.capability_key), [
    'certificate.deploy',
    'certificate.rollback',
    'certificate.verify',
    'cloud.service.connection-test',
    'cloud.service.discover',
  ]);
  assert.ok(assignments.rows.every((row) => row.plugin_version_id === binding.rows[0]?.plugin_version_id));
  assert.ok(assignments.rows.every((row) => row.plugin_binding_id === binding.rows[0]?.id));

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/cloud-account-assets',
    headers,
    body: {
      id: assetId,
      expectedVersion: (created.body as { version: number }).version,
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

  const detail = await app.inject({
    method: 'GET',
    path: `/api/v1/cloud-account-assets/${assetId}`,
    headers,
  });
  assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
  assert.equal((detail.body as { id: string }).id, assetId);

  const otherTenantDetail = await app.inject({
    method: 'GET',
    path: `/api/v1/cloud-account-assets/${assetId}`,
    headers: otherTenantHeaders,
  });
  assert.equal(otherTenantDetail.statusCode, 404, JSON.stringify(otherTenantDetail.body));

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
    'GET /api/v1/cloud-account-assets/:id',
    'PATCH /api/v1/cloud-account-assets',
    'POST /api/v1/cloud-account-assets',
    'POST /api/v1/cloud-account-assets/:id/actions/:action',
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

test('云账号创建、更新和删除使用后端持久化幂等记录', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = await createAppAsync({ db });
  app.setAuthTokenResolver(() => ({ actorId: 'user_admin', tenantId: 'tenant-provider-idempotency' }));
  const security = app.getResource<any>('securityServices');
  await security.rbac.createPolicy({
    subjectType: 'user', subjectId: 'user_admin', effect: 'allow', actions: ['*'], resourceTypes: ['*'], scope: { tenantId: '*' },
  });
  await security.auth.currentSession('user_admin');
  await insertCloudCredential(db, 'tenant-provider-idempotency', 'idempotency', 'cloud.aliyun');
  const headers = { authorization: 'Bearer tenant-provider-idempotency', 'x-idempotency-key': 'cloud-create-idem' };
  const payload = {
    displayName: '幂等云账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-idempotency',
    credentialRef: 'credential://idempotency',
  };
  const created = await app.inject({ method: 'POST', path: '/api/v1/cloud-account-assets', headers, body: payload });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const replayCreate = await app.inject({ method: 'POST', path: '/api/v1/cloud-account-assets', headers, body: payload });
  assert.equal(replayCreate.statusCode, 201, JSON.stringify(replayCreate.body));
  assert.equal((replayCreate.body as { id: string }).id, (created.body as { id: string }).id);
  const createConflict = await app.inject({
    method: 'POST', path: '/api/v1/cloud-account-assets', headers,
    body: { ...payload, displayName: '不同请求体' },
  });
  assert.equal(createConflict.statusCode, 409, JSON.stringify(createConflict.body));
  assert.equal((createConflict.body as { errorCode: string }).errorCode, 'IDEMPOTENCY_CONFLICT');

  const assetId = (created.body as { id: string; version: number }).id;
  const updateHeaders = { authorization: 'Bearer tenant-provider-idempotency', 'x-idempotency-key': 'cloud-update-idem' };
  const updateBody = { id: assetId, expectedVersion: 1, displayName: '幂等更新' };
  const updated = await app.inject({ method: 'PATCH', path: '/api/v1/cloud-account-assets', headers: updateHeaders, body: updateBody });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  const replayUpdate = await app.inject({ method: 'PATCH', path: '/api/v1/cloud-account-assets', headers: updateHeaders, body: updateBody });
  assert.equal(replayUpdate.statusCode, 200, JSON.stringify(replayUpdate.body));
  assert.equal((replayUpdate.body as { version: number }).version, 2);
  const updateConflict = await app.inject({ method: 'PATCH', path: '/api/v1/cloud-account-assets', headers: updateHeaders, body: { ...updateBody, displayName: '另一个更新' } });
  assert.equal(updateConflict.statusCode, 409, JSON.stringify(updateConflict.body));
  assert.equal((updateConflict.body as { errorCode: string }).errorCode, 'IDEMPOTENCY_CONFLICT');

  const actionHeaders = { authorization: 'Bearer tenant-provider-idempotency', 'x-idempotency-key': 'cloud-action-idem' };
  const actionPath = `/api/v1/cloud-account-assets/${assetId}/actions/connection-test`;
  const actionBody = { input: { region: 'cn-hangzhou' } };
  const action = await app.inject({ method: 'POST', path: actionPath, headers: actionHeaders, body: actionBody });
  assert.equal(action.statusCode, 202, JSON.stringify(action.body));
  const replayAction = await app.inject({ method: 'POST', path: actionPath, headers: actionHeaders, body: actionBody });
  assert.equal(replayAction.statusCode, 202, JSON.stringify(replayAction.body));
  assert.equal((replayAction.body as { taskId: string }).taskId, (action.body as { taskId: string }).taskId);
  const actionConflict = await app.inject({ method: 'POST', path: actionPath, headers: actionHeaders, body: { input: { region: 'cn-shenzhen' } } });
  assert.equal(actionConflict.statusCode, 409, JSON.stringify(actionConflict.body));
  assert.equal((actionConflict.body as { errorCode: string }).errorCode, 'IDEMPOTENCY_CONFLICT');

  const deleteHeaders = { authorization: 'Bearer tenant-provider-idempotency', 'x-idempotency-key': 'cloud-delete-idem' };
  const deleted = await app.inject({ method: 'POST', path: '/api/v1/cloud-account-assets/delete', headers: deleteHeaders, body: { id: assetId } });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  const replayDelete = await app.inject({ method: 'POST', path: '/api/v1/cloud-account-assets/delete', headers: deleteHeaders, body: { id: assetId } });
  assert.equal(replayDelete.statusCode, 200, JSON.stringify(replayDelete.body));
  assert.equal((replayDelete.body as { id: string }).id, assetId);
  const records = await db.query<{ count: number }>(
    `select count(*) from idempotency_records where tenant_id=$1`,
    ['tenant-provider-idempotency'],
  );
  assert.equal(Number(records.rows[0]?.count), 4);
  await db.close();
});
