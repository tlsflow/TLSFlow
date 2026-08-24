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
import { certificateUpdatePluginIds } from './canonical-plugin-id/canonical-plugin-id.registry.js';

test('插件能力发布为固定 WorkflowVersion 且共享资源不重复创建模板', async () => {
  const versions = new Map<string, UnifiedPluginVersionRecord>();
  const pluginService = new UnifiedPluginsApplicationService(pluginRepository(versions));
  const installed = await new BuiltinUnifiedPluginLoader().installAll(pluginService);
  for (const pluginId of ['cloud.aliyun', 'cloud.tencent', 'cloud.huawei', 'cloud.volcengine']) {
    assert.ok(installed.some((item) => item.pluginId === pluginId), `${pluginId} 必须能通过内置插件导入和发布前校验`);
  }
  const plugin = installed.find((item) => item.pluginId === 'device.citrix.netscaler-adc');
  assert.ok(plugin);
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));

  const first = await publisher.publishPlugin(plugin!);
  const second = await publisher.publishPlugin(plugin!);

  assert.equal(first.length, 5);
  assert.equal(second.length, 5);
  const firstVersion = await workflows.getVersion(first[0]!.workflowVersionId);
  assert.equal(first[0]?.workflowContentSha256, firstVersion.contentHash);
  assert.equal(firstVersion.executionMode, undefined);
  assert.equal(firstVersion.content.kind, 'CurlSshWorkflow');
  assert.equal(new Set(first.map((item) => item.workflowTemplateId)).size, 4);
  assert.deepEqual(second.map((item) => item.workflowTemplateId), first.map((item) => item.workflowTemplateId));
  assert.notEqual((await publisher.require(plugin.id, 'device.connection.test')).workflowVersionId, (await publisher.require(plugin.id, 'device.identity.detect')).workflowVersionId);
  assert.equal((await publisher.require(plugin.id, 'certificate.deploy')).workflowVersionId, (await publisher.require(plugin.id, 'certificate.rollback')).workflowVersionId);
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

test('插件 Workflow 内容变化且版本与 PluginVersion 同步时可发布', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const firstPlugin = pluginRecord('workflow-metadata-stable', '1.0.0', '1.0.0');
  const secondPlugin = pluginRecord('workflow-metadata-stable-next', '1.1.0', '1.1.0');
  const resourcePath = 'workflows/deploy.json';
  firstPlugin.manifest.resources.runtimeEntrypoint = 'runtime/index.js';
  secondPlugin.manifest.resources.runtimeEntrypoint = 'runtime/index.js';
  const changed = JSON.parse(secondPlugin.resources[resourcePath]!) as { metadata: { name: string } };
  changed.metadata.name = 'fixture-deploy-v2';
  secondPlugin.resources[resourcePath] = JSON.stringify(changed);

  await publisher.publishPlugin(firstPlugin);
  const [published] = await publisher.publishPlugin(secondPlugin);
  assert.ok(published);
});

test('六个证书更新包允许独立发布 deploy 与 rollback Workflow', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  for (const pluginId of [
    'web.nginx.linux',
    'web.nginx.windows',
    'web.apache.linux',
    'web.apache.windows',
    'app.tomcat.linux',
    'app.tomcat.windows',
  ]) {
    const plugin = independentCertificatePluginRecord(pluginId);
    const published = await publisher.publishPlugin(plugin);
    assert.equal(published.length, 3, `${pluginId} 必须发布 deploy、verify、rollback 三条绑定`);
    assert.notEqual(
      published.find((item) => item.capabilityKey === 'certificate.deploy')?.workflowResourcePath,
      published.find((item) => item.capabilityKey === 'certificate.rollback')?.workflowResourcePath,
    );
  }
});

test('普通旧 Workflow DSL 仍拒绝独立 deploy 与 rollback 资源', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const plugin = independentCertificatePluginRecord('fixture.plugin');

  await assert.rejects(
    () => publisher.publishPlugin(plugin),
    /旧 Workflow DSL 插件的 certificate\.deploy 与 certificate\.rollback 必须指向同一资源/,
  );
});

test('六个实际证书更新包都能完成三条 Workflow 发布', async () => {
  const versions = new Map<string, UnifiedPluginVersionRecord>();
  const pluginService = new UnifiedPluginsApplicationService(pluginRepository(versions));
  const installed = await new BuiltinUnifiedPluginLoader().installAll(pluginService);
  const certificatePlugins = installed.filter((plugin) => certificateUpdatePluginIds.includes(plugin.pluginId as (typeof certificateUpdatePluginIds)[number]));
  assert.equal(certificatePlugins.length, certificateUpdatePluginIds.length);

  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  for (const plugin of certificatePlugins) {
    const published = await publisher.publishPlugin(plugin);
    assert.deepEqual(
      published.map((binding) => binding.capabilityKey).sort(),
      ['certificate.deploy', 'certificate.rollback', 'certificate.verify'],
    );
  }
});

test('插件内部 WorkflowVersion 与 PluginVersion 不一致时拒绝发布', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const plugin = pluginRecord('workflow-plugin-version-mismatch', '1.1.0', '1.0.0');

  await assert.rejects(
    () => publisher.publishPlugin(plugin),
    (error: any) => error.errorCode === 'VALIDATION_FAILED'
      && error.details?.code === 'PLUGIN_WORKFLOW_VERSION_MISMATCH',
  );
});

test('插件 Workflow metadata.version 仍必须是合法 SemVer', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const plugin = pluginRecord('workflow-invalid-metadata-version', '1.0.0', 'not-semver');
  plugin.manifest.resources.runtimeEntrypoint = 'runtime/index.js';

  await assert.rejects(
    () => publisher.publishPlugin(plugin),
    /SemVer 语义版本/,
  );
});

test('插件版本变化但 Workflow 版本未同步时拒绝发布', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const firstPlugin = pluginRecord('uplgv_first', '1.0.0', '1.0.0');
  const secondPlugin = pluginRecord('uplgv_second', '1.1.0', '1.0.0');

  await publisher.publishPlugin(firstPlugin);
  await assert.rejects(
    () => publisher.publishPlugin(secondPlugin),
    (error: any) => error.details?.code === 'PLUGIN_WORKFLOW_VERSION_MISMATCH',
  );
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
    workflowKey: 'certificate.deploy',
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

test('历史绑定指向旧 DSL 版本时，插件发布会幂等修复绑定目标', async () => {
  const bindings = new Map<string, PluginWorkflowBindingRecord>();
  const workflows = new WorkflowTemplatesApplicationService(undefined, {}, workflowRepository(bindings));
  const publisher = new PluginWorkflowPublisherService(workflows, workflowRepository(bindings));
  const oldPlugin = pluginRecord('historical-binding-seed', '1.0.13', '1.0.13');
  const currentPlugin = pluginRecord('historical-binding', '1.0.14', '1.0.14');
  const oldContent = JSON.parse(oldPlugin.resources['workflows/deploy.json']!) as Parameters<typeof workflows.createWorkflow>[0]['content'];
  const internal = await workflows.createPluginTemplate({ content: oldContent }, { ownerType: 'SYSTEM', ownerId: 'SYSTEM' });
  const oldVersion = await workflows.publishPluginVersion(internal.version.id);
  bindings.set(`${currentPlugin.id}:certificate.deploy:certificate.deploy`, {
    pluginVersionId: currentPlugin.id,
    capabilityKey: 'certificate.deploy',
    workflowKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: oldVersion.id,
    workflowContentSha256: oldVersion.contentHash,
    createdAt: new Date().toISOString(),
  });

  const [repaired] = await publisher.publishPlugin(currentPlugin);
  assert.ok(repaired);
  const repairedVersion = await workflows.getVersion(repaired!.workflowVersionId);
  assert.equal(repairedVersion.content.metadata.version, '1.0.14');
  assert.equal((await publisher.require(currentPlugin.id, 'certificate.deploy')).workflowVersionId, repaired!.workflowVersionId);
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
  const key = (pluginVersionId: string, capabilityKey: string, workflowKey = capabilityKey) => `${pluginVersionId}:${capabilityKey}:${workflowKey}`;
  return {
    save: async (record) => { records.set(key(record.pluginVersionId, record.capabilityKey, record.workflowKey), record); return record; },
    find: async (pluginVersionId, capabilityKey, workflowKey) => [...records.values()].find((record) => record.pluginVersionId === pluginVersionId && record.capabilityKey === capabilityKey && (!workflowKey || record.workflowKey === workflowKey)),
    findByResource: async (pluginVersionId, workflowResourcePath, workflowKey) => [...records.values()].find((record) => record.pluginVersionId === pluginVersionId && record.workflowResourcePath === workflowResourcePath && (!workflowKey || record.workflowKey === workflowKey)),
    findLatestByPluginResource: async (_tenantId, pluginId, workflowResourcePath, capabilityKey, workflowKey) => [...records.values()].reverse().find((record) => record.pluginVersionId.startsWith(`${pluginId}:`) && record.workflowResourcePath === workflowResourcePath && (!capabilityKey || record.capabilityKey === capabilityKey) && (!workflowKey || record.workflowKey === workflowKey)),
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

function independentCertificatePluginRecord(pluginId: string): UnifiedPluginVersionRecord {
  const plugin = pluginRecord(`independent:${pluginId}`, '1.0.0', '1.0.0');
  const paths = {
    'certificate.deploy': 'workflows/deploy.json',
    'certificate.verify': 'workflows/verify.json',
    'certificate.rollback': 'workflows/rollback.json',
  } as const;
  const content = plugin.resources['workflows/deploy.json']!;
  plugin.pluginId = pluginId;
  plugin.manifest.pluginId = pluginId;
  plugin.manifest.capabilities = Object.keys(paths).map((key) => ({
    key,
    contractVersion: 'v1',
    actionContractId: `${key}.v1`,
    riskLevel: key === 'certificate.verify' ? 'LOW' : 'HIGH',
    executionLocations: ['AGENT'],
  })) as typeof plugin.manifest.capabilities;
  plugin.manifest.resources.workflows = paths;
  plugin.resources = {
    'workflows/deploy.json': content,
    'workflows/verify.json': content,
    'workflows/rollback.json': content,
  };
  plugin.resourceSha256 = {
    'workflows/deploy.json': 'sha256:deploy',
    'workflows/verify.json': 'sha256:verify',
    'workflows/rollback.json': 'sha256:rollback',
  };
  return plugin;
}
