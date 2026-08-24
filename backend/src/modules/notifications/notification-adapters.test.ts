import assert from 'node:assert/strict';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { EmailNotificationAdapter } from './adapters/email-notification.adapter.js';
import { SlackNotificationAdapter } from './adapters/slack-notification.adapter.js';
import { WeComNotificationAdapter } from './adapters/wecom-notification.adapter.js';
import { WebhookNotificationAdapter } from './adapters/webhook-notification.adapter.js';
import { WebhookTargetPolicy } from './security/webhook-target-policy.js';
import type { SafeHttpRequest, SafeHttpResponse } from './adapters/http-notification-client.js';
import type { NotificationSendInput } from './application/channel-adapter-registry.js';

describe('通知渠道 Adapter', () => {
  it('Email Adapter 通过 Mock SMTP 完成真实协议发送', async () => {
    const commands: string[] = [];
    const server = net.createServer((socket) => {
      socket.write('220 mock.smtp ESMTP\r\n');
      let buffer = '';
      let dataMode = false;
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        while (buffer.includes('\r\n')) {
          const index = buffer.indexOf('\r\n');
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          commands.push(line);
          if (dataMode) {
            if (line === '.') { dataMode = false; socket.write('250 queued\r\n'); }
            continue;
          }
          if (line.startsWith('EHLO')) socket.write('250-mock.smtp\r\n250 SIZE 100000\r\n');
          else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
          else if (line.startsWith('RCPT TO')) socket.write('250 ok\r\n');
          else if (line === 'DATA') { dataMode = true; socket.write('354 end with dot\r\n'); }
          else if (line === 'QUIT') socket.write('221 bye\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const input = sendInput('email', {
        config: { host: '127.0.0.1', port: address.port, from: 'gcac@example.com' },
        target: { to: ['owner@example.com'] },
      });
      const result = await new EmailNotificationAdapter().send(input);
      assert.equal(result.success, true);
      assert.ok(commands.includes('MAIL FROM:<gcac@example.com>'));
      assert.ok(commands.includes('RCPT TO:<owner@example.com>'));
      assert.ok(commands.some((line) => line === 'Subject: Test title'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('企业微信和 Slack 只把协议成功响应判定为成功', async () => {
    const wecom = new WeComNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: '{"errcode":0,"errmsg":"ok"}', headers: {} }));
    const slack = new SlackNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: 'ok', headers: {} }));
    assert.equal((await wecom.send(sendInput('wecom'))).success, true);
    assert.equal((await slack.send(sendInput('slack'))).success, true);
    const rejected = new SlackNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: 'invalid_payload', headers: {} }));
    assert.equal((await rejected.send(sendInput('slack'))).success, false);
  });

  it('Webhook Adapter 生成可验证的 HMAC-SHA256 签名且不保存响应正文', async () => {
    const client = new FakeHttpClient({ statusCode: 204, body: 'sensitive response', headers: { 'content-type': 'text/plain' } });
    const adapter = new WebhookNotificationAdapter(client);
    const result = await adapter.send(sendInput('webhook', { secrets: { url: 'https://example.com/hook', signingSecret: 'signing-key' } }));
    assert.equal(result.success, true);
    const request = client.lastRequest!;
    const timestamp = request.headers?.['x-gcac-timestamp'];
    assert.ok(timestamp);
    const expected = `sha256=${createHmac('sha256', 'signing-key').update(`${timestamp}.${request.body}`).digest('hex')}`;
    assert.equal(request.headers?.['x-gcac-signature'], expected);
    assert.deepEqual(result.responseSummary, { statusCode: 204, contentType: 'text/plain' });
  });

  it('Webhook 安全策略拒绝 DNS 重绑定和跨主机重定向', () => {
    const policy = new WebhookTargetPolicy();
    assert.throws(() => policy.assertResolvedAddress('93.184.216.35', ['93.184.216.34']), /DNS/);
    assert.throws(() => policy.assertRedirect(new URL('https://example.com/a'), new URL('https://evil.example/b')), /跨主机/);
  });
});

class FakeHttpClient {
  lastRequest?: SafeHttpRequest;
  constructor(private readonly response: SafeHttpResponse) {}
  async request(input: SafeHttpRequest): Promise<SafeHttpResponse> { this.lastRequest = input; return this.response; }
}

function sendInput(type: 'email' | 'wecom' | 'slack' | 'webhook', overrides: {
  config?: Record<string, unknown>;
  target?: Record<string, unknown>;
  secrets?: Record<string, string>;
} = {}): NotificationSendInput {
  return {
    channel: {
      id: 'channel-1', tenantId: 'tenant-1', name: 'Channel', type, status: 'active', config: overrides.config ?? {},
      secretRefs: {}, healthStatus: 'unknown', consecutiveFailures: 0, createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z', version: 1,
    },
    request: {
      id: 'request-1', tenantId: 'tenant-1', source: 'test', eventKey: 'event-1', idempotencyKey: 'idem-1', templateKey: 'test',
      context: { safe: true }, sourceRefs: {}, status: 'queued', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    },
    delivery: {
      id: 'delivery-1', tenantId: 'tenant-1', requestId: 'request-1', channelId: 'channel-1', channelNameSnapshot: 'Channel', channelType: type,
      targetSnapshot: overrides.target ?? {}, renderedTitle: 'Test title', renderedBody: 'Test body', status: 'sending', attemptCount: 1, maxAttempts: 5,
      responseSummary: {}, createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    },
    secrets: overrides.secrets ?? { webhookUrl: 'https://example.com/hook', url: 'https://example.com/hook' },
  };
}
