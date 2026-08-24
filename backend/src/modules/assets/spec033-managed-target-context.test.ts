import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import type { AgentRegistration } from '../agents/schema/agents.schema.js';
import type { DeviceAssetDto } from '../device-assets/dto/device-assets.dto.js';
import type { HostDto, ManagedTargetDto } from './dto/assets.dto.js';
import { ManagedTargetContextResolver, type ManagedTargetAssetsPort } from './application/managed-target-context.resolver.js';

const now = '2026-07-22T00:00:00.000Z';
const host = { id: 'host_1', tenantId: 'tenant_1', agentId: 'agent_1', osType: 'WINDOWS', ipAddresses: [], managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1', managementMode: 'AGENT', status: 'ACTIVE', tags: [], createdAt: now, updatedAt: now, version: 1 } as HostDto;
const target = { id: 'target_1', tenantId: 'tenant_1', deviceId: 'host_1', discoveryProviderKey: 'agent.discovery', targetType: 'tls.binding', targetKey: 'site:1', supportedCapabilities: ['certificate.deploy'], executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {}, createdAt: now, updatedAt: now, version: 1 } as ManagedTargetDto;

test('Spec033 Resolver 从目标 ID 解析 Agent 完整上下文', async () => {
  const resolver = new ManagedTargetContextResolver(assetsPort(target, host), { getRegistration: async () => agent() }, { findByHostId: async () => undefined });
  const result = await resolver.resolve('tenant_1', 'target_1');
  assert.equal('driverKind' in result, false);
  assert.equal('executionLocation' in result, false);
  assert.deepEqual(result.availableExecutionLocations, ['AGENT']);
  assert.equal(result.host.id, 'host_1');
});

test('Spec033 Resolver 从目标 ID 解析统一插件设备上下文', async () => {
  const deviceTarget = { ...target, discoveryProviderKey: 'plugin-version:version_1', executionLocations: ['CONTROL_PLANE', 'GATEWAY'] } as ManagedTargetDto;
  const deviceHost = { ...host, agentId: undefined, osType: 'NETWORK_DEVICE', managementMode: 'AGENTLESS' } as HostDto;
  const resolver = new ManagedTargetContextResolver(assetsPort(deviceTarget, deviceHost), { getRegistration: async () => undefined }, { findByHostId: async () => device() });
  const result = await resolver.resolve('tenant_1', 'target_1');
  assert.equal('driverKind' in result, false);
  assert.equal('executionLocation' in result, false);
  assert.deepEqual(result.availableExecutionLocations, ['CONTROL_PLANE']);
  assert.equal(result.deviceAsset?.id, 'device_1');
});

test('Spec034.1 Resolver 只汇总可用执行位置，不选择所有者驱动', async () => {
  const hybridTarget = { ...target, executionLocations: ['AGENT', 'CONTROL_PLANE', 'GATEWAY'] } as ManagedTargetDto;
  const resolver = new ManagedTargetContextResolver(
    assetsPort(hybridTarget, host),
    { getRegistration: async () => agent() },
    { findByHostId: async () => ({ ...device(), gatewayId: 'gateway_1' }) },
  );
  const result = await resolver.resolve('tenant_1', 'target_1');

  assert.deepEqual(result.availableExecutionLocations, ['AGENT', 'GATEWAY', 'CONTROL_PLANE']);
  assert.equal('driverKind' in result, false);
  assert.equal('executionLocation' in result, false);
});

test('Spec033 Resolver 拒绝跨租户、禁用和关系冲突目标', async () => {
  const empty = new ManagedTargetContextResolver(assetsPort(undefined, undefined), { getRegistration: async () => undefined }, { findByHostId: async () => undefined });
  await assert.rejects(() => empty.resolve('tenant_2', 'target_1'));
  const disabled = new ManagedTargetContextResolver(assetsPort({ ...target, status: 'DISABLED' }, host), { getRegistration: async () => undefined }, { findByHostId: async () => undefined });
  await assert.rejects(() => disabled.resolve('tenant_1', 'target_1'));
  const unavailable = new ManagedTargetContextResolver(assetsPort(target, { ...host, agentId: undefined }), { getRegistration: async () => undefined }, { findByHostId: async () => undefined });
  await assert.rejects(() => unavailable.resolve('tenant_1', 'target_1'), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal((error.details as { code?: string }).code, 'MANAGED_TARGET_OWNER_UNAVAILABLE');
    return true;
  });
});

function assetsPort(managedTarget: ManagedTargetDto | undefined, managedHost: HostDto | undefined): ManagedTargetAssetsPort {
  return {
    getManagedTarget: async () => managedTarget,
    getHost: async () => managedHost,
    getSiteAsset: async () => undefined,
    getFrameworkInstance: async () => undefined,
  };
}

function agent(): AgentRegistration {
  return { id: 'agent_1', tenantId: 'tenant_1', agentKey: 'agent', descriptor: { agentKey: 'agent', hostname: 'server', version: '1', osType: 'windows', labels: [] }, status: 'ONLINE', registeredAt: now, updatedAt: now, version: 1 };
}

function device(): DeviceAssetDto {
  return { id: 'device_1', tenantId: 'tenant_1', hostId: 'host_1', displayName: 'Plugin Device', managementAddress: '10.0.0.1', managementPort: 443, deviceFamily: 'vendor.product', pluginVersionId: 'version_1', pluginBindingId: 'binding_1', credentialId: 'secret', authMode: 'AUTO', tlsVerify: true, supportTier: 'SUPPORTED', capabilityProfile: {}, createdAt: now, updatedAt: now, version: 1 };
}
