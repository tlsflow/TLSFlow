import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { AcmeDomainService } from './acme.domain-service.js';

const domain = new AcmeDomainService();

function assertError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof AppError && error.errorCode === code);
}

test('ACME Provider 配置拒绝非 HTTPS、空挑战列表和关闭 TLS 校验', () => {
  assertError(() => domain.validateProviderConfiguration({ directoryUrl: 'http://ca.example.test' }), 'ACME_PROVIDER_CONFIG_INVALID');
  assertError(() => domain.validateProviderConfiguration({ directoryUrl: 'https://ca.example.test', allowedChallenges: [] }), 'ACME_PROVIDER_CONFIG_INVALID');
  assertError(() => domain.validateProviderConfiguration({ directoryUrl: 'https://ca.example.test', verifyTls: false }), 'ACME_PROVIDER_CONFIG_INVALID');

  const configuration = domain.validateProviderConfiguration({ directoryUrl: 'https://ca.example.test', allowedChallenges: ['dns-01', 'dns-01'] });
  assert.deepEqual(configuration.allowedChallenges, ['dns-01']);
  assert.equal(configuration.verifyTls, true);
});

test('ACME Account 的联系人、SecretRef 和 EAB 成对关系可被提前校验', () => {
  assert.deepEqual(domain.normalizeContacts([' mailto:Admin@example.com ', 'mailto:admin@example.com']), ['mailto:admin@example.com']);
  assertError(() => domain.normalizeContacts(['admin@example.com']), 'ACME_ACCOUNT_INVALID');
  assertError(() => domain.validateAccountSecretRefs({ accountKeySecretRef: 'not-a-secret-ref' }), 'ACME_SECRET_RESOLVE_DENIED');
  assertError(() => domain.validateAccountSecretRefs({
    accountKeySecretRef: 'secret://certificate_private_key/key-1#current',
    eabKeyIdSecretRef: 'secret://api_token/key-id#current',
  }), 'ACME_ACCOUNT_INVALID');
  assert.doesNotThrow(() => domain.validateAccountSecretRefs({
    accountKeySecretRef: 'secret://certificate_private_key/key-1#current',
    eabKeyIdSecretRef: 'secret://api_token/key-id#current',
    eabHmacSecretRef: 'secret://api_token/hmac#current',
  }));
});

test('ACME 标识支持 DNS、通配符和真实 IPv4/IPv6 校验，并去重', () => {
  assert.deepEqual(domain.normalizeIdentifiers([
    { type: 'dns', value: '*.Example.COM' },
    { type: 'dns', value: '*.example.com' },
    { type: 'ip', value: '192.0.2.10' },
    { type: 'ip', value: '2001:db8::10' },
  ]), [
    { type: 'dns', value: '*.example.com' },
    { type: 'ip', value: '192.0.2.10' },
    { type: 'ip', value: '2001:db8::10' },
  ]);
  assertError(() => domain.normalizeIdentifiers([{ type: 'ip', value: '999.1.1.1' }]), 'VALIDATION_FAILED');
  assertError(() => domain.normalizeIdentifiers([{ type: 'dns', value: '-bad.example.com' }]), 'VALIDATION_FAILED');
  assertError(() => domain.normalizeIdentifiers([{ type: 'dns', value: '' }]), 'VALIDATION_FAILED');
});

test('续签策略必须绑定目标并限制窗口、退避和尝试次数', () => {
  assert.doesNotThrow(() => domain.validateRenewalPolicy({
    certificateAssetId: 'asset-1',
    bindingId: undefined,
    renewalWindowDays: 30,
    maxAttempts: 5,
    backoffSeconds: 300,
    challengeType: 'http-01',
    deploymentMode: 'automatic',
  }));
  assertError(() => domain.validateRenewalPolicy({
    certificateAssetId: undefined,
    bindingId: undefined,
    renewalWindowDays: 30,
    maxAttempts: 5,
    backoffSeconds: 300,
    challengeType: 'http-01',
    deploymentMode: 'automatic',
  }), 'VALIDATION_FAILED');
  assertError(() => domain.validateRenewalPolicy({
    certificateAssetId: 'asset-1',
    bindingId: undefined,
    renewalWindowDays: 91,
    maxAttempts: 5,
    backoffSeconds: 300,
    challengeType: 'http-01',
    deploymentMode: 'automatic',
  }), 'VALIDATION_FAILED');
});
