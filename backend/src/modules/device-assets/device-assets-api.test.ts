import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { DeviceAssetsApplicationService, type DeviceConnectionTester } from './application/device-assets.application-service.js';
import type { DeviceAssetSecurityPort } from './application/device-assets.security.js';
import { DeviceAssetsController } from './controller/device-assets.controller.js';
import { PgDeviceAssetsRepository } from './repository/device-assets.repository.js';

async function createTestApp() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const app = new App();
  new DeviceAssetsController(new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db))).register(app.router);
  return app;
}

async function createSecuredTestApp(allowed: boolean, tester?: DeviceConnectionTester) {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const app = new App();
  const events: string[] = [];
  const security: DeviceAssetSecurityPort = {
    async assertAccess() {
      if (!allowed) throw new Error('DENIED');
    },
    async audit(_request, eventType) {
      events.push(eventType);
    },
  };
  new DeviceAssetsController(new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db), tester), security).register(app.router);
  return { app, events };
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

test('旧设备连接测试入口已移除', async () => {
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
  assert.equal(tested.statusCode, 404);
});

test('旧设备重新发现入口已移除', async () => {
  const discoveredIds: string[] = [];
  const tester: DeviceConnectionTester = {
    async test(device) {
      discoveredIds.push(device.id);
      return {
        reachable: true,
        authenticated: true,
        productMatched: true,
        softwareVersion: '13.1',
        capabilities: {},
        warnings: [],
        certificateCount: 9,
        fingerprintedCertificateCount: 9,
      };
    },
  };
  const { app, events } = await createSecuredTestApp(true, tester);
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { displayName: 'ADC', managementAddress: '10.0.0.30', deviceFamily: 'NETSCALER_ADC', credentialId: 'sec_adc' },
  });
  const deviceAssetId = String((created.body as Record<string, unknown>).id);

  const discovered = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets/discover',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { deviceAssetId },
  });

  assert.equal(discovered.statusCode, 404);
  assert.deepEqual(discoveredIds, []);
  assert.deepEqual(events, ['device_asset.created']);
});

test('设备资产写操作产生脱敏审计事件', async () => {
  const { app, events } = await createSecuredTestApp(true);
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets',
    headers: { 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-a' },
    body: { displayName: 'ADC', managementAddress: '10.0.0.20', deviceFamily: 'NETSCALER_ADC', credentialId: 'sec_adc' },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(events, ['device_asset.created']);
});
