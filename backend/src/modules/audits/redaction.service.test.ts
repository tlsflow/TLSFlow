import test from 'node:test';
import assert from 'node:assert/strict';
import { RedactionService } from './redaction.service.js';

test('RedactionService 脱敏 PEM、Authorization 和敏感字段', () => {
  const redaction = new RedactionService();
  redaction.registerSensitiveValue('KNOWN_SECRET', 'api_token');
  const input = {
    password: 'my-password',
    header: 'Authorization: Bearer abcdefghijklmnop',
    log: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- and KNOWN_SECRET',
  };

  const result = redaction.redact(input);
  const text = JSON.stringify(result.value);
  assert.equal(text.includes('my-password'), false);
  assert.equal(text.includes('abcdefghijklmnop'), false);
  assert.equal(text.includes('KNOWN_SECRET'), false);
  assert.equal(text.includes('BEGIN PRIVATE KEY'), false);
  assert.ok(result.matches.length >= 4);
});

test('RedactionService 脱敏部署产物中的私钥和 PKCS#12 内容', () => {
  const redaction = new RedactionService();
  const result = redaction.redact({
    privateKeyPem: 'private-key-content',
    pfxBase64: 'pkcs12-content',
    clientSecret: 'client-secret-content',
  });

  const serialized = JSON.stringify(result.value);
  assert.equal(serialized.includes('private-key-content'), false);
  assert.equal(serialized.includes('pkcs12-content'), false);
  assert.equal(serialized.includes('client-secret-content'), false);
  assert.equal(result.matches.length, 3);
});
