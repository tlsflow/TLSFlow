import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUnifiedPluginManifest } from './schema/unified-plugins.schema.js';

test('旧 Agent Deployment Plugin Schema 已清退，旧 Runtime 不能进入最新 Manifest 合同', async () => {
  await assertModuleMissing('./schema/agent-deployment-plugins.schema.js');
  assert.throws(
    () => validateUnifiedPluginManifest({
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'fixture.retired-agent-plugin',
      version: '1.0.0',
      displayNameKey: 'fixture.retiredAgentPlugin',
      publisher: 'fixture',
      runtime: 'AGENT_ATOMIC',
      source: 'USER',
      scope: 'MANAGED',
      trust: 'USER_SIGNED',
      support: 'SELF_MANAGED',
      capabilities: [{ key: 'certificate.deploy', contractVersion: '1.0', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] }],
      permissions: [],
      resources: {},
    }),
    /统一插件 Manifest 无效|必须是 AGENT_PLAN、WORKFLOW_DSL 之一/,
  );
});

async function assertModuleMissing(modulePath: string): Promise<void> {
  await assert.rejects(
    () => import(modulePath),
    (error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error)) return false;
      return (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND';
    },
  );
}
