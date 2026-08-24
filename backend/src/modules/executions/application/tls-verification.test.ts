import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTlsVerification, readCertificateCommonName, type TlsVerifyReport } from './tls-verification.js';

const currentReport: TlsVerifyReport = {
  remoteCertificateSha256: 'a'.repeat(64),
  remoteThumbprint: 'A'.repeat(40),
  dnsNames: ['old.example.com'],
  matchesDomainNames: ['old.example.com'],
  commonName: 'old.example.com',
};

test('dry-run 将当前证书指纹差异视为待执行变更', () => {
  const result = evaluateTlsVerification(currentReport, 'b'.repeat(64), ['new.example.com'], true);

  assert.equal(result.success, true);
  assert.equal(result.warning, true);
  assert.equal(result.changeRequired, true);
  assert.equal(result.matched, false);
  assert.deepEqual(result.domainMismatches, ['new.example.com']);
});

test('正式 VERIFY 仍严格拒绝远端证书指纹不一致', () => {
  const result = evaluateTlsVerification(currentReport, 'b'.repeat(64), ['new.example.com'], false);

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'TLS_VERIFY_FINGERPRINT_MISMATCH');
});

test('缺少目标证书指纹时 dry-run 也必须失败', () => {
  const result = evaluateTlsVerification(currentReport, undefined, [], true);

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'CERT_VERIFY_EXPECTED_FINGERPRINT_MISSING');
});

test('从 Node X509Certificate DN 字符串读取 CN，不把字符串展开成字符索引', () => {
  assert.equal(readCertificateCommonName('C=US\nO=Let\'s Encrypt\nCN=*.jacksonz.cn'), '*.jacksonz.cn');
  assert.equal(readCertificateCommonName('CN=api.example.com, O=Example'), 'api.example.com');
});

test('证书对象 CN 兼容旧版 PeerCertificate 结构', () => {
  assert.equal(readCertificateCommonName({ CN: ['first.example.com', 'second.example.com'] }), 'first.example.com');
  assert.equal(readCertificateCommonName({ CN: 'api.example.com' }), 'api.example.com');
});
