import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { workflowTemplatesSchemaRegistry } from '../workflow-templates/schema/workflow-templates.schema.js';

test('Citrix ADC 内置插件包通过表单、展示和八语言校验并可幂等启用', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const loader = new BuiltinUnifiedPluginLoader();
  const first = await loader.installAll('tenant-1', service);
  const second = await loader.installAll('tenant-1', service);

  assert.equal(first.length, 1);
  assert.equal(first[0]?.pluginId, 'citrix.netscaler-adc');
  assert.equal(first[0]?.status, 'ENABLED');
  assert.equal(first[0]?.manifest.scope, 'BOTH');
  assert.equal(first[0]?.manifest.resources.locales && Object.keys(first[0].manifest.resources.locales).length, 8);
  assert.equal(second[0]?.id, first[0]?.id);
  assert.equal(records.size, 1);

  const pluginPackage = (await loader.loadPackages())[0]!;
  for (const workflowPath of Object.values(first[0]!.manifest.resources.workflows ?? {})) {
    workflowTemplatesSchemaRegistry.validate(JSON.parse(pluginPackage.resources[workflowPath]!));
  }
});

function memoryRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => { records.set(record.id, record); return record; },
    findVersion: async (id) => records.get(id),
    findByIdentity: async (tenantId, pluginId, version) => [...records.values()].find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version),
    listVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId),
  };
}
