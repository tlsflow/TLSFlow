import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { SecurityServices } from '../security/security.controller.js';

async function createMigratedApp(actorId: string) {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' } }));
  const security = app.getResource<SecurityServices>('securityServices');
  if (!security) throw new Error('测试应用缺少安全服务');
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  return app;
}

describe('Gateway Relay 控制面 API', () => {
  it('Full Agent 携带 Gateway/Relay 字段时必须拒绝，避免与独立 Gateway 合并', async () => {
    const app = await createMigratedApp('full-agent-gateway-rejected');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: testAuthHeaders('full-agent-gateway-rejected', 'tenant-gateway-boundary'),
      body: {
        agentKey: 'full-agent-with-gateway-fields',
        hostname: 'full-agent-with-gateway-fields',
        version: '1.0.0',
        osType: 'linux',
        role: 'full_agent',
        zoneIds: ['zone-prod'],
        adapters: ['relay.tcp'],
        capabilities: ['gateway.relay.tcp'],
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { errorCode?: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('独立 Gateway 注册只保留 relay.tcp 和 gateway.relay.tcp', async () => {
    const app = await createMigratedApp('gateway-register');
    const headers = testAuthHeaders('gateway-register', 'tenant-gateway-register');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'gateway-agent-1',
        hostname: 'gateway-agent-1',
        version: '1.0.0',
        osType: 'linux',
        role: 'gateway',
        zoneIds: ['zone-prod'],
        adapters: ['relay.tcp'],
        capabilities: ['gateway.relay.tcp'],
      },
    });
    assert.equal(response.statusCode, 201);
    const body = response.body as { role: string; gateway?: { adapters: string[]; capabilities: string[] } };
    assert.equal(body.role, 'gateway');
    assert.deepEqual(body.gateway?.adapters, ['relay.tcp']);
    assert.deepEqual(body.gateway?.capabilities, ['gateway.relay.tcp']);
  });

  it('Gateway 状态 API 只接受 relay.tcp 能力并可查询列表', async () => {
    const app = await createMigratedApp('gateway-status');
    const headers = testAuthHeaders('gateway-status', 'tenant-gateway-status');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/status',
      headers,
      body: {
        action: 'register',
        agentId: 'gateway-agent-status',
        zoneIds: ['zone_prod'],
        version: '1.0.0',
        adapters: ['relay.tcp'],
        capabilities: ['gateway.relay.tcp'],
      },
    });
    assert.equal(response.statusCode, 201);
    const gateway = response.body as { id: string; adapters: string[]; capabilities: string[] };
    assert.deepEqual(gateway.adapters, ['relay.tcp']);
    assert.deepEqual(gateway.capabilities, ['gateway.relay.tcp']);

    const list = await app.inject({ method: 'GET', path: '/api/v1/gateways?filter[zoneId]=zone_prod', headers });
    assert.equal(list.statusCode, 200);
    assert.equal((list.body as { items: Array<{ id: string }> }).items.some((item) => item.id === gateway.id), true);
  });

  it('探测和路由接口拒绝旧业务协议，不连接或创建 Agent Task', async () => {
    const app = await createMigratedApp('gateway-old-route-rejected');
    const headers = testAuthHeaders('gateway-old-route-rejected', 'tenant-gateway-old-route');
    const probe = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/probe',
      headers,
      body: { gatewayId: 'gw-unknown', targetId: 'target-unknown', protocol: 'probe.http' },
    });
    assert.equal(probe.statusCode, 404);

    const route = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/route',
      headers,
      body: { zoneId: 'zone_prod', targetId: 'target-unknown', protocols: ['forward.agent_task'] },
    });
    assert.equal(route.statusCode, 400);
    assert.equal((route.body as { errorCode?: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('Relay 路由 OpenAPI 合同只暴露 relay.tcp 和 gateway.relay.tcp', async () => {
    const app = await createMigratedApp('gateway-openapi');
    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/openapi.json',
      headers: testAuthHeaders('gateway-openapi', 'tenant-gateway-openapi'),
    });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as { paths: Record<string, { post?: { requestBody?: unknown } }> }).paths;
    assert.ok(paths['/api/v1/gateways/route']);
    assert.ok(paths['/api/v1/gateways/probe']);
    const serialized = JSON.stringify(paths['/api/v1/gateways/route']);
    assert.match(serialized, /relay\.tcp/u);
    assert.doesNotMatch(serialized, /forward\.agent_task/u);
  });
});
