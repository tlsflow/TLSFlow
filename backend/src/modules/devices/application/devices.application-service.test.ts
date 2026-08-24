import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import type { ManagedDeviceDetailDto } from '../dto/devices.dto.js';
import type { DevicesRepository } from '../repository/devices.repository.js';
import { DevicesApplicationService, resolvePluginDeviceFamilies, resolvePluginDeviceFamily } from './devices.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';

test('插件设备兼容过滤使用 Manifest 声明的产品族而不是插件 ID', () => {
  const plugin = {
    id: 'plugin-version-citrix',
    pluginId: 'device.citrix.netscaler-adc',
    manifest: { compatibility: { productFamilies: ['citrix.netscaler-adc'] } },
  } as unknown as UnifiedPluginVersionRecord;

  assert.equal(resolvePluginDeviceFamily(plugin), 'citrix.netscaler-adc');
});

test('应用接入向导保留 Manifest 声明的全部兼容产品族', () => {
  const plugin = {
    id: 'plugin-version-nginx',
    pluginId: 'web.nginx',
    manifest: { compatibility: { productFamilies: ['WINDOWS_SERVER', 'LINUX_SERVER', 'WINDOWS_SERVER'] } },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(resolvePluginDeviceFamilies(plugin), ['WINDOWS_SERVER', 'LINUX_SERVER']);
});

test('统一设备发现动作会进入 Agent 标准发现流程', async () => {
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
  let refreshInput: unknown;
  let refreshRequestId = '';
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
    refreshStandardDiscovery: async (_tenantId: string, agentId: string, requestedBy: string, requestId: string) => {
      refreshInput = { agentId, requestedBy };
      refreshRequestId = requestId;
      return { mode: 'standard-capability', task: { id: 'task-1' }, projection: { certificateBindings: 1 } };
    },
  } as unknown as AgentsApplicationService;
  const service = new DevicesApplicationService(repository, undefined, agents);

  const result = await service.executeCapability('tenant-1', 'host-1', 'device.discover', 'user-1', 'request-1');

  assert.deepEqual(refreshInput, { agentId: 'agent-1', requestedBy: 'user-1' });
  assert.equal(refreshRequestId, 'request-1');
  assert.equal((result as { projection: { certificateBindings: number } }).projection.certificateBindings, 1);
});

test('Agent 设备详情只保留标准投影站点，不再解析厂商 capability snapshot', async () => {
  const standardSite = {
    id: 'site-standard',
    siteAssetId: 'site-standard',
        kind: 'web.site',
        frameworkType: 'web.generic',
    name: '标准投影站点',
    bindings: [],
    metadata: { source: 'standard_discovery_projection' },
  } as ManagedDeviceDetailDto['sites'][number];
  const device = {
    id: 'host-standard',
    displayName: 'Standard Host',
    category: 'SERVER',
    productFamily: 'fixture.standard',
    managementMethod: 'AGENT',
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    applicationAssetCount: 1,
    capabilities: [],
    extensionType: 'AGENT',
    allowedActions: [],
    publicSummary: { osType: 'WINDOWS', managementMode: 'AGENT', updatedAt: '2026-07-30T00:00:00.000Z' },
    overview: { deviceId: 'host-standard', displayName: 'Standard Host', deviceType: 'AGENT', managementMode: 'AGENT', status: 'ONLINE', updatedAt: '2026-07-30T00:00:00.000Z' },
    informationSections: [{ key: 'common', fields: [] }],
    frameworks: [],
    sites: [standardSite],
    certificates: [],
    logs: [],
    extension: { type: 'AGENT', agentId: 'agent-standard' },
    extensionSummary: {},
  } as ManagedDeviceDetailDto;
  const repository = { get: async () => device } as unknown as DevicesRepository;
  const agents = {
    getAgentDetail: async () => ({
      agent: { id: 'agent-standard', agentKey: 'agent-key', status: 'ONLINE', registeredAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z', descriptor: { hostname: 'standard-host', osType: 'WINDOWS' } },
      health: { status: 'HEALTHY', offline: false },
      taskQueue: { counts: { queued: 0, leased: 0, acked: 0 } },
      upgradeSuggestion: { suggestion: { status: 'CURRENT' } },
      runtimeLogs: [],
      recentErrors: [],
      capabilities: { declarations: [] },
      capabilitySnapshot: {
        capabilities: [{ capabilityKey: 'windows.iis.sites', value: [{ Name: '不应出现的旧 IIS 站点' }] }],
      },
    }) as unknown as AgentDetailProjection,
  } as unknown as AgentsApplicationService;

  const result = await new DevicesApplicationService(repository, undefined, agents).get('tenant-1', device.id);

  assert.deepEqual(result.sites, [standardSite]);
  assert.equal(JSON.stringify(result.sites).includes('不应出现的旧 IIS 站点'), false);
});
