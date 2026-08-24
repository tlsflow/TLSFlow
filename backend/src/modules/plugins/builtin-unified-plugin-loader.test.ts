import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger, type LogEvent } from '../../common/logging/structured-logger.js';
import { AppError } from '../../common/errors/app-error.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { workflowTemplatesSchemaRegistry } from '../workflow-templates/schema/workflow-templates.schema.js';

test('内置插件包仅安装符合当前 Manifest 合同的包并可幂等启用', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const loader = new BuiltinUnifiedPluginLoader();
  const first = await loader.installAll(service);
  const second = await loader.installAll(service);

  assert.equal(first.length, 1);
  const citrix = first.find((item) => item.pluginId === 'device.citrix.netscaler-adc');
  assert.equal(citrix?.status, 'ENABLED');
  assert.equal(citrix?.version, '1.2.2');
  assert.equal(citrix?.manifest.scope, 'BOTH');
  assert.equal(citrix?.manifest.logoUrl, '/plugin-logos/citrix-adc.svg');
  assert.equal(citrix?.manifest.resources.locales && Object.keys(citrix.manifest.resources.locales).length, 8);
  assert.equal(first.some((item) => item.pluginId.startsWith('cloud.')), false);
  assert.equal(first.every((item) => item.manifest.logoUrl?.startsWith('/plugin-logos/')), true);
  assert.deepEqual(second.map((item) => item.id), first.map((item) => item.id));
  assert.equal(records.size, 1);

  const packages = await loader.loadPackages();
  const pluginPackage = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === 'device.citrix.netscaler-adc')!;
  await assert.rejects(
    () => service.importVersion('SYSTEM', {
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

test('旧厂商 Manifest 导入失败时只告警并继续处理其他插件', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const baseLoader = new BuiltinUnifiedPluginLoader();
  const packages = await baseLoader.loadPackages();
  const warnings: LogEvent[] = [];
  const logger = new StructuredLogger((event) => warnings.push(event));

  const importVersion = service.importVersion.bind(service);
  service.importVersion = async (tenantId, input, sourceChannel) => {
    const pluginId = (input.manifest as { pluginId?: string }).pluginId;
    if (pluginId === 'device.citrix.netscaler-adc') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '模拟导入冲突');
    }
    return importVersion(tenantId, input, sourceChannel);
  };
  class TestLoader extends BuiltinUnifiedPluginLoader {
    override async loadPackages() {
      return packages;
    }
  }

  const installed = await new TestLoader(undefined, logger).installAll(service);
  assert.equal(installed.length, 0);
  assert.equal(warnings.length, packages.length);
  assert.equal(warnings.every((event) => (event.details as { phase: string }).phase === 'import'), true);
  assert.equal(warnings.some((event) => {
    const details = event.details as { pluginId?: string; errorCode: string };
    return details.pluginId === 'device.citrix.netscaler-adc' && details.errorCode === 'RESOURCE_VERSION_CONFLICT';
  }), true);
  assert.equal(warnings.filter((event) => {
    const details = event.details as { pluginId?: string; errorCode: string };
    return details.pluginId?.startsWith('cloud.') && details.errorCode === 'VALIDATION_FAILED';
  }).length, 4);
});

function memoryRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => { records.set(record.id, record); return record; },
    findVersion: async (id) => records.get(id),
    findByIdentity: async (tenantId, pluginId, version) => [...records.values()].find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version),
    listVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId),
    listVersionsBySource: async (source) => [...records.values()].filter((record) => record.source === source),
    listAccessibleVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId || record.source === 'BUILTIN'),
    countReferences: async () => ({ bindings: 0, assignments: 0, hosts: 0, serviceAssets: 0, deviceAssets: 0, total: 0 }),
  };
}
