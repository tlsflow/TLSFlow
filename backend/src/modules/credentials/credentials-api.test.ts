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
  const app = new App({ allowLegacyHeaderContext: true });
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

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credential.id, name: 'ADC 主凭据', username: 'administrator', secretValues: { password: { plainText: 'rotated-password' } }, expectedVersion: 1 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal((updated.body as Record<string, unknown>).id, credential.id);
  assert.equal((updated.body as Record<string, unknown>).name, 'ADC 主凭据');
  assert.equal((updated.body as Record<string, unknown>).username, 'administrator');
  assert.equal((updated.body as Record<string, unknown>).version, 2);
  assert.equal(JSON.stringify(updated.body).includes('rotated-password'), false);
  const secretVersions = await database.query<{ count: string }>(
    `select count(*)::text as count from pg_documents where namespace='security.secret_versions' and payload->>'secretId'=$1`,
    [passwordRef.split('/')[3]?.split('#')[0]],
  );
  assert.equal(secretVersions.rows[0]?.count, '2');

  const listed = await app.inject({
    method: 'GET',
    path: '/api/v1/credentials?search=ADC',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal((listed.body as { total: number }).total, 1);

  const renamed = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credential.id, name: 'ADC 主凭据', expectedVersion: 2 },
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal((renamed.body as Record<string, unknown>).version, 3);

  const disabled = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials/status',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credential.id, status: 'disabled', expectedVersion: 3 },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal((disabled.body as Record<string, unknown>).status, 'disabled');

  const deleted = await app.inject({
    method: 'DELETE',
    path: '/api/v1/credentials/delete',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credential.id },
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.body, { id: credential.id, deleted: true });
});

test('全局凭据 API 保存有效期，空值表示长期有效', async () => {
  const { app, database } = await createTestApp();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-expiry', 'x-actor-id': 'user-expiry' },
    body: {
      name: '有期限令牌',
      kind: 'BEARER_TOKEN',
      scopeType: 'global',
      expiresAt,
      secretValues: { token: { plainText: 'expiry-token' } },
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal((created.body as Record<string, unknown>).expiresAt, expiresAt);

  const cleared = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-expiry', 'x-actor-id': 'user-expiry' },
    body: { id: (created.body as Record<string, unknown>).id, expiresAt: null, expectedVersion: 1 },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal((cleared.body as Record<string, unknown>).expiresAt, undefined);

  const stored = await database.query<{ expires_at: string | null }>(
    'select expires_at from credential_profiles where id=$1',
    [(created.body as Record<string, unknown>).id],
  );
  assert.equal(stored.rows[0]?.expires_at, null);
});

test('全局凭据 API 支持创建 DNS Provider 配置', async () => {
  const { app, database } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-dns', 'x-actor-id': 'user-dns' },
    body: {
      name: 'Cloudflare DNS',
      kind: 'DNS_PROVIDER',
      scopeType: 'global',
      metadata: { providerId: 'cloudflare' },
      secretValues: {
        config: {
          plainText: 'dns_cloudflare_api_token = test-token',
          type: 'password',
        },
      },
    },
  });

  assert.equal(created.statusCode, 201);
  const credential = created.body as Record<string, unknown>;
  assert.equal(credential.kind, 'DNS_PROVIDER');
  assert.match(String((credential.secretSlots as Record<string, string>).config), /^secret:\/\/password\//);
  assert.equal(JSON.stringify(credential).includes('test-token'), false);

  const stored = await database.query<{ kind: string }>(
    'select kind from credential_profiles where id = $1',
    [credential.id],
  );
  assert.equal(stored.rows[0]?.kind, 'DNS_PROVIDER');
});

test('全局凭据 API 支持创建待浏览器获取的 BROWSER_SESSION', async () => {
  const { app } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-browser', 'x-actor-id': 'user-browser' },
    body: {
      name: 'GCAC Web 浏览器会话',
      kind: 'BROWSER_SESSION',
      scopeType: 'global',
      metadata: {
        outputContract: {
          version: 'credential.output/v1',
          parameters: {},
        },
      },
      secretValues: {},
    },
  });

  assert.equal(created.statusCode, 201);
  const credential = created.body as Record<string, unknown>;
  assert.equal(credential.kind, 'BROWSER_SESSION');
  assert.deepEqual(credential.secretSlots, {});
  assert.deepEqual((credential.metadata as Record<string, unknown>).outputContract, {
    version: 'credential.output/v1',
    parameters: {},
  });
});

test('BROWSER_SESSION 更新时按新的输出合同校验并保存 Secret Slot', async () => {
  const { app } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-browser-contract', 'x-actor-id': 'user-browser-contract' },
    body: {
      name: 'GCAC Web 浏览器会话合同测试',
      kind: 'BROWSER_SESSION',
      scopeType: 'global',
      metadata: {
        outputContract: {
          version: 'credential.output/v1',
          parameters: {},
        },
      },
      secretValues: {},
    },
  });
  assert.equal(created.statusCode, 201);
  const credential = created.body as Record<string, unknown>;
  const outputContract = {
    version: 'credential.output/v1',
    parameters: {
      token: { required: true, secretType: 'api_token' },
      sessionId: { required: true, secretType: 'session_id' },
    },
  };

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-browser-contract', 'x-actor-id': 'user-browser-contract' },
    body: {
      id: credential.id,
      expectedVersion: 1,
      metadata: { outputContract },
      secretValues: {
        token: { plainText: 'browser-token', type: 'api_token' },
        sessionId: { plainText: 'browser-session-id', type: 'session_id' },
      },
    },
  });

  assert.equal(updated.statusCode, 200);
  const saved = updated.body as Record<string, unknown>;
  assert.equal(saved.id, credential.id);
  assert.deepEqual(Object.keys(saved.secretSlots as Record<string, string>).sort(), ['sessionId', 'token']);
  assert.deepEqual((saved.metadata as Record<string, unknown>).outputContract, outputContract);
  assert.equal(JSON.stringify(saved).includes('browser-token'), false);
  assert.equal(JSON.stringify(saved).includes('browser-session-id'), false);

  const invalid = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-browser-contract', 'x-actor-id': 'user-browser-contract' },
    body: {
      id: credential.id,
      expectedVersion: 2,
      metadata: { outputContract },
      secretValues: { cookie: { plainText: 'unexpected-cookie', type: 'password' } },
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((invalid.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
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
    headers: { 'x-tenant-id': 'tenant-b', 'x-actor-id': 'user-b' },
  });
  assert.equal(foreign.statusCode, 404);

  const conflict = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { id: credentialId, name: '冲突更新', expectedVersion: 9 },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal((conflict.body as { errorCode: string }).errorCode, 'RESOURCE_VERSION_CONFLICT');
});

test('修复完整的异常凭据后自动转为停用而不是继续残留异常', async () => {
  const { app, database } = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-repair', 'x-actor-id': 'user-a' },
    body: {
      name: '待修复凭据',
      kind: 'USERNAME_PASSWORD',
      scopeType: 'global',
      username: 'admin',
      secretValues: { password: { plainText: 'initial-password' } },
    },
  });
  assert.equal(created.statusCode, 201);
  const credential = created.body as Record<string, unknown>;
  await database.query('update credential_profiles set status=$1 where id=$2', ['error', credential.id]);

  const repaired = await app.inject({
    method: 'PATCH',
    path: '/api/v1/credentials',
    headers: { 'x-tenant-id': 'tenant-repair', 'x-actor-id': 'user-a' },
    body: { id: credential.id, username: 'administrator', expectedVersion: 1 },
  });
  assert.equal(repaired.statusCode, 200);
  assert.equal((repaired.body as Record<string, unknown>).status, 'disabled');
  assert.equal((repaired.body as Record<string, unknown>).version, 2);

  const enabled = await app.inject({
    method: 'POST',
    path: '/api/v1/credentials/status',
    headers: { 'x-tenant-id': 'tenant-repair', 'x-actor-id': 'user-a' },
    body: { id: credential.id, status: 'active', expectedVersion: 2 },
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal((enabled.body as Record<string, unknown>).status, 'active');
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
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
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
      id, tenant_id, plugin_version_id, mode, input_bindings, status, version, created_at, updated_at
    ) values (
      'plgb_usage', 'tenant-usage', 'plgv_usage', 'STANDALONE', $1::jsonb,
      'ACTIVE', 1, now(), now()
    )`,
    [JSON.stringify({
      apiVersion: 'gcac.input-bindings/v1',
      variables: {},
      connections: {},
      credentials: { management: { credentialId } },
      artifacts: {},
    })],
  );

  const usage = await app.inject({
    method: 'GET',
    path: `/api/v1/credentials/usage?id=${credentialId}`,
    headers: { 'x-tenant-id': 'tenant-usage', 'x-actor-id': 'user-a' },
  });
  assert.equal(usage.statusCode, 200);
  assert.equal((usage.body as { total: number }).total, 1);

  const deleted = await app.inject({
    method: 'DELETE',
    path: '/api/v1/credentials/delete',
    headers: { 'x-tenant-id': 'tenant-usage', 'x-actor-id': 'user-a' },
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
