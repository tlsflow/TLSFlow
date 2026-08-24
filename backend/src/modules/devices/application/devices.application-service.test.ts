import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import type { ManagedDeviceDetailDto } from '../dto/devices.dto.js';
import type { DevicesRepository } from '../repository/devices.repository.js';
import { DevicesApplicationService } from './devices.application-service.js';

test('统一设备发现动作会转发到 Agent 能力重扫', async () => {
  const device = {
    id: 'host-1',
    displayName: 'Windows Host',
    category: 'SERVER',
    productFamily: 'WINDOWS_SERVER',
    managementMethod: 'AGENT',
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    applicationAssetCount: 0,
    capabilities: [],
    extensionType: 'AGENT',
    allowedActions: [],
    publicSummary: { osType: 'WINDOWS', managementMode: 'AGENT', updatedAt: '2026-07-29T00:00:00.000Z' },
    overview: { deviceId: 'host-1', displayName: 'Windows Host', deviceType: 'AGENT', managementMode: 'AGENT', status: 'ONLINE', updatedAt: '2026-07-29T00:00:00.000Z' },
    informationSections: [{ key: 'common', fields: [] }],
    frameworks: [],
    sites: [],
    certificates: [],
    logs: [],
    extension: { type: 'AGENT', agentId: 'agent-1' },
    extensionSummary: {},
  } as ManagedDeviceDetailDto;
  const repository = {
    get: async () => device,
  } as unknown as DevicesRepository;
  let rescanInput: unknown;
  let rescanRequestId = '';
  const agents = {
    getAgentDetail: async () => ({
      agent: { id: 'agent-1', agentKey: 'agent-key', status: 'ONLINE', registeredAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', descriptor: { hostname: 'windows-host', osType: 'WINDOWS' } },
      health: { status: 'HEALTHY', offline: false },
      taskQueue: { counts: { queued: 0, leased: 0, acked: 0 } },
      upgradeSuggestion: { suggestion: { status: 'CURRENT' } },
      runtimeLogs: [],
      recentErrors: [],
      capabilities: { declarations: [] },
    }) as unknown as AgentDetailProjection,
    enqueueCapabilityRescanTask: async (_tenantId: string, input: unknown, requestId: string) => {
      rescanInput = input;
      rescanRequestId = requestId;
      return { id: 'task-1' };
    },
  } as unknown as AgentsApplicationService;
  const service = new DevicesApplicationService(repository, undefined, agents);

  const result = await service.executeCapability('tenant-1', 'host-1', 'device.discover', 'user-1', 'request-1');

  assert.deepEqual(rescanInput, { agentId: 'agent-1', requestedBy: 'user-1' });
  assert.equal(rescanRequestId, 'request-1');
  assert.equal((result as { id: string }).id, 'task-1');
});
