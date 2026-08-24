import test from 'node:test';
import assert from 'node:assert/strict';
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

test('SecretService 创建密钥后可通过授权引用解析', async () => {
  const audit = new AuditService();
  const grants = new ExecutionGrantService();
  const service = new SecretService(new CryptoService(new KeyManager(Buffer.alloc(32, 1))), grants, audit);
  const created = await service.create({
    name: '部署 SSH Key',
    type: 'ssh_key',
    scopeType: 'team',
    scopeId: 'team_a',
    plainText: 'PRIVATE_KEY_VALUE',
    createdBy: 'user_admin',
  });

  assert.match(created.secretRef, /^secret:\/\/ssh_key\/sec_/);
  assert.equal(JSON.stringify(created).includes('PRIVATE_KEY_VALUE'), false);

  const versions = await service.listSecretVersions(created.id);
  assert.equal(versions.length, 1);
  assert.equal(JSON.stringify(versions).includes('PRIVATE_KEY_VALUE'), false);
  assert.ok(versions[0].encryptedData);

  const grant = await grants.create({
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
