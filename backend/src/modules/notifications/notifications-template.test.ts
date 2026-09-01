import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { NotificationsApplicationService } from './application/notifications.application-service.js';
import { NotificationTemplateRenderer } from './application/notification-template-renderer.js';
import { PgNotificationsRepository } from './repository/notifications.repository.js';

test('模板 Renderer 解析嵌套变量并拒绝声明不一致', () => {
  const renderer = new NotificationTemplateRenderer();
  const template = {
    id: 'template-1', tenantId: 'tenant-1', templateKey: 'certificate.status', locale: 'zh-CN',
    titleTemplate: '{{certificate.domain}}', bodyTemplate: '状态：{{certificate.status}}',
    requiredVariables: ['certificate.domain', 'certificate.status'], status: 'active' as const,
    createdAt: '', updatedAt: '', version: 3,
  };
  assert.deepEqual(renderer.validate(template, { certificate: { domain: 'example.com', status: 'active' } }), {
    variables: ['certificate.domain', 'certificate.status'],
    missingVariables: [], undeclaredVariables: [], missingDeclarations: [],
  });
  assert.deepEqual(renderer.render(template, { certificate: { domain: 'example.com', status: 'active' } }), {
    title: 'example.com', body: '状态：active', context: { certificate: { domain: 'example.com', status: 'active' } },
  });
  assert.throws(() => renderer.render({ ...template, requiredVariables: ['certificate.domain'] }, { certificate: { domain: 'example.com', status: 'active' } }), /变量声明不完整/);
  assert.throws(() => renderer.render(template, { certificate: { domain: 'example.com' } }), /缺少变量/);
});

test('已禁用模板优先于内置模板，预览失败且不创建通知记录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-notification-template-'));
  const pglite = new PGlite(directory);
  const db = new PgliteDatabase(pglite);
  try {
    await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
    const repository = new PgNotificationsRepository(db);
    const service = new NotificationsApplicationService(repository);
    await repository.upsertTemplate({
      tenantId: 'tenant-1', templateKey: 'certificate.status', locale: 'zh-CN',
      titleTemplate: '禁用标题', bodyTemplate: '禁用正文', status: 'disabled',
    });
    await assert.rejects(
      () => service.previewTemplate({ tenantId: 'tenant-1', templateKey: 'certificate.status', locale: 'zh-CN', context: { status: 'active' } }),
      /通知模板已禁用/,
    );
    const result = await service.enqueue({
      tenantId: 'tenant-1', eventType: 'certificate.status', eventKey: 'certificate.status:disabled',
      eventId: 'disabled-1', idempotencyKey: 'disabled-template-1', templateKey: 'certificate.status',
      source: 'certificate', context: { status: 'active' },
    });
    assert.equal((await repository.getRequest('tenant-1', result.requestId))?.status, 'failed');
    assert.equal((await repository.getRequest('tenant-1', result.requestId))?.statusReason, 'template_not_found');
    assert.equal((await repository.listDeliveries({ tenantId: 'tenant-1' })).total, 0);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
