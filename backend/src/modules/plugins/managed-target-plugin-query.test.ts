import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { ManagedTargetPluginQueryService } from './application/managed-target-plugin-query.service.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('受管目标插件 API 在同一事务中保存目标、Binding 和 Assignment', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations', {
    checksum: (content) => createHash('sha256').update(content, 'utf8').digest('hex'),
  });
  const tenantId = 'tenant-managed-plugin-query';
  const device = await new PgDeviceAssetsRepository(db).create(tenantId, {
    displayName: 'Fixture ADC', managementAddress: '10.33.44.10', managementPort: 443,
    deviceFamily: 'citrix.netscaler-adc', authMode: 'AUTO', tlsVerify: true,
  });
  const assets = new PgAssetsRepository(db);
  const framework = await assets.createFrameworkInstance(tenantId, {
    deviceId: device.hostId, frameworkType: 'adc.load-balancer', frameworkKey: 'adc-1', discoveryProviderKey: 'fixture', displayName: 'ADC',
  });
  const site = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id, deviceId: device.hostId, discoveryProviderKey: 'fixture', siteType: 'virtual-server', siteName: 'HTTPS', siteKey: 'https', port: 443, protocol: 'HTTPS',
  });
  const target = await assets.createManagedTarget(tenantId, {
    deviceId: device.hostId, frameworkInstanceId: framework.id, siteId: site.id, discoveryProviderKey: 'fixture',
    targetType: 'tls.binding', targetKey: 'https', supportedCapabilities: ['certificate.deploy'], executionLocations: ['CONTROL_PLANE'],
  });
  const applicationAsset = await assets.createServiceAsset(tenantId, {
    address: 'managed-plugin.example.com', port: 443, protocol: 'HTTPS', discoverySource: 'MANUAL', status: 'ACTIVE',
    deploymentStrategy: {
      type: 'MANAGED_TARGET',
      managedTarget: { managedTargetId: target.id, certificateFormatId: 'format-existing' },
    },
  });
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported = await plugins.importVersion(tenantId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'fixture.managed', version: '1.0.0', displayNameKey: 'fixture.managed', publisher: 'test',
      defaultLocale: 'zh-CN',
      runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED', permissions: [],
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
      compatibility: { productFamilies: ['citrix.netscaler-adc'], frameworkTypes: ['adc.load-balancer'], targetTypes: ['tls.binding'], managementMethods: ['PLUGIN'], executionLocations: ['CONTROL_PLANE'], artifactContracts: ['certificate.deploy.v1'] },
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' }, locales: { 'zh-CN': 'locales/zh-CN.json' } },
    },
    resources: {
      'workflows/deploy.json': JSON.stringify({
        apiVersion: 'gcac.workflow/v1', kind: 'CurlSshWorkflow', metadata: { name: 'fixture-managed-deploy', version: '1.0.0' },
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {
            virtualServer: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
            allowInsecureTls: { type: 'boolean', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          },
          connections: {},
          credentials: {},
          artifacts: {
            certificate: {
              kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
              artifactContract: { outputs: { leafPem: { role: 'public_certificate', required: true }, privateKeyPem: { role: 'private_key', required: true } } },
            },
          },
        },
        variables: {
          virtualServer: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          certificate: {
            type: 'certificate', required: true,
            artifactContract: { outputs: { leafPem: { role: 'public_certificate', required: true }, privateKeyPem: { role: 'private_key', required: true } } },
          },
        },
        steps: [{ name: 'deploy', type: 'transform', stage: 'install', transform: { engine: 'jsonata', input: {}, outputs: { result: { expression: '{}' } } } }],
      }),
      'locales/zh-CN.json': JSON.stringify({ 'fixture.managed': 'Fixture 受管证书部署' }),
    },
  });
  await plugins.enableVersion(imported.id);
  const publishedWorkflow = {
    pluginVersionId: imported.id,
    capabilityKey: 'certificate.deploy',
    workflowTemplateId: 'workflow_plugin_override',
    workflowVersionId: 'workflow_plugin_override_v1',
    contentHash: 'a'.repeat(64),
  };
  await db.query(`insert into pg_documents (namespace,document_id,payload,updated_at) values
    ('workflow.templates',$1,$2::jsonb,now()),('workflow.template_versions',$3,$4::jsonb,now())`, [
    publishedWorkflow.workflowTemplateId,
    JSON.stringify({ id: publishedWorkflow.workflowTemplateId, name: 'Fixture Plugin Override', origin: 'plugin_internal', ownerType: 'TENANT', ownerId: tenantId, tenantId, currentVersionId: publishedWorkflow.workflowVersionId, status: 'active' }),
    publishedWorkflow.workflowVersionId,
    JSON.stringify({ id: publishedWorkflow.workflowVersionId, templateId: publishedWorkflow.workflowTemplateId, version: 1, dslVersion: 'v1', status: 'published', contentHash: publishedWorkflow.contentHash, content: JSON.parse(imported.resources['workflows/deploy.json']!) }),
  ]);
  await db.query(`insert into unified_plugin_workflow_bindings
    (plugin_version_id,owner_type,owner_id,capability_key,workflow_resource_path,workflow_template_id,workflow_version_id,workflow_content_sha256,created_at)
    values ($1,'TENANT',$2,$3,'workflows/deploy.json',$4,$5,$6,now())`, [
    publishedWorkflow.pluginVersionId,
    tenantId,
    publishedWorkflow.capabilityKey,
    publishedWorkflow.workflowTemplateId,
    publishedWorkflow.workflowVersionId,
    publishedWorkflow.contentHash,
  ]);
  const older = await plugins.importVersion(tenantId, {
    manifest: { ...imported.manifest, version: '0.9.0' },
    resources: imported.resources,
  });
  await plugins.enableVersion(older.id);
  const builtinLatestVersionId = 'builtin-fixture-managed-1-1-25';
  const builtinLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'pt-BR'];
  const builtinManifest = {
    ...imported.manifest,
    source: 'BUILTIN' as const,
    version: '1.1.25',
    scope: 'MANAGED' as const,
    trust: 'OFFICIAL_SIGNED' as const,
    support: 'OFFICIAL' as const,
    resources: {
      ...imported.manifest.resources,
      locales: Object.fromEntries(builtinLocales.map((locale) => [locale, `locales/${locale}.json`])),
    },
  };
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,owner_type,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ($1,'SYSTEM','SYSTEM',$2,'1.1.25','BUILTIN','WORKFLOW_DSL','MANAGED','OFFICIAL_SIGNED','OFFICIAL',$3::jsonb,'package-builtin','manifest-builtin','{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`, [
    builtinLatestVersionId,
    imported.pluginId,
    JSON.stringify(builtinManifest),
  ]);
  for (const locale of builtinLocales) {
    await db.query(`insert into unified_plugin_resources
      (plugin_version_id,resource_path,resource_content,resource_sha256,created_at)
      values ($1,$2,$3,$4,now())`, [
      builtinLatestVersionId,
      `locales/${locale}.json`,
      imported.resources['locales/zh-CN.json'],
      `sha256:locale-builtin-${locale}`,
    ]);
  }
  const legacy = await plugins.importVersion(tenantId, {
    manifest: {
      ...imported.manifest,
      pluginId: 'fixture.legacy',
      version: '1.0.0',
      displayNameKey: 'fixture.legacy',
      defaultLocale: undefined,
      compatibility: undefined,
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: { 'workflows/deploy.json': imported.resources['workflows/deploy.json']! },
  });
  await plugins.enableVersion(legacy.id);

  const service = new ManagedTargetPluginQueryService(db);
  const compatible = await service.listCompatiblePlugins({ tenantId, managedTargetId: target.id, capabilityKey: 'certificate.deploy', locale: 'zh-CN' });
  assert.deepEqual(compatible.items.filter((item) => item.compatible).map((item) => item.pluginVersionId), [builtinLatestVersionId]);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.managed')?.displayName, 'Fixture 受管证书部署');
  assert.equal(compatible.items.some((item) => item.pluginVersionId === older.id), false);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.legacy')?.compatible, false);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.legacy')?.reasons.some((reason) => reason.dimension === 'compatibilityContract'), true);

  const draftProjection = await service.projectApplicationAssetPluginInputs({
    tenantId,
    managedTargetId: target.id,
    pluginVersionId: imported.id,
    certificateFormatId: 'format-existing',
    applicationAsset: {
      id: 'draft',
      address: 'vpn-test.example.com',
      port: 443,
      protocol: 'HTTPS',
      displayName: 'VPN Test',
    },
    inputBindings: {
      apiVersion: 'gcac.input-bindings/v1',
      variables: { virtualServer: 'vpn-test' },
      connections: {},
      credentials: {},
      artifacts: {},
    },
  });
  assert.equal(draftProjection.requiredVariables.find((item) => item.slot === 'allowInsecureTls')?.value, undefined);
  assert.equal(draftProjection.saveable, false);

  const saved = await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: {
      managedTargetId: target.id,
      pluginOverride: { pluginVersionId: imported.id, inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: { virtualServer: 'https', allowInsecureTls: false }, credentials: {}, artifacts: {}, connections: {} } },
    },
  });
  assert.equal(saved.target.managedTargetId, target.id);
  assert.equal(saved.effectiveCapability?.source.ownerType, 'APPLICATION_ASSET');
  assert.equal(saved.effectiveCapability?.plugin.pluginId, 'fixture.managed');
  assert.equal(saved.effectiveCapability?.binding.hostId, device.hostId);
  const savedBinding = await new PluginBindingsApplicationService(new PluginBindingsRepository(db))
    .getTenantBinding(tenantId, saved.effectiveCapability!.binding.pluginBindingId);
  assert.equal(savedBinding.inputBindings.variables.allowInsecureTls, false);
  assert.equal((await assets.getServiceAsset(tenantId, applicationAsset.id))?.deploymentStrategy?.managedTarget?.certificateFormatId, 'format-existing');

  const effective = await service.getEffectiveCapability({ tenantId, managedTargetId: target.id, applicationAssetId: applicationAsset.id, capabilityKey: 'certificate.deploy' });
  assert.equal(effective.executionLocation, 'CONTROL_PLANE');
  assert.equal(effective.binding.pluginBindingId, saved.effectiveCapability?.binding.pluginBindingId);

  await assert.rejects(() => service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id, pluginOverride: { pluginVersionId: older.id, inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} } } },
  }), (error: any) => error.errorCode === 'VALIDATION_FAILED'
    && error.details?.issues?.some((issue: any) => issue.code === 'DEPLOYMENT_INPUT_REQUIRED'));

  const overridden = await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: {
      managedTargetId: target.id,
      executionMode: 'WORKFLOW_OVERRIDE',
        workflowExecution: {
          tenantId,
          pluginVersionId: imported.id,
          capabilityKey: 'certificate.deploy',
          workflowTemplateId: publishedWorkflow.workflowTemplateId,
          workflowVersionSelection: 'FIXED',
        workflowVersionId: publishedWorkflow.workflowVersionId,
        runner: 'CONTROL_PLANE',
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          connections: {},
          variables: { virtualServer: 'https', allowInsecureTls: false },
          credentials: {},
          artifacts: {
            certificate: {
              certificateFormatId: 'format-existing',
              outputBindings: { leafPem: 'leafPem', privateKeyPem: 'privateKeyPem' },
            },
          },
        },
      },
    },
  });
  assert.equal(overridden.executionMode, 'WORKFLOW_OVERRIDE');
  assert.equal((await assets.getServiceAsset(tenantId, applicationAsset.id))?.deploymentStrategy?.managedTarget?.executionMode, 'WORKFLOW_OVERRIDE');
  assert.equal(Number((await db.query<{ count: string | number }>(`select count(*) from plugin_capability_assignments where tenant_id=$1 and owner_type='APPLICATION_ASSET' and owner_id=$2 and status='ACTIVE'`, [tenantId, applicationAsset.id])).rows[0]?.count), 0);

  await assert.rejects(() => service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id },
  }), (error: unknown) => Boolean(error && typeof error === 'object' && 'errorCode' in error && error.errorCode === 'CAPABILITY_MISSING'));
  assert.equal((await assets.getServiceAsset(tenantId, applicationAsset.id))?.deploymentStrategy?.managedTarget?.executionMode, 'WORKFLOW_OVERRIDE');
  assert.ok(overridden.workflowExecutionBinding);
  assert.equal((await db.query<{ status: string }>('select status from workflow_execution_bindings where id=$1', [overridden.workflowExecutionBinding.id])).rows[0]?.status, 'ACTIVE');

  const defaultBindingId = saved.effectiveCapability?.binding.pluginBindingId;
  assert.ok(defaultBindingId);
  await new PluginBindingsApplicationService(new PluginBindingsRepository(db)).assignCapability(tenantId, {
    ownerType: 'MANAGED_TARGET',
    ownerId: target.id,
    capabilityKey: 'certificate.deploy',
    pluginVersionId: imported.id,
    pluginBindingId: defaultBindingId,
    precedence: 'TARGET_OVERRIDE',
  });
  const restored = await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id },
  });
  assert.equal(restored.effectiveCapability?.source.ownerType, 'APPLICATION_ASSET');
  const applicationAssignment = await db.query<{ status: string }>(
    `select status from plugin_capability_assignments
     where tenant_id=$1 and owner_type='APPLICATION_ASSET' and owner_id=$2 and capability_key='certificate.deploy'`,
    [tenantId, applicationAsset.id],
  );
  assert.equal(applicationAssignment.rows[0]?.status, 'ACTIVE');
  const restoredBindingId = restored.effectiveCapability?.binding.pluginBindingId;
  assert.ok(restoredBindingId);
  const restoredBinding = await new PluginBindingsApplicationService(new PluginBindingsRepository(db)).getTenantBinding(tenantId, restoredBindingId);
  assert.deepEqual(restoredBinding.inputBindings.artifacts, {
    certificate: {
      certificateFormatId: 'format-existing',
      outputBindings: { leafPem: 'leafPem', privateKeyPem: 'privateKeyPem' },
    },
  });
  assert.deepEqual(restoredBinding.inputBindings.variables, {});
  assert.deepEqual(restoredBinding.inputBindings.connections, {});
  assert.deepEqual(restoredBinding.inputBindings.credentials, {});
  assert.equal((await db.query<{ status: string }>('select status from workflow_execution_bindings where id=$1', [overridden.workflowExecutionBinding.id])).rows[0]?.status, 'DISABLED');

  await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id, certificateFormatId: 'format-updated' },
  });
  assert.equal((await assets.getServiceAsset(tenantId, applicationAsset.id))?.deploymentStrategy?.managedTarget?.certificateFormatId, 'format-updated');
  await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id },
  });
  assert.equal((await assets.getServiceAsset(tenantId, applicationAsset.id))?.deploymentStrategy?.managedTarget?.certificateFormatId, 'format-updated');

  await assert.rejects(() => service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id, expectedTargetVersion: 999 },
  }), /版本冲突/);
  await assert.rejects(() => service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: {
      managedTargetId: target.id,
      pluginOverride: {
        pluginVersionId: imported.id,
        pluginBindingId: restoredBinding.id,
        expectedBindingVersion: 999,
        inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
      },
    },
  }), /版本冲突/);
});
