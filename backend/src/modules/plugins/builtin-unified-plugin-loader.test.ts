import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { workflowTemplatesSchemaRegistry } from '../workflow-templates/schema/workflow-templates.schema.js';

test('内置 DSL、Agent 与设备插件统一投影为不可变版本并可幂等启用', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const loader = new BuiltinUnifiedPluginLoader();
  const first = await loader.installAll('tenant-1', service);
  const second = await loader.installAll('tenant-1', service);

  assert.equal(first.length, 8);
  const citrix = first.find((item) => item.pluginId === 'citrix.netscaler-adc');
  const apache = first.find((item) => item.pluginId === 'builtin.workflow.apache-8444-cert-switch');
  const synology = first.find((item) => item.pluginId === 'builtin.workflow.synology-dsm-cert-import');
  const agent = first.find((item) => item.pluginId === 'builtin.linux.nginx.pem');
  assert.equal(citrix?.status, 'ENABLED');
  assert.equal(citrix?.version, '1.1.16');
  assert.equal(apache?.version, '1.1.6');
  assert.equal(synology?.version, '1.1.5');
  assert.equal(agent?.version, '1.0.7');
  assert.equal(agent?.manifest.resources.actionAliases?.certificateDeploy, 'action-aliases/certificate-deploy.json');
  assert.equal(citrix?.manifest.scope, 'BOTH');
  assert.equal(citrix?.manifest.logoUrl, '/plugin-logos/citrix-adc.svg');
  assert.equal(citrix?.manifest.resources.locales && Object.keys(citrix.manifest.resources.locales).length, 8);
  assert.equal(apache?.runtime, 'WORKFLOW_DSL');
  assert.equal(apache?.scope, 'BOTH');
  assert.equal(synology?.runtime, 'WORKFLOW_DSL');
  assert.equal(agent?.runtime, 'AGENT_ATOMIC');
  assert.equal(agent?.scope, 'MANAGED');
  assert.equal(first.every((item) => item.manifest.logoUrl?.startsWith('/plugin-logos/')), true);
  assert.deepEqual(second.map((item) => item.id), first.map((item) => item.id));
  assert.equal(records.size, 8);

  const pluginPackage = (await loader.loadPackages()).find((item) => (item.manifest as { pluginId?: string }).pluginId === 'citrix.netscaler-adc')!;
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...pluginPackage,
      resources: {
        ...pluginPackage.resources,
        'locales/zh-CN.json': `${pluginPackage.resources['locales/zh-CN.json']}\n`,
      },
      packageContent: `${pluginPackage.packageContent}\n`,
    }, 'BUILTIN'),
    /同一插件版本不可覆盖/,
  );
  for (const workflowPath of Object.values(citrix!.manifest.resources.workflows ?? {})) {
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
