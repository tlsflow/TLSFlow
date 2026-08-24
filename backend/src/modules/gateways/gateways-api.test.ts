import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { createApp } from '../../app.module.js';
import { AuditService } from '../audits/audit.service.js';
import { GatewayTaskAuditWriter, GatewayTaskService } from '../gateway-agents/index.js';
import { GatewaysApplicationService } from './application/gateways.application-service.js';
import { GatewaysController } from './controller/gateways.controller.js';

describe('spec014 Gateway 后端 API', () => {
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
        adapters: ['ssh', 'curl'],
        capabilities: ['adapter.ssh', 'adapter.curl', 'cert.deploy'],
        currentLoad: 1,
        maxConcurrentTasks: 4,
        successRate: 0.97,
      },
    });
    assert.equal(registered.statusCode, 201);
    const gateway = registered.body as { id: string; status: string; zoneIds: string[]; adapters: string[] };
    assert.equal(gateway.status, 'online');
    assert.deepEqual(gateway.zoneIds, ['zone_prod']);
    assert.ok(gateway.adapters.includes('ssh'));

    const list = await app.inject({ method: 'GET', path: '/api/v1/gateways?filter[zoneId]=zone_prod&filter[status]=online', headers });
    assert.equal(list.statusCode, 200);
    const page = list.body as { items: Array<{ id: string }>; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.id, gateway.id);

    const probe = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/probe',
      headers,
      body: { gatewayId: gateway.id, targetId: 'host_001', zoneId: 'zone_prod', protocol: 'ssh', port: 22, status: 'reachable', latencyMs: 25, ttlSeconds: 600 },
    });
    assert.equal(probe.statusCode, 201);
    assert.equal((probe.body as { status: string; gatewayId: string }).status, 'reachable');

    const route = await app.inject({
      method: 'POST',
      path: '/api/v1/gateways/route',
      headers,
      body: { zoneId: 'zone_prod', targetId: 'host_001', protocols: ['ssh'], requiredCapabilities: ['cert.deploy'], destructive: true },
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
      body: { action: 'register', agentId: 'agent_gateway_disabled', zoneIds: ['zone_prod'], version: '1.0.0', adapters: ['ssh'], capabilities: ['adapter.ssh'] },
    });
    const gatewayId = (registered.body as { id: string }).id;
    await app.inject({ method: 'POST', path: '/api/v1/gateways/probe', headers, body: { gatewayId, targetId: 'host_disabled', protocol: 'ssh', ttlSeconds: 600 } });

    const disabled = await app.inject({ method: 'POST', path: '/api/v1/gateways/status', headers, body: { action: 'disable', gatewayId } });
    assert.equal(disabled.statusCode, 200);
    assert.equal((disabled.body as { status: string }).status, 'disabled');

    const route = await app.inject({ method: 'POST', path: '/api/v1/gateways/route', headers, body: { zoneId: 'zone_prod', targetId: 'host_disabled', protocols: ['ssh'] } });
    assert.equal(route.statusCode, 200);
    assert.equal((route.body as { selectedGateway?: unknown }).selectedGateway, undefined);
  });

  it('Gateway 代表执行后可通过目标历史 API 查询谁通过哪个 Gateway 做了什么', async () => {
    const app = new App();
    const gateways = new GatewaysApplicationService();
    new GatewaysController(gateways).register(app.router);
    const gatewayTasks = new GatewayTaskService({
      auditWriter: new GatewayTaskAuditWriter({
        audit: new AuditService(),
        history: gateways.getTargetHistoryRepository(),
      }),
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
      adapter: 'ssh',
      action: 'exec',
      credentialLeaseId: 'grt_gateway_history',
    });
    gatewayTasks.ack(task.id, 'lease_gateway_history');
    gatewayTasks.markRunning(task.id, 'lease_gateway_history');
    gatewayTasks.appendEvidence({
      id: 'gw_evd_history_api',
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      credentialLeaseId: task.credentialLeaseId,
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

    const history = await app.inject({
      method: 'GET',
      path: '/api/v1/gateways/target-history?delegatedTargetId=host_gateway_history',
      headers,
    });
    assert.equal(history.statusCode, 200);
    const body = history.body as { delegatedTargetId: string; items: Array<Record<string, unknown>> };
    assert.equal(body.delegatedTargetId, 'host_gateway_history');
    assert.ok(body.items.length >= 2);
    assert.equal(body.items[0]?.gatewayId, 'gw_gateway_history');
    assert.equal(body.items[0]?.delegatedTargetId, 'host_gateway_history');
    assert.equal(body.items[0]?.adapter, 'ssh');
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
