import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentsApplicationService } from './application/agents.application-service.js';

test('内置插件刷新后重投影所有有最新快照的 Agent', async () => {
  const projected: string[] = [];
  const agents = [
    { id: 'agent-1', tenantId: 'tenant-1' },
    { id: 'agent-2', tenantId: 'tenant-1' },
    { id: 'agent-3', tenantId: 'tenant-2' },
  ];
  const snapshots = new Map([
    ['agent-1', { id: 'snapshot-1', tenantId: 'tenant-1', agentId: 'agent-1' }],
    ['agent-3', { id: 'snapshot-3', tenantId: 'tenant-2', agentId: 'agent-3' }],
  ]);
  const repository = {
    listAllRegistrations: async () => agents,
    getLatestCapabilitySnapshot: async (_tenantId: string, agentId: string) => snapshots.get(agentId),
  };
  const projector = {
    project: async (agent: { id: string }, snapshot: { id: string }) => {
      projected.push(`${agent.id}:${snapshot.id}`);
      return {};
    },
  };
  const service = new AgentsApplicationService(
    repository as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    projector as never,
  );

  const result = await service.reprojectLatestCapabilitySnapshots();

  assert.deepEqual(result, { attempted: 2, projected: 2, skipped: 1, failed: [] });
  assert.deepEqual(projected, ['agent-1:snapshot-1', 'agent-3:snapshot-3']);
});

test('单个 Agent 重投影失败不会阻断其他 Agent', async () => {
  const projected: string[] = [];
  const agents = [
    { id: 'agent-failed', tenantId: 'tenant-1' },
    { id: 'agent-ok', tenantId: 'tenant-1' },
  ];
  const repository = {
    listAllRegistrations: async () => agents,
    getLatestCapabilitySnapshot: async (_tenantId: string, agentId: string) => ({
      id: `snapshot-${agentId}`,
      tenantId: 'tenant-1',
      agentId,
    }),
  };
  const projector = {
    project: async (agent: { id: string }) => {
      if (agent.id === 'agent-failed') throw new Error('映射资源损坏');
      projected.push(agent.id);
      return {};
    },
  };
  const service = new AgentsApplicationService(
    repository as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    projector as never,
  );

  const result = await service.reprojectLatestCapabilitySnapshots();

  assert.equal(result.attempted, 2);
  assert.equal(result.projected, 1);
  assert.equal(result.failed[0]?.agentId, 'agent-failed');
  assert.deepEqual(projected, ['agent-ok']);
});
