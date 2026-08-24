import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { AgentDirectClient } from './agent-direct-client.js';

test('AgentDirectClient 只向管理端点提交 Web 重新发现请求', async () => {
  const requests: Array<{ method?: string; url?: string; body: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: true, detail: { capabilityRescan: { trigger: 'direct' } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new AgentDirectClient();
  const response = await client.refreshWebInventory(createAgent(`http://127.0.0.1:${address.port}`), {
    requestId: 'request-direct-discovery',
    payload: { actionType: 'agent.fact.collect', refreshWebInventory: true },
  });
  assert.equal(response.success, true);
  assert.deepEqual(requests, [{
    method: 'POST', url: '/api/v1/control/discovery', body: JSON.stringify({ actionType: 'agent.fact.collect', refreshWebInventory: true }),
  }]);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function createAgent(managementEndpoint: string): AgentRegistration {
  const now = new Date().toISOString();
  return {
    id: 'agent-direct-retired',
    tenantId: 'tenant-direct-retired',
    agentKey: 'agent-direct-retired',
    descriptor: { agentKey: 'agent-direct-retired', hostname: 'agent-direct-retired', version: '0.1.0', osType: 'LINUX', labels: [], managementEndpoint },
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}
