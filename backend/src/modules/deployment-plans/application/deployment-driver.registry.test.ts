import assert from 'node:assert/strict';
import test from 'node:test';

import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import { createBuiltinDeploymentDriverRegistry, DeploymentDriverRegistry } from './deployment-driver.registry.js';

test('Spec033 内置驱动解析 Agent Native、Agent Plugin 和统一设备插件', () => {
  const registry = createBuiltinDeploymentDriverRegistry();
  assert.equal(registry.resolve(context('AGENT_NATIVE', 'AGENT', 'web.iis')).kind, 'AGENT_NATIVE');
  assert.equal(registry.resolve(context('AGENT_PLUGIN', 'AGENT', 'custom.runtime')).kind, 'AGENT_PLUGIN');
  const plugin = registry.resolve(context('DEVICE_PLUGIN', 'CONTROL_PLANE', 'adc.load-balancer'));
  assert.equal(plugin.kind, 'DEVICE_PLUGIN');
  assert.deepEqual(plugin.buildDeployment(context('DEVICE_PLUGIN', 'CONTROL_PLANE', 'adc.load-balancer')).map((step) => step.stage), ['DEPLOY']);
});

test('Spec033 驱动支持 Gateway 并拒绝未注册类型', () => {
  const registry = createBuiltinDeploymentDriverRegistry();
  assert.equal(registry.resolve(context('DEVICE_PLUGIN', 'GATEWAY', 'adc.load-balancer')).kind, 'DEVICE_PLUGIN');
  assert.throws(() => new DeploymentDriverRegistry().resolve({
    ...context('DEVICE_PLUGIN', 'CONTROL_PLANE', 'DEVICE_TEMPLATE'),
    driverKind: 'DEVICE_PROVIDER',
  } as never));
});

function context(driverKind: ResolvedManagedTargetContext['driverKind'], executionLocation: ResolvedManagedTargetContext['executionLocation'], frameworkType: string): ResolvedManagedTargetContext {
  return {
    managedTarget: { id: 'target_1', tenantId: 'tenant_1', deviceId: 'host_1', discoveryProviderKey: 'plugin.discovery', targetType: 'tls.binding', targetKey: 'target', supportedCapabilities: ['certificate.deploy'], executionLocations: [executionLocation], status: 'ACTIVE', metadata: {}, createdAt: '', updatedAt: '', version: 1 },
    host: { id: 'host_1', tenantId: 'tenant_1', osType: 'NETWORK_DEVICE', ipAddresses: [], managementChannels: [], discoverySource: 'PROVIDER', compatibilityLevel: 'L1', managementMode: 'AGENTLESS', status: 'ACTIVE', tags: [], createdAt: '', updatedAt: '', version: 1 },
    discoveryProviderKey: 'plugin.discovery',
    frameworkType,
    driverKind,
    executionLocation,
    availableExecutionLocations: [executionLocation],
    deviceAsset: driverKind === 'DEVICE_PLUGIN' ? { id: 'device_1', tenantId: 'tenant_1', hostId: 'host_1', displayName: 'Plugin Device', managementAddress: '10.0.0.1', managementPort: 443, deviceFamily: 'generic.device-plugin', credentialId: 'secret://password/device#v1', authMode: 'PLUGIN', tlsVerify: true, supportTier: 'SUPPORTED', capabilityProfile: {}, pluginBindingId: 'binding_plugin_test', pluginVersionId: 'plugin_test', createdAt: '', updatedAt: '', version: 1 } : undefined,
  };
}
