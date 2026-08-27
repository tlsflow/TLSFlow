import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { DeploymentCapabilityResolver } from './application/deployment-capability.resolver.js';
import type { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

const assignment = {
  id: 'assignment-1', tenantId: 'tenant-1', ownerType: 'MANAGED_TARGET', ownerId: 'target-1',
  capabilityKey: 'certificate.deploy', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1',
  precedence: 'TARGET_OVERRIDE', status: 'ACTIVE', createdAt: '', updatedAt: '',
} as const;

const binding = {
  id: 'binding-1', tenantId: 'tenant-1', pluginVersionId: 'plugin-version-1', mode: 'MANAGED',
  variableBindings: {}, credentialBindings: {}, secretBindings: {}, certificateArtifactBindings: {}, connectionBindings: {},
  managedContext: { hostId: 'host-1', managedTargetId: 'target-1' }, status: 'ACTIVE', version: 1, createdAt: '', updatedAt: '',
} as const;

function plugin(executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'> = ['CONTROL_PLANE']): UnifiedPluginVersionRecord {
  return {
    id: 'plugin-version-1', tenantId: 'tenant-1', pluginId: 'fixture', version: '1.0.0', source: 'USER', runtime: 'WORKFLOW_DSL', scope: 'MANAGED',
    trust: 'UNSIGNED', support: 'SELF_MANAGED', packageSha256: 'package', manifestSha256: 'manifest', resourceSha256: {}, resources: {}, status: 'ENABLED',
    permissionApprovalStatus: 'NOT_REQUIRED', approvedPermissions: [], validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'manifest', resourceSha256: {} },
    createdAt: '', updatedAt: '', manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'fixture', version: '1.0.0', displayNameKey: 'fixture', publisher: 'test',
      runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED', permissions: [], resources: {},
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations }],
      compatibility: { executionLocations },
    },
  };
}

function resolver(options: { hostId?: string; executionLocations?: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>; plugin?: UnifiedPluginVersionRecord } = {}) {
  const bindings = {
    listAssignmentCandidates: async () => [assignment],
    getTenantBinding: async () => ({ ...binding, managedContext: { ...binding.managedContext, hostId: options.hostId ?? 'host-1' } }),
  } as unknown as PluginBindingsApplicationService;
  return new DeploymentCapabilityResolver(bindings, { getVersion: async () => options.plugin ?? plugin(options.executionLocations) });
}

test('DeploymentCapabilityResolver 固定 Assignment、Binding、Runtime 和执行位置', async () => {
  const resolved = await resolver().resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} });
  assert.equal(resolved.assignment.id, 'assignment-1');
  assert.equal(resolved.binding.id, 'binding-1');
  assert.equal(resolved.pluginRuntime, 'WORKFLOW_DSL');
  assert.equal(resolved.executionLocation, 'CONTROL_PLANE');
});

test('DeploymentCapabilityResolver 支持没有 Host 的 CloudAccountAsset ManagedTarget', async () => {
  const cloudAssignment = { ...assignment, ownerType: 'MANAGED_TARGET', ownerId: 'cloud-target-1' } as const;
  const cloudBinding = {
    ...binding,
    id: 'cloud-binding-1',
    managedContext: { cloudAccountAssetId: 'cloud-account-1', managedTargetId: 'cloud-target-1' },
  } as const;
  const bindings = {
    listAssignmentCandidates: async () => [cloudAssignment],
    getTenantBinding: async () => cloudBinding,
  } as unknown as PluginBindingsApplicationService;
  const resolved = await new DeploymentCapabilityResolver(bindings, { getVersion: async () => plugin(['CONTROL_PLANE']) }).resolve({
    tenantId: 'tenant-1',
    capabilityKey: 'certificate.deploy',
    cloudAccountAssetId: 'cloud-account-1',
    managedTargetId: 'cloud-target-1',
    executionLocations: ['CONTROL_PLANE'],
    compatibility: { targetType: 'cloud.cdn.domain', managementMethod: 'PLUGIN' },
  });
  assert.equal(resolved.binding.managedContext?.cloudAccountAssetId, 'cloud-account-1');
  assert.equal(resolved.binding.managedContext?.hostId, undefined);
  assert.equal(resolved.executionLocation, 'CONTROL_PLANE');
});

test('DeploymentCapabilityResolver 允许当前租户解析 SYSTEM 内置插件版本', async () => {
  const builtin = plugin();
  builtin.tenantId = 'SYSTEM';
  builtin.ownerType = 'SYSTEM';
  builtin.source = 'BUILTIN';
  builtin.manifest.source = 'BUILTIN';
  const resolved = await resolver({ plugin: builtin }).resolve({
    tenantId: 'tenant-1',
    capabilityKey: 'certificate.deploy',
    hostId: 'host-1',
    managedTargetId: 'target-1',
    applicationAssetId: 'asset-1',
    executionLocations: ['CONTROL_PLANE'],
    compatibility: {},
  });
  assert.equal(resolved.plugin.source, 'BUILTIN');
  assert.equal(resolved.plugin.tenantId, 'SYSTEM');
});

test('DeploymentCapabilityResolver 拒绝所有候选 Binding Host 身份冲突', async () => {
  await assert.rejects(
    resolver({ hostId: 'host-2' }).resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} }),
    /没有上下文匹配的插件能力指派/,
  );
});

test('DeploymentCapabilityResolver 无 Assignment 时失败关闭', async () => {
  const bindings = {
    listAssignmentCandidates: async () => [],
    getTenantBinding: async () => { throw new Error('不应读取 Binding'); },
  } as unknown as PluginBindingsApplicationService;
  const capabilityResolver = new DeploymentCapabilityResolver(bindings, { getVersion: async () => plugin() });

  await assert.rejects(
    capabilityResolver.resolve({
      tenantId: 'tenant-1',
      capabilityKey: 'certificate.deploy',
      hostId: 'host-1',
      managedTargetId: 'target-1',
      applicationAssetId: 'asset-1',
      executionLocations: ['CONTROL_PLANE'],
      compatibility: {},
    }),
    (error) => error instanceof AppError && error.errorCode === 'CAPABILITY_MISSING',
  );
});

test('DeploymentCapabilityResolver 跳过错配应用资产指派并回退到目标指派', async () => {
  const staleAssignment = { ...assignment, id: 'assignment-stale', ownerType: 'APPLICATION_ASSET', ownerId: 'asset-1', pluginBindingId: 'binding-stale' } as const;
  const targetAssignment = { ...assignment, id: 'assignment-target', ownerType: 'MANAGED_TARGET', ownerId: 'target-1', pluginBindingId: 'binding-target' } as const;
  const bindings = {
    listAssignmentCandidates: async () => [staleAssignment, targetAssignment],
    getTenantBinding: async (_tenantId: string, bindingId: string) => ({
      ...binding,
      id: bindingId,
      managedContext: bindingId === 'binding-stale'
        ? { hostId: 'host-stale', managedTargetId: 'target-stale' }
        : { hostId: 'host-1', managedTargetId: 'target-1' },
    }),
  } as unknown as PluginBindingsApplicationService;
  const resolved = await new DeploymentCapabilityResolver(bindings, { getVersion: async () => plugin() }).resolve({
    tenantId: 'tenant-1',
    capabilityKey: 'certificate.deploy',
    hostId: 'host-1',
    managedTargetId: 'target-1',
    applicationAssetId: 'asset-1',
    executionLocations: ['CONTROL_PLANE'],
    compatibility: {},
  });
  assert.equal(resolved.assignment.id, 'assignment-target');
  assert.equal(resolved.binding.id, 'binding-target');
});

test('DeploymentCapabilityResolver 拒绝插件不支持的执行位置', async () => {
  await assert.rejects(
    resolver({ executionLocations: ['AGENT'] }).resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} }),
    /不支持目标执行位置/,
  );
});

test('DeploymentCapabilityResolver 只接受精确产品族标识', async () => {
  const resolvedPlugin = plugin();
  resolvedPlugin.manifest.compatibility = { productFamilies: ['WINDOWS_SERVER'] };
  const bindings = {
    listAssignmentCandidates: async () => [assignment],
    getTenantBinding: async () => binding,
  } as unknown as PluginBindingsApplicationService;
  const resolved = await new DeploymentCapabilityResolver(bindings, { getVersion: async () => resolvedPlugin }).resolve({
    tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1',
    executionLocations: ['CONTROL_PLANE'], compatibility: { productFamily: 'WINDOWS_SERVER' },
  });
  assert.equal(resolved.compatibility.compatible, true);
});
