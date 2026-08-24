import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

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
    assert.equal(duplicateAck.statusCode, 400);

    const result = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers,
      body: { agentId: agent.id, taskId: taskBody.id, leaseId: 'lease_1', success: true, detail: { exitCode: 0 } },
    });
    assert.equal(result.statusCode, 200);
    assert.equal((result.body as { status: string; result: { success: boolean } }).status, 'succeeded');
    assert.equal((result.body as { result: { success: boolean } }).result.success, true);
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
    const plan = await app.inject({ method: 'POST', path: '/api/v1/agents/upgrades/check', headers, body: { agentId: agent.id } });
    assert.equal(plan.statusCode, 200);
    const planBody = plan.body as { id: string; status: string; targetVersion: string };
    assert.equal(planBody.status, 'planned');
    assert.equal(planBody.targetVersion, '1.1.0');
    const result = await app.inject({ method: 'POST', path: '/api/v1/agents/upgrades/result', headers, body: { agentId: agent.id, planId: planBody.id, success: false, rolledBack: true, errorCode: 'UPGRADE_SIGNATURE_INVALID' } });
    assert.equal(result.statusCode, 200);
    assert.equal((result.body as { status: string }).status, 'rolled_back');
  });

  it('OpenAPI 包含 Agent 控制面路由', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: { 'x-tenant-id': 'tenant_agent' } });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    assert.ok(paths['/api/v1/agents/register']);
    assert.ok(paths['/api/v1/agents/enrollment-tokens']);
    assert.ok(paths['/api/v1/agents/sessions']);
    assert.ok(paths['/api/v1/agents/heartbeat']);
    assert.ok(paths['/api/v1/agents/tasks/logs']);
    assert.ok(paths['/api/v1/agents/tasks/result']);
    assert.ok(paths['/api/v1/agents/upgrades/check']);
  });
});
