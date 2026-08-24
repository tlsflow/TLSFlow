import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from './app.module.js';

describe('应用模块注册', () => {
  it('主应用入口暴露能力、Provider 和监控 API', async () => {
    const app = createApp();
    const headers = { 'x-actor-id': 'user_app', 'x-tenant-id': 'tenant_app', 'x-request-id': 'req_app_modules' };

    const capabilities = await app.inject({ method: 'GET', path: '/api/v1/capabilities/definitions', headers });
    const providers = await app.inject({ method: 'GET', path: '/api/v1/providers', headers });
    const monitors = await app.inject({ method: 'GET', path: '/api/v1/monitors/dashboard', headers });

    assert.equal(capabilities.statusCode, 200);
    assert.equal(providers.statusCode, 200);
    assert.equal(monitors.statusCode, 200);
  });

  it('OpenAPI 契约包含新模块路由', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: { 'x-request-id': 'req_openapi_modules' } });
    const doc = response.body as { paths: Record<string, unknown> };

    assert.equal(response.statusCode, 200);
    assert.ok(doc.paths['/api/v1/capabilities/definitions']);
    assert.ok(doc.paths['/api/v1/providers']);
    assert.ok(doc.paths['/api/v1/monitors/risks']);
  });

  it('主应用入口按 Gateway 持久化配置重建 registry 和 reachability', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'gcac-app-gateway-'));
    try {
      const headers = { 'x-tenant-id': 'tenant_app_gateway_persist', 'x-request-id': 'req_app_gateway_persist' };
      const first = createApp({ gatewayPersistence: { backend: 'file', baseDir } });
      const registered = await first.inject({
        method: 'POST',
        path: '/api/v1/gateways/status',
        headers,
        body: {
          action: 'register',
          agentId: 'agent_app_gateway_persist',
          zoneIds: ['zone_prod'],
          version: '1.0.0',
          adapters: ['ssh'],
          capabilities: ['adapter.ssh'],
        },
      });
      assert.equal(registered.statusCode, 201);
      const gatewayId = (registered.body as { id: string }).id;
      const probe = await first.inject({
        method: 'POST',
        path: '/api/v1/gateways/probe',
        headers,
        body: {
          gatewayId,
          targetId: 'host_app_gateway_persist',
          protocol: 'ssh',
          status: 'reachable',
          ttlSeconds: 600,
        },
      });
      assert.equal(probe.statusCode, 201);

      const rebuilt = createApp({ gatewayPersistence: { backend: 'file', baseDir } });
      const list = await rebuilt.inject({ method: 'GET', path: '/api/v1/gateways?filter[status]=online', headers });
      assert.equal(list.statusCode, 200);
      const page = list.body as { total: number; items: Array<{ id: string; agentId: string }> };
      assert.equal(page.total, 1);
      assert.equal(page.items[0]?.id, gatewayId);
      assert.equal(page.items[0]?.agentId, 'agent_app_gateway_persist');

      const detail = await rebuilt.inject({ method: 'GET', path: `/api/v1/gateways/detail?id=${gatewayId}`, headers });
      assert.equal(detail.statusCode, 200);
      const detailBody = detail.body as { reachability: Array<{ targetId: string; status: string }> };
      assert.equal(detailBody.reachability[0]?.targetId, 'host_app_gateway_persist');
      assert.equal(detailBody.reachability[0]?.status, 'reachable');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
