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
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        accepted: true,
        actionId: 'direct-action-001',
        status: 'running',
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/control/actions/status?actionId=direct-action-001') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        actionId: 'direct-action-001',
        status: 'completed',
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

test('AgentExecutorAdapter 会把 linux.nginx.deploy_certificate 也视为直连优先动作', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        accepted: true,
        actionId: 'direct-action-nginx-001',
        status: 'running',
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/control/actions/status?actionId=direct-action-nginx-001') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        actionId: 'direct-action-nginx-001',
        status: 'completed',
        detail: {
          mode: 'nginx_dry_run_preflight',
          executable: false,
          blockers: [{ code: 'WRITE_PERMISSION_DENIED' }],
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind nginx direct execute test server');

  const app = createApp();
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-nginx-01',
        hostname: 'DIRECT-EXECUTOR-NGINX-01',
        version: '0.1.0',
        osType: 'linux',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: `127.0.0.1:${address.port}`,
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'linux.nginx.deploy_certificate'],
        },
      },
    });
    assert.equal(register.statusCode, 201, JSON.stringify(register.body));
    const agentId = (register.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const adapter = new AgentExecutorAdapter(agentsService);
    const result = await adapter.executeStep({
      step: {
        id: 'stp_direct_nginx_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_nginx_success',
        deploymentPlanTargetId: 'dpt_direct_nginx_success',
        stepNo: 1,
        stepType: 'DISCOVER',
        name: 'DISCOVER direct nginx success',
        dependsOn: [],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: {
          executorType: 'AGENT',
          agentId,
          type: 'linux.nginx.deploy_certificate',
          providerType: 'NGINX',
          operation: 'dryRun',
          bindingSelector: {
            certPath: '/etc/nginx/certs/site.pem',
            keyPath: '/etc/nginx/certs/site.key',
            listenPort: 443,
            serverNames: ['direct-nginx.example.com'],
          },
          artifact: {
            certificatePem: '-----BEGIN CERTIFICATE-----\\nfake\\n-----END CERTIFICATE-----\\n',
            privateKeyPem: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n',
            targetFingerprintSha256: 'c'.repeat(64),
          },
          executionPolicy: {
            testCommand: 'nginx -t',
            reloadCommand: 'nginx -s reload',
            verifyHost: 'direct-nginx.example.com',
            verifyPort: 443,
          },
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'tester',
        version: 1,
      },
      runType: 'dry_run',
      dryRun: true,
    });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.asyncPending, undefined);
    assert.equal(result.detail?.mode, 'nginx_dry_run_preflight');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('AgentExecutorAdapter 在新直连协议缺失时会回退旧的 actions/execute', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/execute') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        taskId: 'legacy-direct-task-001',
        detail: {
          mode: 'legacy_direct_execute',
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind legacy direct execute test server');

  const app = createApp();
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-legacy-01',
        hostname: 'DIRECT-EXECUTOR-LEGACY-01',
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
        id: 'stp_direct_legacy_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_legacy_success',
        deploymentPlanTargetId: 'dpt_direct_legacy_success',
        stepNo: 2,
        stepType: 'INSTALL',
        name: 'INSTALL direct legacy success',
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
            hostHeader: 'legacy.example.com',
            bindingInformation: '*:443:legacy.example.com',
          },
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
    assert.equal(result.detail?.mode, 'legacy_direct_execute');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
