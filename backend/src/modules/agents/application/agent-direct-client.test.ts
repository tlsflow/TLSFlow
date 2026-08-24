import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { AgentDirectClient } from './agent-direct-client.js';

test('AgentDirectClient 退役后失败关闭且不发起 HTTP 请求', async () => {
  const client = new AgentDirectClient();
  await assert.rejects(
    client.executeAction(createAgent(), {
      actionType: 'agent.plan.execute',
      inputs: {},
      requestId: 'request-direct-retired',
    }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'AUTH_FORBIDDEN'
      && (error.details as { reason?: string } | undefined)?.reason === 'AGENT_DIRECT_BYPASS_RETIRED'
      && (error.details as { fallback?: boolean } | undefined)?.fallback === false,
  );
});

function createAgent(): AgentRegistration {
  const now = new Date().toISOString();
  return {
    id: 'agent-direct-retired',
    tenantId: 'tenant-direct-retired',
    agentKey: 'agent-direct-retired',
    descriptor: { agentKey: 'agent-direct-retired', hostname: 'agent-direct-retired', version: '0.1.0', osType: 'LINUX', labels: [] },
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}
