import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { DeviceAssetsApplicationService, type DeviceConnectionTester } from './application/device-assets.application-service.js';
import { PgDeviceAssetsRepository } from './repository/device-assets.repository.js';

async function createService() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const tester: DeviceConnectionTester = {
    async test(device) {
      return {
        reachable: true,
        authenticated: true,
        productMatched: true,
        productName: 'NetScaler ADC',
        softwareVersion: '14.1',
        softwareBuild: 'test-build',
        supportLevel: 'SUPPORTED',
        capabilities: {},
        warnings: [],
      };
    },
  };
  return new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db), tester);
}

test('设备资产 CRUD 不返回密码字段并支持连接测试', async () => {
  const service = await createService();
  const created = await service.create('tenant-a', {
    displayName: 'ADC 生产',
    managementAddress: '10.0.0.10',
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'sec_adc',
  });
  assert.equal(created.managementPort, 443);
  assert.equal(created.tlsVerify, true);
  assert.equal('password' in created, false);
  assert.equal((await service.list('tenant-a')).length, 1);
  const updated = await service.update('tenant-a', created.id, { displayName: 'ADC 生产集群', authMode: 'SESSION' });
  assert.equal(updated.displayName, 'ADC 生产集群');
  assert.equal(updated.authMode, 'SESSION');
  const tested = await service.testConnection('tenant-a', created.id, 'user-a');
  assert.equal(tested.softwareVersion, '14.1');
  await service.delete('tenant-a', created.id);
  assert.equal((await service.list('tenant-a')).length, 0);
});

test('设备资产拒绝协议和路径形式的管理地址', async () => {
  const service = await createService();
  assert.throws(
    () => service.create('tenant-a', {
      displayName: 'ADC',
      managementAddress: 'https://adc.example.com/nitro',
      deviceFamily: 'NETSCALER_ADC',
      credentialId: 'sec_adc',
    }),
    /管理地址必须是 IP 或 DNS/,
  );
});

test('设备资产删除可清理服务资产已删除但 Host 仍残留的半删除状态', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const repository = new PgDeviceAssetsRepository(db);
  const service = new DeviceAssetsApplicationService(repository);
  const device = await service.create('tenant-partial-delete', {
    displayName: 'ADC 半删除恢复',
    managementAddress: '10.0.0.20',
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'sec_adc_partial',
  });

  await db.query(
    `update pg_service_assets set status='DELETED', deleted_at=now() where tenant_id=$1 and id=$2`,
    ['tenant-partial-delete', device.id],
  );
  await service.delete('tenant-partial-delete', device.id);

  const host = await db.query<{ status: string; deleted_at: string | null }>(
    `select status, deleted_at from pg_hosts where tenant_id=$1 and id=$2`,
    ['tenant-partial-delete', device.hostId],
  );
  assert.equal(host.rows[0]?.status, 'DELETED');
  assert.ok(host.rows[0]?.deleted_at);
});

test('重新添加相同 ADC 时复用无活跃设备资产的孤儿 Host', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const repository = new PgDeviceAssetsRepository(db);
  const service = new DeviceAssetsApplicationService(repository);
  const first = await service.create('tenant-orphan-host', {
    displayName: 'ADC 旧记录',
    managementAddress: '10.0.0.49',
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'sec_adc_old',
  });
  await db.query(
    `update pg_service_assets set status='DELETED', deleted_at=now() where tenant_id=$1 and id=$2`,
    ['tenant-orphan-host', first.id],
  );

  const second = await service.create('tenant-orphan-host', {
    displayName: 'ADC 新记录',
    managementAddress: '10.0.0.49',
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'sec_adc_new',
  });

  assert.equal(second.hostId, first.hostId);
  assert.equal((await service.list('tenant-orphan-host')).length, 1);
  const hosts = await db.query<{ count: number }>(
    `select count(*)::int as count from pg_hosts where tenant_id=$1 and deleted_at is null`,
    ['tenant-orphan-host'],
  );
  assert.equal(hosts.rows[0]?.count, 1);
});

test('同一 Host 地址存在其他活跃设备时返回业务冲突而不是数据库异常', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const service = new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db));
  await service.create('tenant-host-conflict', {
    displayName: 'ADC 8443',
    managementAddress: '10.0.0.50',
    managementPort: 8443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'sec_adc_8443',
  });

  await assert.rejects(
    service.create('tenant-host-conflict', {
      displayName: 'ADC 443',
      managementAddress: '10.0.0.50',
      managementPort: 443,
      deviceFamily: 'NETSCALER_ADC',
      credentialId: 'sec_adc_443',
    }),
    /管理地址已被其他设备占用/,
  );
});
