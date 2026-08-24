import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionLocation, ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import {
  PluginRuntimeAdapterRegistry,
  WorkflowDslRuntimeAdapter,
  createDefaultPluginRuntimeAdapterRegistry,
} from './plugin-runtime-adapter.registry.js';

test('PluginRuntimeAdapterRegistry 使用同一接口编译 Workflow DSL', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('WORKFLOW_DSL', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE'),
    applicationAsset: applicationAsset(),
    resolvedInput: resolvedInput(),
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1' },
  });
  assert.equal(result.executorType, 'WORKFLOW');
  assert.equal((result.payload.workflowRequest as { workflowVersionId: string }).workflowVersionId, 'workflow-version-1');
  assert.equal((result.payload.certificateVerification as { capabilityKey: string }).capabilityKey, 'certificate.verify');
  assert.equal(result.payload.resolvedDeploymentInput, resolvedInputFixture);
  assert.deepEqual(Object.keys(result.payload.workflowRequest as Record<string, unknown>).filter((key) => key.endsWith('Bindings')), []);
});

test('PluginWorkflow 固定路由到独立 Plugin Runner，并生成完整绑定草稿', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('WORKFLOW_DSL', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE'),
    applicationAsset: applicationAsset(),
    resolvedInput: resolvedInput(),
    workflow: {
      workflowId: 'workflow-plugin-1',
      workflowVersionId: 'workflow-plugin-version-1',
      executionMode: 'PLUGIN_RUNNER',
    },
  });

  assert.equal(result.executorType, 'PLUGIN_RUNNER');
  assert.deepEqual(result.requiredCapabilities, ['plugin.runner.execute']);
  const binding = result.payload.pluginRunnerBindingDraft as Record<string, unknown>;
  assert.deepEqual(binding, {
    apiVersion: 'gcac.plugin-runner-binding/v1',
    workflowVersionId: 'workflow-plugin-version-1',
    pluginVersionId: 'plugin-version-1',
    pluginId: 'fixture',
    pluginVersion: '1.0.0',
    packageHash: `sha256:${'a'.repeat(64)}`,
    manifestHash: `sha256:${'b'.repeat(64)}`,
    resourceHash: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    capability: 'certificate.deploy',
    writeEffect: true,
    hostPermissions: [],
  });
});

test('PluginRuntimeAdapterRegistry 使用应用资产 verifyUrl 作为最终 TLS VERIFY 入口', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('WORKFLOW_DSL', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE', { hostIp: '10.255.0.49' }),
    applicationAsset: {
      ...applicationAsset(),
      address: 'lb-test01.jacksonz.cn',
      sniName: 'lb-test01.jacksonz.cn',
      verifyUrl: 'https://lb-test01.jacksonz.cn',
    },
    resolvedInput: resolvedInput(),
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1' },
  });

  assert.deepEqual(result.payload.certificateVerification, {
    capabilityKey: 'certificate.verify',
    schemaVersion: '1.0',
    connectHost: 'lb-test01.jacksonz.cn',
    serverName: 'lb-test01.jacksonz.cn',
    port: 443,
    expectedDomains: ['lb-test01.jacksonz.cn'],
    verifyUrl: 'https://lb-test01.jacksonz.cn',
    source: 'APPLICATION_VERIFY_URL',
  });
});

test('PluginRuntimeAdapterRegistry 拒绝重复注册、不支持位置和退役 Runtime', async () => {
  await assert.rejects(() => new PluginRuntimeAdapterRegistry().register(new WorkflowDslRuntimeAdapter()).compile({
    capability: capability('WORKFLOW_DSL', 'AGENT'),
    context: context('AGENT'),
    applicationAsset: applicationAsset(),
    resolvedInput: resolvedInput(),
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1' },
  }), /没有可用/);
  await assert.rejects(() => new PluginRuntimeAdapterRegistry().compile({
    capability: capability('TRUSTED_JS', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE'),
    applicationAsset: applicationAsset(),
    resolvedInput: resolvedInput(),
  }), /没有可用/);
});

function applicationAsset() {
  return {
    id: 'asset-1',
    address: '10.255.0.127',
    sniName: 'test02.jacksonz.cn',
    port: 443,
    protocol: 'HTTPS' as const,
    displayName: 'TEST02',
    verifyUrl: 'https://test02.jacksonz.cn',
  };
}

const resolvedInputFixture: ResolvedDeploymentInputV1 = {
  apiVersion: 'gcac.resolved-deployment-input/v1',
  contractVersion: 'gcac.deployment-input/v1',
  assetContext: {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: 'asset-1', address: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443, protocol: 'HTTPS' },
    site: { id: 'site-1', name: 'TEST02', bindingInformation: '*:443:test02.jacksonz.cn', metadata: {} },
    target: { id: 'target-1', type: 'tls.binding', key: 'target-1', metadata: {} },
    deployment: { targets: [], certificateResourceName: 'certificate-test02' },
  },
  variables: {},
  connections: {},
  credentials: {},
  artifacts: {},
  provenance: {},
  sensitivePaths: [],
  issues: [],
  executable: true,
  resolvedSha256: 'resolved-input-fixture',
};

function resolvedInput(): ResolvedDeploymentInputV1 {
  return resolvedInputFixture;
}

function capability(runtime: string, executionLocation: ResolvedDeploymentCapability['executionLocation']): ResolvedDeploymentCapability {
  // 允许负 Fixture 构造已退役 Runtime，验证注册表不会把未知值猜测成可执行适配器。
  const normalizedRuntime = runtime as ResolvedDeploymentCapability['pluginRuntime'];
  return {
    assignment: {
      id: 'assignment-1', tenantId: 'tenant-1', ownerType: 'APPLICATION_ASSET', ownerId: 'asset-1', capabilityKey: 'certificate.deploy',
      pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1', precedence: 'ASSET_OVERRIDE', status: 'ACTIVE', createdAt: '', updatedAt: '',
    },
    binding: {
      id: 'binding-1', tenantId: 'tenant-1', pluginVersionId: 'plugin-version-1', mode: 'MANAGED',
      inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, credentials: {}, artifacts: {}, connections: {} }, managedContext: { hostId: 'host-1', managedTargetId: 'target-1' },
      status: 'ACTIVE', version: 3, createdAt: '', updatedAt: '',
    },
    plugin: {
      id: 'plugin-version-1', tenantId: 'tenant-1', pluginId: 'fixture', version: '1.0.0', source: 'USER', runtime: normalizedRuntime, scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED',
      manifest: {
        apiVersion: 'gcac.plugin-manifest/v1',
        kind: 'GcacPlugin',
        pluginId: 'fixture',
        version: '1.0.0',
        displayNameKey: 'fixture',
        publisher: 'test',
        runtime: normalizedRuntime,
        source: 'USER',
        scope: 'MANAGED',
        trust: 'UNSIGNED',
        support: 'SELF_MANAGED',
        capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
        permissions: [],
        resources: {},
      },
      packageSha256: `sha256:${'a'.repeat(64)}`, manifestSha256: `sha256:${'b'.repeat(64)}`, resourceSha256: {}, resources: {}, status: 'ENABLED', permissionApprovalStatus: 'NOT_REQUIRED', approvedPermissions: [],
      validationReport: { valid: true, errors: [], warnings: [], manifestSha256: '', resourceSha256: {} }, createdAt: '', updatedAt: '',
    },
    pluginVersionId: 'plugin-version-1',
    pluginRuntime: normalizedRuntime,
    executionLocation,
    compatibility: { compatible: true, reasons: [] },
  };
}

function context(executionLocation: ExecutionLocation, options: { hostIp?: string } = {}): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target-1', tenantId: 'tenant-1', deviceId: 'host-1', discoveryProviderKey: 'fixture', targetType: 'tls.binding', targetKey: 'target-1',
      assetId: 'cloud-account-1',
      supportedCapabilities: ['certificate.deploy'], executionLocations: [executionLocation], status: 'ACTIVE', metadata: { listenerId: 'listener-1', frameworkType: 'cloud.aliyun.cdn' }, createdAt: '', updatedAt: '', version: 1,
    },
    host: {
      id: 'host-1', tenantId: 'tenant-1', primaryIp: options.hostIp ?? '10.255.0.127', ipAddresses: [options.hostIp ?? '10.255.0.127'], osType: 'LINUX', managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1',
      managementMode: 'AGENT', status: 'ACTIVE', tags: [], agentId: 'agent-1', createdAt: '', updatedAt: '', version: 1,
    },
    agent: { id: 'agent-1' } as never,
    siteAsset: {
      id: 'site-1', tenantId: 'tenant-1', frameworkInstanceId: 'framework-1', siteName: 'TEST02', bindingInformation: '*:443:test02.jacksonz.cn',
      hostHeader: 'test02.jacksonz.cn', port: 443, protocol: 'HTTPS', metadata: {}, discoverySource: 'AGENT', status: 'ACTIVE', createdAt: '', updatedAt: '', version: 1,
    } as never,
    discoveryProviderKey: 'fixture',
    frameworkType: executionLocation === 'CONTROL_PLANE' ? 'cloud.aliyun.cdn' : 'web.nginx',
    availableExecutionLocations: [executionLocation],
  };
}
