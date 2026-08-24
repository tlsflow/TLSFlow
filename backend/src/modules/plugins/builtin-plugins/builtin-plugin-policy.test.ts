import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import {
  builtinPluginPermissionAllowlist,
  validateBuiltinPluginPolicy,
} from './builtin-plugin-policy.js';

test('内置 Policy 固定官方信任、Runner 合同和 Canonical ID', () => {
  const decision = validateBuiltinPluginPolicy(baseManifest());

  assert.equal(decision.pluginId, 'web.nginx');
  assert.equal(decision.executionMode, 'PLUGIN_RUNNER');
  assert.equal(decision.ipcProtocol, 'gcac.plugin-runner/v1');
  assert.equal(decision.runtimeEntrypoint, 'runtime/index.js');
});

test('内置 Policy 拒绝历史危险权限和未登记权限', () => {
  const forbidden = baseManifest();
  forbidden.permissions = ['runtime.execute_unknown_code'];
  assert.throws(() => validateBuiltinPluginPolicy(forbidden), /禁止权限/);

  const unknown = baseManifest();
  unknown.permissions = ['host.object.call'];
  assert.throws(() => validateBuiltinPluginPolicy(unknown), /未登记权限/);
  assert.equal(builtinPluginPermissionAllowlist.includes('host.object.call'), false);
});

test('内置 Policy 拒绝非官方信任等级和非 Runner 入口', () => {
  const unsigned = baseManifest();
  unsigned.trust = 'UNSIGNED';
  assert.throws(() => validateBuiltinPluginPolicy(unsigned), /官方信任/);

  const wrongEntrypoint = baseManifest();
  wrongEntrypoint.resources.runtimeEntrypoint = 'runtime/other.js';
  assert.throws(() => validateBuiltinPluginPolicy(wrongEntrypoint), /runtime\/index\.js/);
});

function baseManifest(): UnifiedPluginManifestV1 {
  return {
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: 'web.nginx',
    version: '1.0.0',
    displayNameKey: 'plugin.webNginx.name',
    publisher: 'GCAC',
    runtime: 'WORKFLOW_DSL',
    source: 'BUILTIN',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    capabilities: [{
      key: 'application.discover',
      contractVersion: 'v1',
      actionContractId: 'application.discover.v1',
      riskLevel: 'LOW',
      executionLocations: ['CONTROL_PLANE'],
    }],
    permissions: [],
    resources: {
      runtimeEntrypoint: 'runtime/index.js',
      workflows: { 'application.discover': 'workflows/discover.json' },
    },
  };
}
