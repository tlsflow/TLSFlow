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
