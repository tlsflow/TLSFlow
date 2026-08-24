import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAgentsRepository } from '../agents/repository/agents.repository.js';
import { ManagedTargetContextResolver } from '../assets/application/managed-target-context.resolver.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { deploymentAssetContextBuilder } from '../deployment-inputs/application/deployment-asset-context.builder.js';
import { DeploymentInputContractLoader } from '../deployment-inputs/application/deployment-input-contract-loader.js';
import { ProductionDeploymentInputResolverService } from '../deployment-inputs/application/production-deployment-input-resolver.service.js';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';
import { createDefaultPluginRuntimeAdapterRegistry } from '../deployment-plans/application/plugin-runtime-adapter.registry.js';
import { PgDevicesRepository } from '../devices/repository/devices.repository.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { ManagedTargetPluginQueryService } from './application/managed-target-plugin-query.service.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { PluginWorkflowPublisherService } from './application/plugin-workflow-publisher.service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { StandardDeviceDiscoveryProjector } from './discovery/standard-device-discovery.projector.js';
import type { ResolvedDeploymentCapability } from './application/deployment-capability.resolver.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { PluginWorkflowBindingsRepository } from './repository/plugin-workflow-bindings.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../compatibility/fixtures/unified-plugins');

test('NAS 与 Kubernetes 用户插件无需宿主产品分派即可走通标准部署链', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const tenantId = 'tenant-unknown-product-extensibility';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const assets = new PgAssetsRepository(db);
  const deviceAssets = new PgDeviceAssetsRepository(db);
  const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const contexts = new ManagedTargetContextResolver(assets, new PgAgentsRepository(db), deviceAssets);
  const workflows = new WorkflowTemplatesApplicationService();
  const workflowPublisher = new PluginWorkflowPublisherService(workflows, new PluginWorkflowBindingsRepository(db));
  const packages = await new BuiltinUnifiedPluginLoader(fixtureRoot).loadPackages();

  assert.equal(packages.length, 2);
  for (const [index, pluginPackage] of packages.entries()) {
    const manifest = pluginPackage.manifest as { pluginId: string; resources: { discoveryMappings: { default: string } } };
    const fixture = fixtureFor(manifest.pluginId);
    const imported = await plugins.importVersion(tenantId, pluginPackage, 'USER');
    const plugin = await plugins.enableVersion(imported.id);
    const [workflowBinding] = await workflowPublisher.publishPlugin(plugin);
    assert.ok(workflowBinding);

    const ui = await plugins.getUiResources(plugin.id, 'zh-CN');
    assert.deepEqual(Object.keys(ui.forms), ['device']);
    assert.deepEqual(Object.keys(ui.presentations), ['device']);
    assert.equal(ui.locale?.resolved, 'zh-CN');

    const device = await deviceAssets.create(tenantId, {
      displayName: fixture.displayName,
      managementAddress: fixture.address,
      managementPort: fixture.port,
      deviceFamily: manifest.pluginId,
      authMode: 'AUTO',
      tlsVerify: true,
    });
    const discovery = JSON.parse(plugin.resources[manifest.resources.discoveryMappings.default]!);
    const projection = await new StandardDeviceDiscoveryProjector(db).project({
      tenantId,
      hostId: device.hostId,
      deviceAssetId: device.id,
      pluginVersionId: plugin.id,
      discoverySource: 'PROVIDER',
    }, discovery);
    assert.deepEqual(projection, {
      serviceInstances: 1,
      sites: 1,
      managedTargets: 1,
      certificates: 0,
      certificateBindings: 0,
      stale: 0,
      conflicts: 0,
    });

    const target = (await assets.listManagedTargets(tenantId, { page: 1, pageSize: 20, filter: {} })).items
      .find((item) => item.deviceId === device.hostId);
    assert.ok(target);
    const deviceDetail = await new PgDevicesRepository(db).get(tenantId, device.hostId);
    assert.equal(deviceDetail?.productFamily, fixture.productFamily);
    assert.equal(deviceDetail?.frameworks[0]?.frameworkType, fixture.frameworkType);
    assert.equal(deviceDetail?.sites[0]?.kind, fixture.siteType);

    const applicationAsset = await assets.createServiceAsset(tenantId, {
      address: fixture.applicationAddress,
      port: 443,
      protocol: 'HTTPS',
      displayName: `${fixture.displayName} Certificate`,
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });
    const query = new ManagedTargetPluginQueryService(db);
    const compatible = await query.listCompatiblePlugins({
      tenantId,
      managedTargetId: target.id,
      capabilityKey: 'certificate.deploy',
      locale: 'zh-CN',
    });
    assert.deepEqual(compatible.items.filter((item) => item.compatible).map((item) => item.pluginVersionId), [plugin.id]);

    const inputBindings = emptyInputBindingsV1();
    inputBindings.variables.targetName = target.targetKey;
    const saved = await query.saveApplicationAssetTarget({
      tenantId,
      applicationAssetId: applicationAsset.id,
      value: {
        managedTargetId: target.id,
        certificateFormatId: `fixture-format-${index}`,
        pluginOverride: { pluginVersionId: plugin.id, inputBindings },
      },
    });
    assert.equal(saved.effectiveCapability?.plugin.pluginVersionId, plugin.id);
    assert.equal(saved.effectiveCapability?.executionLocation, 'CONTROL_PLANE');
    const pluginBindingId = saved.effectiveCapability?.binding.pluginBindingId;
    assert.ok(pluginBindingId);

    const pluginBinding = await bindings.getTenantBinding(tenantId, pluginBindingId);
    const assignment = (await bindings.listAssignmentCandidates(tenantId, 'certificate.deploy', {
      deviceId: device.hostId,
      managedTargetId: target.id,
      applicationAssetId: applicationAsset.id,
    }))[0];
    assert.ok(assignment);
    const context = await contexts.resolve(tenantId, target.id);
    const contract = new DeploymentInputContractLoader().fromPlugin(plugin, 'certificate.deploy');
    const resolvedInput = new ProductionDeploymentInputResolverService().resolve({
      phase: 'preflight',
      contract,
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset, managedTargetContext: context }),
      bindingLayers: { assetOverride: { pluginVersionId: plugin.id, inputBindings: pluginBinding.inputBindings } },
      artifactSnapshots: {
        certificate: {
          outputs: {
            leafPem: { artifactRef: `memory://${manifest.pluginId}/certificate.pem` },
            privateKeyPem: { artifactRef: `memory://${manifest.pluginId}/private-key.pem` },
          },
        },
      },
    });
    assert.equal(resolvedInput.executable, true);
    assert.equal(resolvedInput.contractVersion, 'gcac.deployment-input/v1');

    const capability: ResolvedDeploymentCapability = {
      assignment,
      binding: pluginBinding,
      plugin,
      pluginVersionId: plugin.id,
      pluginRuntime: 'WORKFLOW_DSL',
      executionLocation: 'CONTROL_PLANE',
      compatibility: { compatible: true, reasons: [] },
    };
    const runtime = await createDefaultPluginRuntimeAdapterRegistry().compile({
      capability,
      context,
      applicationAsset,
      resolvedInput,
      workflow: {
        workflowId: workflowBinding.workflowTemplateId,
        workflowVersionId: workflowBinding.workflowVersionId,
      },
    });
    assert.equal(runtime.executorType, 'WORKFLOW');
    assert.equal((runtime.payload.workflowRequest as { workflowVersionSelection: string }).workflowVersionSelection, 'PINNED');
    assert.equal((runtime.payload.pluginRuntimeCapability as { pluginVersionId: string }).pluginVersionId, plugin.id);
    assert.equal((runtime.payload.pluginRuntimeCapability as { pluginBindingId: string }).pluginBindingId, pluginBinding.id);
    assert.equal(runtime.payload.resolvedDeploymentInput, resolvedInput);
    assert.deepEqual(Object.keys(runtime.payload).filter((key) => key.endsWith('Bindings')), []);

    await assertPersistedChain(db, plugin.id, index + 1);
  }
});

function fixtureFor(pluginId: string) {
  if (pluginId === 'fixture.mock-nas') return {
    displayName: '模拟 NAS', address: '192.0.2.40', port: 5001,
    productFamily: 'fixture.mock-nas', frameworkType: 'storage.nas', siteType: 'network.virtual-server',
    applicationAddress: 'nas.example.test',
  };
  assert.equal(pluginId, 'fixture.mock-kubernetes');
  return {
    displayName: '模拟 Kubernetes', address: '192.0.2.41', port: 6443,
    productFamily: 'fixture.mock-kubernetes', frameworkType: 'kubernetes.cluster', siteType: 'kubernetes.ingress',
    applicationAddress: 'k8s.example.test',
  };
}

async function assertPersistedChain(db: PgliteDatabase, pluginVersionId: string, expectedCount: number): Promise<void> {
  const pluginSnapshot = await db.query<{ plugin_version_id: string }>(
    'select plugin_version_id from plugin_discovery_snapshots where plugin_version_id=$1',
    [pluginVersionId],
  );
  assert.equal(pluginSnapshot.rows[0]?.plugin_version_id, pluginVersionId);
  for (const table of [
    'unified_plugin_versions',
    'unified_plugin_workflow_bindings',
    'plugin_discovery_snapshots',
    'pg_framework_instances',
    'pg_site_assets',
    'pg_managed_targets',
    'pg_application_asset_targets',
    'unified_plugin_bindings',
    'plugin_capability_assignments',
  ]) {
    const result = await db.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    assert.equal(Number(result.rows[0]?.count), expectedCount, `${table} 必须保存完整测试链路`);
  }
}
