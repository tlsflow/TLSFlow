import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { DeviceAssetsApplicationService } from './application/device-assets.application-service.js';
import { DeviceAssetsController } from './controller/device-assets.controller.js';
import { PgDeviceAssetsRepository } from './repository/device-assets.repository.js';

async function createTestApp() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const app = new App();
  new DeviceAssetsController(new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db))).register(app.router);
  return app;
}

test('设备资产 API 创建、查询和更新不暴露密码', async () => {
  const app = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: {
      displayName: 'ADC 生产',
      managementAddress: 'adc.example.com',
      deviceFamily: 'NETSCALER_ADC',
      credentialId: 'sec_adc',
      tlsVerify: true,
    },
  });
  assert.equal(created.statusCode, 201);
  const body = created.body as Record<string, unknown>;
  assert.equal(body.managementAddress, 'adc.example.com');
  assert.equal('password' in body, false);

  const listed = await app.inject({ method: 'GET', path: '/api/v1/device-assets', headers: { 'x-tenant-id': 'tenant-a' } });
  assert.equal(listed.statusCode, 200);
  assert.equal((listed.body as unknown[]).length, 1);

  const updated = await app.inject({
    method: 'PATCH',
    path: '/api/v1/device-assets',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { deviceAssetId: body.id, displayName: 'ADC 生产集群', authMode: 'SESSION' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal((updated.body as Record<string, unknown>).displayName, 'ADC 生产集群');
});

test('未注册 NITRO 测试器时连接测试返回能力缺失', async () => {
  const app = await createTestApp();
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { displayName: 'ADC', managementAddress: '10.0.0.10', deviceFamily: 'NETSCALER_ADC', credentialId: 'sec_adc' },
  });
  const tested = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets/test-connection',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: { deviceAssetId: (created.body as Record<string, unknown>).id },
  });
  assert.equal(tested.statusCode, 422);
  assert.equal((tested.body as { errorCode?: string }).errorCode, 'CAPABILITY_MISSING');
});
