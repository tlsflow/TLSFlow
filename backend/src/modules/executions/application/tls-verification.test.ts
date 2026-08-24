import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTlsVerification, type TlsVerifyReport } from './tls-verification.js';

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
