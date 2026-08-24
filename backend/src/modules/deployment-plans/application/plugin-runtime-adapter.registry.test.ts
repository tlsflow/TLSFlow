import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionLocation, ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import {
  AgentAtomicRuntimeAdapter,
  PluginRuntimeAdapterRegistry,
  WorkflowDslRuntimeAdapter,
  createDefaultPluginRuntimeAdapterRegistry,
} from './plugin-runtime-adapter.registry.js';

test('PluginRuntimeAdapterRegistry 使用同一接口编译 Agent Atomic', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('AGENT_ATOMIC', 'AGENT'),
    context: context('AGENT'),
    applicationAsset: applicationAsset(),
    certificateBindingId: 'certificate-binding-1',
  });
  assert.equal(result.executorType, 'AGENT');
  assert.equal(result.executionTargetId, 'agent-1');
  assert.equal((result.payload.pluginRuntimeCapability as { pluginBindingId: string }).pluginBindingId, 'binding-1');
  assert.deepEqual(result.payload.certificateVerification, {
    capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443, expectedDomains: ['test02.jacksonz.cn'],
  });
  const assetContext = result.payload.pluginExecutionContext as Record<string, Record<string, unknown>>;
  assert.equal(assetContext.apiVersion, 'gcac.deployment-asset-context/v1');
  assert.equal(assetContext.application.serverName, 'test02.jacksonz.cn');
  assert.equal(assetContext.target.key, 'target-1');
  assert.equal('frameworkType' in assetContext.target, false);
  assert.equal('configPath' in assetContext.site, false);
});

test('PluginRuntimeAdapterRegistry 使用同一接口编译 Workflow DSL', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('WORKFLOW_DSL', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE'),
    applicationAsset: applicationAsset(),
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1', credentials: {} },
  });
  assert.equal(result.executorType, 'WORKFLOW');
  assert.equal((result.payload.workflowRequest as { workflowVersionId: string }).workflowVersionId, 'workflow-version-1');
  assert.equal((result.payload.certificateVerification as { capabilityKey: string }).capabilityKey, 'certificate.verify');
});

test('PluginRuntimeAdapterRegistry 拒绝重复注册和不支持的执行位置', async () => {
  assert.throws(() => new PluginRuntimeAdapterRegistry().register(new AgentAtomicRuntimeAdapter()).register(new AgentAtomicRuntimeAdapter()), /重复注册/);
  await assert.rejects(() => new PluginRuntimeAdapterRegistry().register(new WorkflowDslRuntimeAdapter()).compile({
    capability: capability('WORKFLOW_DSL', 'AGENT'),
    context: context('AGENT'),
    applicationAsset: applicationAsset(),
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1', credentials: {} },
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
  };
}

function capability(runtime: ResolvedDeploymentCapability['pluginRuntime'], executionLocation: ResolvedDeploymentCapability['executionLocation']): ResolvedDeploymentCapability {
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
      id: 'plugin-version-1', tenantId: 'tenant-1', pluginId: 'fixture', version: '1.0.0', source: 'USER', runtime, scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED',
      manifest: { apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'fixture', version: '1.0.0', displayNameKey: 'fixture', publisher: 'test', runtime, source: 'USER', scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED', capabilities: [], permissions: [], resources: {} },
      packageSha256: '', manifestSha256: '', resourceSha256: {}, resources: {}, status: 'ENABLED', permissionApprovalStatus: 'NOT_REQUIRED', approvedPermissions: [],
      validationReport: { valid: true, errors: [], warnings: [], manifestSha256: '', resourceSha256: {} }, createdAt: '', updatedAt: '',
    },
    pluginVersionId: 'plugin-version-1',
    pluginRuntime: runtime,
    executionLocation,
    compatibility: { compatible: true, reasons: [] },
  };
}

function context(executionLocation: ExecutionLocation): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target-1', tenantId: 'tenant-1', deviceId: 'host-1', discoveryProviderKey: 'fixture', targetType: 'tls.binding', targetKey: 'target-1',
      supportedCapabilities: ['certificate.deploy'], executionLocations: [executionLocation], status: 'ACTIVE', metadata: {}, createdAt: '', updatedAt: '', version: 1,
    },
    host: {
      id: 'host-1', tenantId: 'tenant-1', primaryIp: '10.255.0.127', ipAddresses: ['10.255.0.127'], osType: 'LINUX', managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1',
      managementMode: 'AGENT', status: 'ACTIVE', tags: [], agentId: 'agent-1', createdAt: '', updatedAt: '', version: 1,
    },
    agent: { id: 'agent-1' } as never,
    siteAsset: {
      id: 'site-1', tenantId: 'tenant-1', frameworkInstanceId: 'framework-1', siteName: 'TEST02', bindingInformation: '*:443:test02.jacksonz.cn',
      hostHeader: 'test02.jacksonz.cn', port: 443, protocol: 'HTTPS', metadata: {}, discoverySource: 'AGENT', status: 'ACTIVE', createdAt: '', updatedAt: '', version: 1,
    } as never,
    discoveryProviderKey: 'fixture',
    frameworkType: 'web.nginx',
    availableExecutionLocations: [executionLocation],
  };
}
