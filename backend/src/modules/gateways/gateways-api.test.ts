import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AuditService } from '../audits/audit.service.js';
import { GatewayTaskAuditWriter, GatewayTaskService } from '../gateway-agents/index.js';
import { GatewaysApplicationService } from './application/gateways.application-service.js';
import { GatewaysController } from './controller/gateways.controller.js';

async function createMigratedApp() {
  const db = new PgliteDatabase();
  await runMigrations(db);
  return createApp({ db, corePersistence: { mode: 'memory' } });
}

describe('spec014 Gateway 后端 API', () => {
  it('Full Agent 启用 Gateway 能力后应同步到 GatewayRegistry', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_gateway_extension', 'x-request-id': 'req_gateway_extension_register' };

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'full_agent.gateway_extension',
        hostname: 'full-agent-gateway-extension',
        version: '0.1.0',
        osType: 'linux',
        role: 'full_agent',
        zone: 'default',
        zoneIds: ['default'],
        adapters: ['probe.tcp', 'probe.http', 'forward.agent_task', 'forward.direct_control'],
        capabilities: ['agent.full.online', 'linux.nginx.deploy_certificate', 'gateway.probe.tcp', 'gateway.forward.agent_task', 'gateway.forward.direct_control'],
        currentLoad: 0,
        maxConcurrentTasks: 4,
        successRate: 1,
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string; role: string; gateway?: { zoneIds: string[]; capabilities: string[] } };
    assert.equal(agent.role, 'full_agent');
    assert.deepEqual(agent.gateway?.zoneIds, ['default']);
    assert.equal(agent.gateway?.capabilities.includes('gateway.forward.agent_task'), true);

    const list = await app.inject({
      method: 'GET',
      path: '/api/v1/gateways?filter[zoneId]=default',
      headers: { ...headers, 'x-request-id': 'req_gateway_extension_list' },
    });
    assert.equal(list.statusCode, 200);
    const page = list.body as { items: Array<{ id: string; agentId: string; zoneIds: string[] }> };
    assert.equal(page.items.some((item) => item.agentId === agent.id), true);
  });

  it('Agent 注册 Gateway 时应允许租户内自定义中文区域并同步到 GatewayRegistry', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_gateway_custom_zone', 'x-request-id': 'req_gateway_custom_zone_register' };

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'full_agent.gateway_custom_zone',
        hostname: 'full-agent-gateway-custom-zone',
        version: '0.1.0',
        osType: 'windows',
        role: 'gateway',
        zone: '数据中心',
        adapters: ['probe.tcp', 'probe.http', 'forward.agent_task', 'forward.direct_control'],
        capabilities: ['gateway.probe.tcp', 'gateway.probe.http', 'gateway.forward.agent_task', 'gateway.forward.direct_control'],
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string; gateway?: { zoneIds: string[] } };
    assert.deepEqual(agent.gateway?.zoneIds, ['数据中心']);

    const list = await app.inject({
      method: 'GET',
      path: `/api/v1/gateways?filter[zoneId]=${encodeURIComponent('数据中心')}`,
      headers: { ...headers, 'x-request-id': 'req_gateway_custom_zone_list' },
    });
    assert.equal(list.statusCode, 200);
    const page = list.body as { items: Array<{ agentId: string; zoneIds: string[] }>; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.agentId, agent.id);
    assert.deepEqual(page.items[0]?.zoneIds, ['数据中心']);

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers: { ...headers, 'x-request-id': 'req_gateway_custom_zone_capabilities' },
      body: {
        agentId: agent.id,
        compatibilityLevel: 'modern',
        capabilities: [
          { capabilityKey: 'gateway.forward.agent_task', value: true, confidence: 0.95 },
          { capabilityKey: 'gateway.forward.direct_control', value: true, confidence: 0.95 },
        ],
        adapters: ['probe.tcp', 'probe.http', 'forward.agent_task', 'forward.direct_control'],
      },
    });
    assert.equal(capabilities.statusCode, 201);
  });

  it('默认 Gateway Zone 应按租户隔离，不能被 default 全局主键卡住', async () => {
    const app = createApp();
    for (const tenant of ['tenant_gateway_default_a', 'tenant_gateway_default_b']) {
      const registered = await app.inject({
        method: 'POST',
        path: '/api/v1/gateways/status',
        headers: { 'x-tenant-id': tenant, 'x-request-id': `req_${tenant}` },
        body: {
          action: 'register',
          agentId: `agent_${tenant}`,
          zoneIds: ['default'],
          version: '1.0.0',
          adapters: ['probe.tcp'],
          capabilities: ['gateway.probe.tcp'],
        },
      });
      assert.equal(registered.statusCode, 201);
      assert.deepEqual((registered.body as { zoneIds: string[] }).zoneIds, ['default']);
    }
  });

  it('支持 Gateway 注册、列表、详情、可达性探测和区域路由', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_gateway', 'x-request-id': 'req_gateway_1' };

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/status',
      headers,
      body: {
        action: 'register',
        agentId: 'agent_gateway_001',
        zoneIds: ['zone_prod'],
        version: '1.0.0',
        adapters: ['probe.tcp', 'probe.http', 'forward.agent_task'],
        capabilities: ['gateway.probe.tcp', 'gateway.probe.http', 'gateway.forward.agent_task'],
        currentLoad: 1,
        maxConcurrentTasks: 4,
        successRate: 0.97,
      },
    });
    assert.equal(registered.statusCode, 201);
    const gateway = registered.body as { id: string; status: string; zoneIds: string[]; adapters: string[] };
    assert.equal(gateway.status, 'online');
    assert.deepEqual(gateway.zoneIds, ['zone_prod']);
    assert.ok(gateway.adapters.includes('probe.tcp'));

    const list = await app.inject({ method: 'GET', path: '/api/v1/gateways?filter[zoneId]=zone_prod&filter[status]=online', headers });
    assert.equal(list.statusCode, 200);
    const page = list.body as { items: Array<{ id: string }>; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.id, gateway.id);

    const probe = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/probe',
      headers,
      body: { gatewayId: gateway.id, targetId: 'host_001', zoneId: 'zone_prod', protocol: 'probe.tcp', port: 22, status: 'reachable', latencyMs: 25, ttlSeconds: 600 },
    });
    assert.equal(probe.statusCode, 201);
    assert.equal((probe.body as { status: string; gatewayId: string }).status, 'reachable');

    const route = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/route',
      headers,
      body: { zoneId: 'zone_prod', targetId: 'host_001', protocols: ['probe.tcp'], requiredCapabilities: ['gateway.forward.agent_task'], destructive: true },
    });
    assert.equal(route.statusCode, 200);
    const routeBody = route.body as { selectedGateway?: { id: string }; candidateGateways: unknown[]; fallbackSuggestions: string[] };
    assert.equal(routeBody.selectedGateway?.id, gateway.id);
    assert.equal(routeBody.candidateGateways.length, 1);
    assert.deepEqual(routeBody.fallbackSuggestions, []);

    const detail = await app.inject({ method: 'GET', path: `/api/v1/gateways/detail?id=${gateway.id}`, headers });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as { gateway: { id: string }; reachability: unknown[] };
    assert.equal(detailBody.gateway.id, gateway.id);
    assert.equal(detailBody.reachability.length, 1);
  });

  it('禁用 Gateway 后不再被路由选中', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_gateway_disabled' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/status',
      headers,
      body: { action: 'register', agentId: 'agent_gateway_disabled', zoneIds: ['zone_prod'], version: '1.0.0', adapters: ['probe.tcp'], capabilities: ['gateway.probe.tcp'] },
    });
    const gatewayId = (registered.body as { id: string }).id;
    await app.inject({ method: 'POST', path: '/api/v1/gateways/probe', headers, body: { gatewayId, targetId: 'host_disabled', protocol: 'probe.tcp', ttlSeconds: 600 } });

    const disabled = await app.inject({ method: 'POST', path: '/api/v1/gateways/status', headers, body: { action: 'disable', gatewayId } });
    assert.equal(disabled.statusCode, 200);
    assert.equal((disabled.body as { status: string }).status, 'disabled');

    const route = await app.inject({ method: 'POST', path: '/api/v1/gateways/route', headers, body: { zoneId: 'zone_prod', targetId: 'host_disabled', protocols: ['probe.tcp'] } });
    assert.equal(route.statusCode, 200);
    assert.equal((route.body as { selectedGateway?: unknown }).selectedGateway, undefined);
  });

  it('Gateway 代表执行后可通过目标历史 API 查询谁通过哪个 Gateway 做了什么', async () => {
    const app = new App();
    const gateways = new GatewaysApplicationService();
    new GatewaysController(gateways).register(app.router);
    const auditWriter = new GatewayTaskAuditWriter({
        audit: new AuditService(),
        history: gateways.getTargetHistoryRepository(),
    });
    const gatewayTasks = new GatewayTaskService({
      auditWriter,
    });
    const headers = { 'x-tenant-id': 'tenant_gateway_history', 'x-actor-id': 'operator_gateway_history' };
    const task = gatewayTasks.dispatch({
      id: 'gateway_task_history_api',
      idempotencyKey: 'idem_gateway_history_api',
      tenantId: 'tenant_gateway_history',
      operatorId: 'operator_gateway_history',
      planId: 'plan_gateway_history',
      executionRunId: 'run_gateway_history',
      stepId: 'step_gateway_history',
      gatewayId: 'gw_gateway_history',
      delegatedTargetId: 'host_gateway_history',
      target: { id: 'host_gateway_history', zoneId: 'zone_prod' },
      adapter: 'forward.agent_task',
      action: 'gateway.forward.agent_task',
    });
    gatewayTasks.ack(task.id, 'lease_gateway_history');
    gatewayTasks.markRunning(task.id, 'lease_gateway_history');
    gatewayTasks.appendEvidence({
      id: 'gw_evd_history_api',
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      evidenceRef: 'backup://host_gateway_history/before',
      kind: 'backup_ref',
      summary: '备份完成',
      metadata: {
        backupRef: 'backup://host_gateway_history/before',
        certificateFingerprint: 'SHA256:history',
        verifyResult: { ok: true },
      },
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'success',
    });
    gatewayTasks.result(task.id, 'lease_gateway_history', { success: true, status: 'success', summary: '执行完成' });
    await auditWriter.flush();

    const history = await app.inject({
      method: 'GET',
      path: '/api/v1/gateways/target-history?delegatedTargetId=host_gateway_history',
      headers,
    });
    assert.equal(history.statusCode, 200);
    const body = history.body as { delegatedTargetId: string; items: Array<Record<string, unknown>> };
    assert.equal(body.delegatedTargetId, 'host_gateway_history');
    assert.ok(body.items.length >= 1);
    assert.equal(body.items[0]?.gatewayId, 'gw_gateway_history');
    assert.equal(body.items[0]?.delegatedTargetId, 'host_gateway_history');
    assert.equal(body.items[0]?.adapter, 'forward.agent_task');
    assert.equal(body.items.some((item) => item.operatorId === 'operator_gateway_history'), true);
    assert.equal(body.items.some((item) => item.result === 'success'), true);
    assert.equal(body.items.some((item) => item.certificateFingerprint === 'SHA256:history'), true);
    assert.equal(body.items.some((item) => item.backupRef === 'backup://host_gateway_history/before'), true);
  });

  it('OpenAPI 包含 Gateway 路由契约', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: { 'x-tenant-id': 'tenant_gateway_openapi' } });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    assert.ok(paths['/api/v1/gateways']);
    assert.ok(paths['/api/v1/gateways/detail']);
    assert.ok(paths['/api/v1/gateways/target-history']);
    assert.ok(paths['/api/v1/gateways/route']);
    assert.ok(paths['/api/v1/gateways/probe']);
    assert.ok(paths['/api/v1/gateways/status']);
  });
});
