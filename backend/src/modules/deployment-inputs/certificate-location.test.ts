import assert from 'node:assert/strict';
import test from 'node:test';
import { readCertificateLocation } from './dto/certificate-location.dto.js';

test('旧 PEM 路径字段可规范化为精确证书位置', () => {
  const location = readCertificateLocation({
    certPath: '/etc/gcac-test/certs/test.crt',
    keyPath: '/etc/gcac-test/certs/test.key',
    configPath: '/etc/nginx/sites-enabled/test.conf',
    serviceName: 'nginx',
  }, '2026-08-01T00:00:00.000Z');

  assert.deepEqual(location, {
    apiVersion: 'gcac.certificate-location/v1',
    storageKind: 'PEM_FILES',
    certificatePath: '/etc/gcac-test/certs/test.crt',
    privateKeyPath: '/etc/gcac-test/certs/test.key',
    sourceConfigPath: '/etc/nginx/sites-enabled/test.conf',
    serviceName: 'nginx',
    confidence: 'EXACT',
    observedAt: '2026-08-01T00:00:00.000Z',
  });
});

test('KeyStore 和 Windows Store 使用独立存储类型', () => {
  assert.equal(readCertificateLocation({ keystorePath: '/opt/tomcat/conf/server.p12' }, '2026-08-01T00:00:00.000Z')?.storageKind, 'KEYSTORE');
  assert.equal(readCertificateLocation({ storeThumbprint: 'ABCDEF', storeName: 'My' }, '2026-08-01T00:00:00.000Z')?.storageKind, 'WINDOWS_CERTIFICATE_STORE');
});
