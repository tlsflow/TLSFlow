import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceLocalKeyCustodyAdapter, type DeviceLocalActionReceipt } from './device-local-key-custody.adapter.js';

const certificatePem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

test('网关本机持钥适配器只提交固定插件版本和公开字段', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const receipt: DeviceLocalActionReceipt = { status: 'SUCCESS', deviceId: 'adc-1', pluginId: 'device.f5.bigip', pluginVersionId: 'pv-1', action: 'generate_csr', idempotencyKey: 'csr-1', privateKeyTransported: false };
  const adapter = new DeviceLocalKeyCustodyAdapter({ dispatch: async (input) => { calls.push(input); return receipt; } });
  await adapter.generateCsr({ tenantId: 'tenant-1', deviceId: 'adc-1', pluginId: 'device.f5.bigip', pluginVersionId: 'pv-1', commonName: 'app.example.test', sans: ['app.example.test'], algorithm: 'rsa', idempotencyKey: 'csr-1' });
  await adapter.installIssued({ tenantId: 'tenant-1', deviceId: 'adc-1', pluginId: 'device.f5.bigip', pluginVersionId: 'pv-1', localKeyRef: 'device-key:adc-1:1', expectedPublicKeyFingerprintSha256: 'a'.repeat(64), certificatePem, certificateChainPem: certificatePem, idempotencyKey: 'install-1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.action, 'generate_csr');
  assert.equal(calls[1]?.action, 'install_issued');
  assert.equal((calls[1]?.payload as Record<string, unknown>).privateKeyPem, undefined);
  assert.equal((calls[1]?.payload as Record<string, unknown>).privateKeyTransported, false);
});

test('网关适配器拒绝通用 Shell、缺版本锚点和私钥材料', async () => {
  const adapter = new DeviceLocalKeyCustodyAdapter({ dispatch: async () => ({ status: 'SUCCESS', deviceId: 'adc-1', pluginId: 'device.f5.bigip', pluginVersionId: 'pv-1', action: 'generate_csr', idempotencyKey: 'x', privateKeyTransported: false }) });
  assert.throws(() => adapter.generateCsr({ tenantId: 'tenant-1', deviceId: 'adc-1', pluginId: 'shell', pluginVersionId: '', commonName: 'app.example.test', sans: [], algorithm: 'rsa', idempotencyKey: 'x' }));
  assert.throws(() => adapter.installIssued({ tenantId: 'tenant-1', deviceId: 'adc-1', pluginId: 'device.f5.bigip', pluginVersionId: 'pv-1', localKeyRef: 'pfx-password', expectedPublicKeyFingerprintSha256: 'a'.repeat(64), certificatePem, certificateChainPem: certificatePem, idempotencyKey: 'x' }));
});
