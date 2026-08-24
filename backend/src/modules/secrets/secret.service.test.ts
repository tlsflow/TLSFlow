import test from 'node:test';
import assert from 'node:assert/strict';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { SecretEntity, SecretVersionEntity } from '../../persistence/entities/secret.entity.js';
import { KeyManager } from './key-manager.service.js';
import { CryptoService } from './crypto.service.js';
import { parseSecretRef } from './secret-ref.js';
import { SecretService } from './secret.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { AuditService } from '../audits/audit.service.js';

test('SecretRef 可以解析 current 和版本号', () => {
  assert.deepEqual(parseSecretRef('secret://ssh_key/sec_123#current'), {
    type: 'ssh_key',
    secretId: 'sec_123',
    version: 'current',
  });
  assert.equal(parseSecretRef('secret://api_token/sec_123#v2').version, 'v2');
  assert.throws(
    () => parseSecretRef('secret://bad/sec_123#v2'),
    (error: any) => error.errorCode === 'SECRET_REF_INVALID',
  );
});

test('CryptoService 加解密正常，篡改 authTag 会失败', () => {
  const crypto = new CryptoService(new KeyManager(Buffer.alloc(32, 7)));
  const encrypted = crypto.encryptSecret('super-secret-token');
  assert.notEqual(encrypted.encryptedData, 'super-secret-token');
  assert.equal(crypto.decryptSecret(encrypted), 'super-secret-token');

  assert.throws(
    () => crypto.decryptSecret({ ...encrypted, authTag: Buffer.alloc(16).toString('base64') }),
    (error: any) => error.errorCode === 'SEC_SECRET_RESOLVE_DENIED',
  );
});

test('SecretService 创建密钥后可通过执行授权解析', async () => {
  const audit = new AuditService();
  const grants = new ExecutionGrantService();
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 1))), grants, audit);
  const created = await service.create({
    tenantId: 'tenant_secret_exec',
    name: '部署 SSH Key',
    type: 'ssh_key',
    scopeType: 'team',
    scopeId: 'team_a',
    plainText: 'PRIVATE_KEY_VALUE',
    createdBy: 'user_admin',
  });

  assert.match(created.secretRef, /^secret:\/\/ssh_key\/sec_/);
  assert.equal(JSON.stringify(created).includes('PRIVATE_KEY_VALUE'), false);

  const versions = await service.listSecretVersions(created.id, 'tenant_secret_exec');
  assert.equal(versions.length, 1);
  assert.equal(JSON.stringify(versions).includes('PRIVATE_KEY_VALUE'), false);
  assert.ok(versions[0].encryptedData);

  const grant = await grants.create({
    tenantId: 'tenant_secret_exec',
    runId: 'run_1',
    stepId: 'step_1',
    executorType: 'ssh',
    allowedSecretRefs: [created.secretRef],
    allowedActions: ['secret.resolve'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const resolved = await service.resolveForExecution({
    secretRef: created.secretRef,
    grantId: grant.id,
    runId: 'run_1',
    stepId: 'step_1',
    executorType: 'ssh',
    purpose: 'secret.resolve',
    actorId: 'user_admin',
  });
  assert.equal(resolved.plainText, 'PRIVATE_KEY_VALUE');
  assert.match(resolved.secretRef, /#v1$/);
  assert.equal((await audit.query({ eventType: 'secret.used' })).length, 1);
});

test('SecretService 在重建后仍可解析持久化 Secret', async () => {
  const db = new PgliteDatabase();
  const secrets = new PgDocumentRepository<SecretEntity>(db, 'security.secrets');
  const versions = new PgDocumentRepository<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>(db, 'security.secret_versions');
  const audit = new AuditService();
  const grants = new ExecutionGrantService();

  const first = new SecretService(new CryptoService(new KeyManager()), grants, audit, secrets, versions);
  const created = await first.create({
    tenantId: 'tenant_secret_persist',
    name: 'LDAP 服务账号密码',
    type: 'password',
    scopeType: 'global',
    plainText: 'ldap-bind-password',
    createdBy: 'user_admin',
  });

  const rebuilt = new SecretService(new CryptoService(new KeyManager()), grants, audit, secrets, versions);
  const resolved = await rebuilt.resolveForService({
    secretRef: created.secretRef,
    tenantId: 'tenant_secret_persist',
    expectedType: 'password',
    purpose: 'ldap.bind',
    actorId: 'user_admin',
  });

  assert.equal(resolved.plainText, 'ldap-bind-password');
  assert.match(resolved.secretRef, /#v1$/);
});

test('SecretService 不为健康检查成功读取写入逐条审计', async () => {
  const audit = new AuditService();
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 3))), new ExecutionGrantService(), audit);
  const created = await service.create({
    tenantId: 'tenant_secret_health',
    name: '健康检查密码',
    type: 'password',
    scopeType: 'global',
    plainText: 'health-check-password',
    createdBy: 'user_admin',
  });

  await service.resolveForService({
    secretRef: created.secretRef,
    tenantId: 'tenant_secret_health',
    expectedType: 'password',
    purpose: 'secret.health_check',
    actorId: 'system',
  });

  assert.equal((await audit.query({ eventType: 'secret.used', resourceType: 'secret', resourceId: created.id })).length, 0);

  await service.resolveForService({
    secretRef: created.secretRef,
    tenantId: 'tenant_secret_health',
    expectedType: 'password',
    purpose: 'ldap.bind',
    actorId: 'user_admin',
  });

  const serviceReadAudits = await audit.query({ eventType: 'secret.used', resourceType: 'secret', resourceId: created.id });
  assert.equal(serviceReadAudits.length, 1);
  assert.equal((serviceReadAudits[0]?.detail as { purpose?: string }).purpose, 'ldap.bind');
});

test('SecretService 支持持久化工作流凭据元数据且列表不泄露明文', async () => {
  const db = new PgliteDatabase();
  const secrets = new PgDocumentRepository<SecretEntity>(db, 'security.secrets.metadata-test');
  const versions = new PgDocumentRepository<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>(db, 'security.secret_versions.metadata-test');
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 2))), new ExecutionGrantService(), new AuditService(), secrets, versions);
  await service.create({
    tenantId: 'tenant_secret_meta',
    name: 'edge-01 root',
    type: 'password',
    scopeType: 'global',
    plainText: 'secret-password',
    createdBy: 'user_admin',
    metadata: {
      workflowCredential: true,
      workflowCredentialKind: 'username_password',
      username: 'deploy',
    },
  });

  const listed = await service.listMetadata('tenant_secret_meta');
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0]?.metadata, {
    workflowCredential: true,
    workflowCredentialKind: 'username_password',
    username: 'deploy',
  });
  assert.equal(JSON.stringify(listed).includes('secret-password'), false);
});

test('SecretService 元数据和版本列表按租户隔离', async () => {
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 4))), new ExecutionGrantService(), new AuditService());
  const tenantA = await service.create({
    tenantId: 'tenant_a',
    name: 'tenant-a password',
    type: 'password',
    scopeType: 'global',
    plainText: 'secret-a',
    createdBy: 'user_admin',
  });
  await service.create({
    tenantId: 'tenant_b',
    name: 'tenant-b password',
    type: 'password',
    scopeType: 'global',
    plainText: 'secret-b',
    createdBy: 'user_admin',
  });

  const listed = await service.listMetadata('tenant_a');
  assert.deepEqual(listed.map((item) => item.id), [tenantA.id]);
  await assert.rejects(
    () => service.getMetadata(tenantA.id, 'tenant_b'),
    (error: any) => error.errorCode === 'SEC_SECRET_NOT_FOUND',
  );
  assert.equal((await service.listSecretVersions(tenantA.id, 'tenant_b')).length, 0);
});

test('SecretService 服务端解析缺少租户上下文时失败关闭', async () => {
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 5))), new ExecutionGrantService(), new AuditService());
  const created = await service.create({
    tenantId: 'tenant_fail_closed',
    name: 'tenant scoped secret',
    type: 'password',
    scopeType: 'global',
    plainText: 'secret-value',
    createdBy: 'user_admin',
  });

  await assert.rejects(
    () => service.resolveForService({
      secretRef: created.secretRef,
      expectedType: 'password',
      purpose: 'provider.test',
      actorId: 'system',
    }),
    (error: any) => error.errorCode === 'SEC_SECRET_RESOLVE_DENIED',
  );
});
