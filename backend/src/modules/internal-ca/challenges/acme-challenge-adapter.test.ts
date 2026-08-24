import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Dns01ChallengeAdapter } from './dns-01.adapter.js';
import { Http01ChallengeAdapter } from './http-01.adapter.js';
import { TlsAlpn01ChallengeAdapter } from './tls-alpn-01.adapter.js';

const material = {
  tenantId: 'tenant-acme-challenge',
  challengeId: 'challenge-1',
  identifier: '*.example.com',
  token: 'token-value',
  keyAuthorization: 'key-authorization-value',
  presentationId: 'presentation-1',
  actorId: 'worker-acme',
};

test('HTTP-01 Adapter 使用固定 responder 完成呈现和清理', async () => {
  const calls: string[] = [];
  const adapter = new Http01ChallengeAdapter({
    present: async (input) => {
      calls.push(`present:${input.identifier}:${input.presentationId}`);
      return { accepted: true };
    },
    cleanup: async (input) => {
      calls.push(`cleanup:${input.identifier}:${input.presentationId}`);
      return { removed: true };
    },
  });

  assert.deepEqual(await adapter.validate(material), {
    supported: true,
    detail: 'HTTP-01 需要受管 HTTP Challenge responder',
  });
  assert.equal((await adapter.present(material)).presentationId, material.presentationId);
  assert.equal((await adapter.cleanup(material)).cleaned, true);
  assert.deepEqual(calls, [
    'present:*.example.com:presentation-1',
    'cleanup:*.example.com:presentation-1',
  ]);
});

test('DNS-01 Adapter 只写入规范化 TXT 名称和 SHA-256 base64url 值', async () => {
  const calls: Array<{ recordName: string; value: string }> = [];
  const adapter = new Dns01ChallengeAdapter({
    present: async (input) => {
      calls.push({ recordName: input.recordName, value: input.value });
      return { accepted: true };
    },
    cleanup: async (input) => {
      calls.push({ recordName: input.recordName, value: input.value });
      return { removed: true };
    },
  });
  const expected = createHash('sha256').update(material.keyAuthorization).digest('base64url');

  await adapter.present(material);
  await adapter.cleanup(material);

  assert.deepEqual(calls, [
    { recordName: '_acme-challenge.example.com', value: expected },
    { recordName: '_acme-challenge.example.com', value: expected },
  ]);
});

test('TLS-ALPN-01 Adapter 通过固定 responder 管理临时验证状态', async () => {
  const calls: string[] = [];
  const adapter = new TlsAlpn01ChallengeAdapter({
    present: async (input) => {
      calls.push(`present:${input.identifier}:${input.presentationId}`);
      return { alpn: 'acme-tls/1' };
    },
    cleanup: async (input) => {
      calls.push(`cleanup:${input.identifier}:${input.presentationId}`);
      return { removed: true };
    },
  });

  assert.equal((await adapter.present(material)).detail?.alpn, 'acme-tls/1');
  assert.equal((await adapter.cleanup(material)).cleaned, true);
  assert.deepEqual(calls, [
    'present:*.example.com:presentation-1',
    'cleanup:*.example.com:presentation-1',
  ]);
});
