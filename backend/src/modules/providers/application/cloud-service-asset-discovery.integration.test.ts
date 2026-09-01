import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from '../../plugins/repository/plugin-bindings.repository.js';
import { PluginPackageResourcesService } from '../../plugins/application/plugin-package-resources.service.js';
import { PluginResourceOnboardingApplicationService } from '../../assets/application/plugin-resource-onboarding.application-service.js';
import { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from '../../plugins/repository/unified-plugins.repository.js';
import { BuiltinUnifiedPluginLoader } from '../../plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { CloudResourceProjectionService } from '../discovery/cloud-resource-projection.js';
import type { CloudAccountDiscoveryResult } from './cloud-account-discovery.application-service.js';

test('标准 ServiceAsset 云资源接入会投影 Framework、Site 和真实 ManagedTarget', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const tenantId = 'tenant-cloud-service-asset-integration';
  const loader = new BuiltinUnifiedPluginLoader();
  const pluginPackage = (await loader.loadPackages()).find((item) => {
    const manifest = item.manifest as { pluginId?: string };
    return manifest.pluginId === 'cloud.aliyun';
  });
  assert.ok(pluginPackage, '必须加载内置阿里云 CDN 插件包');
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported = await plugins.importVersion(tenantId, {
    manifest: pluginPackage.manifest,
    resources: pluginPackage.resources,
    packageContent: pluginPackage.packageContent,
  }, 'BUILTIN');
  await plugins.approvePermissions(imported.id, imported.manifest.permissions);
  const plugin = await plugins.enableVersion(imported.id);

  const assets = new AssetsApplicationService(new PgAssetsRepository(db));
  const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const projection = new CloudResourceProjectionService(db);
  assets.setCloudResourceProjectionService(projection);
  const operations: Array<{ assetId: string; operation: string }> = [];
  const discovery = {
    executeServiceAsset: async (currentTenantId: string, assetId: string, operation: 'connection-test' | 'discover'): Promise<CloudAccountDiscoveryResult> => {
      operations.push({ assetId, operation });
      assert.equal(currentTenantId, tenantId);
      if (operation === 'discover') {
        await projection.persistBatch({
          tenantId,
          serviceAssetId: assetId,
          pluginId: plugin.pluginId,
          pluginVersionId: plugin.id,
          provider: plugin.pluginId,
          providerDisplayName: '阿里云 CDN',
          topology: 'ACCOUNT_FRAMEWORK',
          discoveryProviderKey: 'plugin:cloud.aliyun:discover',
          discoveredAt: '2026-08-27T00:00:00.000Z',
        }, [
          {
            apiVersion: 'gcac.cloud-service/v1', kind: 'CloudServiceResource',
            stableKey: 'cloud.aliyun:cdn.domain:mainland.example', pluginId: plugin.pluginId,
            pluginVersionId: plugin.id, provider: plugin.pluginId, resourceId: 'mainland.example',
            resourceType: 'cdn.domain', region: 'mainland', displayName: 'mainland.example',
            frameworkKey: 'cdn.mainland', frameworkDisplayName: '阿里云 CDN · 中国大陆',
          },
          {
            apiVersion: 'gcac.cloud-service/v1', kind: 'CloudServiceResource',
            stableKey: 'cloud.aliyun:cdn.domain:global.example', pluginId: plugin.pluginId,
            pluginVersionId: plugin.id, provider: plugin.pluginId, resourceId: 'global.example',
            resourceType: 'cdn.domain', region: 'global', displayName: 'global.example',
            frameworkKey: 'cdn.global', frameworkDisplayName: '阿里云 CDN · 国际站',
            metadata: {
              certificateEndpoints: [{
                endpointKey: 'global.example',
                targetType: 'cloud.aliyun.cdn.certificate',
                targetKey: 'global.example',
                bindingKey: 'global.example',
                supportedCapabilities: ['certificate.deploy'],
                executionLocations: ['CONTROL_PLANE'],
              }],
            },
          },
        ]);
      }
      return {
        operation,
        status: 'SUCCEEDED',
        assetId,
        providerKey: plugin.pluginId,
        pluginVersionId: plugin.id,
        workflowVersionId: `workflow-${operation}`,
        signatureVerified: true,
        resources: [],
        completedAt: '2026-08-27T00:00:00.000Z',
      };
    },
  };
  const onboarding = new PluginResourceOnboardingApplicationService(
    assets,
    bindings,
    discovery as never,
    new PluginPackageResourcesService(),
  );

  const result = await onboarding.onboard(tenantId, plugin, {
    displayName: '阿里云 CDN 主账号',
    credentialId: 'cred_aliyun_fixture',
  }, 'user-cloud');

  assert.equal(result.resourceType, 'ASSET');
  assert.equal(result.assetId, result.resourceId);
  assert.deepEqual(operations, [
    { assetId: result.assetId as string, operation: 'connection-test' },
    { assetId: result.assetId as string, operation: 'discover' },
  ]);
  const owner = await db.query<{ metadata: Record<string, unknown>; status: string }>(
    'select metadata, status from pg_service_assets where tenant_id=$1 and id=$2',
    [tenantId, result.assetId],
  );
  assert.equal(owner.rows[0]?.status, 'ACTIVE');
  assert.equal(owner.rows[0]?.metadata.pluginId, plugin.pluginId);
  assert.equal(owner.rows[0]?.metadata.onboardingState, 'ACTIVE');
  assert.equal((await db.query('select id from pg_cloud_account_assets where tenant_id=$1', [tenantId])).rows.length, 0);
  assert.equal((await db.query('select id from pg_hosts where tenant_id=$1', [tenantId])).rows.length, 0);
  assert.equal((await db.query('select service_asset_id from pg_device_assets where tenant_id=$1 and service_asset_id=$2', [tenantId, result.assetId])).rows.length, 0);

  const binding = await db.query<{ managed_context: { serviceAssetId?: string } }>(
    'select managed_context from unified_plugin_bindings where tenant_id=$1 and plugin_version_id=$2',
    [tenantId, plugin.id],
  );
  assert.equal(binding.rows[0]?.managed_context.serviceAssetId, result.assetId);
  const assignments = await db.query<{ owner_type: string; owner_id: string; capability_key: string }>(
    'select owner_type, owner_id, capability_key from plugin_capability_assignments where tenant_id=$1 order by capability_key',
    [tenantId],
  );
  assert.deepEqual(assignments.rows, [
    { owner_type: 'SERVICE_ASSET', owner_id: result.assetId, capability_key: 'cloud.service.connection-test' },
    { owner_type: 'SERVICE_ASSET', owner_id: result.assetId, capability_key: 'cloud.service.discover' },
  ]);

  const persisted = await projection.listForAsset(tenantId, result.assetId as string, 'SERVICE_ASSET');
  assert.equal(persisted.frameworks.length, 2);
  assert.equal(persisted.sites.length, 2);
  assert.equal(persisted.managedTargets.length, 1);
  assert.equal(persisted.managedTargets[0]?.targetType, 'cloud.aliyun.cdn.certificate');
  assert.equal(persisted.managedTargets[0]?.targetKey, 'global.example');
  assert.equal(persisted.frameworks.every((item) => item.serviceAssetId === result.assetId), true);
  assert.equal(persisted.sites.every((item) => item.serviceAssetId === result.assetId), true);

  const detail = await assets.getServiceAssetDetail(tenantId, result.assetId as string);
  const standardDetail = detail as (Record<string, any> | undefined);
  assert.equal(standardDetail?.category, 'CLOUD');
  assert.equal(standardDetail?.frameworks?.length, 2);
  assert.equal(standardDetail?.sites?.length, 2);
  assert.equal(standardDetail?.resourceCounts?.frameworks, 2);
  assert.equal(standardDetail?.resourceCounts?.sites, 2);
  assert.equal(standardDetail?.sites?.find((site: Record<string, unknown>) => site.name === 'global.example')?.managedTargetId !== undefined, true);
});
