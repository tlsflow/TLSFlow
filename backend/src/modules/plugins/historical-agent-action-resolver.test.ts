import assert from 'node:assert/strict';
import test from 'node:test';
import { HistoricalAgentActionResolver } from './application/historical-agent-action-resolver.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

test('历史 Action 解析只接受当前 Assignment 固定的 Enabled PluginVersion', async () => {
  const first = plugin('version-1', 'capability.first');
  const second = plugin('version-2', 'capability.second');
  const resolver = new HistoricalAgentActionResolver(
    { listVersions: async () => [first, second] },
    { resolve: async (input: { capabilityKey: string }) => capability(input.capabilityKey === 'capability.first' ? first : second, input.capabilityKey) } as never,
  );

  await assert.rejects(
    () => resolver.resolve({ tenantId: 'tenant-1', actionType: 'fixture.vendor.deploy', resolvedInput: resolvedInput() as never }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'HISTORICAL_AGENT_ACTION_AMBIGUOUS',
  );
});

test('历史 Action 忽略 Disabled 版本并返回当前绑定身份', async () => {
  const enabled = plugin('version-enabled', 'certificate.deploy');
  const disabled = { ...plugin('version-disabled', 'certificate.deploy'), status: 'DISABLED' as const };
  const resolver = new HistoricalAgentActionResolver(
    { listVersions: async () => [disabled, enabled] },
    { resolve: async () => capability(enabled, 'certificate.deploy') } as never,
  );
  const result = await resolver.resolve({ tenantId: 'tenant-1', actionType: 'fixture.vendor.deploy', resolvedInput: resolvedInput() as never });
  assert.equal(result.capability.pluginVersionId, enabled.id);
  assert.equal(result.capability.binding.id, 'binding-version-enabled');
});

function plugin(id: string, capabilityKey: string): UnifiedPluginVersionRecord {
  const aliasPath = `action-aliases/${id}.json`;
  return {
    id, tenantId: 'tenant-1', pluginId: `plugin.${id}`, version: '1.0.0', source: 'USER', runtime: 'AGENT_ATOMIC', scope: 'MANAGED', trust: 'USER_SIGNED', support: 'SELF_MANAGED',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: `plugin.${id}`, version: '1.0.0', displayNameKey: 'plugin.fixture.name', publisher: 'fixture',
      runtime: 'AGENT_ATOMIC', source: 'USER', scope: 'MANAGED', trust: 'USER_SIGNED', support: 'SELF_MANAGED', permissions: [],
      capabilities: [{ key: capabilityKey, contractVersion: '1.0', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] }],
      compatibility: { executionLocations: ['AGENT'], artifactContracts: ['certificate.deploy.v1'] },
      resources: { agentRecipes: { [capabilityKey]: 'agent-recipes/fixture.json' }, actionAliases: { fixture: aliasPath } },
    },
    packageSha256: 'sha256:fixture', manifestSha256: 'sha256:fixture', resourceSha256: {},
    resources: { 'agent-recipes/fixture.json': '{}', [aliasPath]: JSON.stringify({ apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases', aliases: [{ actionType: 'fixture.vendor.deploy', capabilityKey, inputContract: 'certificate.deploy.v1' }] }) },
    status: 'ENABLED', permissionApprovalStatus: 'APPROVED', approvedPermissions: [], validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'sha256:fixture', resourceSha256: {} },
    createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

function capability(pluginVersion: UnifiedPluginVersionRecord, capabilityKey: string) {
  return { pluginVersionId: pluginVersion.id, plugin: pluginVersion, binding: { id: `binding-${pluginVersion.id}` }, assignment: { id: `assignment-${pluginVersion.id}` }, pluginRuntime: 'AGENT_ATOMIC', executionLocation: 'AGENT', compatibility: { compatible: true, reasons: [] }, capabilityKey };
}

function resolvedInput() {
  return { assetContext: { application: { id: 'asset-1' }, host: { id: 'host-1', osType: 'LINUX' }, target: { id: 'target-1', type: 'tls.binding', metadata: {} } } };
}
