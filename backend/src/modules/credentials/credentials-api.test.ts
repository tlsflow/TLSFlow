import assert from 'node:assert/strict';
import test from 'node:test';

import { App } from '../../common/http/app.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { CredentialsApplicationService } from './application/credentials.application-service.js';
import { CredentialsController } from './controller/credentials.controller.js';
import { CredentialsRepository } from './repository/credentials.repository.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';

async function createTestApp() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const app = new App();
  const security = createPersistedSecurityServices(database).services;
  new CredentialsController(new CredentialsApplicationService(new CredentialsRepository(database), undefined, database, security.secrets)).register(app.router);
  return { app, database };
}

test('全局凭据 API 支持创建、查询、更新、禁用和删除', async () => {
  const { app, database } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: {
      name: 'ADC 生产凭据',
      kind: 'USERNAME_PASSWORD',
      scopeType: 'global',
      username: 'nsroot',
      secretValues: { password: { plainText: 'initial-password' } },
    },
  });
  assert.equal(created.statusCode, 201);
  const credential = created.body as Record<string, unknown>;
  assert.equal(credential.status, 'active');
  const passwordRef = String((credential.secretSlots as Record<string, string>).password);
  assert.match(passwordRef, /^secret:\/\/password\/sec_[A-Za-z0-9_-]+#current$/);
  assert.equal('plainText' in credential, false);
  assert.equal(JSON.stringify(credential).includes('initial-password'), false);

  const rotated = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials/rotate',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credential.id, secretValues: { password: { plainText: 'rotated-password' } }, expectedVersion: 1 },
  });
  assert.equal(rotated.statusCode, 200);
  assert.equal((rotated.body as Record<string, unknown>).id, credential.id);
  assert.equal((rotated.body as Record<string, unknown>).version, 2);
  assert.equal(JSON.stringify(rotated.body).includes('rotated-password'), false);
  const secretVersions = await database.query<{ count: string }>(
    `select count(*)::text as count from pg_documents where namespace='security.secret_versions' and payload->>'secretId'=$1`,
    [passwordRef.split('/')[3]?.split('#')[0]],
  );
  assert.equal(secretVersions.rows[0]?.count, '2');

  const listed = await app.inject({
    method: 'GET',
    path: '/api/v1/credentials?search=ADC',
    headers: { 'x-tenant-id': 'tenant-a' },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal((listed.body as { total: number }).total, 1);

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { id: credential.id, name: 'ADC 主凭据', expectedVersion: 2 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal((updated.body as Record<string, unknown>).version, 3);

  const disabled = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials/status',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { id: credential.id, status: 'disabled', expectedVersion: 3 },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal((disabled.body as Record<string, unknown>).status, 'disabled');

  const deleted = await app.inject({
    method: 'DELETE',
    path: '/api/v1/credentials/delete',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { id: credential.id },
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.body, { id: credential.id, deleted: true });
});

test('全局凭据 API 强制租户隔离和乐观锁', async () => {
  const { app } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: {
      name: 'SSH 凭据',
      kind: 'SSH_KEY',
      scopeType: 'global',
      username: 'root',
      secretValues: { privateKey: { plainText: 'private-key-material' } },
    },
  });
  const credentialId = String((created.body as Record<string, unknown>).id);

  const foreign = await app.inject({
    method: 'GET',
    path: `/api/v1/credentials/detail?id=${credentialId}`,
    headers: { 'x-tenant-id': 'tenant-b' },
  });
  assert.equal(foreign.statusCode, 404);

  const conflict = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { id: credentialId, name: '冲突更新', expectedVersion: 9 },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal((conflict.body as { errorCode: string }).errorCode, 'RESOURCE_VERSION_CONFLICT');
});

test('全局凭据 API 拒绝非法运行时状态', async () => {
  const { app } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: {
      name: '令牌凭据',
      kind: 'BEARER_TOKEN',
      scopeType: 'global',
      secretValues: { token: { plainText: 'token-value' } },
    },
  });
  const credentialId = String((created.body as Record<string, unknown>).id);
  const result = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials/status',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { id: credentialId, status: 'deleted', expectedVersion: 1 },
  });
  assert.equal(result.statusCode, 400);
  assert.equal((result.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
});

test('全局凭据 API 返回 PluginBinding Usage 并阻止删除', async () => {
  const { app, database } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-usage', 'x-actor-id': 'user-a' },
    body: {
      name: '设备凭据',
      kind: 'USERNAME_PASSWORD',
      scopeType: 'global',
      username: 'admin',
      secretValues: { password: { plainText: 'usage-password' } },
    },
  });
  const credentialId = String((created.body as Record<string, unknown>).id);
  await database.query(
    `insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support, manifest,
      package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values (
      'plgv_usage', 'tenant-usage', 'test.usage', '1.0.0', 'USER', 'WORKFLOW_DSL', 'BOTH', 'UNSIGNED', 'SELF_MANAGED', '{}'::jsonb,
      'a', 'b', '{}'::jsonb, 'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
    )`,
  );
  await database.query(
    `insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, variable_bindings, credential_bindings,
      secret_bindings, certificate_artifact_bindings, connection_bindings, status, version, created_at, updated_at
    ) values (
      'plgb_usage', 'tenant-usage', 'plgv_usage', 'STANDALONE', '{}'::jsonb,
      $1::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ACTIVE', 1, now(), now()
    )`,
    [JSON.stringify({ management: { credentialId } })],
  );

  const usage = await app.inject({
    method: 'GET',
    path: `/api/v1/credentials/usage?id=${credentialId}`,
    headers: { 'x-tenant-id': 'tenant-usage' },
  });
  assert.equal(usage.statusCode, 200);
  assert.equal((usage.body as { total: number }).total, 1);

  const deleted = await app.inject({
    method: 'DELETE',
    path: '/api/v1/credentials/delete',
    headers: { 'x-tenant-id': 'tenant-usage' },
    body: { id: credentialId },
  });
  assert.equal(deleted.statusCode, 409);
  assert.equal((deleted.body as { errorCode: string }).errorCode, 'RESOURCE_VERSION_CONFLICT');
});

test('CredentialProfile 创建失败时回滚 Secret、版本和审计', async () => {
  const { app, database } = await createTestApp();
  const payload = {
    name: '重复凭据', kind: 'USERNAME_PASSWORD', scopeType: 'global', username: 'admin',
    secretValues: { password: { plainText: 'must-not-remain' } },
  };
  const first = await app.inject({ method: 'POST', path: '/api/v1/credentials', headers: { 'x-tenant-id': 'tenant-rollback', 'x-actor-id': 'user-a' }, body: payload });
  assert.equal(first.statusCode, 201);
  const before = await database.query<{ namespace: string; count: string }>(
    `select namespace, count(*)::text as count from pg_documents
      where namespace in ('security.secrets','security.secret_versions','security.audit_logs')
      group by namespace order by namespace`,
  );

  const duplicated = await app.inject({ method: 'POST', path: '/api/v1/credentials', headers: { 'x-tenant-id': 'tenant-rollback', 'x-actor-id': 'user-a' }, body: payload });
  assert.equal(duplicated.statusCode, 409);
  assert.equal((duplicated.body as { errorCode: string }).errorCode, 'RESOURCE_ALREADY_EXISTS');
  const after = await database.query<{ namespace: string; count: string }>(
    `select namespace, count(*)::text as count from pg_documents
      where namespace in ('security.secrets','security.secret_versions','security.audit_logs')
      group by namespace order by namespace`,
  );
  assert.deepEqual(after.rows, before.rows);
  const credentials = await database.query<{ count: string }>(`select count(*)::text as count from credential_profiles where tenant_id='tenant-rollback'`);
  assert.equal(credentials.rows[0]?.count, '1');
});
