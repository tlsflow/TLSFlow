import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';
import { CredentialsApplicationService } from './application/credentials.application-service.js';
import { RuntimeCredentialResolver } from './application/runtime-credential-resolver.js';
import { CredentialsRepository } from './repository/credentials.repository.js';

test('部署计划凭据快照固定 CredentialProfile 和 Secret 精确版本', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const security = createPersistedSecurityServices(database).services;
  const repository = new CredentialsRepository(database);
  const application = new CredentialsApplicationService(repository, undefined, database, security.secrets);
  const created = await application.create('tenant-plan', 'user-a', {
    name: '计划凭据',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    username: 'admin',
    secretValues: { password: { plainText: 'version-one' } },
  }, { tenantId: 'tenant-plan' });
  const resolver = new RuntimeCredentialResolver(repository, security.secrets);

  const first = await resolver.resolveBindingsForPlan('tenant-plan', { management: { credentialId: created.id } });
  assert.match(first.management!.secretRefs.password!, /#v1$/);
  assert.equal(first.management!.credentialVersionId, '1');

  await application.rotate('tenant-plan', created.id, 'user-a', {
    expectedVersion: 1,
    secretValues: { password: { plainText: 'version-two' } },
  }, { tenantId: 'tenant-plan' });
  const second = await resolver.resolveBindingsForPlan('tenant-plan', { management: { credentialId: created.id } });
  assert.match(second.management!.secretRefs.password!, /#v2$/);
  assert.equal(second.management!.credentialVersionId, '2');
  assert.notEqual(second.management!.snapshotSha256, first.management!.snapshotSha256);
  assert.match(first.management!.secretRefs.password!, /#v1$/);
});

test('部署计划凭据快照兼容租户凭据引用历史全局 Secret', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const security = createPersistedSecurityServices(database).services;
  const repository = new CredentialsRepository(database);
  const resolver = new RuntimeCredentialResolver(repository, security.secrets);
  const secret = await security.secrets.create({
    name: '历史全局 Secret',
    type: 'password',
    scopeType: 'global',
    plainText: 'legacy-global-secret',
    createdBy: 'system',
  }, { tenantId: 'tenant-plan' });
  const now = new Date().toISOString();
  await repository.save({
    id: 'cred_global_secret_cutover',
    tenantId: 'tenant-plan',
    name: '历史迁移凭据',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    username: 'admin',
    secretSlots: { password: secret.secretRef },
    metadata: {},
    status: 'active',
    version: 1,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  });

  const resolved = await resolver.resolveBindingsForPlan('tenant-plan', { management: { credentialId: 'cred_global_secret_cutover' } });
  assert.match(resolved.management!.secretRefs.password!, /#v1$/);
  assert.equal(resolved.management!.credentialVersionId, '1');
});

test('PASSWORD Credential 可在部署前解析明文，但不会进入运行时凭据快照', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const security = createPersistedSecurityServices(database).services;
  const repository = new CredentialsRepository(database);
  const application = new CredentialsApplicationService(repository, undefined, database, security.secrets);
  const created = await application.create('tenant-password', 'user-a', {
    name: 'Tomcat KeyStore 密码',
    kind: 'PASSWORD',
    scopeType: 'global',
    secretValues: { password: { plainText: 'tomcat-current-password' } },
  }, { tenantId: 'tenant-password' });
  const resolver = new RuntimeCredentialResolver(repository, security.secrets);

  const runtime = await resolver.resolve('tenant-password', created.id);
  assert.equal(runtime.kind, 'PASSWORD');
  assert.deepEqual(runtime.secretRefs, { password: created.secretSlots.password });
  assert.equal(JSON.stringify(runtime).includes('tomcat-current-password'), false);
  assert.equal(await resolver.resolveSecretValue('tenant-password', created.id), 'tomcat-current-password');
});

test('显式 keystorePassword Credential 的错误类型不会回退到 Agent 自动读取', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const security = createPersistedSecurityServices(database).services;
  const repository = new CredentialsRepository(database);
  const application = new CredentialsApplicationService(repository, undefined, database, security.secrets);
  const created = await application.create('tenant-password', 'user-a', {
    name: '错误类型',
    kind: 'API_KEY',
    scopeType: 'global',
    delivery: { location: 'header', name: 'X-Key' },
    secretValues: { token: { plainText: 'not-a-keystore-password' } },
  }, { tenantId: 'tenant-password' });
  const resolver = new RuntimeCredentialResolver(repository, security.secrets);

  await assert.rejects(
    () => resolver.resolveSecretValue('tenant-password', created.id),
    (error: any) => error?.errorCode === 'VALIDATION_FAILED' && /Tomcat KeyStore 密码 Credential 类型/.test(error.message),
  );
});
