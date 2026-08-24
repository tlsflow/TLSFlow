import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from '../plugins/repository/unified-plugins.repository.js';
import { PluginWorkflowBindingsRepository } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { PluginWorkflowSourceService } from './application/plugin-workflow-source.service.js';

test('插件工作流来源过滤、派生和内部只读形成闭环', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-plugin-source';
  const workflows=new WorkflowTemplatesApplicationService(new WorkflowTemplatesDomainService(new PgDocumentRepository(db,'workflow.templates'),new PgDocumentRepository(db,'workflow.template_versions')));
  const content={apiVersion:'gcac.workflow/v1' as const,kind:'CurlSshWorkflow' as const,metadata:{name:'plugin-deploy',version:'1.0.0'},inputContract:{apiVersion:'gcac.deployment-input/v1' as const,variables:{},connections:{},credentials:{},artifacts:{}},steps:[{name:'wait',type:'wait' as const,seconds:1}]};
  const internal=await workflows.createPluginTemplate({content}); await workflows.publishPluginVersion(internal.version.id);
  const plugins=new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported=await plugins.importVersion(tenantId,{manifest:{apiVersion:'gcac.plugin-manifest/v1',kind:'GcacPlugin',pluginId:'fixture.source',version:'1.0.0',displayNameKey:'fixture.source',defaultLocale:'zh-CN',publisher:'test',runtime:'WORKFLOW_DSL',source:'USER',scope:'BOTH',trust:'UNSIGNED',support:'SELF_MANAGED',permissions:[],capabilities:[{key:'certificate.deploy',contractVersion:'v1',actionContractId:'certificate.deploy.v1',riskLevel:'HIGH',executionLocations:['CONTROL_PLANE']}],resources:{workflows:{'certificate.deploy':'workflows/deploy.json'},locales:{'zh-CN':'locales/zh-CN.json','en-US':'locales/en-US.json'}}},resources:{'workflows/deploy.json':JSON.stringify(content),'locales/zh-CN.json':JSON.stringify({'fixture.source':'示例来源'}),'locales/en-US.json':JSON.stringify({'fixture.source':'Fixture Source'})}}); await plugins.enableVersion(imported.id);
  const bindings=new PluginWorkflowBindingsRepository(db); await bindings.save({pluginVersionId:imported.id,capabilityKey:'certificate.deploy',workflowResourcePath:'workflows/deploy.json',workflowTemplateId:internal.template.id,workflowVersionId:internal.version.id,workflowContentSha256:internal.version.contentHash,createdAt:new Date().toISOString()});
  const service=new PluginWorkflowSourceService(plugins,bindings,workflows); const candidates=await service.list(tenantId); assert.equal(candidates.length,1); assert.equal(candidates[0]?.stepCount,1); assert.equal(candidates[0]?.displayName, '示例来源'); assert.equal((await service.list(tenantId, 'en-US'))[0]?.displayName, 'Fixture Source');
  const derived=await service.createWorkflow(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',name:'my-deploy'}); assert.equal(derived.template.origin,'user'); assert.equal(derived.template.ownerType,'TENANT'); assert.equal(derived.version.pluginSource?.sourceWorkflowVersionId,internal.version.id);
  await assert.rejects(()=>workflows.renameTemplate({templateId:internal.template.id,name:'forbidden'}),(error:any)=>error.errorCode==='WORKFLOW_INTERNAL_READ_ONLY');
  const draft=await service.createDraft(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',templateId:derived.template.id,name:'ignored'}); assert.equal(draft.templateId,derived.template.id); assert.equal(draft.content.metadata.name,'my-deploy');
  await assert.rejects(
    () => service.createDraft(tenantId, { pluginVersionId: imported.id, capabilityKey: 'certificate.deploy', templateId: internal.template.id, name: 'internal-target' }),
    (error: any) => error.errorCode === 'RESOURCE_NOT_FOUND',
  );
  await db.query(`update unified_plugin_workflow_bindings set workflow_content_sha256='bad' where plugin_version_id=$1`,[imported.id]); assert.equal((await service.list(tenantId)).length,0); await assert.rejects(()=>service.createWorkflow(tenantId,{pluginVersionId:imported.id,capabilityKey:'certificate.deploy',name:'bad'}),(error:any)=>error.errorCode==='PLUGIN_WORKFLOW_HASH_MISMATCH');
});

test('非内置租户可以使用官方内置工作流来源，但不能看到默认租户的用户插件', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const workflows = new WorkflowTemplatesApplicationService(new WorkflowTemplatesDomainService(
    new PgDocumentRepository(db, 'workflow.templates'),
    new PgDocumentRepository(db, 'workflow.template_versions'),
  ));
  const builtinTenantId = 'builtin-tenant';
  const businessTenantId = 'tenant-business';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const bindings = new PluginWorkflowBindingsRepository(db);
  const content = {
    apiVersion: 'gcac.workflow/v1' as const,
    kind: 'CurlSshWorkflow' as const,
    metadata: { name: 'builtin-deploy', version: '1.0.0' },
    inputContract: { apiVersion: 'gcac.deployment-input/v1' as const, variables: {}, connections: {}, credentials: {}, artifacts: {} },
    steps: [{ name: 'wait', type: 'wait' as const, seconds: 1 }],
  };
  const internal = await workflows.createPluginTemplate({ content });
  const published = await workflows.publishPluginVersion(internal.version.id);
  const builtin = await plugins.importVersion(builtinTenantId, {
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
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: { 'workflows/deploy.json': JSON.stringify(content) },
  }, 'BUILTIN');
  await plugins.enableVersion(builtin.id);
  await bindings.save({
    pluginVersionId: builtin.id,
    capabilityKey: 'certificate.deploy',
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
    workflowContentSha256: published.contentHash,
    createdAt: new Date().toISOString(),
  });
  const userPlugin = await plugins.importVersion(builtinTenantId, {
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
    workflowResourcePath: 'workflows/deploy.json',
    workflowTemplateId: internal.template.id,
    workflowVersionId: published.id,
    workflowContentSha256: published.contentHash,
    createdAt: new Date().toISOString(),
  });

  const service = new PluginWorkflowSourceService(plugins, bindings, workflows, builtinTenantId);
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
