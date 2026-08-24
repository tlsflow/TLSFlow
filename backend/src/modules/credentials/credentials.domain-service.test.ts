import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { CredentialsDomainService } from './domain/credentials.domain-service.js';
import { CredentialsRepository } from './repository/credentials.repository.js';

test('用户名密码凭据规范化并通过 Repository 往返', async () => {
  const domain = new CredentialsDomainService();
  const entity = domain.normalizeCreate('tenant-1', 'user-1', {
    name: 'Citrix ADC 管理凭据',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    username: 'nsroot',
    secretSlots: { password: 'secret://password/sec-adc#current' },
  }, { id: 'cred-1', now: '2026-07-26T00:00:00.000Z' });
  assert.equal(entity.username, 'nsroot');
  assert.equal(entity.secretSlots.password, 'secret://password/sec-adc#current');

  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const repository = new CredentialsRepository(db);
  await repository.save(entity);
  assert.deepEqual(await repository.get('tenant-1', 'cred-1'), entity);
});

test('CredentialProfile 拒绝缺失用户名、非法作用域和错误 Secret 类型', () => {
  const domain = new CredentialsDomainService();
  assert.throws(() => domain.normalizeCreate('tenant-1', 'user-1', {
    name: '缺少用户名', kind: 'USERNAME_PASSWORD', scopeType: 'global',
    secretSlots: { password: 'secret://password/sec-1#current' },
  }, { id: 'cred-1', now: '2026-07-26T00:00:00.000Z' }));
  assert.throws(() => domain.normalizeCreate('tenant-1', 'user-1', {
    name: '缺少作用域', kind: 'BEARER_TOKEN', scopeType: 'host',
    secretSlots: { token: 'secret://api_token/sec-1#current' },
  }, { id: 'cred-2', now: '2026-07-26T00:00:00.000Z' }));
  assert.throws(() => domain.normalizeCreate('tenant-1', 'user-1', {
    name: '类型错误', kind: 'BEARER_TOKEN', scopeType: 'global',
    secretSlots: { token: 'secret://password/sec-1#current' },
  }, { id: 'cred-3', now: '2026-07-26T00:00:00.000Z' }));
});

test('API Key 必须声明投递位置和名称', () => {
  const domain = new CredentialsDomainService();
  assert.throws(() => domain.normalizeCreate('tenant-1', 'user-1', {
    name: 'API Key', kind: 'API_KEY', scopeType: 'global',
    secretSlots: { token: 'secret://api_token/sec-1#current' },
  }, { id: 'cred-1', now: '2026-07-26T00:00:00.000Z' }));
  const entity = domain.normalizeCreate('tenant-1', 'user-1', {
    name: 'API Key', kind: 'API_KEY', scopeType: 'global',
    delivery: { location: 'header', name: 'X-API-Key' },
    secretSlots: { token: 'secret://api_token/sec-1#current' },
  }, { id: 'cred-1', now: '2026-07-26T00:00:00.000Z' });
  assert.deepEqual(entity.delivery, { location: 'header', name: 'X-API-Key' });
});

test('CLOUD_PROVIDER 按 Provider 固定校验密钥槽位', () => {
  const domain = new CredentialsDomainService();
  const entity = domain.normalizeCreate('tenant-1', 'user-1', {
    name: '厂商凭据', kind: 'CLOUD_PROVIDER', scopeType: 'global',
    metadata: { providerKey: 'cloud.aliyun' },
    secretSlots: {
      accessKeyId: 'secret://api_token/sec-1#current',
      accessKeySecret: 'secret://api_token/sec-2#current',
    },
  }, { id: 'cred-1', now: '2026-08-06T00:00:00.000Z' });
  assert.deepEqual(Object.keys(entity.secretSlots).sort(), ['accessKeyId', 'accessKeySecret']);
  assert.throws(() => domain.normalizeCreate('tenant-1', 'user-1', {
    name: '非法厂商凭据', kind: 'CLOUD_PROVIDER', scopeType: 'global',
    metadata: { providerKey: 'cloud.example' },
    secretSlots: {
      accessKeyId: 'secret://api_token/sec-1#current',
      accessKeySecret: 'secret://api_token/sec-2#current',
    },
  }, { id: 'cred-2', now: '2026-08-06T00:00:00.000Z' }), (error: any) => error.errorCode === 'VALIDATION_FAILED');
});

test('BROWSER_SESSION 凭据允许先创建空输出合同，等待浏览器获取填充', () => {
  const domain = new CredentialsDomainService();
  const entity = domain.normalizeCreate('tenant-browser', 'user-browser', {
    name: 'GCAC Web 浏览器会话',
    kind: 'BROWSER_SESSION',
    scopeType: 'global',
    metadata: {
      outputContract: {
        version: 'credential.output/v1',
        parameters: {},
      },
    },
    secretSlots: {},
  }, { id: 'cred-browser-1', now: '2026-08-07T00:00:00.000Z' });

  assert.equal(entity.kind, 'BROWSER_SESSION');
  assert.deepEqual(entity.secretSlots, {});
  assert.deepEqual(entity.metadata, {
    outputContract: {
      version: 'credential.output/v1',
      parameters: {},
    },
  });
});
