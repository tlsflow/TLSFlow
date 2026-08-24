import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { defaultOnboardingVerifyUrl, validateOnboardingTargetInput } from './onboarding-target-input.js';

test('统一向导默认使用 DNS 访问域名和站点端口生成验证 URL', () => {
  assert.equal(defaultOnboardingVerifyUrl('ikuai.jacksonz.cn', 443, 'HTTPS'), 'https://ikuai.jacksonz.cn:443');
  assert.deepEqual(validateOnboardingTargetInput({
    accessDomain: 'Ikuai.Jacksonz.CN.',
    verifyUrl: 'https://ikuai.jacksonz.cn:443/health',
  }), {
    accessDomain: 'ikuai.jacksonz.cn',
    verifyUrl: 'https://ikuai.jacksonz.cn:443/health',
  });
});

test('统一向导拒绝把管理 VIP 作为访问域名或验证 URL 主机', () => {
  for (const input of [
    { accessDomain: '10.255.0.215', verifyUrl: 'https://ikuai.jacksonz.cn:443' },
    { accessDomain: 'ikuai.jacksonz.cn', verifyUrl: 'https://10.255.0.215:443' },
  ]) {
    assert.throws(
      () => validateOnboardingTargetInput(input),
      (error: unknown) => error instanceof AppError && [
        'ONBOARDING_ACCESS_DOMAIN_IP_FORBIDDEN',
        'ONBOARDING_VERIFY_URL_IP_FORBIDDEN',
      ].includes(String((error.details as { code?: string })?.code)),
    );
  }
});

test('统一向导拒绝验证 URL 与访问域名不一致', () => {
  assert.throws(
    () => validateOnboardingTargetInput({
      accessDomain: 'ikuai.jacksonz.cn',
      verifyUrl: 'https://other.jacksonz.cn:443',
    }),
    (error: unknown) => error instanceof AppError
      && (error.details as { code?: string })?.code === 'ONBOARDING_VERIFY_URL_DOMAIN_MISMATCH',
  );
});
