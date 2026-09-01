import assert from 'node:assert/strict';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { EmailNotificationAdapter } from './adapters/email-notification.adapter.js';
import { DingTalkNotificationAdapter } from './adapters/dingtalk-notification.adapter.js';
import { FeishuNotificationAdapter } from './adapters/feishu-notification.adapter.js';
import { SlackNotificationAdapter } from './adapters/slack-notification.adapter.js';
import { TelegramNotificationAdapter } from './adapters/telegram-notification.adapter.js';
import { WeComNotificationAdapter } from './adapters/wecom-notification.adapter.js';
import { WebhookNotificationAdapter } from './adapters/webhook-notification.adapter.js';
import { WebhookTargetPolicy } from './security/webhook-target-policy.js';
import { validatePlatformWebhookEndpoint } from './security/platform-webhook-endpoint-policy.js';
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
    assert.equal((await wecom.send(sendInput('wecom', {
      secrets: { webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test' },
    }))).success, true);
    assert.equal((await slack.send(sendInput('slack'))).success, true);
    const rejected = new SlackNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: 'invalid_payload', headers: {} }));
    assert.equal((await rejected.send(sendInput('slack'))).success, false);
  });

  it('飞书自定义机器人按官方规则生成签名并解析平台响应', async () => {
    const client = new FakeHttpClient({ statusCode: 200, body: '{"code":0,"msg":"success"}', headers: {} });
    const result = await new FeishuNotificationAdapter(client).send(sendInput('feishu', {
      secrets: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test', signingSecret: 'feishu-secret' },
    }));
    assert.equal(result.success, true);
    const payload = JSON.parse(client.lastRequest!.body) as Record<string, unknown>;
    const timestamp = String(payload.timestamp);
    assert.equal(payload.sign, createHmac('sha256', `${timestamp}\nfeishu-secret`).digest('base64'));
    assert.deepEqual(payload.content, { text: 'Test title\nTest body' });
  });

  it('飞书和钉钉拒绝伪造的平台 Webhook 域名', async () => {
    await assert.rejects(
      new FeishuNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: '{"code":0}', headers: {} })).send(sendInput('feishu', {
        secrets: { webhookUrl: 'https://attacker.example/open-apis/bot/v2/hook/test' },
      })),
      /不属于此渠道配置的私有化 Origin/,
    );
    await assert.rejects(
      new DingTalkNotificationAdapter(new FakeHttpClient({ statusCode: 200, body: '{"errcode":0}', headers: {} })).send(sendInput('dingtalk', {
        secrets: { webhookUrl: 'https://attacker.example/robot/send?access_token=test' },
      })),
      /不属于此渠道配置的私有化 Origin/,
    );
  });

  it('企微、飞书和钉钉私有化地址只由各自渠道配置的 Origin 批准', async () => {
    assert.deepEqual(
      validatePlatformWebhookEndpoint('wecom', 'https://wecom.internal.example/cgi-bin/webhook/send?key=test', ['https://wecom.internal.example']),
      { trustedPrivateOrigins: ['https://wecom.internal.example'], isPrivateDeployment: true },
    );
    assert.deepEqual(
      validatePlatformWebhookEndpoint('feishu', 'https://feishu.internal.example:8443/custom/bot/hook', ['https://feishu.internal.example:8443']),
      { trustedPrivateOrigins: ['https://feishu.internal.example:8443'], isPrivateDeployment: true },
    );
    assert.deepEqual(
      validatePlatformWebhookEndpoint('dingtalk', 'https://dingtalk.internal.example/robot/send?access_token=test', ['https://dingtalk.internal.example']),
      { trustedPrivateOrigins: ['https://dingtalk.internal.example'], isPrivateDeployment: true },
    );
    assert.throws(
      () => validatePlatformWebhookEndpoint('wecom', 'https://unapproved.internal.example/hook', ['https://wecom.internal.example']),
      /不属于此渠道配置的私有化 Origin/,
    );
  });

  it('受信任私有化 Origin 只放行 RFC1918，仍拒绝元数据、回环和 DNS 重绑定', async () => {
    const privatePolicy = new WebhookTargetPolicy(async () => ['10.20.30.40']);
    const validated = await privatePolicy.validateUrl('https://wecom.internal.example/hook', {
      trustedPrivateOrigins: ['https://wecom.internal.example'],
    });
    assert.equal(validated.allowPrivateNetwork, true);
    assert.deepEqual(validated.addresses, ['10.20.30.40']);
    await assert.rejects(
      privatePolicy.validateUrl('https://wecom.internal.example/hook'),
      /目标地址被安全策略阻止/,
    );
    assert.throws(
      () => privatePolicy.assertResolvedAddress('10.20.30.41', ['10.20.30.40'], true),
      /DNS/,
    );

    const metadataPolicy = new WebhookTargetPolicy(async () => ['169.254.169.254']);
    await assert.rejects(
      metadataPolicy.validateUrl('https://wecom.internal.example/hook', {
        trustedPrivateOrigins: ['https://wecom.internal.example'],
      }),
      /目标地址被安全策略阻止/,
    );
    assert.throws(
      () => privatePolicy.assertRedirect(new URL('https://wecom.internal.example/a'), new URL('https://wecom.internal.example:8443/b')),
      /跨 Origin/,
    );
  });

  it('私有化平台 Adapter 把渠道配置的 Origin 传递给安全 HTTP 客户端', async () => {
    const client = new FakeHttpClient({ statusCode: 200, body: '{"errcode":0,"errmsg":"ok"}', headers: {} });
    const result = await new WeComNotificationAdapter(client).send(sendInput('wecom', {
      secrets: { webhookUrl: 'https://wecom.internal.example/custom/webhook?key=test' },
      privateOrigins: ['https://wecom.internal.example'],
    }));
    assert.equal(result.success, true);
    assert.deepEqual(client.lastRequest?.trustedPrivateOrigins, ['https://wecom.internal.example']);
  });

  it('钉钉自定义机器人把时间戳和 HMAC 签名放入请求 URL', async () => {
    const client = new FakeHttpClient({ statusCode: 200, body: '{"errcode":0,"errmsg":"ok"}', headers: {} });
    const result = await new DingTalkNotificationAdapter(client).send(sendInput('dingtalk', {
      secrets: { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test', signingSecret: 'ding-secret' },
    }));
    assert.equal(result.success, true);
    const url = new URL(client.lastRequest!.url);
    const timestamp = url.searchParams.get('timestamp');
    assert.ok(timestamp);
    assert.equal(
      url.searchParams.get('sign'),
      createHmac('sha256', 'ding-secret').update(`${timestamp}\nding-secret`).digest('base64'),
    );
  });

  it('Telegram 使用固定 Bot API sendMessage 而不是任意 Webhook', async () => {
    const client = new FakeHttpClient({ statusCode: 200, body: '{"ok":true,"result":{"message_id":42}}', headers: {} });
    const result = await new TelegramNotificationAdapter(client).send(sendInput('telegram', {
      config: { chatId: '-100123', messageThreadId: 7 },
      secrets: { botToken: '123456:telegram-token' },
    }));
    assert.equal(result.success, true);
    assert.equal(result.externalId, '42');
    assert.equal(client.lastRequest!.url, 'https://api.telegram.org/bot123456:telegram-token/sendMessage');
    assert.equal(client.lastRequest!.maxRedirects, 0);
    assert.deepEqual(JSON.parse(client.lastRequest!.body), {
      chat_id: '-100123',
      text: 'Test title\nTest body',
      disable_web_page_preview: true,
      message_thread_id: 7,
    });
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
    assert.throws(() => policy.assertRedirect(new URL('https://example.com/a'), new URL('https://evil.example/b')), /跨 Origin/);
  });
});

class FakeHttpClient {
  lastRequest?: SafeHttpRequest;
  constructor(private readonly response: SafeHttpResponse) {}
  async request(input: SafeHttpRequest): Promise<SafeHttpResponse> { this.lastRequest = input; return this.response; }
}

function sendInput(type: 'email' | 'wecom' | 'slack' | 'feishu' | 'dingtalk' | 'telegram' | 'webhook', overrides: {
  config?: Record<string, unknown>;
  target?: Record<string, unknown>;
  secrets?: Record<string, string>;
  privateOrigins?: string[];
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
    privateOrigins: overrides.privateOrigins ?? [],
  };
}
