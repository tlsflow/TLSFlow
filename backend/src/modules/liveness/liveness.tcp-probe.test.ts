import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { probeTcp } from './application/liveness.application-service.js';

test('TCP 管理端口探测成功时立即关闭连接', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await probeTcp('127.0.0.1', address.port, 1_000);
    assert.equal(result.success, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('TCP 管理端口拒绝连接时返回稳定原因码', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const result = await probeTcp('127.0.0.1', address.port, 1_000);
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, 'TCP_CONNECTION_REFUSED');
});
