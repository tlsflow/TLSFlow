import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { describe, it } from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { AgentDirectClient } from './agent-direct-client.js';

describe('AgentDirectClient', () => {
  it('持久化能力列表过期时使用 Agent 健康接口刷新能力', async () => {
    const requests: string[] = [];
    const server = createAgentControlServer(requests, ['health', 'certificate.trust.inspect']);
    const address = await listen(server);
    const client = new AgentDirectClient();

    try {
      const result = await client.executeAction(createAgent(address.port, ['health']), {
        actionType: 'certificate.trust.inspect',
        inputs: { fingerprintSha256: 'a'.repeat(64) },
        requestId: 'req_runtime_capability_refresh',
      });

      assert.equal(result.success, true);
      assert.deepEqual(requests, [
        'GET /api/v1/control/health',
        'POST /api/v1/control/actions/start',
        'GET /api/v1/control/actions/status?actionId=direct-action-refresh',
      ]);
      assert.ok(result.directControl.supportedActions.includes('certificate.trust.inspect'));
    } finally {
      await close(server);
    }
  });

  it('健康接口仍未声明目标能力时继续拒绝直连执行', async () => {
    const requests: string[] = [];
    const server = createAgentControlServer(requests, ['health', 'discovery.run']);
    const address = await listen(server);
    const client = new AgentDirectClient();

    try {
      await assert.rejects(
        client.executeAction(createAgent(address.port, ['health']), {
          actionType: 'certificate.trust.inspect',
          inputs: {},
          requestId: 'req_runtime_capability_missing',
        }),
        (error: unknown) => error instanceof AppError
          && error.errorCode === 'CAPABILITY_MISSING'
          && (error.details as { capabilitySource?: string } | undefined)?.capabilitySource === 'runtime-health',
      );
      assert.deepEqual(requests, ['GET /api/v1/control/health']);
    } finally {
      await close(server);
    }
  });
});

function createAgentControlServer(requests: string[], supportedActions: string[]): Server {
  return createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'GET' && request.url === '/api/v1/control/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        directControl: {
          enabled: true,
          reachable: true,
          protocolVersion: 'v1',
          supportedActions,
          lastReadyAt: '2026-08-08T00:00:00.000Z',
        },
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v1/control/actions/start') {
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        accepted: true,
        actionId: 'direct-action-refresh',
        status: 'running',
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/v1/control/actions/status?actionId=direct-action-refresh') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        actionId: 'direct-action-refresh',
        status: 'completed',
        detail: { status: 'not_found' },
      }));
      return;
    }
    response.writeHead(404).end();
  });
}

function createAgent(port: number, supportedActions: string[]): AgentRegistration {
  const now = new Date().toISOString();
  return {
    id: 'agt_direct_client_test',
    tenantId: 'tenant_direct_client_test',
    agentKey: 'direct-client-test',
    descriptor: {
      agentKey: 'direct-client-test',
      hostname: 'direct-client-test',
      version: '0.1.0',
      osType: 'LINUX',
      labels: [],
    },
    directControl: {
      enabled: true,
      reachable: true,
      listenAddress: `127.0.0.1:${port}`,
      protocolVersion: 'v1',
      supportedActions,
    },
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function listen(server: Server): Promise<{ port: number }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动 Agent 直连测试服务');
  return address;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
