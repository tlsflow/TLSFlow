import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { AgentExecutorAdapter } from './application/executors.js';

const headers = {
  'x-tenant-id': 'tenant_agent_direct_executor',
  'x-actor-id': 'user_1',
  'x-request-id': 'req_agent_direct_executor',
};

test('AgentExecutorAdapter 直连成功时同步返回且不留下待拉取任务', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/execute') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        taskId: 'direct-task-001',
        detail: {
          mode: 'iis_install_completed',
          oldThumbprint: '1111111111111111111111111111111111111111',
          newThumbprint: '2222222222222222222222222222222222222222',
          rolledBack: false,
          manualRequired: false,
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind direct execute test server');

  const app = createApp();
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-01',
        hostname: 'DIRECT-EXECUTOR-01',
        version: '0.1.0',
        osType: 'windows',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: `127.0.0.1:${address.port}`,
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'windows.iis.deploy_certificate'],
        },
      },
    });
    assert.equal(register.statusCode, 201, JSON.stringify(register.body));
    const agentId = (register.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const adapter = new AgentExecutorAdapter(agentsService);
    const result = await adapter.executeStep({
      step: {
        id: 'stp_direct_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_success',
        deploymentPlanTargetId: 'dpt_direct_success',
        stepNo: 2,
        stepType: 'INSTALL',
        name: 'INSTALL direct success',
        dependsOn: [1],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: {
          executorType: 'AGENT',
          agentId,
          type: 'windows.iis.deploy_certificate',
          providerType: 'IIS',
          siteName: 'Default Web Site',
          bindingSelector: {
            ip: '*',
            port: 443,
            hostHeader: 'direct.example.com',
            bindingInformation: '*:443:direct.example.com',
          },
          expectedDomains: ['direct.example.com'],
          verifyUrl: 'https://direct.example.com:443',
          pfxBase64: 'ZmFrZQ==',
          pfxPassword: 'Secret-123!',
          expectedCertificateFingerprintSha256: 'a'.repeat(64),
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'tester',
        version: 1,
      },
      runType: 'apply',
      dryRun: false,
    });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.asyncPending, undefined);
    assert.equal(result.detail?.mode, 'iis_install_completed');

    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
      headers,
    });
    assert.equal(pulled.statusCode, 200);
    assert.deepEqual(pulled.body, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('AgentExecutorAdapter 直连不可达时回退到轮询任务队列', async () => {
  const app = createApp();
  const register = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'direct-executor-02',
      hostname: 'DIRECT-EXECUTOR-02',
      version: '0.1.0',
      osType: 'windows',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:9',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'windows.iis.deploy_certificate'],
      },
    },
  });
  assert.equal(register.statusCode, 201, JSON.stringify(register.body));
  const agentId = (register.body as { id: string }).id;

  const agentsService = app.getResource('agentsService') as AgentsApplicationService;
  const adapter = new AgentExecutorAdapter(agentsService);
  const result = await adapter.executeStep({
    step: {
      id: 'stp_direct_fallback',
      tenantId: headers['x-tenant-id'],
      executionRunId: 'run_direct_fallback',
      deploymentPlanTargetId: 'dpt_direct_fallback',
      stepNo: 2,
      stepType: 'INSTALL',
      name: 'INSTALL direct fallback',
      dependsOn: [1],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: {
        executorType: 'AGENT',
        agentId,
        type: 'windows.iis.deploy_certificate',
        providerType: 'IIS',
        siteName: 'Default Web Site',
        bindingSelector: {
          ip: '*',
          port: 443,
          hostHeader: 'fallback.example.com',
          bindingInformation: '*:443:fallback.example.com',
        },
        expectedDomains: ['fallback.example.com'],
        verifyUrl: 'https://fallback.example.com:443',
        pfxBase64: 'ZmFrZQ==',
        pfxPassword: 'Secret-123!',
        expectedCertificateFingerprintSha256: 'b'.repeat(64),
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'tester',
      version: 1,
    },
    runType: 'apply',
    dryRun: false,
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.asyncPending, true);
  assert.equal(result.detail?.mode, 'agent_task_enqueued');
  assert.equal((result.detail?.directFallback as { attempted?: boolean } | undefined)?.attempted, true);

  const pulled = await app.inject({
    method: 'GET',
    path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
    headers,
  });
  assert.equal(pulled.statusCode, 200);
  const tasks = pulled.body as Array<{ payload?: { type?: string } }>;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.payload?.type, 'windows.iis.deploy_certificate');
});
