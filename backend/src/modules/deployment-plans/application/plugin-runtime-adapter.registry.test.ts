import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
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
    applicationAssetId: 'asset-1',
    certificateBindingId: 'certificate-binding-1',
  });
  assert.equal(result.executorType, 'AGENT');
  assert.equal(result.executionTargetId, 'agent-1');
  assert.equal((result.payload.pluginRuntimeCapability as { pluginBindingId: string }).pluginBindingId, 'binding-1');
});

test('PluginRuntimeAdapterRegistry 使用同一接口编译 Workflow DSL', async () => {
  const result = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability: capability('WORKFLOW_DSL', 'CONTROL_PLANE'),
    context: context('CONTROL_PLANE'),
    applicationAssetId: 'asset-1',
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1', credentials: {} },
  });
  assert.equal(result.executorType, 'WORKFLOW');
  assert.equal((result.payload.workflowRequest as { workflowVersionId: string }).workflowVersionId, 'workflow-version-1');
});

test('PluginRuntimeAdapterRegistry 拒绝重复注册和不支持的执行位置', async () => {
  assert.throws(() => new PluginRuntimeAdapterRegistry().register(new AgentAtomicRuntimeAdapter()).register(new AgentAtomicRuntimeAdapter()), /重复注册/);
  await assert.rejects(() => new PluginRuntimeAdapterRegistry().register(new WorkflowDslRuntimeAdapter()).compile({
    capability: capability('WORKFLOW_DSL', 'AGENT'),
    context: context('AGENT'),
    applicationAssetId: 'asset-1',
    workflow: { workflowId: 'workflow-1', workflowVersionId: 'workflow-version-1', credentials: {} },
  }), /没有可用/);
});

function capability(runtime: ResolvedDeploymentCapability['pluginRuntime'], executionLocation: ResolvedDeploymentCapability['executionLocation']): ResolvedDeploymentCapability {
  return {
    assignment: {
      id: 'assignment-1', tenantId: 'tenant-1', ownerType: 'APPLICATION_ASSET', ownerId: 'asset-1', capabilityKey: 'certificate.deploy',
      pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1', precedence: 'ASSET_OVERRIDE', status: 'ACTIVE', createdAt: '', updatedAt: '',
    },
    binding: {
      id: 'binding-1', tenantId: 'tenant-1', pluginVersionId: 'plugin-version-1', mode: 'MANAGED', variableBindings: {}, credentialBindings: {},
      secretBindings: {}, certificateArtifactBindings: {}, connectionBindings: {}, managedContext: { hostId: 'host-1', managedTargetId: 'target-1' },
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

function context(executionLocation: ResolvedManagedTargetContext['executionLocation']): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target-1', tenantId: 'tenant-1', deviceId: 'host-1', discoveryProviderKey: 'fixture', targetType: 'tls.binding', targetKey: 'target-1',
      supportedCapabilities: ['certificate.deploy'], executionLocations: [executionLocation], status: 'ACTIVE', metadata: {}, createdAt: '', updatedAt: '', version: 1,
    },
    host: {
      id: 'host-1', tenantId: 'tenant-1', ipAddresses: [], osType: 'LINUX', managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1',
      managementMode: 'AGENT', status: 'ACTIVE', tags: [], agentId: 'agent-1', createdAt: '', updatedAt: '', version: 1,
    },
    agent: { id: 'agent-1' } as never,
    discoveryProviderKey: 'fixture',
    frameworkType: 'web.nginx',
    driverKind: executionLocation === 'AGENT' ? 'AGENT_NATIVE' : 'DEVICE_PLUGIN',
    executionLocation,
    availableExecutionLocations: [executionLocation],
  };
}
