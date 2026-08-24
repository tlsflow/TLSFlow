import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryHttp01Responder } from './http-01.responder.js';

test('HTTP-01 responder 可以读取已呈现的 keyAuthorization', async () => {
  const responder = new InMemoryHttp01Responder();

  await responder.present({
    tenantId: 'tenant-1',
    identifier: 'example.com',
    token: 'token-1',
    keyAuthorization: 'token-1.thumbprint',
    presentationId: 'presentation-1',
    actorId: 'worker-1',
  });

  assert.equal(responder.read('token-1'), 'token-1.thumbprint');
});

test('HTTP-01 responder 只允许匹配当前租户和呈现记录的清理操作', async () => {
  const responder = new InMemoryHttp01Responder();
  const input = {
    tenantId: 'tenant-1',
    identifier: 'example.com',
    token: 'token-1',
    keyAuthorization: 'token-1.thumbprint',
    presentationId: 'presentation-1',
    actorId: 'worker-1',
  };
  await responder.present(input);

  await responder.cleanup({ ...input, tenantId: 'tenant-2' });
  assert.equal(responder.read(input.token), input.keyAuthorization);

  await responder.cleanup(input);
  assert.equal(responder.read(input.token), undefined);
});

test('HTTP-01 responder 会清理过期的验证材料', async () => {
  const responder = new InMemoryHttp01Responder();
  const input = {
    tenantId: 'tenant-1',
    identifier: 'example.com',
    token: 'token-1',
    keyAuthorization: 'token-1.thumbprint',
    presentationId: 'presentation-1',
    actorId: 'worker-1',
  };
  await responder.present(input);
  assert.equal(responder.read(input.token), input.keyAuthorization);

  const realNow = Date.now;
  const presentAt = realNow();
  Date.now = () => presentAt + 600_001;
  try {
    assert.equal(responder.read(input.token), undefined);
  } finally {
    Date.now = realNow;
  }
});
