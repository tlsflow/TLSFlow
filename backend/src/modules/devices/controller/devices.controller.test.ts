import assert from 'node:assert/strict';
import test from 'node:test';

import type { HttpRequest } from '../../../common/http/http-types.js';
import { Router } from '../../../common/http/router.js';
import { DevicesController } from './devices.controller.js';

test('设备动作入口透传已批准的 TLS 例外授权', async () => {
  const calls: unknown[][] = [];
  const service = {
    executeCapability: async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'success' };
    },
  };
  const router = new Router();
  new DevicesController(service as never).register(router);
  const route = router.match('POST', '/api/v1/devices/device-1/actions');
  assert.ok(route);

  await route.handler(request({
    capabilityKey: 'device.discover',
    authorization: { approved: true, approvalId: 'approval-tls-1' },
  }));

  assert.deepEqual(calls[0], [
    'tenant-1',
    'device-1',
    'device.discover',
    'user-1',
    'request-1',
    { approved: true, approvalId: 'approval-tls-1' },
  ]);
});

test('设备动作入口拒绝伪造或未知授权字段', async () => {
  const service = { executeCapability: async () => ({ status: 'success' }) };
  const router = new Router();
  new DevicesController(service as never).register(router);
  const route = router.match('POST', '/api/v1/devices/device-1/actions');
  assert.ok(route);

  await assert.rejects(
    async () => { await route.handler(request({ capabilityKey: 'device.discover', authorization: { approved: 'true' } })); },
    /authorization\.approved 必须是布尔值/,
  );
  await assert.rejects(
    async () => { await route.handler(request({ capabilityKey: 'device.discover', authorization: { approved: true, grantId: 'forged' } })); },
    /authorization 包含未知字段/,
  );
});

function request(body: unknown): HttpRequest {
  return {
    method: 'POST',
    path: '/api/v1/devices/device-1/actions',
    query: {},
    headers: {},
    body,
    context: { requestId: 'request-1', traceId: 'trace-1', tenantId: 'tenant-1', actorId: 'user-1' },
  };
}
