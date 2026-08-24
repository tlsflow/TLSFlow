import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PluginBindingsApplicationService, CertificateArtifactBindingResolver } from './application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';

test('Managed 与 Standalone Binding 使用同一数据模型并保护上下文边界', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ('version-1','tenant-1','fixture','1','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED','{}','p','m','{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`);
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const managed = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', variableBindings: {}, secretBindings: { auth: 'secret://device/1' }, certificateArtifactBindings: {}, connectionBindings: {}, managedContext: { hostId: 'host-1', deviceAssetId: 'device-1' } });
  const standalone = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'STANDALONE', variableBindings: {}, secretBindings: {}, certificateArtifactBindings: {}, connectionBindings: { address: '10.0.0.1' } });
  assert.equal(managed.mode, 'MANAGED');
  assert.equal(standalone.mode, 'STANDALONE');
  await assert.rejects(() => service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', variableBindings: {}, secretBindings: {}, certificateArtifactBindings: {}, connectionBindings: {} }), /hostId/);
});

test('Capability Assignment 按应用资产、受管目标、设备顺序覆盖', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ('version-1','tenant-1','fixture','1','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED','{}','p','m','{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`);
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const binding = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', variableBindings: {}, secretBindings: {}, certificateArtifactBindings: {}, connectionBindings: {}, managedContext: { hostId: 'host-1' } });
  for (const [ownerType, ownerId, precedence] of [['DEVICE','device-1','DEVICE_DEFAULT'],['MANAGED_TARGET','target-1','TARGET_OVERRIDE'],['APPLICATION_ASSET','asset-1','ASSET_OVERRIDE']] as const) {
    await service.assignCapability('tenant-1', { ownerType, ownerId, capabilityKey: 'certificate.deploy', pluginVersionId: 'version-1', pluginBindingId: binding.id, precedence });
  }
  const resolved = await service.resolveAssignment('tenant-1', 'certificate.deploy', { deviceId: 'device-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1' });
  assert.equal(resolved?.ownerType, 'APPLICATION_ASSET');
});

test('PluginBinding 支持乐观锁更新并保持 SecretRef', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  await database.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ('version-1','tenant-1','fixture-update','1','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED','{}','p','m','{}','ENABLED','NOT_REQUIRED','[]','{}',now(),now())`);
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(database));
  const created = await service.createBinding('tenant-1', {
    pluginVersionId: 'version-1', mode: 'STANDALONE', variableBindings: { region: 'default' },
    secretBindings: { auth: 'secret://device/1' }, certificateArtifactBindings: {}, connectionBindings: { address: '10.0.0.1' },
  });
  const updated = await service.updateBinding('tenant-1', created.id, {
    expectedVersion: 1,
    variableBindings: { region: 'partition-a' },
  });
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.secretBindings, { auth: 'secret://device/1' });
  await assert.rejects(() => service.updateBinding('tenant-1', created.id, { expectedVersion: 1, variableBindings: {} }), /版本冲突/);
});

test('证书产物 Resolver 只返回 ArtifactRef、哈希和敏感标记', async () => {
  const resolver = new CertificateArtifactBindingResolver({ generateDeploymentArtifactFromFormat: async () => ({ certificateVersionId: 'cert-1', certificateFormatId: 'format-1', format: 'PEM', certificatePem: 'CERT', privateKeyPem: 'KEY', files: [] }) });
  const result = await resolver.resolve({ certificateVersionId: 'cert-1', createdBy: 'test', bindings: { material: { certificateFormatId: 'format-1', outputBindings: { certificate: 'certificatePem', privateKey: 'privateKeyPem' } } } });
  assert.equal(result.material?.outputs.privateKey?.sensitive, true);
  assert.equal(JSON.stringify(result).includes('KEY'), false);
});
