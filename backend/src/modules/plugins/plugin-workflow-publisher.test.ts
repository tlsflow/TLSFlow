import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { PluginWorkflowPublisherService } from './application/plugin-workflow-publisher.service.js';
import type { PluginWorkflowBindingRecord } from './dto/plugin-workflow-bindings.dto.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import type { PluginWorkflowBindingsRepositoryPort } from './repository/plugin-workflow-bindings.repository.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('插件能力发布为固定 WorkflowVersion 且共享资源不重复创建模板', async () => {
  const versions = new Map<string, UnifiedPluginVersionRecord>();
  const pluginService = new UnifiedPluginsApplicationService(pluginRepository(versions));
  const [plugin] = await new BuiltinUnifiedPluginLoader().installAll('tenant-1', pluginService);
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService();
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));

  const first = await publisher.publishPlugin(plugin!);
  const second = await publisher.publishPlugin(plugin!);

  assert.equal(first.length, 6);
  assert.equal(second.length, 6);
  assert.equal((await workflows.listTemplates()).length, 4);
  assert.equal((await publisher.require(plugin!.id, 'device.connection.test')).workflowVersionId, (await publisher.require(plugin!.id, 'device.identity.detect')).workflowVersionId);
});

function pluginRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
  return { saveVersion: async (record) => { records.set(record.id, record); return record; }, findVersion: async (id) => records.get(id), findByIdentity: async (tenantId, pluginId, version) => [...records.values()].find((record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version), listVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId) };
}

function workflowRepository(records: Map<string, PluginWorkflowBindingRecord>): PluginWorkflowBindingsRepositoryPort {
  const key = (pluginVersionId: string, capabilityKey: string) => `${pluginVersionId}:${capabilityKey}`;
  return {
    save: async (record) => { records.set(key(record.pluginVersionId, record.capabilityKey), record); return record; },
    find: async (pluginVersionId, capabilityKey) => records.get(key(pluginVersionId, capabilityKey)),
    findByResource: async (pluginVersionId, workflowResourcePath) => [...records.values()].find((record) => record.pluginVersionId === pluginVersionId && record.workflowResourcePath === workflowResourcePath),
    list: async (pluginVersionId) => [...records.values()].filter((record) => record.pluginVersionId === pluginVersionId),
  };
}
