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
  const [plugin] = await new BuiltinUnifiedPluginLoader().installAll(pluginService);
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));

  const first = await publisher.publishPlugin(plugin!);
  const second = await publisher.publishPlugin(plugin!);

  assert.equal(first.length, 6);
  assert.equal(second.length, 6);
  assert.equal(first[0]?.workflowContentSha256, (await workflows.getVersion(first[0]!.workflowVersionId)).contentHash);
  assert.equal((await workflows.listTemplates()).length, 3);
  assert.equal((await publisher.require(plugin!.id, 'device.connection.test')).workflowVersionId, (await publisher.require(plugin!.id, 'device.identity.detect')).workflowVersionId);
  assert.equal((await publisher.require(plugin!.id, 'certificate.deploy')).workflowVersionId, (await publisher.require(plugin!.id, 'certificate.rollback')).workflowVersionId);
});

test('插件升级复用原工作流模板并追加不可变版本', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const firstPlugin = pluginRecord('uplgv_first', '1.0.0', '1.0.0');
  const secondPlugin = pluginRecord('uplgv_second', '1.1.0', '1.1.0');
  const templateCountBefore = (await workflows.listTemplates()).length;

  const [first] = await publisher.publishPlugin(firstPlugin);
  const [second] = await publisher.publishPlugin(secondPlugin);

  assert.equal((await workflows.listTemplates()).length, templateCountBefore + 1);
  assert.equal(first?.workflowTemplateId, second?.workflowTemplateId);
  assert.notEqual(first?.workflowVersionId, second?.workflowVersionId);
  assert.equal((await workflows.listTemplates()).find((item) => item.id === first?.workflowTemplateId)?.origin, 'plugin_internal');
  assert.deepEqual((await workflows.listVersions(first!.workflowTemplateId)).map((item) => item.version).sort((left, right) => left - right), [1, 2]);
});

test('插件版本变化但工作流内容未变化时复用已有版本', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const firstPlugin = pluginRecord('uplgv_first', '1.0.0', '1.0.0');
  const secondPlugin = pluginRecord('uplgv_second', '1.1.0', '1.0.0');

  const [first] = await publisher.publishPlugin(firstPlugin);
  const [second] = await publisher.publishPlugin(secondPlugin);

  assert.equal(first?.workflowTemplateId, second?.workflowTemplateId);
  assert.equal(first?.workflowVersionId, second?.workflowVersionId);
  assert.equal((await workflows.listVersions(first!.workflowTemplateId)).length, 1);
});

test('插件发布遇到已存在的 Workflow 内容时复用现有版本', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const legacyPlugin = pluginRecord('legacy-publish', '1.0.0', '1.0.0');
  const nextPlugin = pluginRecord('legacy-publish-next', '1.1.0', '1.1.0');
  const legacyContent = JSON.parse(legacyPlugin.resources['workflows/deploy.json']!) as Parameters<typeof workflows.createWorkflow>[0]['content'];
  const nextContent = JSON.parse(nextPlugin.resources['workflows/deploy.json']!) as Parameters<typeof workflows.createWorkflow>[0]['content'];
  const internal = await workflows.createPluginTemplate({ content: legacyContent }, { ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
  const publishedLegacy = await workflows.publishPluginVersion(internal.version.id);
  const nextDraft = await workflows.createPluginInternalDraftVersion({
    templateId: internal.template.id,
    content: nextContent,
    changeSummary: 'seed existing published version',
  });
  const publishedNext = await workflows.publishPluginVersion(nextDraft.id);
  bindings.set(`${legacyPlugin.id}:certificate.deploy`, {
    pluginVersionId: legacyPlugin.id,
    pluginId: legacyPlugin.pluginId,
    ownerType: 'SYSTEM',
    capabilityKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: publishedLegacy.id,
    workflowContentSha256: publishedLegacy.contentHash,
    createdAt: new Date().toISOString(),
  });

  const [binding] = await publisher.publishPlugin(nextPlugin);

  assert.equal(binding?.workflowTemplateId, internal.template.id);
  assert.equal(binding?.workflowVersionId, publishedNext.id);
  assert.equal((await publisher.require(nextPlugin.id, 'certificate.deploy')).workflowVersionId, publishedNext.id);
});

test('Workflow DSL 插件声明能力缺少绑定时拒绝发布', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const plugin = pluginRecord('missing-capability-binding', '1.0.0', '1.0.0');
  plugin.manifest.capabilities.push({
    key: 'certificate.rollback',
    contractVersion: 'v1',
    actionContractId: 'certificate.rollback.v1',
    riskLevel: 'HIGH',
    executionLocations: ['CONTROL_PLANE'],
  });
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));

  await assert.rejects(
    () => publisher.publishPlugin(plugin),
    (error: any) => error.errorCode === 'VALIDATION_FAILED' && error.details?.missingCapabilityKeys?.includes('certificate.rollback'),
  );
});

function pluginRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
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

function workflowRepository(records: Map<string, PluginWorkflowBindingRecord>): PluginWorkflowBindingsRepositoryPort {
  const key = (pluginVersionId: string, capabilityKey: string) => `${pluginVersionId}:${capabilityKey}`;
  return {
    save: async (record) => { records.set(key(record.pluginVersionId, record.capabilityKey), record); return record; },
    find: async (pluginVersionId, capabilityKey) => records.get(key(pluginVersionId, capabilityKey)),
    findByResource: async (pluginVersionId, workflowResourcePath) => [...records.values()].find((record) => record.pluginVersionId === pluginVersionId && record.workflowResourcePath === workflowResourcePath),
    findLatestByPluginResource: async (_tenantId, pluginId, workflowResourcePath) => [...records.values()].reverse().find((record) => record.pluginVersionId.startsWith(`${pluginId}:`) && record.workflowResourcePath === workflowResourcePath),
    listCurrent: async () => [...records.values()],
    list: async (pluginVersionId) => [...records.values()].filter((record) => record.pluginVersionId === pluginVersionId),
    listAll: async () => [...records.values()],
  };
}

function pluginRecord(id: string, pluginVersion: string, workflowVersion: string): UnifiedPluginVersionRecord {
  const resourcePath = 'workflows/deploy.json';
  const content = JSON.stringify({
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'fixture-deploy', version: workflowVersion },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    },
    steps: [{ name: 'deploy', type: 'transform', stage: 'install', transform: { engine: 'jsonata', input: {}, outputs: { result: { expression: '{}' } } } }],
  });
  return {
    id: `fixture.plugin:${id}`,
    tenantId: 'tenant-1',
    pluginId: 'fixture.plugin',
    version: pluginVersion,
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'fixture.plugin',
      version: pluginVersion,
      displayNameKey: 'fixture.name',
      descriptionKey: 'fixture.description',
      defaultLocale: 'zh-CN',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
      permissions: [],
      compatibility: {},
      resources: { workflows: { 'certificate.deploy': resourcePath } },
    },
    packageSha256: 'sha256:fixture',
    manifestSha256: 'sha256:fixture',
    resourceSha256: { [resourcePath]: 'sha256:fixture' },
    resources: { [resourcePath]: content },
    status: 'ENABLED',
    permissionApprovalStatus: 'NOT_REQUIRED',
    approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'sha256:fixture', resourceSha256: { [resourcePath]: 'sha256:fixture' } },
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}
