import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { PluginPromotionService } from './promotion/plugin-promotion.service.js';

test('Standalone 归集支持预览、确认幂等和撤销恢复', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  const plugin = await createPlugin(db);
  const binding = await new PluginBindingsApplicationService(new PluginBindingsRepository(db)).createBinding('tenant-1', {
    pluginVersionId: plugin.id, mode: 'STANDALONE', inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: { timeoutSeconds: 30 },
    credentials: { credential: { credentialId: 'cred-1' } }, artifacts: {}, connections: { management: { host: '10.50.0.10', port: 443 } } },
  });
  const service = new PluginPromotionService(db);
  const preview = await service.preview('tenant-1', input(binding.id));
  assert.equal(preview.status, 'PREVIEWED');
  assert.equal(preview.mappings.sites.length, 1);
  assert.equal(preview.mappings.credentials[0]?.action, 'REUSE');

  const completed = await service.confirm('tenant-1', preview.promotionId);
  assert.equal(completed.status, 'COMPLETED');
  assert.ok(completed.deviceAssetId);
  assert.ok(completed.targetPluginBindingId);
  assert.equal((await service.confirm('tenant-1', preview.promotionId)).id, completed.id);
  const targetBinding = await db.query<{ mode: string; status: string }>('select mode,status from unified_plugin_bindings where id=$1', [completed.targetPluginBindingId]);
  assert.deepEqual(targetBinding.rows[0], { mode: 'MANAGED', status: 'ACTIVE' });

  const revoked = await service.revoke('tenant-1', preview.promotionId);
  assert.equal(revoked.status, 'REVOKED');
  const sourceBinding = await db.query<{ status: string }>('select status from unified_plugin_bindings where id=$1', [binding.id]);
  assert.equal(sourceBinding.rows[0]?.status, 'ACTIVE');
});

test('Standalone 归集预览阻止地址冲突和非 SecretRef', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  const plugin = await createPlugin(db);
  const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const existing = new PluginPromotionService(db);
  const first = await bindings.createBinding('tenant-1', {
    pluginVersionId: plugin.id, mode: 'STANDALONE', inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {},
    credentials: { credential: { credentialId: 'cred-1' } }, artifacts: {}, connections: {} },
  });
  const firstPreview = await existing.preview('tenant-1', input(first.id));
  assert.equal((await existing.confirm('tenant-1', firstPreview.promotionId)).status, 'COMPLETED');

  const invalid = await bindings.createBinding('tenant-1', {
    pluginVersionId: plugin.id, mode: 'STANDALONE', inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {},
    credentials: { credential: { credentialId: '' } }, artifacts: {}, connections: {} },
  });
  const conflict = await existing.preview('tenant-1', input(invalid.id));
  assert.equal(conflict.status, 'CONFLICT');
  assert.deepEqual(conflict.conflicts.map((item) => item.code).sort(), ['DEVICE_ADDRESS_CONFLICT', 'SECRET_REF_INVALID']);
});

async function createPlugin(db: PgliteDatabase) {
  const service = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported = await service.importVersion('tenant-1', {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'test.both-device', version: '1.0.0',
      displayNameKey: 'plugin.test.name', publisher: 'test', runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'BOTH',
      trust: 'UNSIGNED', support: 'SELF_MANAGED', permissions: [],
      resources: { workflows: { 'device.discover': 'workflows/discover.json', 'certificate.deploy': 'workflows/deploy.json' } },
      capabilities: [
        { key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
        { key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] },
      ],
    },
    resources: { 'workflows/discover.json': '{}', 'workflows/deploy.json': '{}' },
  });
  return service.enableVersion(imported.id);
}

function input(sourcePluginBindingId: string) {
  return {
    sourcePluginBindingId, displayName: 'Managed Device', deviceFamily: 'test.both-device', managementAddress: '10.50.0.10',
    managementPort: 443, authMode: 'SECRET_REF', tlsVerify: true,
    discovery: {
      apiVersion: 'gcac.device-discovery/v2' as const,
      device: { stableKey: 'device:10.50.0.10', displayName: 'Managed Device', productFamily: 'TEST', managementAddress: '10.50.0.10' },
      capabilities: [{ key: 'device.discover', available: true }, { key: 'certificate.deploy', available: true }],
      frameworks: [{ stableKey: 'framework:main', frameworkType: 'test.framework', displayName: 'Test Framework' }],
      sites: [{ stableKey: 'site:443', frameworkStableKey: 'framework:main', siteType: 'network.virtual-server', displayName: 'HTTPS', addresses: ['10.50.0.10'], port: 443, protocol: 'HTTPS' }],
      managedTargets: [{ stableKey: 'target:443', frameworkStableKey: 'framework:main', siteStableKey: 'site:443', targetType: 'tls.binding', targetKey: 'site:443', supportedCapabilities: ['certificate.deploy'], executionLocations: ['CONTROL_PLANE' as const] }],
      certificates: [], certificateBindings: [], warnings: [],
    },
  };
}
