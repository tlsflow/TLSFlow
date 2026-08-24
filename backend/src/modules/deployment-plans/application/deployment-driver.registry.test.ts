import assert from 'node:assert/strict';
import test from 'node:test';

import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import { createBuiltinDeploymentDriverRegistry, DeploymentDriverRegistry } from './deployment-driver.registry.js';

test('Spec033 内置驱动解析 Agent Native、Agent Plugin 和 NetScaler Provider', () => {
  const registry = createBuiltinDeploymentDriverRegistry();
  assert.equal(registry.resolve(context('AGENT_NATIVE', 'AGENT', 'IIS')).kind, 'AGENT_NATIVE');
  assert.equal(registry.resolve(context('AGENT_PLUGIN', 'AGENT', 'CUSTOM')).kind, 'AGENT_PLUGIN');
  const netscaler = registry.resolve(context('DEVICE_PROVIDER', 'CONTROL_PLANE', 'DEVICE_TEMPLATE'));
  assert.equal(netscaler.kind, 'DEVICE_PROVIDER');
  assert.deepEqual(netscaler.buildDeployment(context('DEVICE_PROVIDER', 'CONTROL_PLANE', 'DEVICE_TEMPLATE')).map((step) => step.stage), ['BACKUP', 'DEPLOY', 'VERIFY']);
});

test('Spec033 驱动拒绝执行位置冲突和未注册类型', () => {
  const registry = createBuiltinDeploymentDriverRegistry();
  assert.throws(() => registry.resolve(context('DEVICE_PROVIDER', 'AGENT', 'DEVICE_TEMPLATE')));
  assert.throws(() => new DeploymentDriverRegistry().resolve(context('DEVICE_PLUGIN', 'GATEWAY', 'DEVICE_TEMPLATE')));
});

function context(driverKind: ResolvedManagedTargetContext['driverKind'], executionLocation: ResolvedManagedTargetContext['executionLocation'], providerType: ResolvedManagedTargetContext['providerType']): ResolvedManagedTargetContext {
  return {
    managedTarget: { id: 'target_1', tenantId: 'tenant_1', hostId: 'host_1', providerType, frameworkType: providerType, targetType: 'CUSTOM', targetKey: 'target', capabilityProfile: {}, status: 'ACTIVE', metadata: {}, createdAt: '', updatedAt: '', version: 1 },
    host: { id: 'host_1', tenantId: 'tenant_1', osType: 'NETWORK_DEVICE', ipAddresses: [], managementChannels: [], discoverySource: 'PROVIDER', compatibilityLevel: 'L1', managementMode: 'AGENTLESS', status: 'ACTIVE', tags: [], createdAt: '', updatedAt: '', version: 1 },
    providerType,
    driverKind,
    executionLocation,
    deviceAsset: driverKind === 'DEVICE_PROVIDER' ? { id: 'device_1', tenantId: 'tenant_1', hostId: 'host_1', displayName: 'ADC', managementAddress: '10.0.0.1', managementPort: 443, deviceFamily: 'NETSCALER_ADC', credentialId: 'secret://password/adc#v1', authMode: 'AUTO', tlsVerify: true, supportTier: 'SUPPORTED', capabilityProfile: {}, createdAt: '', updatedAt: '', version: 1 } : undefined,
  };
}
