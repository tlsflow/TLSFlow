import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCertificateVerificationTarget } from './certificate-verification-target.js';

test('受管目标 TLS 验证分离连接地址和 SNI 域名', () => {
  const result = buildCertificateVerificationTarget({
    applicationAsset: {
      id: 'asset-1',
      address: 'app.example.com',
      sniName: 'app.example.com',
      port: 443,
      verifyUrl: undefined,
    },
    managedTargetContext: {
      host: { primaryIp: '10.0.0.10' } as never,
      siteAsset: {} as never,
      managedTarget: { id: 'target-1' } as never,
    },
    sourceLabel: 'MANAGED_HOST',
  });

  assert.equal(result.connectHost, '10.0.0.10');
  assert.equal(result.serverName, 'app.example.com');
  assert.deepEqual(result.expectedDomains, ['app.example.com']);
});
