import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

function createFixture() {
  let projected: Record<string, unknown> | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'agent-host', display_name: 'Agent Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: Record<string, unknown>) => {
      projected = discovery;
      return { serviceInstances: 0, sites: 0, managedTargets: 0, certificates: 0, certificateBindings: 0, stale: 0, conflicts: 0 };
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  return { projected: () => projected, service: new AgentCapabilityDiscoveryProjector(database, projector) };
}

function agent(): AgentRegistration {
  return {
    id: 'agent-1',
    descriptor: { hostname: 'agent-host', osVersion: 'Linux', ipAddress: '10.0.0.10' },
  } as AgentRegistration;
}

function snapshot(capabilities: AgentCapabilitySnapshot['capabilities']): AgentCapabilitySnapshot {
  return {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    reportedAt: '2026-08-09T00:00:00.000Z',
    capabilities,
  } as AgentCapabilitySnapshot;
}

test('Agent 快照只投影通用主机事实，不生成产品对象', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'process.list', confidence: 1, value: true },
    { capabilityKey: 'service.list', confidence: 0.9, value: { count: 3 } },
  ]));

  const projected = fixture.projected() as {
    device: { productFamily: string };
    capabilities: Array<{ key: string; available: boolean; metadata?: Record<string, unknown> }>;
    frameworks: unknown[];
    sites: unknown[];
    managedTargets: unknown[];
    certificates: unknown[];
    certificateBindings: unknown[];
  };
  assert.equal(projected.device.productFamily, 'AGENT_HOST');
  assert.deepEqual(projected.capabilities, [
    { key: 'process.list', available: true, metadata: { confidence: 1 } },
    { key: 'service.list', available: true, metadata: { confidence: 0.9 } },
  ]);
  assert.equal(projected.frameworks.length, 0);
  assert.equal(projected.sites.length, 0);
  assert.equal(projected.managedTargets.length, 0);
  assert.equal(projected.certificates.length, 0);
  assert.equal(projected.certificateBindings.length, 0);
});

test('Agent 能力值为 false 或 null 时只表示不可用，不被解释为产品未安装', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'filesystem.read', confidence: 1, value: false },
    { capabilityKey: 'service.status', confidence: 1, value: null },
  ]));

  const projected = fixture.projected() as { capabilities: Array<{ key: string; available: boolean }> };
  assert.deepEqual(projected.capabilities, [
    { key: 'filesystem.read', available: false, metadata: { confidence: 1 } },
    { key: 'service.status', available: false, metadata: { confidence: 1 } },
  ]);
});

test('缺少统一 Host 资产锚点时失败关闭', async () => {
  const database = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DatabasePort;
  const projector = {} as StandardDeviceDiscoveryProjector;
  const service = new AgentCapabilityDiscoveryProjector(database, projector);

  await assert.rejects(
    () => service.project(agent(), snapshot([])),
    (error: unknown) => error instanceof Error && error.message.includes('统一 Host 资产锚点'),
  );
});
