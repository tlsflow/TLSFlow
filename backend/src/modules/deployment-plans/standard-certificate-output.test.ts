import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBoundCertificateOutput, resolveStandardCertificateOutput } from './application/deployment-plans.application-service.js';

test('标准证书输出解析器同时支持 PEM、PFX、JKS 和密码', () => {
  const material = {
    leafPem: 'CERTIFICATE_PEM',
    privateKeyPem: 'PRIVATE_KEY_PEM',
    pfxBase64: 'PFX_BASE64',
    pfxPassword: 'PFX_PASSWORD',
    jksBase64: 'JKS_BASE64',
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
  assert.deepEqual(resolveStandardCertificateOutput(material, 'jksBase64'), {
    key: 'jksBase64',
    role: 'keystore',
    format: 'base64',
    content: 'JKS_BASE64',
  });
});

test('标准证书槽输出原始值，自定义文件槽保留文件对象', () => {
  const intermediates = [{ sequence: 1, pemBase64: 'CHAIN_BASE64' }];
  const material = {
    leafPemBase64: 'LEAF_BASE64',
    orderedIntermediates: intermediates,
  };
  const file = { key: 'chain', content: 'CHAIN_PEM' };
  const virtualOutput = { key: 'orderedChainPem', content: 'CHAIN_PEM' };

  assert.equal(resolveBoundCertificateOutput(material, 'leafPemBase64', file, undefined), 'LEAF_BASE64');
  assert.deepEqual(resolveBoundCertificateOutput(material, 'orderedIntermediates', file, virtualOutput), intermediates);
  assert.equal(resolveBoundCertificateOutput(material, 'orderedIntermediates', file, virtualOutput) === intermediates, false);
  assert.equal(resolveBoundCertificateOutput(material, 'certFile', file, virtualOutput), file);
});
