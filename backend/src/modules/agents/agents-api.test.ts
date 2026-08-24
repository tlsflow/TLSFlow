import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createMockSafeAgentCsrPem } from './domain/agents.domain-service.js';

describe('spec011 Agent 控制面协议', () => {
  it('Agent 注册幂等、心跳、能力快照、任务 ack/result 主链路可用', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_agent', 'x-request-id': 'req_agent_1' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: { agentKey: 'agent.prod.01', hostname: 'AGENT-01.EXAMPLE.COM', version: '1.0.0', osType: 'linux', labels: ['prod', 'prod'] },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string; agentKey: string; descriptor: { hostname: string; labels: string[] }; status: string };
    assert.equal(agent.agentKey, 'agent.prod.01');
    assert.equal(agent.descriptor.hostname, 'agent-01.example.com');
    assert.deepEqual(agent.descriptor.labels, ['prod']);
    assert.equal(agent.status, 'ONLINE');

    const repeated = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: { ...headers, 'x-request-id': 'req_agent_2' },
      body: { agentKey: 'agent.prod.01', hostname: 'agent-01.example.com', version: '1.0.1', osType: 'LINUX' },
    });
    assert.equal(repeated.statusCode, 201);
    assert.equal((repeated.body as { id: string }).id, agent.id);

    const heartbeat = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers,
      body: { agentId: agent.id, version: '1.0.1', taskSummary: { running: 1, queued: 2 } },
    });
    assert.equal(heartbeat.statusCode, 200);
    assert.equal((heartbeat.body as { agent: { status: string }; heartbeat: { requestId: string } }).agent.status, 'ONLINE');
    assert.equal((heartbeat.body as { heartbeat: { requestId: string } }).heartbeat.requestId, 'req_agent_1');

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers,
      body: {
        agentId: agent.id,
        compatibilityLevel: 'L1',
        capabilities: [{ capabilityKey: 'ssh.exec', value: true, confidence: 0.95, evidence: { source: 'self-test' } }],
      },
    });
    assert.equal(capabilities.statusCode, 201);
    const projection = capabilities.body as { declarations: Array<{ targetId: string; capabilityKey: string; source: string; auditRef: string }> };
    assert.equal(projection.declarations[0]?.targetId, agent.id);
    assert.equal(projection.declarations[0]?.capabilityKey, 'ssh.exec');
    assert.equal(projection.declarations[0]?.source, 'agent_report');
    assert.equal(projection.declarations[0]?.auditRef, 'req_agent_1');

    const task = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks',
      headers,
      body: { agentId: agent.id, executionRunId: 'run_1', executionStepId: 'step_1', idempotencyKey: 'idem_agent_task_1', payload: { dryRun: true } },
    });
    assert.equal(task.statusCode, 201);
    const taskBody = task.body as { id: string; status: string };
    assert.equal(taskBody.status, 'queued');

    const pulled = await app.inject({ method: 'GET', path: `/api/v1/agents/tasks/pull?agentId=${agent.id}`, headers });
    assert.equal(pulled.statusCode, 200);
    assert.equal((pulled.body as unknown[]).length, 1);

    const ack = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers,
      body: { agentId: agent.id, taskId: taskBody.id, leaseId: 'lease_1' },
    });
    assert.equal(ack.statusCode, 200);
    assert.equal((ack.body as { status: string }).status, 'acked');

    const duplicateAck = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers,
      body: { agentId: agent.id, taskId: taskBody.id, leaseId: 'lease_1' },
    });
    assert.equal(duplicateAck.statusCode, 200);
    assert.equal((duplicateAck.body as { status: string }).status, 'acked');

    const result = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers,
      body: { agentId: agent.id, taskId: taskBody.id, leaseId: 'lease_1', success: true, detail: { exitCode: 0 } },
    });
    assert.equal(result.statusCode, 200);
    assert.equal((result.body as { status: string; result: { success: boolean } }).status, 'succeeded');
    assert.equal((result.body as { result: { success: boolean } }).result.success, true);

    const duplicateResult = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers,
      body: { agentId: agent.id, taskId: taskBody.id, leaseId: 'lease_1', success: true, detail: { exitCode: 0 } },
    });
    assert.equal(duplicateResult.statusCode, 200);
    assert.equal((duplicateResult.body as { status: string }).status, 'succeeded');

    const detail = await app.inject({ method: 'GET', path: `/api/v1/agents/detail?agentId=${agent.id}`, headers });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      agent: { id: string; descriptor: { version: string } };
      lifecycle: { disabled: boolean; revoked: boolean; canPullTasks: boolean };
      latestHeartbeat: { taskSummary: { running: number; queued: number } };
      capabilities: { declarations: unknown[] };
      capabilitySnapshot: { compatibilityLevel: string };
      taskQueue: { counts: { succeeded: number }; tasks: unknown[] };
      upgradeSuggestion: { suggestion: { status: string } };
      recentErrors: unknown[];
    };
    assert.equal(detailBody.agent.id, agent.id);
    assert.equal(detailBody.latestHeartbeat.taskSummary.running, 1);
    assert.equal(detailBody.capabilities.declarations.length, 1);
    assert.equal(detailBody.capabilitySnapshot.compatibilityLevel, 'L1');
    assert.equal(detailBody.taskQueue.counts.succeeded, 1);
    assert.equal(detailBody.lifecycle.canPullTasks, true);
    assert.equal(detailBody.upgradeSuggestion.suggestion.status, 'not_required');

    const rescanTask = await app.inject({
      method: 'POST',
      path: `/api/v1/agents/${agent.id}/rescan`,
      headers: { ...headers, 'x-actor-id': 'ops_rescan' },
    });
    assert.equal(rescanTask.statusCode, 201);
    const rescanBody = rescanTask.body as { id: string; status: string; payload: { type: string; requestedBy: string }; idempotencyKey: string };
    assert.equal(rescanBody.status, 'queued');
    assert.equal(rescanBody.payload.type, 'agent.capability.rescan');
    assert.equal(rescanBody.payload.requestedBy, 'ops_rescan');
    assert.equal(rescanBody.idempotencyKey, `agent.capability.rescan:${agent.id}`);

    const duplicatedRescan = await app.inject({
      method: 'POST',
      path: `/api/v1/agents/${agent.id}/rescan`,
      headers: { ...headers, 'x-actor-id': 'ops_rescan_2', 'x-request-id': 'req_agent_rescan_duplicate' },
    });
    assert.equal(duplicatedRescan.statusCode, 409);
    assert.equal((duplicatedRescan.body as { errorCode: string }).errorCode, 'RESOURCE_ALREADY_EXISTS');

    const capabilityQuery = await app.inject({ method: 'GET', path: `/api/v1/agents/capabilities?agentId=${agent.id}`, headers });
    assert.equal(capabilityQuery.statusCode, 200);
    assert.equal((capabilityQuery.body as { declarations: unknown[] }).declarations.length, 1);

    const queue = await app.inject({ method: 'GET', path: `/api/v1/agents/tasks?agentId=${agent.id}&status=succeeded`, headers });
    assert.equal(queue.statusCode, 200);
    assert.equal((queue.body as { tasks: unknown[]; counts: { succeeded: number } }).tasks.length, 1);
    assert.equal((queue.body as { tasks: unknown[]; counts: { succeeded: number } }).counts.succeeded, 1);

    const disabled = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/disable',
      headers: { ...headers, 'x-actor-id': 'admin_agent' },
      body: { agentId: agent.id, reason: 'host retired', revokeCertificate: true },
    });
    assert.equal(disabled.statusCode, 200);
    const disabledBody = disabled.body as { status: string; disabledAt?: string; disabledBy?: string; disabledReason?: string; revokedAt?: string; certificateRevoked?: boolean };
    assert.equal(disabledBody.status, 'DISABLED');
    assert.equal(disabledBody.disabledBy, 'admin_agent');
    assert.equal(disabledBody.disabledReason, 'host retired');
    assert.equal(disabledBody.certificateRevoked, true);
    assert.ok(disabledBody.revokedAt);

    const disabledDetail = await app.inject({ method: 'GET', path: `/api/v1/agents/detail?agentId=${agent.id}`, headers });
    assert.equal(disabledDetail.statusCode, 200);
    const disabledDetailBody = disabledDetail.body as { lifecycle: { disabled: boolean; revoked: boolean; certificateRevoked: boolean; canHeartbeat: boolean; canPullTasks: boolean } };
    assert.equal(disabledDetailBody.lifecycle.disabled, true);
    assert.equal(disabledDetailBody.lifecycle.revoked, true);
    assert.equal(disabledDetailBody.lifecycle.certificateRevoked, true);
    assert.equal(disabledDetailBody.lifecycle.canHeartbeat, false);
    assert.equal(disabledDetailBody.lifecycle.canPullTasks, false);
  });

  it('同一台 Windows 主机重复安装时，即使 agentKey 变化也应基于 machineId 复用同一条 Agent 记录', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_agent_windows_mid', 'x-request-id': 'req_agent_windows_mid_1' };

    const first = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'winps.install.001',
        machineId: '4d36e967e32511cebfbc08002be10318',
        hostname: 'WIN-SRV-01',
        version: '0.1.0',
        osType: 'windows',
        ipAddress: '10.10.20.30',
        osVersion: '20348.2402',
        role: 'full_agent',
        zone: 'default',
      },
    });
    assert.equal(first.statusCode, 201);
    const firstBody = first.body as { id: string; agentKey: string; descriptor: { ipAddress?: string; machineId?: string } };
    assert.equal(firstBody.agentKey, 'winps.install.001');
    assert.equal(firstBody.descriptor.machineId, '4d36e967e32511cebfbc08002be10318');
    assert.equal(firstBody.descriptor.ipAddress, '10.10.20.30');

    const second = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: { ...headers, 'x-request-id': 'req_agent_windows_mid_2' },
      body: {
        agentKey: 'winps.install.002',
        machineId: '4d36e967e32511cebfbc08002be10318',
        hostname: 'WIN-SRV-01',
        version: '0.1.1',
        osType: 'windows',
        ipAddress: '10.10.20.31',
        osVersion: '20348.2520',
        role: 'full_agent',
        zone: 'default',
      },
    });
    assert.equal(second.statusCode, 201);
    const secondBody = second.body as { id: string; agentKey: string; descriptor: { ipAddress?: string; machineId?: string; version: string } };
    assert.equal(secondBody.id, firstBody.id);
    assert.equal(secondBody.agentKey, 'winps.install.001');
    assert.equal(secondBody.descriptor.machineId, '4d36e967e32511cebfbc08002be10318');
    assert.equal(secondBody.descriptor.ipAddress, '10.10.20.31');
    assert.equal(secondBody.descriptor.version, '0.1.1');
  });

  it('Gateway 注册、心跳、能力上报和禁用状态满足 Spec014', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_gateway', 'x-request-id': 'req_gateway_1' };

    const tokenResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/enrollment-tokens',
      headers,
      body: { allowedRoles: ['gateway'], allowedZones: ['zone_prod'], maxUses: 2, ttlSeconds: 600 },
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = tokenResponse.body as { token: string; allowedRoles: string[] };
    assert.deepEqual(token.allowedRoles, ['gateway']);

    const missingZone = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        enrollmentToken: token.token,
        agentKey: 'gateway.prod.nozone',
        hostname: 'gateway-nozone',
        version: '2.0.0',
        osType: 'linux',
        role: 'gateway',
      },
    });
    assert.equal(missingZone.statusCode, 400);

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        enrollmentToken: token.token,
        agentKey: 'gateway.prod.01',
        hostname: 'gateway-prod-01',
        version: '2.0.0',
        osType: 'linux',
        role: 'gateway',
        zoneIds: ['zone_prod'],
        adapters: ['ssh', 'curl'],
        capabilities: ['host.reachability', 'file.read'],
        resourceLimits: { cpu: 2, password: 'secret-value' },
        currentLoad: 1,
        maxConcurrentTasks: 4,
        successRate: 0.98,
      },
    });
    assert.equal(registered.statusCode, 201);
    const gateway = registered.body as { id: string; role: string; zone: string; gateway: { zoneIds: string[]; adapters: string[]; currentLoad: number; maxConcurrentTasks: number; successRate: number; resourceLimits: Record<string, unknown>; status: string } };
    assert.equal(gateway.role, 'gateway');
    assert.equal(gateway.zone, 'zone_prod');
    assert.deepEqual(gateway.gateway.zoneIds, ['zone_prod']);
    assert.deepEqual(gateway.gateway.adapters, ['ssh', 'curl']);
    assert.equal(gateway.gateway.resourceLimits.password, '[REDACTED]');

    const heartbeat = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers: { ...headers, 'x-request-id': 'req_gateway_heartbeat' },
      body: {
        agentId: gateway.id,
        version: '2.0.1',
        taskSummary: { running: 2, queued: 3 },
        adapters: ['ssh', 'curl', 'winrm'],
        currentLoad: 3,
        maxConcurrentTasks: 5,
        successRate: 0.96,
      },
    });
    assert.equal(heartbeat.statusCode, 200);
    const heartbeatBody = heartbeat.body as { agent: { gateway: { adapters: string[]; currentLoad: number; lastHeartbeatAt: string; status: string } }; heartbeat: { gateway: { currentLoad: number } } };
    assert.deepEqual(heartbeatBody.agent.gateway.adapters, ['ssh', 'curl', 'winrm']);
    assert.equal(heartbeatBody.agent.gateway.currentLoad, 3);
    assert.equal(heartbeatBody.agent.gateway.status, 'online');
    assert.equal(heartbeatBody.heartbeat.gateway.currentLoad, 3);
    assert.ok(heartbeatBody.agent.gateway.lastHeartbeatAt);

    const gatewayList = await app.inject({
      method: 'GET',
      path: '/api/v1/gateways?status=online',
      headers,
    });
    assert.equal(gatewayList.statusCode, 200);
    const gatewayItems = (gatewayList.body as { items: Array<{ id: string; agentId: string; zoneIds: string[]; currentLoad: number }> }).items;
    const registryGateway = gatewayItems.find((item) => item.agentId === gateway.id);
    assert.ok(registryGateway, 'Gateway Agent 注册后必须同步进入 Gateway Registry，不能维护两份事实源');
    assert.deepEqual(registryGateway.zoneIds, ['zone_prod']);
    assert.equal(registryGateway.currentLoad, 3);

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers: { ...headers, 'x-request-id': 'req_gateway_capabilities' },
      body: {
        agentId: gateway.id,
        compatibilityLevel: 'L1',
        adapters: ['ssh'],
        resourceLimits: { memoryMb: 512 },
        currentLoad: 1,
        maxConcurrentTasks: 5,
        successRate: 0.97,
        capabilities: [
          { capabilityKey: 'gateway.task', value: true, confidence: 1, evidence: { source: 'self-test' } },
          { capabilityKey: 'ssh.exec', value: true, confidence: 0.9 },
        ],
      },
    });
    assert.equal(capabilities.statusCode, 201);
    const projection = capabilities.body as { declarations: Array<{ capabilityKey: string; targetId: string }> };
    assert.deepEqual(projection.declarations.map((item) => item.capabilityKey), ['gateway.task', 'ssh.exec']);

    const task = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks',
      headers,
      body: {
        agentId: gateway.id,
        executionRunId: 'run_gateway',
        executionStepId: 'step_gateway',
        idempotencyKey: 'idem_gateway_task_run',
        payload: {
          type: 'gateway.task.run',
          gatewayTask: {
            target: { id: 'host-001', zoneId: 'zone_prod' },
            adapter: 'ssh',
            action: 'command.run',
            payload: { command: 'uptime', token: 'secret-value' },
          },
        },
      },
    });
    assert.equal(task.statusCode, 201);
    const taskBody = task.body as { id: string; payload: { type: string; gatewayTask: { payload: { token: string } } } };
    assert.equal(taskBody.payload.type, 'gateway.task.run');
    assert.equal(taskBody.payload.gatewayTask.payload.token, '[REDACTED]');

    const ack = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, leaseId: 'lease_gateway' },
    });
    assert.equal(ack.statusCode, 200);
    const duplicateAck = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, leaseId: 'lease_gateway' },
    });
    assert.equal(duplicateAck.statusCode, 200);

    const log = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, sequence: 1, message: 'apiKey=secret-value gateway done' },
    });
    assert.equal(log.statusCode, 201);
    const duplicateLog = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, sequence: 1, message: 'apiKey=another-secret' },
    });
    assert.equal(duplicateLog.statusCode, 201);
    assert.equal((duplicateLog.body as { message: string }).message, (log.body as { message: string }).message);
    assert.match((log.body as { message: string }).message, /REDACTED/);

    const result = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, leaseId: 'lease_gateway', success: true, detail: { evidenceRef: 'evidence://run/step', token: 'secret-value' } },
    });
    assert.equal(result.statusCode, 200);
    assert.equal((result.body as { result: { detail: { token: string } } }).result.detail.token, '[REDACTED]');
    const duplicateResult = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers,
      body: { agentId: gateway.id, taskId: taskBody.id, leaseId: 'lease_gateway', success: true, detail: { token: 'changed' } },
    });
    assert.equal(duplicateResult.statusCode, 200);
    assert.equal((duplicateResult.body as { status: string }).status, 'succeeded');

    const disabled = await app.inject({ method: 'POST', path: '/api/v1/agents/disable', headers, body: { agentId: gateway.id } });
    assert.equal(disabled.statusCode, 200);
    assert.equal((disabled.body as { status: string; gateway: { status: string } }).status, 'DISABLED');
    assert.equal((disabled.body as { gateway: { status: string } }).gateway.status, 'disabled');

    const disabledHeartbeat = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers,
      body: { agentId: gateway.id, version: '2.0.2', currentLoad: 0 },
    });
    assert.equal(disabledHeartbeat.statusCode, 400);

    const queuedAfterDisable = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks',
      headers,
      body: { agentId: gateway.id, executionRunId: 'run_gateway_2', executionStepId: 'step_gateway_2', idempotencyKey: 'idem_gateway_disabled', payload: { type: 'gateway.task.run' } },
    });
    assert.equal(queuedAfterDisable.statusCode, 201);
    const pulled = await app.inject({ method: 'GET', path: `/api/v1/agents/tasks/pull?agentId=${gateway.id}`, headers });
    assert.equal(pulled.statusCode, 200);
    assert.deepEqual(pulled.body, []);
  });

  it('注册令牌、mTLS 会话、日志脱敏和升级协议可用', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_agent_secure', 'x-request-id': 'req_agent_secure' };
    const tokenResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/enrollment-tokens',
      headers,
      body: { allowedRoles: ['full_agent'], allowedZones: ['prod'], maxUses: 1, ttlSeconds: 600 },
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = tokenResponse.body as { token: string; tokenHash: string; tokenPreview: string; usedCount: number };
    assert.ok(token.token);
    assert.notEqual(token.token, token.tokenHash);
    assert.ok(token.tokenPreview.includes('...'));

    const fingerprint = 'aa:bb:cc:dd:ee:ff:00:11';
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        enrollmentToken: token.token,
        agentKey: 'agent.secure.01',
        hostname: 'secure-agent',
        version: '1.0.0',
        osType: 'linux',
        role: 'full_agent',
        zone: 'prod',
        certificateFingerprint: fingerprint,
        certificateExpiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string; certificateFingerprint: string };
    assert.equal(agent.certificateFingerprint, 'aabbccddeeff0011');

    const reused = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: { enrollmentToken: token.token, agentKey: 'agent.secure.02', hostname: 'x', version: '1.0.0', osType: 'linux', role: 'full_agent', zone: 'prod' },
    });
    assert.equal(reused.statusCode, 403);

    const session = await app.inject({ method: 'POST', path: '/api/v1/agents/sessions', headers, body: { agentId: agent.id, certificateFingerprint: fingerprint } });
    assert.equal(session.statusCode, 201);
    assert.equal((session.body as { certificateFingerprint: string }).certificateFingerprint, 'aabbccddeeff0011');
    const badSession = await app.inject({ method: 'POST', path: '/api/v1/agents/sessions', headers, body: { agentId: agent.id, certificateFingerprint: '1122334455667788' } });
    assert.equal(badSession.statusCode, 403);

    const task = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks',
      headers,
      body: { agentId: agent.id, executionRunId: 'run_secure', executionStepId: 'step_secure', idempotencyKey: 'idem_secure_task' },
    });
    const taskId = (task.body as { id: string }).id;
    const log = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers,
      body: { agentId: agent.id, taskId, sequence: 1, message: 'token=secret-value deploy ok' },
    });
    assert.equal(log.statusCode, 201);
    assert.equal((log.body as { redacted: boolean; message: string }).redacted, true);
    assert.match((log.body as { message: string }).message, /REDACTED/);

    const release = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/versions',
      headers,
      body: {
        version: '1.1.0',
        platform: 'LINUX',
        downloadUrl: 'https://example.com/agent-1.1.0.tar.gz',
        checksumSha256: 'a'.repeat(64),
        signature: 'sig',
        rollbackVersion: '1.0.0',
      },
    });
    assert.equal(release.statusCode, 201);
    const suggestion = await app.inject({ method: 'GET', path: `/api/v1/agents/upgrades/suggestion?agentId=${agent.id}`, headers });
    assert.equal(suggestion.statusCode, 200);
    assert.equal((suggestion.body as { suggestion: { status: string; targetVersion: string } }).suggestion.status, 'available');
    assert.equal((suggestion.body as { suggestion: { status: string; targetVersion: string } }).suggestion.targetVersion, '1.1.0');

    const plan = await app.inject({ method: 'POST', path: '/api/v1/agents/upgrades/check', headers, body: { agentId: agent.id } });
    assert.equal(plan.statusCode, 200);
    const planBody = plan.body as { id: string; status: string; targetVersion: string };
    assert.equal(planBody.status, 'planned');
    assert.equal(planBody.targetVersion, '1.1.0');
    const result = await app.inject({ method: 'POST', path: '/api/v1/agents/upgrades/result', headers, body: { agentId: agent.id, planId: planBody.id, success: false, rolledBack: true, errorCode: 'UPGRADE_SIGNATURE_INVALID' } });
    assert.equal(result.statusCode, 200);
    assert.equal((result.body as { status: string }).status, 'rolled_back');
  });

  it('CSR 签发、证书轮换/吊销和日志断点续传 cursor 可用', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_agent_cert', 'x-actor-id': 'cert_admin', 'x-request-id': 'req_agent_cert' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: { agentKey: 'agent.cert.01', hostname: 'agent-cert-01', version: '1.0.0', osType: 'linux', role: 'full_agent' },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string };

    const firstCsrPem = createMockSafeAgentCsrPem('agent.cert.01').csrPem;
    const csr = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/certificate-requests',
      headers,
      body: { agentId: agent.id, csrPem: firstCsrPem, requestedTtlDays: 30 },
    });
    assert.equal(csr.statusCode, 201);
    const csrBody = csr.body as { id: string; status: string; csrSha256: string };
    assert.equal(csrBody.status, 'pending');
    assert.match(csrBody.csrSha256, /^[a-f0-9]{64}$/);

    const signed = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/certificates/sign',
      headers,
      body: { agentId: agent.id, csrId: csrBody.id, ttlDays: 30 },
    });
    assert.equal(signed.statusCode, 201);
    const cert = signed.body as { certificate: { id: string; fingerprintSha256: string; certificatePem: string; certificateChainPem: string; status: string } };
    assert.equal(cert.certificate.status, 'active');
    assert.match(cert.certificate.fingerprintSha256, /^[a-f0-9]{64}$/);
    assert.match(cert.certificate.certificatePem, /BEGIN CERTIFICATE/);
    assert.equal((cert.certificate.certificateChainPem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length, 2);

    const session = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/sessions',
      headers,
      body: { agentId: agent.id, certificateFingerprint: cert.certificate.fingerprintSha256 },
    });
    assert.equal(session.statusCode, 201);

    const rotated = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/certificates/rotate',
      headers,
      body: { agentId: agent.id, csrPem: createMockSafeAgentCsrPem('agent.cert.01.rotate').csrPem, ttlDays: 45 },
    });
    assert.equal(rotated.statusCode, 201);
    const rotatedBody = rotated.body as { previousCertificate: { id: string; status: string }; certificate: { id: string; fingerprintSha256: string } };
    assert.equal(rotatedBody.previousCertificate.id, cert.certificate.id);
    assert.equal(rotatedBody.previousCertificate.status, 'rotated');
    assert.notEqual(rotatedBody.certificate.fingerprintSha256, cert.certificate.fingerprintSha256);

    const revoked = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/certificates/revoke',
      headers,
      body: { agentId: agent.id, certificateId: rotatedBody.certificate.id, reason: 'key rotation compromised' },
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal((revoked.body as { status: string; revokedBy: string }).status, 'revoked');
    assert.equal((revoked.body as { status: string; revokedBy: string }).revokedBy, 'cert_admin');

    const listed = await app.inject({ method: 'GET', path: `/api/v1/agents/certificates?agentId=${agent.id}`, headers });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as unknown[]).length, 2);

    const task = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks',
      headers,
      body: { agentId: agent.id, executionRunId: 'run_cursor', executionStepId: 'step_cursor', idempotencyKey: 'idem_cursor' },
    });
    const taskId = (task.body as { id: string }).id;
    const firstBatch = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/log-batches',
      headers,
      body: {
        agentId: agent.id,
        taskId,
        logs: [
          { sequence: 1, message: 'first' },
          { sequence: 3, message: 'third' },
        ],
      },
    });
    assert.equal(firstBatch.statusCode, 200);
    assert.equal((firstBatch.body as { lastAckedSequence: number }).lastAckedSequence, 1);

    const secondBatch = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/log-batches',
      headers,
      body: {
        agentId: agent.id,
        taskId,
        logs: [
          { sequence: 1, message: 'duplicate' },
          { sequence: 2, message: 'second token=secret' },
        ],
      },
    });
    assert.equal(secondBatch.statusCode, 200);
    const ack = secondBatch.body as { duplicateSequences: number[]; lastAckedSequence: number };
    assert.deepEqual(ack.duplicateSequences, [1]);
    assert.equal(ack.lastAckedSequence, 3);

    const cursor = await app.inject({ method: 'GET', path: `/api/v1/agents/tasks/log-cursor?agentId=${agent.id}&taskId=${taskId}`, headers });
    assert.equal(cursor.statusCode, 200);
    assert.equal((cursor.body as { lastAckedSequence: number }).lastAckedSequence, 3);

    const tooOldReplay = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/log-batches',
      headers,
      body: { agentId: agent.id, taskId, logs: [{ sequence: 0, message: 'too old replay' }] },
    });
    assert.equal(tooOldReplay.statusCode, 200);
    assert.deepEqual((tooOldReplay.body as { rejectedSequences: number[] }).rejectedSequences, [0]);
    assert.equal((tooOldReplay.body as { lastAckedSequence: number }).lastAckedSequence, 3);
  });

  it('OpenAPI 包含 Agent 控制面路由', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: { 'x-tenant-id': 'tenant_agent' } });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    assert.ok(paths['/api/v1/agents/register']);
    assert.ok(paths['/api/v1/agents/enrollment-tokens']);
    assert.ok(paths['/api/v1/agents/detail']);
    assert.ok(paths['/api/v1/agents/capabilities']);
    assert.ok(paths['/api/v1/agents/:agentId/rescan']);
    assert.ok(paths['/api/v1/agents/tasks']);
    assert.ok(paths['/api/v1/agents/upgrades/suggestion']);
    assert.ok(paths['/api/v1/agents/disable']);
    assert.ok(paths['/api/v1/agents/sessions']);
    assert.ok(paths['/api/v1/agents/certificate-requests']);
    assert.ok(paths['/api/v1/agents/certificates/sign']);
    assert.ok(paths['/api/v1/agents/certificates/rotate']);
    assert.ok(paths['/api/v1/agents/certificates/revoke']);
    assert.ok(paths['/api/v1/agents/heartbeat']);
    assert.ok(paths['/api/v1/agents/tasks/logs']);
    assert.ok(paths['/api/v1/agents/tasks/log-batches']);
    assert.ok(paths['/api/v1/agents/tasks/log-cursor']);
    assert.ok(paths['/api/v1/agents/tasks/result']);
    assert.ok(paths['/api/v1/agents/upgrades/check']);
  });
});
