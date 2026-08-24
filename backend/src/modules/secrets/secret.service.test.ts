import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyManager } from './key-manager.service.js';
import { CryptoService } from './crypto.service.js';
import { parseSecretRef } from './secret-ref.js';
import { SecretService } from './secret.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { AuditService } from '../audits/audit.service.js';

test('SecretRef 能解析 current 和具体版本', () => {
  assert.deepEqual(parseSecretRef('secret://ssh_key/sec_123#current'), {
    type: 'ssh_key',
    secretId: 'sec_123',
    version: 'current',
  });
  assert.equal(parseSecretRef('secret://api_token/sec_123#v2').version, 'v2');
  assert.throws(() => parseSecretRef('secret://bad/sec_123#v2'), (error: any) => error.errorCode === 'SECRET_REF_INVALID');
});

test('CryptoService 信封加密不泄露明文，篡改 authTag 后不能解密', () => {
  const crypto = new CryptoService(new KeyManager(Buffer.alloc(32, 7)));
  const encrypted = crypto.encryptSecret('super-secret-token');
  assert.notEqual(encrypted.encryptedData, 'super-secret-token');
  assert.equal(crypto.decryptSecret(encrypted), 'super-secret-token');

  assert.throws(() => crypto.decryptSecret({ ...encrypted, authTag: Buffer.alloc(16).toString('base64') }), (error: any) => error.errorCode === 'SEC_SECRET_RESOLVE_DENIED');
});

test('SecretService 创建只返回 SecretRef，解析必须有匹配 Grant 且写审计', () => {
  const audit = new AuditService();
  const grants = new ExecutionGrantService();
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 1))), grants, audit);
  const created = service.create({
    name: '生产 SSH Key',
    type: 'ssh_key',
    scopeType: 'team',
    scopeId: 'team_a',
    plainText: 'PRIVATE_KEY_VALUE',
    createdBy: 'user_admin',
  });

  assert.match(created.secretRef, /^secret:\/\/ssh_key\/sec_/);
  assert.equal(JSON.stringify(created).includes('PRIVATE_KEY_VALUE'), false);

  const versions = service.listSecretVersions(created.id);
  assert.equal(versions.length, 1);
  assert.equal(JSON.stringify(versions).includes('PRIVATE_KEY_VALUE'), false);
  assert.ok(versions[0].encryptedData);

  const grant = grants.create({
    runId: 'run_1',
    stepId: 'step_1',
    executorType: 'ssh',
    allowedSecretRefs: [created.secretRef],
    allowedActions: ['secret.resolve'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const resolved = service.resolveForExecution({
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
  assert.equal(audit.query({ eventType: 'secret.used' }).length, 1);
});
