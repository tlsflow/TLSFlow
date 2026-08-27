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

test('云资源插件复用标准设备接入入口但不创建设备资产', async () => {
  const plugin = {
    id: 'plugin-version-cloud',
    tenantId: 'SYSTEM',
    pluginId: 'cloud.test',
    version: '1.0.0',
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'MANAGED',
    status: 'ENABLED',
    manifest: {
      capabilities: [
        { key: 'cloud.service.connection-test' },
        { key: 'cloud.service.discover' },
      ],
      resources: { forms: { cloud: 'forms/cloud.json' } },
    },
    resources: { 'forms/cloud.json': '{}' },
  } as unknown as UnifiedPluginVersionRecord;
  const resourceOnboardingCalls: Array<Record<string, unknown>> = [];
  const resourceOnboarding = {
    supports: (candidate: UnifiedPluginVersionRecord) => candidate.pluginId === 'cloud.test',
    onboard: async (tenantId: string, candidate: UnifiedPluginVersionRecord, values: Record<string, unknown>, actorId: string) => {
      resourceOnboardingCalls.push({ tenantId, pluginId: candidate.pluginId, values, actorId });
      return {
        onboardingKind: 'PLUGIN_MANAGED',
        resourceType: 'ASSET',
        resourceId: 'cloud-asset-1',
        assetId: 'cloud-asset-1',
      };
    },
  };
  const packageResources = {
    validate: () => ({
      forms: {
        cloud: {
          schemaVersion: 'gcac.plugin-form/v1',
          mode: 'MANAGED',
          sections: [{ id: 'resource', titleKey: 'test.resource', fields: [
            { key: 'displayName', type: 'text', labelKey: 'test.displayName', required: true },
            { key: 'credentialId', type: 'credential_ref', labelKey: 'test.credential', required: true },
          ] }],
        },
      },
      presentations: {},
    }),
  };
  const db = {
    query: async (sql: string) => {
      if (sql.includes('pg_device_assets')) throw new Error('云资源接入不应访问 pg_device_assets');
      return { rows: [] };
    },
    transaction: async () => { throw new Error('云资源接入不应开启设备事务'); },
  };
  const service = new DevicesApplicationService(
    { get: async () => undefined } as unknown as DevicesRepository,
    undefined,
    undefined,
    db as never,
    { getVersion: async () => plugin } as never,
    packageResources as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    resourceOnboarding,
  );

  const result = await service.onboard('tenant-cloud', {
    platformKey: 'plugin',
    pluginVersionId: plugin.id,
    formValues: { displayName: '阿里云 CDN', credentialId: 'cred-1' },
  }, 'user-cloud', 'request-cloud');

  assert.equal((result as unknown as { assetId: string }).assetId, 'cloud-asset-1');
  assert.deepEqual(resourceOnboardingCalls, [{
    tenantId: 'tenant-cloud',
    pluginId: 'cloud.test',
    values: { displayName: '阿里云 CDN', credentialId: 'cred-1' },
    actorId: 'user-cloud',
  }]);
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

test('设备详情自动使用 pluginId 当前已启用插件版本而不是历史来源版本', async () => {
  const previous = {
    ...devicePluginVersionFixture('plugin-version-previous', '1.0.1', 'RETIRED'),
    tenantId: 'tenant-1',
    ownerType: 'TENANT' as const,
    ownerId: 'tenant-1',
    source: 'USER' as const,
    manifest: { ...devicePluginVersionFixture('plugin-version-previous', '1.0.1', 'RETIRED').manifest, source: 'USER' as const },
  };
  const latest = devicePluginVersionFixture('plugin-version-latest', '1.0.2', 'ENABLED');
  const device = {
    id: 'host-plugin-latest',
    displayName: 'F5',
    category: 'NETWORK_APPLIANCE',
    productFamily: 'device.f5.bigip',
    managementMethod: 'PLUGIN',
    extensionType: 'NETWORK_APPLIANCE',
    applicationAssetCount: 0,
    capabilities: [],
    allowedActions: [],
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    informationSections: [{
      key: 'networkAppliance',
      fields: [{ key: 'pluginVersion', value: previous.version, valueType: 'TEXT' as const }],
    }],
    publicSummary: { osType: 'NETWORK', managementMode: 'PLUGIN', updatedAt: previous.updatedAt },
    overview: { deviceId: 'host-plugin-latest', displayName: 'F5', deviceType: 'NETWORK_APPLIANCE', managementMode: 'PLUGIN', status: 'HEALTHY', updatedAt: previous.updatedAt },
    frameworks: [],
    sites: [],
    certificates: [],
    logs: [],
    extension: { type: 'PLUGIN', deviceAssetId: 'asset-plugin-latest', pluginVersionId: previous.id, pluginBindingId: 'binding-plugin-latest' },
    extensionSummary: { pluginVersion: previous.version },
  } as unknown as ManagedDeviceDetailDto;
  const repository = { get: async () => device } as unknown as DevicesRepository;
  const db = {
    query: async (sql: string) => sql.includes('plugin_capability_assignments')
      ? { rows: [{ capability_key: 'device.connection.test' }, { capability_key: 'device.removed' }] }
      : { rows: [] },
  };
  const plugins = {
    getVersionForTenant: async (_tenantId: string, id: string) => id === latest.id ? latest : previous,
    listAccessibleVersions: async () => [latest, previous],
    getVersionWithUiResourcesForTenant: async (_tenantId: string, id: string) => ({
      version: id === latest.id ? latest : previous,
      ui: { forms: {}, presentations: {}, locale: { messages: {} } },
    }),
  };
  const result = await new DevicesApplicationService(repository, undefined, undefined, db as never, plugins as never).get('tenant-1', device.id);
  const pluginVersionField = result.informationSections.find((section) => section.key === 'networkAppliance')?.fields.find((field) => field.key === 'pluginVersion');
  assert.equal(pluginVersionField?.value, '1.0.2');
  assert.equal(result.controlVersion, '1.0.2');
  assert.equal(result.extensionSummary.pluginVersion, '1.0.2');
  assert.equal(result.pluginUi?.pluginVersionId, latest.id);
  assert.deepEqual(result.pluginUi?.capabilities, ['device.connection.test']);
});

test('设备能力执行使用 pluginId 当前插件工作流并迁移历史 Binding 输入', async () => {
  const previous = {
    ...devicePluginVersionFixture('plugin-version-previous-execute', '1.0.1', 'RETIRED'),
    tenantId: 'tenant-1',
    ownerType: 'TENANT' as const,
    ownerId: 'tenant-1',
    source: 'USER' as const,
    manifest: { ...devicePluginVersionFixture('plugin-version-previous-execute', '1.0.1', 'RETIRED').manifest, source: 'USER' as const },
  };
  const latest = devicePluginVersionFixture('plugin-version-latest-execute', '1.0.2', 'ENABLED');
  const device = {
    id: 'host-plugin-latest-execute',
    displayName: 'F5',
    category: 'NETWORK_APPLIANCE',
    productFamily: 'device.f5.bigip',
    managementMethod: 'PLUGIN',
    extensionType: 'NETWORK_APPLIANCE',
    applicationAssetCount: 0,
    capabilities: [],
    allowedActions: [],
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    informationSections: [{ key: 'networkAppliance', fields: [] }],
    publicSummary: { osType: 'NETWORK', managementMode: 'PLUGIN', updatedAt: previous.updatedAt },
    overview: { deviceId: 'host-plugin-latest-execute', displayName: 'F5', deviceType: 'NETWORK_APPLIANCE', managementMode: 'PLUGIN', status: 'HEALTHY', updatedAt: previous.updatedAt },
    frameworks: [],
    sites: [],
    certificates: [],
    logs: [],
    extension: { type: 'PLUGIN', deviceAssetId: 'asset-plugin-latest-execute', pluginVersionId: previous.id, pluginBindingId: 'binding-plugin-latest-execute' },
    extensionSummary: {},
  } as unknown as ManagedDeviceDetailDto;
  const repository = { get: async () => device } as unknown as DevicesRepository;
  const binding = {
    id: 'binding-plugin-latest-execute',
    pluginVersionId: previous.id,
    inputBindings: {
      apiVersion: 'gcac.input-bindings/v1',
      variables: { legacyVariable: 'discard-me' },
      connections: { management: { host: '10.33.5.49' } },
      credentials: {},
      artifacts: {},
    },
  };
  const db = {
    query: async (sql: string) => {
      if (sql.includes('plugin_capability_assignments')) return { rows: [{ capability_key: 'device.connection.test' }] };
      if (sql.includes('from pg_service_assets sa')) return { rows: [{
        id: 'asset-plugin-latest-execute', tenant_id: 'tenant-1', display_name: 'F5', address: '10.33.5.49',
        host_id: device.id, device_family: 'device.f5.bigip', management_port: 443, auth_mode: 'BASIC',
        tls_verify: true, plugin_version_id: previous.id, plugin_binding_id: binding.id, support_tier: 'SUPPORTED',
      }] };
      return { rows: [] };
    },
  };
  const plugins = {
    getVersionForTenant: async (_tenantId: string, id: string) => id === latest.id ? latest : previous,
    listAccessibleVersions: async () => [latest, previous],
    getVersionWithUiResourcesForTenant: async () => ({ version: latest, ui: { forms: {}, presentations: {}, locale: { messages: {} } } }),
  };
  const pluginBindings = {
    resolveAssignment: async () => ({ pluginBindingId: binding.id, pluginVersionId: previous.id }),
    getTenantBinding: async () => binding,
  };
  let workflowPluginVersionId = '';
  const pluginWorkflows = {
    require: async (pluginVersionId: string) => {
      workflowPluginVersionId = pluginVersionId;
      return { pluginVersionId, capabilityKey: 'device.connection.test', workflowResourcePath: 'workflows/connection-test.json', workflowTemplateId: 'template-1', workflowVersionId: 'workflow-version-1', workflowContentSha256: 'sha256:workflow', createdAt: '2026-08-23T00:00:00.000Z' };
    },
  };
  const workflowVersion = {
    id: 'workflow-version-1',
    executionMode: 'DSL',
    content: {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'connection-test' },
      inputContract: {
        apiVersion: 'gcac.deployment-input/v1',
        variables: {},
        connections: {
          management: {
            transport: 'http',
            allowedProtocols: ['https'],
            host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
            port: { type: 'number', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          },
        },
        credentials: {},
        artifacts: {},
      },
      steps: [],
    },
  };
  let capturedBindings: Record<string, unknown> | undefined;
  const deploymentInputResolver = {
    resolve: (input: { bindingLayers: { deviceDefault?: { inputBindings: Record<string, unknown> } } }) => {
      capturedBindings = input.bindingLayers.deviceDefault?.inputBindings;
      return { executable: true };
    },
  };
  const workflows = {
    getVersion: async () => workflowVersion,
    execute: async () => ({ status: 'success', id: 'workflow-run-1', stepResults: [] }),
  };
  const runtimeGuard = { execute: async (_context: unknown, run: () => Promise<unknown>) => run() };
  await new DevicesApplicationService(
    repository,
    undefined,
    undefined,
    db as never,
    plugins as never,
    undefined,
    pluginBindings as never,
    pluginWorkflows as never,
    workflows as never,
    runtimeGuard as never,
    undefined,
    deploymentInputResolver as never,
  ).executeCapability('tenant-1', device.id, 'device.connection.test');
  assert.equal(workflowPluginVersionId, latest.id);
  assert.equal((capturedBindings?.variables as Record<string, unknown>)?.legacyVariable, undefined);
  assert.equal((capturedBindings?.connections as Record<string, Record<string, unknown>>)?.management?.host, '10.33.5.49');
});

test('历史设备首次执行凭据健康检测时自动补齐能力指派', async () => {
  const device = {
    id: 'host-historical-health',
    displayName: '历史设备',
    category: 'NETWORK_APPLIANCE',
    productFamily: 'device.f5.bigip',
    managementMethod: 'PLUGIN',
    extensionType: 'NETWORK_APPLIANCE',
    applicationAssetCount: 0,
    capabilities: [],
    allowedActions: [],
    health: 'HEALTHY',
    sourceStatus: 'ONLINE',
    informationSections: [{ key: 'common', fields: [] }],
    publicSummary: { osType: 'NETWORK', managementMode: 'PLUGIN', updatedAt: '2026-08-23T00:00:00.000Z' },
    overview: { deviceId: 'host-historical-health', displayName: '历史设备', deviceType: 'NETWORK_APPLIANCE', managementMode: 'PLUGIN', status: 'HEALTHY', updatedAt: '2026-08-23T00:00:00.000Z' },
    logs: [],
    frameworks: [],
    sites: [],
    certificates: [],
    extension: { type: 'PLUGIN', deviceAssetId: 'asset-historical-health', pluginVersionId: 'plugin-version-health', pluginBindingId: 'binding-health' },
    extensionSummary: {},
  } as unknown as ManagedDeviceDetailDto;
  const plugin = devicePluginVersionFixture('plugin-version-health', '1.0.0', 'ENABLED');
  plugin.manifest = {
    ...plugin.manifest,
    capabilities: [
      { key: 'device.connection.test', contractVersion: 'v1', actionContractId: 'device.connection.test.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
      { key: 'credential.health-check', contractVersion: 'v1', actionContractId: 'credential.health-check.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
    ],
  };
  const historicalPlugin = {
    ...devicePluginVersionFixture('plugin-version-health-old', '0.9.0', 'RETIRED'),
    tenantId: 'tenant-health',
    ownerType: 'TENANT' as const,
    ownerId: 'tenant-health',
    source: 'USER' as const,
    manifest: { ...plugin.manifest, version: '0.9.0', source: 'USER' as const },
  };
  const repository = { get: async () => device } as unknown as DevicesRepository;
  const assignments: Array<Record<string, unknown>> = [];
  const pluginBindings = {
    resolveAssignment: async () => undefined,
    getTenantBinding: async () => ({ id: 'binding-health', tenantId: 'tenant-health', pluginVersionId: historicalPlugin.id, mode: 'MANAGED', status: 'ACTIVE', version: 1, inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }, createdAt: '', updatedAt: '' }),
    assignCapability: async (_tenantId: string, input: Record<string, unknown>) => {
      assignments.push(input);
      return { ...input, id: 'assignment-health', tenantId: 'tenant-health', status: 'ACTIVE', createdAt: '', updatedAt: '' };
    },
  } as unknown as PluginBindingsApplicationService;
  const plugins = {
    getVersionForTenant: async (_tenantId: string, id: string) => id === historicalPlugin.id ? historicalPlugin : plugin,
    listAccessibleVersions: async () => [plugin],
    getVersionWithUiResourcesForTenant: async () => ({ version: plugin, ui: { forms: {}, presentations: {}, locale: { messages: {} } } }),
  };
  const db = {
    query: async (sql: string) => {
      if (sql.includes('plugin_capability_assignments')) return { rows: [] };
      if (sql.includes('from pg_service_assets sa')) return { rows: [{
        id: 'asset-historical-health', tenant_id: 'tenant-health', display_name: '历史设备', address: '10.0.0.1', host_id: device.id,
        device_family: 'device.f5.bigip', management_port: 443, auth_mode: 'BASIC', tls_verify: true,
        plugin_version_id: plugin.id, plugin_binding_id: 'binding-health', support_tier: 'SUPPORTED',
      }] };
      return { rows: [] };
    },
  };
  const workflowVersion = {
    id: 'workflow-health', executionMode: 'DSL', content: {
      apiVersion: 'gcac.workflow/v1', kind: 'CurlSshWorkflow', metadata: { name: 'health' },
      inputContract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }, steps: [],
    },
  };
  const pluginWorkflows = { require: async () => ({ pluginVersionId: plugin.id, capabilityKey: 'credential.health-check', workflowVersionId: 'workflow-health', workflowTemplateId: 'template-health', workflowResourcePath: 'workflows/credential-health-check.json', workflowContentSha256: 'sha256:health', createdAt: '' }) } as unknown as PluginWorkflowPublisherService;
  const workflows = { getVersion: async () => workflowVersion, execute: async () => ({ status: 'success', id: 'run-health', stepResults: [] }) } as unknown as WorkflowTemplatesApplicationService;
  const resolver = { resolve: () => ({ executable: true, variables: {}, connections: {}, credentials: {}, artifacts: {}, sensitivePaths: [], issues: [] }) };
  const runtimeGuard = { execute: async (_context: unknown, run: () => Promise<unknown>) => run() };
  await new DevicesApplicationService(repository, undefined, undefined, db as never, plugins as never, undefined, pluginBindings, pluginWorkflows, workflows, runtimeGuard as never, undefined, resolver as never)
    .executeCapability('tenant-health', device.id, 'credential.health-check');
  assert.deepEqual(assignments[0], {
    ownerType: 'DEVICE', ownerId: device.id, capabilityKey: 'credential.health-check', pluginVersionId: historicalPlugin.id, pluginBindingId: 'binding-health', precedence: 'DEVICE_DEFAULT',
  });
});

function devicePluginVersionFixture(
  id: string,
  version: string,
  status: 'ENABLED' | 'RETIRED',
): UnifiedPluginVersionRecord {
  return {
    id,
    tenantId: 'SYSTEM',
    pluginId: 'device.f5.bigip',
    version,
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'device.f5.bigip',
      version,
      displayNameKey: 'plugin.f5.name',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      permissions: [],
      compatibility: { productFamilies: ['device.f5.bigip'], managementMethods: ['PLUGIN'], executionLocations: ['CONTROL_PLANE'] },
      capabilities: [
        { key: 'device.connection.test', contractVersion: 'v1', actionContractId: 'device.connection.test.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
      ],
      resources: { workflows: { 'device.connection.test': 'workflows/connection-test.json' } },
    },
    packageSha256: `sha256:${id}:package`,
    manifestSha256: `sha256:${id}:manifest`,
    resourceSha256: { 'workflows/connection-test.json': `sha256:${id}:workflow` },
    resources: { 'workflows/connection-test.json': '{}' },
    status,
    permissionApprovalStatus: 'NOT_REQUIRED',
    approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: `sha256:${id}:manifest`, resourceSha256: {} },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: status === 'ENABLED' ? '2026-08-23T01:00:00.000Z' : '2026-08-22T01:00:00.000Z',
  };
}
