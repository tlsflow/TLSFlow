import assert from 'node:assert/strict';
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
});
