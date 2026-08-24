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
