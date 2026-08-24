import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from '../plugins/repository/unified-plugins.repository.js';
import { PluginWorkflowBindingsRepository } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import { hostLocales } from '../plugins/locales/plugin-locale.service.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { PluginWorkflowSourceService } from './application/plugin-workflow-source.service.js';

const fixtureDisplayNames = {
  'zh-CN': '示例来源',
  'zh-TW': '示例來源',
  'en-US': 'Fixture Source',
  'ja-JP': 'フィクスチャーソース',
  'ko-KR': 'Fixture 소스',
  'fr-FR': 'Source de fixture',
  'ru-RU': 'Источник фикстуры',
  'pt-BR': 'Fonte de fixture',
} satisfies Record<(typeof hostLocales)[number], string>;

function localeFixture(displayNameKey: string) {
  const locales = Object.fromEntries(hostLocales.map((locale) => [locale, `locales/${locale}.json`])) as Record<string, string>;
  const resources = Object.fromEntries(hostLocales.map((locale) => [
    locales[locale],
    JSON.stringify({ [displayNameKey]: fixtureDisplayNames[locale] }),
  ]));
  return { locales, resources };
}

test('插件工作流来源过滤、派生和内部只读形成闭环', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-plugin-source';
  const workflows=new WorkflowTemplatesApplicationService(new WorkflowTemplatesDomainService(new PgDocumentRepository(db,'workflow.templates'),new PgDocumentRepository(db,'workflow.template_versions')));
  const content={apiVersion:'gcac.workflow/v1' as const,kind:'CurlSshWorkflow' as const,metadata:{name:'plugin-deploy',version:'1.0.0'},inputContract:{apiVersion:'gcac.deployment-input/v1' as const,variables:{},connections:{},credentials:{},artifacts:{}},steps:[{name:'wait',type:'wait' as const,seconds:1}]};
  const internal=await workflows.createPluginTemplate({content}); await workflows.publishPluginVersion(internal.version.id);
  const plugins=new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const sourceLocales = localeFixture('fixture.source');
  const imported=await plugins.importVersion(tenantId,{manifest:{apiVersion:'gcac.plugin-manifest/v1',kind:'GcacPlugin',pluginId:'fixture.source',version:'1.0.0',displayNameKey:'fixture.source',defaultLocale:'zh-CN',publisher:'test',runtime:'WORKFLOW_DSL',source:'USER',scope:'BOTH',trust:'UNSIGNED',support:'SELF_MANAGED',permissions:[],capabilities:[{key:'certificate.deploy',contractVersion:'v1',actionContractId:'certificate.deploy.v1',riskLevel:'HIGH',executionLocations:['CONTROL_PLANE']},{key:'certificate.rollback',contractVersion:'v1',actionContractId:'certificate.rollback.v1',riskLevel:'HIGH',executionLocations:['CONTROL_PLANE']}],resources:{workflows:{'certificate.deploy':'workflows/deploy.json','certificate.rollback':'workflows/deploy.json'},locales:sourceLocales.locales}},resources:{'workflows/deploy.json':JSON.stringify(content),...sourceLocales.resources}}); await plugins.enableVersion(imported.id);
  const bindings=new PluginWorkflowBindingsRepository(db); await bindings.save({pluginVersionId:imported.id,capabilityKey:'certificate.deploy',workflowKey:'certificate.deploy',workflowResourcePath:'workflows/deploy.json',workflowTemplateId:internal.template.id,workflowVersionId:internal.version.id,workflowContentSha256:internal.version.contentHash,createdAt:new Date().toISOString()});
  await bindings.save({pluginVersionId:imported.id,capabilityKey:'certificate.rollback',workflowKey:'certificate.rollback',workflowResourcePath:'workflows/deploy.json',workflowTemplateId:internal.template.id,workflowVersionId:internal.version.id,workflowContentSha256:internal.version.contentHash,createdAt:new Date().toISOString()});
  const importedManifest = (await plugins.getVersion(imported.id)).manifest;
  const importedV2 = await plugins.importVersion(tenantId, {
    manifest: { ...importedManifest, version: '2.0.0' },
    resources: { 'workflows/deploy.json': JSON.stringify(content), ...sourceLocales.resources },
  });
  await plugins.enableVersion(importedV2.id);
  await bindings.save({pluginVersionId:importedV2.id,capabilityKey:'certificate.deploy',workflowKey:'certificate.deploy',workflowResourcePath:'workflows/deploy.json',workflowTemplateId:internal.template.id,workflowVersionId:internal.version.id,workflowContentSha256:internal.version.contentHash,createdAt:new Date().toISOString()});
  await bindings.save({pluginVersionId:importedV2.id,capabilityKey:'certificate.rollback',workflowKey:'certificate.rollback',workflowResourcePath:'workflows/deploy.json',workflowTemplateId:internal.template.id,workflowVersionId:internal.version.id,workflowContentSha256:internal.version.contentHash,createdAt:new Date().toISOString()});
  const service=new PluginWorkflowSourceService(plugins,bindings,workflows); const candidates=await service.list(tenantId); assert.equal(candidates.length,2); assert.deepEqual(new Set(candidates.map((item) => item.pluginVersionId)), new Set([imported.id, importedV2.id])); assert.equal(candidates[0]?.capabilityKey,'certificate.deploy'); assert.equal(candidates[0]?.stepCount,1); assert.equal(candidates[0]?.workflowVersion,1); assert.equal(candidates[0]?.displayName, '示例来源'); assert.equal(candidates[0]?.workflowName, 'plugin-deploy'); assert.equal(candidates[0]?.workflowResourcePath, 'workflows/deploy.json'); assert.equal((await service.list(tenantId, 'en-US'))[0]?.displayName, 'Fixture Source');
  const originalGetUiResources = plugins.getUiResources.bind(plugins);
  plugins.getUiResources = async () => { throw new Error('插件引用了未知标准字段'); };
  try {
    await assert.rejects(
      () => service.list(tenantId),
      (error: unknown) => error instanceof Error && error.message === '插件引用了未知标准字段',
    );
  } finally {
    plugins.getUiResources = originalGetUiResources;
  }
  const derived=await service.createWorkflow(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',name:'my-deploy'}); assert.equal(derived.template.origin,'user'); assert.equal(derived.template.ownerType,'TENANT'); assert.equal(derived.version.pluginSource?.sourceWorkflowVersionId,internal.version.id);
  const derivedV2=await service.createWorkflow(tenantId,{pluginVersionId:importedV2.id,capabilityKey:'certificate.deploy',name:'my-deploy-v2'}); assert.equal(derivedV2.version.pluginSource?.pluginVersionId, importedV2.id);
  await assert.rejects(()=>workflows.renameTemplate({templateId:internal.template.id,name:'forbidden'}),(error:any)=>error.errorCode==='WORKFLOW_INTERNAL_READ_ONLY');
  const draft=await service.createDraft(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',templateId:derived.template.id,name:'ignored'}); assert.equal(draft.templateId,derived.template.id); assert.equal(draft.content.metadata.name,'my-deploy');
  await assert.rejects(
    () => service.createDraft(tenantId, { pluginVersionId: imported.id, capabilityKey: 'certificate.deploy', templateId: internal.template.id, name: 'internal-target' }),
    (error: any) => error.errorCode === 'RESOURCE_NOT_FOUND',
  );
  await db.query(`update unified_plugin_workflow_bindings set workflow_content_sha256='bad' where plugin_version_id=$1`,[imported.id]); assert.equal((await service.list(tenantId)).length,1); await assert.rejects(()=>service.createWorkflow(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',name:'bad'}),(error:any)=>error.errorCode==='PLUGIN_WORKFLOW_HASH_MISMATCH');
});

test('业务租户可以使用系统所有权的内置工作流来源，但不能看到其他租户的用户插件', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const workflows = new WorkflowTemplatesApplicationService(new WorkflowTemplatesDomainService(
    new PgDocumentRepository(db, 'workflow.templates'),
    new PgDocumentRepository(db, 'workflow.template_versions'),
  ));
  const systemStorageId = 'SYSTEM';
  const businessTenantId = 'tenant-business';
  const otherTenantId = 'tenant-other';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const bindings = new PluginWorkflowBindingsRepository(db);
  const content = {
    apiVersion: 'gcac.workflow/v1' as const,
    kind: 'CurlSshWorkflow' as const,
    metadata: { name: 'builtin-deploy', version: '1.0.0' },
    inputContract: { apiVersion: 'gcac.deployment-input/v1' as const, variables: {}, connections: {}, credentials: {}, artifacts: {} },
    steps: [{ name: 'wait', type: 'wait' as const, seconds: 1 }],
  };
  const builtinLocales = localeFixture('fixture.name');
  const internal = await workflows.createPluginTemplate({ content });
  const published = await workflows.publishPluginVersion(internal.version.id);
  const builtin = await plugins.importVersion(systemStorageId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'builtin.workflow.fixture',
      version: '1.0.0',
      displayNameKey: 'fixture.name',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      permissions: [],
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
       resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' }, locales: builtinLocales.locales },
     },
     resources: { 'workflows/deploy.json': JSON.stringify(content), ...builtinLocales.resources },
  }, 'BUILTIN');
  await plugins.enableVersion(builtin.id);
  await bindings.save({
    pluginVersionId: builtin.id,
    capabilityKey: 'certificate.deploy',
    workflowKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
    workflowContentSha256: published.contentHash,
    createdAt: new Date().toISOString(),
  });
  const userPlugin = await plugins.importVersion(otherTenantId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'fixture.user-only',
      version: '1.0.0',
      displayNameKey: 'fixture.name',
      publisher: 'user',
      runtime: 'WORKFLOW_DSL',
      source: 'USER',
      scope: 'BOTH',
      trust: 'UNSIGNED',
      support: 'SELF_MANAGED',
      permissions: [],
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: { 'workflows/deploy.json': JSON.stringify(content) },
  });
  await plugins.enableVersion(userPlugin.id);
  await bindings.save({
    pluginVersionId: userPlugin.id,
    capabilityKey: 'certificate.deploy',
    workflowKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
    workflowContentSha256: published.contentHash,
    createdAt: new Date().toISOString(),
  });

  const service = new PluginWorkflowSourceService(plugins, bindings, workflows);
  const candidates = await service.list(businessTenantId);
  assert.deepEqual(candidates.map((item) => item.pluginId), ['builtin.workflow.fixture']);
  const derived = await service.createWorkflow(businessTenantId, {
    pluginVersionId: builtin.id,
    capabilityKey: 'certificate.deploy',
    name: 'business-deploy',
  });
  assert.equal(derived.template.origin, 'user');
  assert.equal(derived.template.ownerType, 'TENANT');
  assert.equal(derived.version.pluginSource?.sourceWorkflowVersionId, published.id);
  await assert.rejects(
    () => service.createWorkflow(businessTenantId, {
      pluginVersionId: userPlugin.id,
      capabilityKey: 'certificate.deploy',
      name: 'should-fail',
    }),
    (error: any) => error.errorCode === 'PLUGIN_WORKFLOW_SOURCE_UNAVAILABLE',
  );
});
