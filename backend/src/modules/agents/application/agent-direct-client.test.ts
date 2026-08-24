import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { describe, it } from 'node:test';
import { computeAgentPlanDigest } from '../security/agent-security.contract.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { AgentCapabilityTokenV1, AgentPlanV1, PolicyAuthorityDecisionV1 } from '../security/agent-security.contract.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { AgentDirectClient } from './agent-direct-client.js';

describe('AgentDirectClient', () => {
  it('持久化能力列表过期时使用 Agent 健康接口刷新 Agent v2 能力', async () => {
    const requests: string[] = [];
    const server = createAgentControlServer(requests, ['health', 'agent.plan.execute']);
    const address = await listen(server);
    const client = new AgentDirectClient();
    const agent = createAgent(address.port, ['health']);

    try {
      const result = await client.executeAction(agent, {
        actionType: 'agent.plan.execute',
        inputs: createAgentV2Inputs(agent),
        requestId: 'req_runtime_capability_refresh',
      });

      assert.equal(result.success, true);
      assert.deepEqual(requests, [
        'GET /api/v1/control/health',
        'POST /api/v1/control/actions/start',
        'GET /api/v1/control/actions/status?actionId=direct-action-refresh',
      ]);
      assert.ok(result.directControl.supportedActions.includes('agent.plan.execute'));
    } finally {
      await close(server);
    }
  });

  it('健康接口仍未声明目标 Agent v2 能力时继续拒绝直连执行', async () => {
    const requests: string[] = [];
    const server = createAgentControlServer(requests, ['health', 'agent.fact.collect']);
    const address = await listen(server);
    const client = new AgentDirectClient();
    const agent = createAgent(address.port, ['health']);

    try {
      await assert.rejects(
        client.executeAction(agent, {
          actionType: 'agent.plan.execute',
          inputs: createAgentV2Inputs(agent),
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

  it('plan.execute 完成响应失败且未确认写入结果时返回 UNKNOWN', async () => {
    const requests: string[] = [];
    const server = createAgentControlServer(requests, ['agent.plan.execute'], { success: false, errorCode: 'AGENT_TIMEOUT' });
    const address = await listen(server);
    const client = new AgentDirectClient();
    const agent = createAgent(address.port, ['agent.plan.execute']);

    try {
      const result = await client.executeAction(agent, {
        actionType: 'agent.plan.execute',
        inputs: { ...createAgentV2Inputs(agent), actionSchemaVersion: '1.0' },
        requestId: 'req_runtime_unknown',
      });

      assert.equal(result.success, false);
      assert.equal(result.outcome, 'UNKNOWN');
      assert.deepEqual(requests, [
        'POST /api/v1/control/actions/start',
        'GET /api/v1/control/actions/status?actionId=direct-action-refresh',
      ]);
    } finally {
      await close(server);
    }
  });
});

function createAgentControlServer(requests: string[], supportedActions: string[], completedBody: Record<string, unknown> = { success: true, detail: { status: 'not_found' } }): Server {
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
        ...completedBody,
        actionId: 'direct-action-refresh',
        status: 'completed',
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

function createAgentV2Inputs(agent: AgentRegistration): Record<string, unknown> {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const plan = {
    planVersion: 'gcac.agent-security/v1' as const,
    planId: 'direct-plan-1',
    agentId: agent.id,
    tenantId: agent.tenantId,
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-1',
    capability: 'filesystem.read',
    operations: [{
      operationId: 'op-1',
      operationType: 'filesystem.read' as const,
      stage: 'prepare' as const,
      input: { path: '/var/lib/gcac/config.json' },
      dependsOn: [],
      idempotencyKey: 'direct-idem-1',
      timeoutSeconds: 30,
    }],
    planDigest: '',
    tokenId: 'direct-token-1',
    policyDecisionId: 'direct-decision-1',
    nonce: 'direct-nonce-1',
    expiresAt,
    writeEffect: false,
  } satisfies AgentPlanV1;
  const planWithDigest: AgentPlanV1 = { ...plan, planDigest: computeAgentPlanDigest(plan) };
  const token: AgentCapabilityTokenV1 = {
    tokenVersion: 'gcac.agent-security/v1',
    tokenId: 'direct-token-1',
    agentId: agent.id,
    tenantId: agent.tenantId,
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-1',
    capability: 'filesystem.read',
    actions: ['filesystem.read'],
    allowedPaths: ['/var/lib/gcac'],
    allowedServices: [],
    artifactDigests: ['a'.repeat(64)],
    policyRef: 'policy-1',
    policyVersion: '1',
    issuedAt,
    expiresAt,
    nonce: 'direct-nonce-1',
    planDigest: planWithDigest.planDigest,
    authorityKeyId: 'authority-key-1',
    signature: 'test-token-signature',
  };
  const policyDecision: PolicyAuthorityDecisionV1 = {
    decisionVersion: 'gcac.agent-security/v1',
    decisionId: 'direct-decision-1',
    allowed: true,
    agentId: agent.id,
    tenantId: agent.tenantId,
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-1',
    capability: 'filesystem.read',
    actions: ['filesystem.read'],
    allowedPaths: ['/var/lib/gcac'],
    allowedServices: [],
    artifactDigests: ['a'.repeat(64)],
    policyRef: 'policy-1',
    policyVersion: '1',
    planDigest: planWithDigest.planDigest,
    tokenId: 'direct-token-1',
    nonce: 'direct-nonce-1',
    issuedAt,
    validUntil: expiresAt,
    authorityKeyId: 'authority-key-1',
    revocationRef: 'revocation-1',
    signature: 'test-policy-signature',
  };
  return { plan: planWithDigest, token, policyDecision };
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
