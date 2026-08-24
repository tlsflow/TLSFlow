import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePluginActionAliases } from './schema/plugin-action-aliases.schema.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';

test('插件历史 Action 别名必须引用当前插件声明的 Agent 能力和输入 Contract', () => {
  const result = validatePluginActionAliases({
    apiVersion: 'gcac.plugin-action-aliases/v1',
    kind: 'PluginActionAliases',
    aliases: [{ actionType: 'fixture.vendor.deploy', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' }],
  }, manifest());
  assert.equal(result.aliases[0]?.actionType, 'fixture.vendor.deploy');

  assert.throws(() => validatePluginActionAliases({
    apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases',
    aliases: [{ actionType: 'fixture.vendor.deploy', capabilityKey: 'certificate.deploy', inputContract: 'legacy.contract' }],
  }, manifest()), /输入 Contract/);
});

test('插件历史 Action 别名拒绝重复、标准 Atomic Action 和任意扩展字段', () => {
  assert.throws(() => validatePluginActionAliases({
    apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases', aliases: [
      { actionType: 'fixture.vendor.deploy', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' },
      { actionType: 'FIXTURE.VENDOR.DEPLOY', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' },
    ],
  }, manifest()), /重复/);
  assert.throws(() => validatePluginActionAliases({
    apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases',
    aliases: [{ actionType: 'agent.atomic_plan.execute', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1', command: 'rm' }],
  }, manifest()), /未知字段/);
});

function manifest(): UnifiedPluginManifestV1 {
  return {
    apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'plugin.fixture', version: '1.0.0', displayNameKey: 'plugin.fixture.name', publisher: 'fixture',
    runtime: 'AGENT_ATOMIC', source: 'USER', scope: 'MANAGED', trust: 'USER_SIGNED', support: 'SELF_MANAGED', permissions: [],
    capabilities: [{ key: 'certificate.deploy', contractVersion: '1.0', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] }],
    resources: { agentRecipes: { 'certificate.deploy': 'agent-recipes/fixture.json' } },
  };
}
