import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHostApiGrant,
  forbiddenHostApiMethods,
  hostApiRegistry,
  listHostApiMethods,
  validateHostApiRequest,
  validateHostApiPermissions,
  validateHostApiResult,
} from './host-api.registry.js';

const expectedMethods = [
  'cloudService.get', 'artifact.grant.read', 'secret.grant.resolve', 'crypto.sign', 'http.request', 'execution.progress', 'execution.checkpoint.save', 'execution.checkpoint.load',
  'execution.isCancelled', 'resourceLock.acquire', 'resourceLock.release', 'audit.append',
].sort();

test('Host API Registry 覆盖 IPC v1 要求的全部通用方法且没有厂商方法', () => {
  assert.deepEqual(Object.keys(hostApiRegistry).sort(), expectedMethods);
  for (const definition of listHostApiMethods()) {
    assert.ok(definition.requestSchema);
    assert.ok(definition.resultSchema);
    assert.ok(definition.errorSchema);
    assert.ok(definition.permission);
    assert.ok(definition.requiredGrants.length > 0);
    assert.ok(definition.timeoutMs > 0);
    assert.ok(definition.maxOutputBytes > 0);
    assert.ok(definition.auditFields.length > 0);
    if (!definition.readOnly) {
      assert.equal(definition.retryable, false, `${definition.method} 写操作不得静默重试`);
      assert.ok(definition.idempotencyKey);
    }
    assert.ok(!definition.method.includes('provider'));
    assert.ok(!definition.method.includes('product'));
  }
  for (const method of forbiddenHostApiMethods) assert.equal(method in hostApiRegistry, false, method);
});

test('Host API request/result Schema 拒绝未知字段、错误类型和非法结果', () => {
  validateHostApiRequest('cloudService.get', { cloudServiceRef: 'caa-1' });
  validateHostApiRequest('http.request', { url: 'https://example.invalid/api', method: 'GET', headers: {} });
  validateHostApiRequest('artifact.grant.read', { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' });
  validateHostApiRequest('crypto.sign', { grantId: 'grant-1', secretRef: 'secret://private_key/key-1#current', data: 'header.payload', hashAlgorithm: 'SHA-256', signatureAlgorithm: 'ES256' });
  validateHostApiResult('artifact.grant.read', { ok: true, data: { id: 'artifact-1' } });
  assert.throws(() => validateHostApiRequest('artifact.grant.read', { grantId: 'grant-1', artifactRef: 'artifact://artifact-1', secret: 'must-not-pass' }));
  assert.throws(() => validateHostApiRequest('secret.grant.resolve', { grantId: 'grant-1', secretRef: 'secret-1' }));
  assert.throws(() => validateHostApiResult('artifact.grant.read', { ok: 'true' }));
  assert.throws(() => validateHostApiResult('artifact.grant.read', { ok: false }));
  assert.throws(() => validateHostApiResult('artifact.grant.read', { ok: true, error: { code: 'E', message: 'bad', retryable: false, mayBeUnknown: false, secretRedacted: true } }));
  assert.throws(() => validateHostApiResult('artifact.grant.read', { ok: false, data: {}, error: { code: 'E', message: 'bad', retryable: false, mayBeUnknown: false, secretRedacted: true } }));
  assert.throws(() => validateHostApiRequest('database.query', {}));
});

test('Host API Grant 权限和引用缺失时失败关闭', () => {
  assert.doesNotThrow(() => assertHostApiGrant('artifact.grant.read', ['artifact.read'], ['grant-1']));
  assert.throws(() => assertHostApiGrant('artifact.grant.read', [], ['grant-1']), /权限不足/);
  assert.throws(() => assertHostApiGrant('artifact.grant.read', ['artifact.read'], []), /Grant 引用/);
  assert.throws(() => assertHostApiGrant('artifact.grant.read', ['artifact.read'], ['grant-1', 'grant-1']), /重复/);
  assert.doesNotThrow(() => assertHostApiGrant('secret.grant.resolve', ['secret.resolve'], ['grant-1']));
  assert.throws(() => assertHostApiGrant('secret.grant.resolve', ['secret.read'], ['grant-1']));
  assert.throws(() => validateHostApiPermissions(undefined as never), /权限格式/);
  assert.throws(() => validateHostApiPermissions(['artifact.read', 'artifact.read']), /重复/);
  assert.throws(() => assertHostApiGrant('artifact.grant.read', ['artifact.read', 'artifact.read'], ['grant-1']), /重复/);
  assert.throws(() => validateHostApiRequest('certificate.get', { id: 'certificate-1' }));
  assert.throws(() => validateHostApiRequest('http.request', { url: 'http://example.invalid', method: 'GET', headers: {} }));
});

test('Host API JSON Schema 文件保留同一份方法目录', () => {
  const schema = JSON.parse(readFileSync(resolve(process.cwd(), 'src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json'), 'utf8')) as { $defs: { methodCatalog: { properties: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(schema.$defs.methodCatalog.properties).sort(), expectedMethods);
});
