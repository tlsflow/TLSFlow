import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStandardCertificateOutput } from './application/deployment-plans.application-service.js';

test('标准证书输出解析器同时支持 PEM、PFX 和 PFX 密码', () => {
  const material = {
    leafPem: 'CERTIFICATE_PEM',
    privateKeyPem: 'PRIVATE_KEY_PEM',
    pfxBase64: 'PFX_BASE64',
    pfxPassword: 'PFX_PASSWORD',
  };

  assert.deepEqual(resolveStandardCertificateOutput(material, 'leafPem'), {
    key: 'leafPem',
    role: 'public_certificate',
    format: 'pem',
    content: 'CERTIFICATE_PEM',
    contentBase64: Buffer.from('CERTIFICATE_PEM', 'utf8').toString('base64'),
  });
  assert.deepEqual(resolveStandardCertificateOutput(material, 'pfxBase64'), {
    key: 'pfxBase64',
    role: 'pkcs12_bundle',
    format: 'base64',
    content: 'PFX_BASE64',
  });
  assert.deepEqual(resolveStandardCertificateOutput(material, 'pfxPassword'), {
    key: 'pfxPassword',
    role: 'pkcs12_password',
    format: 'text',
    content: 'PFX_PASSWORD',
  });
});
