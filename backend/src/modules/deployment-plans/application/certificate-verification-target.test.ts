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

test('历史 SNI 为连接 IP 时改用资产访问域名', () => {
  const result = buildCertificateVerificationTarget({
    applicationAsset: {
      id: 'asset-1',
      address: 'cloud.jacksonz.cn',
      sniName: '10.255.0.77',
      verifyUrl: 'https://cloud.jacksonz.cn:5001/webapi/entry.cgi',
      port: 5001,
    },
    sourceLabel: 'APPLICATION_ASSET',
  });

  assert.equal(result.connectHost, 'cloud.jacksonz.cn');
  assert.equal(result.serverName, 'cloud.jacksonz.cn');
  assert.deepEqual(result.expectedDomains, ['cloud.jacksonz.cn']);
});
