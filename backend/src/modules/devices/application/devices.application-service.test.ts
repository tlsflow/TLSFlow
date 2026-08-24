import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import type { ManagedDeviceDetailDto } from '../dto/devices.dto.js';
import type { DevicesRepository } from '../repository/devices.repository.js';
import { DevicesApplicationService, resolvePluginDeviceFamilies, resolvePluginDeviceFamily } from './devices.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import { AppError } from '../../../common/errors/app-error.js';

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

test('设备插件能力执行把宿主租户上下文透传给统一工作流执行', async () => {
  const device = {
    id: 'host-plugin-1',
    displayName: 'Citrix ADC',
    category: 'SERVER',
    productFamily: 'citrix.netscaler-adc',
    managementMethod: 'PLUGIN',
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    applicationAssetCount: 0,
    capabilities: [],
    extensionType: 'NETWORK_APPLIANCE',
    allowedActions: [],
    publicSummary: { osType: 'NETWORK', managementMode: 'PLUGIN', updatedAt: '2026-08-01T00:00:00.000Z' },
    overview: { deviceId: 'host-plugin-1', displayName: 'Citrix ADC', deviceType: 'PLUGIN', managementMode: 'PLUGIN', status: 'HEALTHY', updatedAt: '2026-08-01T00:00:00.000Z' },
    informationSections: [{ key: 'common', fields: [] }],
    frameworks: [],
    sites: [],
    certificates: [],
    logs: [],
    extension: { type: 'PLUGIN', deviceAssetId: 'asset-plugin-1', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-plugin-1' },
    extensionSummary: {},
  } as ManagedDeviceDetailDto;
  const repository = {
    get: async () => device,
    list: async () => ({ items: [], total: 0, page: 1, pageSize: 200 }),
  } as unknown as DevicesRepository;
  const workflowCalls: Array<{ tenantId?: string; templateVersionId: string; mode: string; authorization?: { approved?: boolean; approvalId?: string } }> = [];
  const workflows = {
    execute: async (input: { tenantId?: string; templateVersionId: string; mode: string; authorization?: { approved?: boolean; approvalId?: string } }) => {
      workflowCalls.push(input);
      return {
        id: 'run-connection-test', mode: 'real_test', executionBranch: 'deploy', plannedOnly: false, status: 'success',
        renderedSteps: [], stepResults: [], rollbackResults: [], logs: [],
      };
    },
    getVersion: async () => ({
      id: 'wf-version-1',
      templateId: 'template-1',
      version: 1,
      dslVersion: 'v1',
      content: { apiVersion: 'gcac.workflow/v1', kind: 'CurlSshWorkflow', metadata: { name: 'connection-test', displayName: 'connection test' }, inputContract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }, steps: [] },
      contentHash: 'sha256:wf',
      status: 'published',
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
  } as unknown as WorkflowTemplatesApplicationService;
  const pluginBindings = {
    resolveAssignment: async () => ({ pluginBindingId: 'binding-plugin-1', pluginVersionId: 'plugin-version-1' }),
    getTenantBinding: async () => ({ id: 'binding-plugin-1', inputBindings: { credentials: {}, variables: {}, connections: {}, artifacts: {} } }),
  } as unknown as PluginBindingsApplicationService;
  const pluginWorkflows = {
    require: async () => ({ pluginVersionId: 'plugin-version-1', capabilityKey: 'device.connection.test', workflowResourcePath: 'workflows/connection-test.json', workflowTemplateId: 'template-1', workflowVersionId: 'wf-version-1', workflowContentSha256: 'sha256:wf', createdAt: '2026-08-01T00:00:00.000Z' }),
  } as unknown as PluginWorkflowPublisherService;
  const db = {
    query: async (sql: string) => {
      if (sql.includes('plugin_capability_assignments')) {
        return { rows: [{ capability_key: 'device.connection.test' }] };
      }
      if (sql.includes('pg_service_assets sa')) {
        return { rows: [{
          id: 'asset-plugin-1',
          tenant_id: 'tenant-exec-1',
          display_name: 'Citrix ADC',
          address: '10.255.0.49',
          host_id: 'host-plugin-1',
          device_family: 'citrix.netscaler-adc',
          management_port: 443,
          auth_mode: 'NITRO_HEADER',
          tls_verify: true,
          plugin_version_id: 'plugin-version-1',
          plugin_binding_id: 'binding-plugin-1',
          credential_id: 'cred-1',
          support_tier: 'SUPPORTED',
        }] };
      }
      return { rows: [] };
    },
  };
  const service = new DevicesApplicationService(
    repository,
    undefined,
    undefined,
    db as never,
    undefined,
    undefined,
    pluginBindings,
    pluginWorkflows,
    workflows,
    undefined,
    undefined,
    {
      resolve: () => ({
        apiVersion: 'gcac.resolved-deployment-input/v1',
        contractVersion: 'gcac.deployment-input/v1',
        assetContext: { apiVersion: 'gcac.deployment-asset-context/v1', application: { id: 'asset-plugin-1', address: '10.255.0.49', serverName: '10.255.0.49', port: 443, protocol: 'https' }, deployment: { targets: [], certificateResourceName: 'certificate-10-255-0-49' } },
        variables: {},
        connections: {},
        credentials: {},
        artifacts: {},
        provenance: {},
        sensitivePaths: [],
        issues: [],
        executable: true,
        resolvedSha256: 'sha256:resolved',
      }),
    } as never,
  );

  const result = await service.executeCapability(
    'tenant-exec-1',
    'host-plugin-1',
    'device.connection.test',
    'user-1',
    'request-1',
    { approved: true, approvalId: 'approval-device-test' },
  );

  assert.equal((result as { status: string }).status, 'success');
  assert.equal(workflowCalls.length, 1);
  assert.equal(workflowCalls[0]?.tenantId, 'tenant-exec-1');
  assert.equal(workflowCalls[0]?.templateVersionId, 'wf-version-1');
  assert.equal(workflowCalls[0]?.mode, 'real_test');
  assert.deepEqual(workflowCalls[0]?.authorization, { approved: true, approvalId: 'approval-device-test' });
});

test('设备插件能力执行缺少统一工作流服务时失败关闭而不是伪造成功', async () => {
  const device = {
    id: 'host-plugin-missing',
    displayName: 'Citrix ADC',
    category: 'SERVER',
    productFamily: 'citrix.netscaler-adc',
    managementMethod: 'PLUGIN',
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    applicationAssetCount: 0,
    capabilities: [],
    extensionType: 'NETWORK_APPLIANCE',
    allowedActions: [],
    publicSummary: { osType: 'NETWORK', managementMode: 'PLUGIN', updatedAt: '2026-08-01T00:00:00.000Z' },
    overview: { deviceId: 'host-plugin-missing', displayName: 'Citrix ADC', deviceType: 'PLUGIN', managementMode: 'PLUGIN', status: 'HEALTHY', updatedAt: '2026-08-01T00:00:00.000Z' },
    informationSections: [{ key: 'common', fields: [] }],
    frameworks: [],
    sites: [],
    certificates: [],
    logs: [],
    extension: { type: 'PLUGIN', deviceAssetId: 'asset-plugin-missing', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-plugin-1' },
    extensionSummary: {},
  } as ManagedDeviceDetailDto;
  const repository = { get: async () => device } as unknown as DevicesRepository;
  const service = new DevicesApplicationService(repository);

  await assert.rejects(
    service.executeCapability('tenant-1', 'host-plugin-missing', 'device.connection.test'),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CAPABILITY_MISSING',
  );
});
