import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentRegistration } from '../agents/schema/agents.schema.js';
import type { DeviceAssetDto } from '../device-assets/dto/device-assets.dto.js';
import type { HostDto, ManagedTargetDto } from './dto/assets.dto.js';
import { ManagedTargetContextResolver, type ManagedTargetAssetsPort } from './application/managed-target-context.resolver.js';

const now = '2026-07-22T00:00:00.000Z';
const host = { id: 'host_1', tenantId: 'tenant_1', agentId: 'agent_1', osType: 'WINDOWS', ipAddresses: [], managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1', managementMode: 'AGENT', status: 'ACTIVE', tags: [], createdAt: now, updatedAt: now, version: 1 } as HostDto;
const target = { id: 'target_1', tenantId: 'tenant_1', agentId: 'agent_1', hostId: 'host_1', providerType: 'IIS', frameworkType: 'IIS', targetType: 'SITE_BINDING', targetKey: 'site:1', capabilityProfile: {}, status: 'ACTIVE', metadata: {}, createdAt: now, updatedAt: now, version: 1 } as ManagedTargetDto;

test('Spec033 Resolver 从目标 ID 解析 Agent 完整上下文', async () => {
  const resolver = new ManagedTargetContextResolver(assetsPort(target, host), { getRegistration: async () => agent() }, { get: async () => undefined });
  const result = await resolver.resolve('tenant_1', 'target_1');
  assert.equal(result.driverKind, 'AGENT_NATIVE');
  assert.equal(result.executionLocation, 'AGENT');
  assert.equal(result.host.id, 'host_1');
});

test('Spec033 Resolver 从目标 ID 解析 NetScaler 设备上下文', async () => {
  const deviceTarget = { ...target, agentId: undefined, deviceAssetId: 'device_1', providerType: 'DEVICE_TEMPLATE', frameworkType: 'DEVICE_TEMPLATE' } as ManagedTargetDto;
  const deviceHost = { ...host, agentId: undefined, osType: 'NETWORK_DEVICE', managementMode: 'AGENTLESS' } as HostDto;
  const resolver = new ManagedTargetContextResolver(assetsPort(deviceTarget, deviceHost), { getRegistration: async () => undefined }, { get: async () => device() });
  const result = await resolver.resolve('tenant_1', 'target_1');
  assert.equal(result.driverKind, 'DEVICE_PROVIDER');
  assert.equal(result.executionLocation, 'CONTROL_PLANE');
  assert.equal(result.deviceAsset?.id, 'device_1');
});

test('Spec033 Resolver 拒绝跨租户、禁用和关系冲突目标', async () => {
  const empty = new ManagedTargetContextResolver(assetsPort(undefined, undefined), { getRegistration: async () => undefined }, { get: async () => undefined });
  await assert.rejects(() => empty.resolve('tenant_2', 'target_1'));
  const disabled = new ManagedTargetContextResolver(assetsPort({ ...target, status: 'DISABLED' }, host), { getRegistration: async () => undefined }, { get: async () => undefined });
  await assert.rejects(() => disabled.resolve('tenant_1', 'target_1'));
  const conflict = new ManagedTargetContextResolver(assetsPort(target, { ...host, agentId: 'agent_other' }), { getRegistration: async () => undefined }, { get: async () => undefined });
  await assert.rejects(() => conflict.resolve('tenant_1', 'target_1'));
});

function assetsPort(managedTarget: ManagedTargetDto | undefined, managedHost: HostDto | undefined): ManagedTargetAssetsPort {
  return {
    getManagedTarget: async () => managedTarget,
    getHost: async () => managedHost,
    getSiteAsset: async () => undefined,
    getServiceAsset: async () => undefined,
    getServiceInstance: async () => undefined,
  };
}

function agent(): AgentRegistration {
  return { id: 'agent_1', tenantId: 'tenant_1', agentKey: 'agent', descriptor: { agentKey: 'agent', hostname: 'server', version: '1', osType: 'windows', labels: [] }, status: 'ONLINE', registeredAt: now, updatedAt: now, version: 1 };
}

function device(): DeviceAssetDto {
  return { id: 'device_1', tenantId: 'tenant_1', hostId: 'host_1', displayName: 'ADC', managementAddress: '10.0.0.1', managementPort: 443, deviceFamily: 'NETSCALER_ADC', credentialId: 'secret', authMode: 'AUTO', tlsVerify: true, supportTier: 'SUPPORTED', capabilityProfile: {}, createdAt: now, updatedAt: now, version: 1 };
}
