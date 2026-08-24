import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSecretRef } from '../../secrets/secret-ref.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import {
  acmeProviderProfileKeys,
  getAcmeProviderProfile,
  listAcmeProviderProfiles,
  normalizeAcmeProviderProfile,
} from './acme-provider-profiles.js';

test('ACME Provider Profile 覆盖九个受控入口且表单只暴露最小字段', () => {
  const profiles = listAcmeProviderProfiles();
  assert.deepEqual(profiles.map((item) => item.key), [...acmeProviderProfileKeys]);

  const visibleFields = new Set(['profileKey', 'displayName', 'directoryUrl', 'isDefault', 'trustBundleSecretRef', 'contactEmail', 'eabSecretRef']);
  for (const profile of profiles) {
    assert.ok(profile.version);
    assert.ok(profile.displayName);
    assert.ok(profile.allowedChallenges.includes('http-01'));
    for (const field of [...profile.form.providerFields, ...profile.form.accountFields]) {
      assert.equal(visibleFields.has(field), true, `${profile.key} 暴露了非最小字段 ${field}`);
    }
    assert.equal(profile.form.hiddenFields.includes('termsOfServiceUrl'), true);
    assert.equal(profile.form.hiddenFields.includes('allowedChallenges'), true);
    assert.equal(profile.form.hiddenFields.includes('accountKeySecretRef'), true);
  }
});

test('固定 Directory Profile 不接受前端覆盖，企业和私有 Profile 只保存必要字段', () => {
  const letsencrypt = normalizeAcmeProviderProfile({
    profileKey: 'letsencrypt',
    displayName: 'LE',
    directoryUrl: 'https://evil.example/directory',
    isDefault: true,
  });
  assert.equal(letsencrypt.directoryUrl, 'https://acme-v02.api.letsencrypt.org/directory');
  assert.equal(letsencrypt.profileKey, 'letsencrypt');
  assert.equal(letsencrypt.isDefault, true);

  const digicert = normalizeAcmeProviderProfile({
    profileKey: 'digicert',
    directoryUrl: 'https://acme.example.digicert.com/directory',
  });
  assert.equal(digicert.directoryUrl, 'https://acme.example.digicert.com/directory');
  assert.equal(digicert.allowedChallenges.includes('dns-01'), true);

  assert.throws(
    () => normalizeAcmeProviderProfile({ profileKey: 'sectigo' }),
    /ACME Directory 必须填写/,
  );
});

test('EAB 和私有信任链使用结构化 SecretRef 类型', () => {
  const service = new AcmeDomainService();
  const custom = normalizeAcmeProviderProfile({
    profileKey: 'custom',
    directoryUrl: 'https://ca.internal.example/acme/directory',
    trustBundleSecretRef: 'secret://certificate_trust_bundle/sec_trust#current',
  });
  assert.equal(service.validateProviderConfiguration({ ...custom }).trustBundleSecretRef, 'secret://certificate_trust_bundle/sec_trust#current');
  assert.equal(parseSecretRef('secret://acme_eab/sec_eab#current').type, 'acme_eab');

  assert.throws(
    () => service.validateProviderConfiguration({
      ...custom,
      trustBundleSecretRef: 'secret://certificate_private_key/sec_wrong#current',
    }),
    /SecretRef 类型不匹配/,
  );
});

test('Profile EAB 策略和字段模式匹配最小账户表单', () => {
  assert.equal(getAcmeProviderProfile('letsencrypt')?.account.eab, 'not_required');
  assert.equal(getAcmeProviderProfile('zerossl')?.account.eab, 'required');
  assert.equal(getAcmeProviderProfile('google-trust-services')?.account.eab, 'required');
  assert.equal(getAcmeProviderProfile('digicert')?.account.eab, 'discover');
  assert.equal(getAcmeProviderProfile('step-ca')?.form.accountFields.includes('trustBundleSecretRef'), true);
  assert.equal(getAcmeProviderProfile('custom')?.form.providerFields.includes('directoryUrl'), true);
});
