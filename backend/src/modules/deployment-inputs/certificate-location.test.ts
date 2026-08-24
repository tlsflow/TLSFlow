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

test('PostgreSQL Date 类型的受管目标更新时间会规范化为 observedAt 字符串', () => {
  const location = readCertificateLocation({
    certificateLocation: {
      apiVersion: 'gcac.certificate-location/v1',
      storageKind: 'WINDOWS_CERTIFICATE_STORE',
      storeName: 'My',
      storeThumbprint: '4865D416CD00954798D8793FEA6050F43D6EAED4',
      confidence: 'EXACT',
    },
  }, new Date('2026-08-01T13:31:13.224Z'));

  assert.equal(location?.observedAt, '2026-08-01T13:31:13.224Z');
});

test('TLS 握手观测 URI 不能成为部署位置', () => {
  assert.throws(
    () => readCertificateLocation({ certificatePath: 'windows-tls://127.0.0.1/8443/ABCDEF' }, '2026-08-01T00:00:00.000Z'),
    /TLS 握手观测结果不能作为部署位置/,
  );
  assert.throws(
    () => readCertificateLocation({ certificateLocation: { storageKind: 'KEYSTORE', keystorePath: 'windows-tls://127.0.0.1/8445/ABCDEF' } }, '2026-08-01T00:00:00.000Z'),
    /TLS 握手观测结果不能作为部署位置/,
  );
});
