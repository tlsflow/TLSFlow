import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger, type LogEvent } from '../../common/logging/structured-logger.js';
import { AppError } from '../../common/errors/app-error.js';
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
  assert.equal(citrix?.version, '1.1.25');
  assert.equal(apache?.version, '1.2.6');
  assert.equal(synology?.version, '1.2.4');
  assert.equal(agent?.version, '1.0.14');
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

  const packages = await loader.loadPackages();
  const pluginPackage = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === 'citrix.netscaler-adc')!;
  for (const pluginId of ['builtin.workflow.apache-8444-cert-switch', 'builtin.workflow.synology-dsm-cert-import']) {
    const workflowPackage = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === pluginId)!;
    const workflowPath = Object.values((workflowPackage.manifest as { resources: { workflows: Record<string, string> } }).resources.workflows)[0]!;
    const workflow = JSON.parse(workflowPackage.resources[workflowPath]!) as {
      inputContract: { variables: { siteName: { source: { path: string } } } };
    };
    assert.equal(workflow.inputContract.variables.siteName.source.path, 'application.serverName');
  }
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

test('内置插件导入、审批和启用失败时只告警并继续处理其他插件', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const baseLoader = new BuiltinUnifiedPluginLoader();
  const packages = await baseLoader.loadPackages();
  const warnings: LogEvent[] = [];
  const logger = new StructuredLogger((event) => warnings.push(event));

  const importVersion = service.importVersion.bind(service);
  service.importVersion = async (tenantId, input, sourceChannel) => {
    const pluginId = (input.manifest as { pluginId?: string }).pluginId;
    if (pluginId === 'citrix.netscaler-adc') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '模拟导入冲突');
    }
    return importVersion(tenantId, input, sourceChannel);
  };
  const approvePermissions = service.approvePermissions.bind(service);
  service.approvePermissions = async (id, permissions) => {
    const record = await service.getVersion(id);
    if (record.pluginId === 'builtin.workflow.apache-8444-cert-switch') {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '模拟权限审批失败');
    }
    return approvePermissions(id, permissions);
  };
  const enableVersion = service.enableVersion.bind(service);
  service.enableVersion = async (id) => {
    const record = await service.getVersion(id);
    if (record.pluginId === 'builtin.linux.nginx.pem') {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '模拟启用失败');
    }
    return enableVersion(id);
  };

  class TestLoader extends BuiltinUnifiedPluginLoader {
    override async loadPackages() {
      return packages;
    }
  }

  const installed = await new TestLoader(undefined, logger).installAll('tenant-1', service);
  assert.equal(installed.length, packages.length - 3);
  assert.equal(installed.some((item) => item.pluginId === 'builtin.workflow.synology-dsm-cert-import'), true);
  assert.equal(installed.some((item) => item.pluginId === 'builtin.rabbitmq.pem'), true);
  assert.deepEqual(
    warnings.map((event) => ({
      phase: (event.details as { phase: string }).phase,
      pluginId: (event.details as { pluginId?: string }).pluginId,
      version: (event.details as { version?: string }).version,
      errorCode: (event.details as { errorCode: string }).errorCode,
    })),
    [
      { phase: 'import', pluginId: 'citrix.netscaler-adc', version: '1.1.25', errorCode: 'RESOURCE_VERSION_CONFLICT' },
      { phase: 'approvePermissions', pluginId: 'builtin.workflow.apache-8444-cert-switch', version: '1.2.6', errorCode: 'PLUGIN_PERMISSION_DENIED' },
      { phase: 'enable', pluginId: 'builtin.linux.nginx.pem', version: '1.0.14', errorCode: 'PLUGIN_PERMISSION_DENIED' },
    ],
  );
});

function memoryRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => { records.set(record.id, record); return record; },
    findVersion: async (id) => records.get(id),
    findByIdentity: async (tenantId, pluginId, version) => [...records.values()].find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version),
    listVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId),
  };
}
