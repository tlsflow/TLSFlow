import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { insertCanonicalPluginVersion } from './plugin-test-fixtures.js';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';

const inputBindings = (variables: Record<string, unknown> = {}, credentials: Record<string, { credentialId: string }> = {}, connections: Record<string, unknown> = {}, artifacts: Record<string, unknown> = {}) => ({ ...emptyInputBindingsV1(), variables, credentials, connections: connections as never, artifacts: artifacts as never });

test('Managed 与 Standalone Binding 使用同一数据模型并保护上下文边界', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  await insertCanonicalPluginVersion(db, 'version-1', 'tenant-1');
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const managed = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', inputBindings: inputBindings({}, { auth: { credentialId: 'cred-1' } }), managedContext: { hostId: 'host-1', managedTargetId: 'target-1' } });
  const standalone = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'STANDALONE', inputBindings: inputBindings({}, {}, { management: { host: '10.0.0.1' } }) });
  assert.equal(managed.mode, 'MANAGED');
  assert.equal(standalone.mode, 'STANDALONE');
  await assert.rejects(() => service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', inputBindings: inputBindings() }), /hostId/);
  await assert.rejects(() => service.createBinding('tenant-1', {
    pluginVersionId: 'version-1', mode: 'MANAGED', inputBindings: inputBindings(),
    managedContext: { hostId: 'host-1', agentId: 'agent-1' } as never,
  }), /只允许保存 Host、ManagedTarget 或 CloudAccountAsset 身份/);
});

test('Capability Assignment 按应用资产、受管目标、设备顺序覆盖', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (value) => createHash('sha256').update(value).digest('hex') });
  await insertCanonicalPluginVersion(db, 'version-1', 'tenant-1');
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const binding = await service.createBinding('tenant-1', { pluginVersionId: 'version-1', mode: 'MANAGED', inputBindings: inputBindings(), managedContext: { hostId: 'host-1' } });
  for (const [ownerType, ownerId, precedence] of [['DEVICE','host-1','DEVICE_DEFAULT'],['MANAGED_TARGET','target-1','TARGET_OVERRIDE'],['APPLICATION_ASSET','asset-1','ASSET_OVERRIDE']] as const) {
    await service.assignCapability('tenant-1', { ownerType, ownerId, capabilityKey: 'certificate.deploy', pluginVersionId: 'version-1', pluginBindingId: binding.id, precedence });
  }
  const resolved = await service.resolveAssignment('tenant-1', 'certificate.deploy', { deviceId: 'host-1', managedTargetId: 'target-1', applicationAssetId: 'asset-1' });
  assert.equal(resolved?.ownerType, 'APPLICATION_ASSET');
});

test('PluginBinding 支持乐观锁更新完整 InputBindings 信封', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  await insertCanonicalPluginVersion(database, 'version-1', 'tenant-1');
  const service = new PluginBindingsApplicationService(new PluginBindingsRepository(database));
  const created = await service.createBinding('tenant-1', {
    pluginVersionId: 'version-1', mode: 'STANDALONE', inputBindings: inputBindings({ region: 'default' }, { auth: { credentialId: 'cred-1' } }, { management: { host: '10.0.0.1' } }),
  });
  const updated = await service.updateBinding('tenant-1', created.id, {
    expectedVersion: 1,
    inputBindings: inputBindings({ region: 'partition-a' }, { auth: { credentialId: 'cred-1' } }, { management: { host: '10.0.0.1' } }),
  });
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.inputBindings.credentials, { auth: { credentialId: 'cred-1' } });
  await assert.rejects(() => service.updateBinding('tenant-1', created.id, { expectedVersion: 1, inputBindings: inputBindings() }), /版本冲突/);
});
