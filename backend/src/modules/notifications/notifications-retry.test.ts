import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgNotificationsRepository } from './repository/notifications.repository.js';
import { NotificationsApplicationService } from './application/notifications.application-service.js';
import { NotificationRetryScheduler } from './application/notification-retry-scheduler.js';
import type { TaskEnqueuer } from '../tasks/task-enqueue.js';
import type { TaskRun } from '../tasks/task.types.js';
import { NotificationsController } from './controller/notifications.controller.js';
import { Router } from '../../common/http/router.js';
import type { SecurityServices } from '../security/security.controller.js';

describe('通知五段流水线连接', () => {
  it('证书事件重复发布只创建一个 Request，模板预览不创建投递', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const service = new NotificationsApplicationService(repository);
      const event = {
        tenantId: 'tenant-1', eventId: 'version-1', eventType: 'certificate.status' as const,
        occurredAt: '2026-08-28T00:00:00.000Z', payloadVersion: 1, idempotencyKey: 'certificate.status:version-1:active',
        payload: { resourceId: 'version-1', status: 'active' }, sourceRefs: { certificateVersionId: 'version-1' },
      };
      const first = await service.publish(event);
      const second = await service.publish(event);
      assert.equal(first.requestId, second.requestId);
      assert.equal((await repository.listDeliveries({ tenantId: 'tenant-1' })).total, 0);
      const preview = await service.previewTemplate({
        tenantId: 'tenant-1', templateKey: 'certificate.status', locale: 'zh-CN',
        context: { resourceId: 'version-1', status: 'active' },
      });
      assert.equal(preview.title, '证书状态变更：active');
      assert.equal((await repository.listRequests({ tenantId: 'tenant-1' })).total, 1);
    } finally { await fixture.close(); }
  });

  it('可重试失败递增派发代次并由 Scheduler 创建下一代幂等任务', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: 'Webhook', type: 'webhook', status: 'active' });
      const request = await repository.createRequest({
        tenantId: 'tenant-1', source: 'certificate', eventKey: 'certificate.status:1', eventType: 'certificate.status',
        eventId: '1', idempotencyKey: 'idem-1', templateKey: 'certificate.status', context: {}, sourceRefs: {}, status: 'queued',
        deliveries: [{ channel, target: {}, renderedTitle: 'title', renderedBody: 'body', templateVersion: 1 }],
      });
      const firstDelivery = (await repository.listDeliveries({ tenantId: 'tenant-1' })).items[0]!;
      const leased = await repository.leaseDelivery('tenant-1', firstDelivery.id, 'worker-1', 60);
      assert.ok(leased);
      await repository.completeDeliveryAttempt({
        deliveryId: firstDelivery.id, leaseOwner: 'worker-1', success: false, retryable: true,
        failureCategory: 'network', failureMessage: 'temporary', nextAttemptAt: '2026-08-28T00:00:00.000Z',
      });
      const retrying = await repository.getDelivery('tenant-1', firstDelivery.id);
      assert.equal(retrying?.status, 'retrying');
      assert.equal(retrying?.dispatchGeneration, 2);

      const created: string[] = [];
      const tasks: TaskEnqueuer = {
        enqueue: async (input) => {
          created.push(String(input.idempotencyKey));
          return { id: `task-${created.length}`, tenantId: input.tenantId, taskType: input.taskType, definitionVersion: 1, category: 'SYSTEM', status: 'QUEUED', triggerSource: input.triggerSource, requestedBy: input.requestedBy, payload: input.payload ?? {}, availableAt: new Date().toISOString(), createdAt: new Date().toISOString() } as TaskRun;
        },
      };
      const scheduler = new NotificationRetryScheduler(repository, tasks, 'scheduler-1');
      const result = await scheduler.runOnce({ now: '2026-08-28T00:00:01.000Z' });
      assert.deepEqual(result, { scanned: 1, enqueued: 1, failed: 0 });
      assert.deepEqual(created, [`notification-delivery:${firstDelivery.id}:2`]);
      const outbox = await repository.listDeliveryOutbox('tenant-1', firstDelivery.id);
      assert.equal(outbox.find((item) => item.dispatchGeneration === 2)?.status, 'dispatched');
      assert.equal((await repository.getRequest('tenant-1', request.id))?.status, 'queued');
    } finally { await fixture.close(); }
  });

  it('Outbox 入列失败后下一轮扫描可以补偿，重复扫描不会重复建任务', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: 'Webhook', type: 'webhook', status: 'active' });
      const request = await repository.createRequest({
        tenantId: 'tenant-1', source: 'certificate', eventKey: 'certificate.report:1', eventType: 'certificate.report',
        eventId: '1', idempotencyKey: 'outbox-outage-1', templateKey: 'certificate.report', context: {}, sourceRefs: {}, status: 'queued',
        deliveries: [{ channel, target: {}, renderedTitle: 'title', renderedBody: 'body', templateVersion: 1 }],
      });
      const delivery = (await repository.listDeliveries({ tenantId: 'tenant-1', requestId: request.id })).items[0]!;
      const scanNow = new Date(Date.now() + 1_000).toISOString();
      let calls = 0;
      const tasks: TaskEnqueuer = {
        enqueue: async (input) => {
          calls += 1;
          if (calls === 1) throw new Error('task queue unavailable');
          return { id: 'task-recovered', tenantId: input.tenantId, taskType: input.taskType, definitionVersion: 1, category: 'SYSTEM', status: 'QUEUED', triggerSource: input.triggerSource, payload: input.payload ?? {}, availableAt: new Date().toISOString(), createdAt: new Date().toISOString() } as TaskRun;
        },
      };
      const scheduler = new NotificationRetryScheduler(repository, tasks, 'scheduler-outage');
      assert.deepEqual(await scheduler.runOnce({ now: scanNow }), { scanned: 1, enqueued: 0, failed: 1 });
      const failedOutbox = (await repository.listDeliveryOutbox('tenant-1', delivery.id))[0]!;
      assert.equal(failedOutbox.status, 'failed');
      assert.equal(failedOutbox.lastError, 'task queue unavailable');
      await fixture.db.query('update notification_dispatch_outbox set next_attempt_at=$1::timestamptz where id=$2', ['2026-08-28T00:00:00.000Z', failedOutbox.id]);
      assert.deepEqual(await scheduler.runOnce({ now: scanNow }), { scanned: 1, enqueued: 1, failed: 0 });
      assert.deepEqual(await scheduler.runOnce({ now: scanNow }), { scanned: 0, enqueued: 0, failed: 0 });
      assert.equal(calls, 2);
      assert.equal((await repository.listDeliveryOutbox('tenant-1', delivery.id))[0]?.status, 'dispatched');
    } finally { await fixture.close(); }
  });

  it('手工重试 API 递增代次、保留历史 Attempt 且重复点击不创建新代次', async () => {
    const fixture = await createFixture();
    try {
      const repository = new PgNotificationsRepository(fixture.db);
      const channel = await repository.createChannel({ tenantId: 'tenant-1', name: 'Webhook', type: 'webhook', status: 'active' });
      const request = await repository.createRequest({
        tenantId: 'tenant-1', source: 'certificate', eventKey: 'certificate.renewal.result:1', eventType: 'certificate.renewal.result',
        eventId: '1', idempotencyKey: 'manual-retry-1', templateKey: 'certificate.renewal.result', context: {}, sourceRefs: {}, status: 'queued',
        deliveries: [{ channel, target: {}, renderedTitle: 'title', renderedBody: 'body', templateVersion: 1 }],
      });
      const delivery = (await repository.listDeliveries({ tenantId: 'tenant-1', requestId: request.id })).items[0]!;
      assert.ok(await repository.leaseDelivery('tenant-1', delivery.id, 'worker-failed', 60));
      await repository.completeDeliveryAttempt({
        deliveryId: delivery.id, leaseOwner: 'worker-failed', success: false, retryable: false,
        failureCategory: 'configuration', failureMessage: 'invalid channel target',
      });
      const security = {
        rbac: { assertCan: async () => undefined },
        objectPermissions: { assertCan: async () => undefined, buildAuthorizedQuery: async () => ({}) },
        audit: { write: async () => undefined },
      } as unknown as SecurityServices;
      const createdTaskKeys: string[] = [];
      const tasks: TaskEnqueuer = {
        enqueue: async (input) => {
          createdTaskKeys.push(String(input.idempotencyKey));
          return {
            id: 'task-manual-retry', tenantId: input.tenantId, taskType: input.taskType, definitionVersion: 1,
            category: 'SYSTEM', status: 'QUEUED', triggerSource: input.triggerSource, payload: input.payload ?? {},
            availableAt: new Date().toISOString(), createdAt: new Date().toISOString(),
          } as TaskRun;
        },
      };
      const previousWorkerFlag = process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
      process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = 'true';
      const router = new Router();
      new NotificationsController(new NotificationsApplicationService(repository, undefined, undefined, undefined, undefined, undefined, undefined, tasks), security).register(router);
      const path = `/api/v1/notification-deliveries/${delivery.id}/actions/retry`;
      const requestContext = { requestId: 'request-retry', traceId: 'trace-retry', tenantId: 'tenant-1', actorId: 'operator-1' };
      const result = await router.match('POST', path)!.handler({ method: 'POST', path, query: {}, headers: {}, context: requestContext });
      assert.deepEqual(result, { deliveryId: delivery.id, dispatchGeneration: 2, attemptNo: 2, taskKey: `notification-delivery:${delivery.id}:2` });
      assert.deepEqual(createdTaskKeys, [`notification-delivery:${delivery.id}:2`]);
      assert.equal((await repository.listDeliveryAttempts('tenant-1', delivery.id)).length, 1);
      assert.equal((await repository.listDeliveryOutbox('tenant-1', delivery.id)).filter((item) => item.dispatchGeneration === 2).length, 1);
     await assert.rejects(
        async () => router.match('POST', path)!.handler({ method: 'POST', path, query: {}, headers: {}, context: requestContext }),
       /仅最终失败的投递可以重发/,
      );
      assert.equal((await repository.getDelivery('tenant-1', delivery.id))?.dispatchGeneration, 2);
      if (previousWorkerFlag === undefined) delete process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
      else process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = previousWorkerFlag;
    } finally { await fixture.close(); }
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-notification-retry-'));
  const pglite = new PGlite(directory);
  const db = new PgliteDatabase(pglite);
  await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
  return { db, close: async () => { await pglite.close(); await rm(directory, { recursive: true, force: true }); } };
}
