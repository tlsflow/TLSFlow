import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { NotificationsDomainService } from './domain/notifications.domain-service.js';
import { NotificationsApplicationService } from './application/notifications.application-service.js';
import { PgNotificationsRepository } from './repository/notifications.repository.js';
import { NotificationRouteMatcher } from './application/notification-route-matcher.js';
import { WebhookTargetPolicy, isBlockedAddress } from './security/webhook-target-policy.js';
import { AutomationNotificationPort } from './application/notification.port.js';
import { NotificationsController } from './controller/notifications.controller.js';
import { Router } from '../../common/http/router.js';
import type { SecurityServices } from '../security/security.controller.js';

describe('通知核心', () => {
  it('迁移后 NotificationPort 持久化并保持幂等', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const service = new NotificationsApplicationService(repository);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: '测试 Slack', type: 'slack', status: 'active', secretRefs: { webhookUrl: 'secret://api_token/slack#current' } });
      await repository.upsertTemplate({ tenantId: 'tenant-1', templateKey: 'risk.opened', locale: 'zh-CN', titleTemplate: '{{title}}', bodyTemplate: '{{summary}}', requiredVariables: ['title', 'summary'] });
      await repository.createRoute({ tenantId: 'tenant-1', name: '风险路由', priority: 10, matcher: { sources: ['monitor'] }, channelTargets: [{ channelId: channel.id }] });
      const input = { tenantId: 'tenant-1', templateKey: 'risk.opened', eventKey: 'risk:1:opened:v1', idempotencyKey: 'risk:1:opened:v1', source: 'monitor', context: { title: '证书到期', summary: '剩余 7 天', password: 'never-store' } };
      const first = await service.enqueue(input);
      const second = await service.enqueue(input);
      assert.equal(first.requestId, second.requestId);
      const stored = await repository.getRequest('tenant-1', first.requestId);
      assert.equal(stored?.context.password, '[REDACTED]');
      assert.equal((await repository.listDeliveries({ tenantId: 'tenant-1' })).total, 1);
    } finally { await fixture.close(); }
  });

  it('多 Worker 只能租用一次且过期租约可恢复', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: 'Webhook', type: 'webhook', status: 'active', secretRefs: { url: 'secret://api_token/url#current' } });
      await repository.createRequest({ tenantId: 'tenant-1', source: 'test', eventKey: 'e1', idempotencyKey: 'i1', templateKey: 't1', context: {}, sourceRefs: {}, status: 'queued', deliveries: [{ channel, target: {} }] });
      const [left, right] = await Promise.all([repository.leaseNextDelivery('worker-a', 60), repository.leaseNextDelivery('worker-b', 60)]);
      assert.equal([left, right].filter(Boolean).length, 1);
      await fixture.db.query("update notification_deliveries set lease_until=now()-interval '1 second'");
      const recovered = await repository.leaseNextDelivery('worker-c', 60);
      assert.equal(recovered?.id, (left ?? right)?.id);
    } finally { await fixture.close(); }
  });

  it('私有化 Origin 设置按租户持久化并使用版本并发控制', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      assert.deepEqual(await repository.getSettings('tenant-1'), {
        tenantId: 'tenant-1',
        privateOrigins: { wecom: [], feishu: [], dingtalk: [] },
        version: 0,
      });
      const created = await repository.updateSettings({
        tenantId: 'tenant-1',
        updatedBy: 'admin-1',
        version: 0,
        privateOrigins: {
          wecom: ['https://wecom.internal.example'],
          feishu: ['https://feishu.internal.example:8443'],
          dingtalk: [],
        },
      });
      assert.equal(created.version, 1);
      assert.deepEqual((await repository.getSettings('tenant-1')).privateOrigins, created.privateOrigins);
      await assert.rejects(repository.updateSettings({
        tenantId: 'tenant-1',
        updatedBy: 'admin-2',
        version: 0,
        privateOrigins: { wecom: [], feishu: [], dingtalk: [] },
      }), /版本已变化/);
      assert.equal((await repository.getSettings('tenant-2')).version, 0);
    } finally { await fixture.close(); }
  });

  it('应用服务规范化私有化 Origin 并拒绝完整 Webhook URL', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const service = new NotificationsApplicationService(repository);
      const settings = await service.updateSettings({
        tenantId: 'tenant-1',
        updatedBy: 'admin-1',
        version: 0,
        privateOrigins: {
          wecom: ['https://wecom.internal.example', 'https://wecom.internal.example/'],
          feishu: [],
          dingtalk: [],
        },
      });
      assert.deepEqual(settings.privateOrigins.wecom, ['https://wecom.internal.example']);
      assert.throws(() => service.updateSettings({
          tenantId: 'tenant-1',
          updatedBy: 'admin-1',
          version: settings.version,
          privateOrigins: {
            wecom: ['https://wecom.internal.example/hook?token=secret'],
            feishu: [],
            dingtalk: [],
          },
        }), /精确 HTTPS Origin/);
    } finally { await fixture.close(); }
  });

  it('通知设置读取和保存使用不同的 RBAC 权限', async () => {
    const fixture = await createFixture();
    try {
      const actions: Array<{ action: string; resourceType: string }> = [];
      const security = {
        rbac: {
          assertCan: async (_subject: unknown, action: string, resource: { type: string }) => {
            actions.push({ action, resourceType: resource.type });
          },
        },
        audit: { write: async () => undefined },
      } as unknown as SecurityServices;
      const service = new NotificationsApplicationService(new PgNotificationsRepository(fixture.db));
      const router = new Router();
      new NotificationsController(service, security).register(router);
      const context = { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', actorId: 'admin-1' };

      await router.match('GET', '/api/v1/notification-settings')!.handler({
        method: 'GET', path: '/api/v1/notification-settings', query: {}, headers: {}, context,
      });
      await router.match('PATCH', '/api/v1/notification-settings')!.handler({
        method: 'PATCH', path: '/api/v1/notification-settings', query: {}, headers: {}, context,
        body: { version: 0, wecomPrivateOrigins: [], feishuPrivateOrigins: [], dingtalkPrivateOrigins: [] },
      });

      assert.deepEqual(actions, [
        { action: 'notification.channel.read', resourceType: 'settings' },
        { action: 'settings.write', resourceType: 'settings' },
      ]);
    } finally { await fixture.close(); }
  });

  it('路由按优先级匹配并在 stopOnMatch 停止', () => {
    const matcher = new NotificationRouteMatcher();
    const base = { tenantId: 't', status: 'active' as const, matcher: {}, channelTargets: [], dedupeWindowSeconds: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 };
    const result = matcher.match([
      { ...base, id: 'late', name: 'late', priority: 20, stopOnMatch: false },
      { ...base, id: 'first', name: 'first', priority: 10, stopOnMatch: true },
    ], {});
    assert.deepEqual(result.map((route) => route.id), ['first']);
  });

  it('模板缺变量、邮件头换行和敏感上下文会被阻止或脱敏', () => {
    const domain = new NotificationsDomainService();
    assert.throws(() => domain.render('{{name}}', {}, ['name']), /缺少必需变量/);
    assert.throws(() => domain.assertSafeEmailHeader('ok\r\nBcc: attacker@example.com', 'subject'), /非法换行/);
    assert.deepEqual(domain.sanitizeContext({ token: 'abc', nested: { password: '123' } }), { token: '[REDACTED]', nested: { password: '[REDACTED]' } });
    assert.throws(() => domain.assertChannelSecrets({ webhookUrl: 'https://example.com/hook' }, {}), /SecretRef/);
    assert.throws(() => domain.assertChannelSecrets({}, { webhookUrl: 'plaintext-token' }), /无效 SecretRef/);
  });

  it('SSRF 策略拒绝本机、链路本地、私网和云元数据地址', async () => {
    assert.equal(isBlockedAddress('127.0.0.1'), true);
    assert.equal(isBlockedAddress('169.254.169.254'), true);
    assert.equal(isBlockedAddress('10.0.0.1'), true);
    assert.equal(isBlockedAddress('::1'), true);
    await assert.rejects(() => new WebhookTargetPolicy().validateUrl('http://127.0.0.1/hook'), /安全策略/);
    await assert.rejects(() => new WebhookTargetPolicy().validateUrl('file:///etc/passwd'), /HTTP/);
  });

  it('停用渠道仍可创建正式测试投递，但普通请求不能进入停用渠道', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const service = new NotificationsApplicationService(repository);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: '预启用 Slack', type: 'slack', status: 'disabled', secretRefs: { webhookUrl: 'secret://api_token/slack#current' } });
      await repository.upsertTemplate({ tenantId: 'tenant-1', templateKey: 'test.template', locale: 'zh-CN', titleTemplate: 'Test', bodyTemplate: 'Body' });
      const normal = await service.enqueue({ tenantId: 'tenant-1', channelId: channel.id, templateKey: 'test.template', eventKey: 'normal', idempotencyKey: 'normal', source: 'system', context: {} });
      assert.equal((await repository.getRequest('tenant-1', normal.requestId))?.status, 'failed');
      const test = await service.enqueue({ tenantId: 'tenant-1', channelId: channel.id, templateKey: 'test.template', eventKey: 'test', idempotencyKey: 'test', source: 'test', context: {} });
      assert.equal((await repository.getRequest('tenant-1', test.requestId))?.status, 'queued');
    } finally { await fixture.close(); }
  });

  it('自动化通知端口使用稳定幂等键并保存运行来源关联', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const service = new NotificationsApplicationService(repository);
      const automation = new AutomationNotificationPort(service);
      const first = await automation.enqueue({ tenantId: 'tenant-1', automationRunId: 'run-1', automationRunTargetId: 'target-1', eventType: 'failed', templateKey: 'automation.run', context: { title: '自动化失败', summary: '目标执行失败' } });
      const second = await automation.enqueue({ tenantId: 'tenant-1', automationRunId: 'run-1', automationRunTargetId: 'target-1', eventType: 'failed', templateKey: 'automation.run', context: { title: '自动化失败', summary: '目标执行失败' } });
      assert.equal(first.requestId, second.requestId);
      const request = await repository.getRequest('tenant-1', first.requestId);
      assert.deepEqual(request?.sourceRefs, { automationRunId: 'run-1', automationRunTargetId: 'target-1' });
      assert.equal(request?.status, 'failed');
    } finally { await fixture.close(); }
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-notification-'));
  const pglite = new PGlite(directory);
  const db = new PgliteDatabase(pglite);
  await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
  return { db, close: async () => { await pglite.close(); await rm(directory, { recursive: true, force: true }); } };
}
