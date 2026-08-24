import assert from 'node:assert/strict';
import test from 'node:test';
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

function resolver(options: { hostId?: string; executionLocations?: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'> } = {}) {
  const bindings = {
    resolveAssignment: async () => assignment,
    getTenantBinding: async () => ({ ...binding, managedContext: { ...binding.managedContext, hostId: options.hostId ?? 'host-1' } }),
  } as unknown as PluginBindingsApplicationService;
  return new DeploymentCapabilityResolver(bindings, { getVersion: async () => plugin(options.executionLocations) });
}

test('DeploymentCapabilityResolver 固定 Assignment、Binding、Runtime 和执行位置', async () => {
  const resolved = await resolver().resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} });
  assert.equal(resolved.assignment.id, 'assignment-1');
  assert.equal(resolved.binding.id, 'binding-1');
  assert.equal(resolved.pluginRuntime, 'WORKFLOW_DSL');
  assert.equal(resolved.executionLocation, 'CONTROL_PLANE');
});

test('DeploymentCapabilityResolver 拒绝 Binding Host 身份冲突', async () => {
  await assert.rejects(
    resolver({ hostId: 'host-2' }).resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} }),
    /不属于目标 Host/,
  );
});

test('DeploymentCapabilityResolver 拒绝插件不支持的执行位置', async () => {
  await assert.rejects(
    resolver({ executionLocations: ['AGENT'] }).resolve({ tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1', executionLocations: ['CONTROL_PLANE'], compatibility: {} }),
    /不支持目标执行位置/,
  );
});

test('DeploymentCapabilityResolver 对产品族分隔符和大小写差异使用统一规范化比较', async () => {
  const resolvedPlugin = plugin();
  resolvedPlugin.manifest.compatibility = { productFamilies: ['WINDOWS_SERVER'] };
  const bindings = {
    resolveAssignment: async () => assignment,
    getTenantBinding: async () => binding,
  } as unknown as PluginBindingsApplicationService;
  const resolved = await new DeploymentCapabilityResolver(bindings, { getVersion: async () => resolvedPlugin }).resolve({
    tenantId: 'tenant-1', capabilityKey: 'certificate.deploy', hostId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1',
    executionLocations: ['CONTROL_PLANE'], compatibility: { productFamily: 'Windows Server' },
  });
  assert.equal(resolved.compatibility.compatible, true);
});
