import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { NotificationsRepository } from '../repository/notifications.repository.js';

export interface NotificationRetrySchedulerResult {
  scanned: number;
  enqueued: number;
  failed: number;
}

/**
 * 通知 Outbox 的唯一派发入口。
 * 该类只处理“Outbox -> 统一任务”这一小段，不触碰模板和渠道 Adapter。
 */
export class NotificationRetryScheduler {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly tasks: TaskEnqueuer,
    private readonly workerId = `notification-outbox-${process.pid}`,
    private readonly leaseSeconds = 30,
  ) {}

  async runOnce(input: { now?: string; limit?: number; requestedBy?: string } = {}): Promise<NotificationRetrySchedulerResult> {
    const claimed = await this.repository.claimDispatchOutbox(this.workerId, Math.min(200, Math.max(1, input.limit ?? 50)), this.leaseSeconds, input.now);
    let enqueued = 0;
    let failed = 0;
    for (const outbox of claimed) {
      const delivery = await this.repository.getDelivery(outbox.tenantId, outbox.deliveryId);
      const taskKey = `notification-delivery:${outbox.deliveryId}:${outbox.dispatchGeneration}`;
      if (!delivery || delivery.dispatchGeneration !== outbox.dispatchGeneration) {
        // 旧代次已经不再有执行意义，收敛为已处理，避免补偿扫描永久重复。
        await this.repository.markDispatchOutboxDispatched(outbox.id, this.workerId, 'stale:' + taskKey);
        continue;
      }
      try {
        const existing = await this.tasks.findByIdempotencyKey?.(outbox.tenantId, 'NOTIFICATION_DELIVERY', taskKey);
        const task = existing ?? await this.tasks.enqueue({
          tenantId: outbox.tenantId,
          taskType: 'NOTIFICATION_DELIVERY',
          requestedBy: input.requestedBy ?? 'notification-scheduler',
          triggerSource: 'notifications.outbox',
          idempotencyKey: taskKey,
          payload: { deliveryId: outbox.deliveryId, dispatchGeneration: outbox.dispatchGeneration },
          resourceRefs: [
            { resourceType: 'notificationDelivery', resourceId: outbox.deliveryId },
            { resourceType: 'notificationRequest', resourceId: delivery.requestId },
          ],
        });
        await this.repository.markDispatchOutboxDispatched(outbox.id, this.workerId, task.id);
        enqueued += existing ? 0 : 1;
      } catch (error) {
        failed += 1;
        await this.repository.markDispatchOutboxFailed(
          outbox.id,
          this.workerId,
          error instanceof Error ? error.message : String(error),
          nextDispatchAt(),
        );
      }
    }
    return { scanned: claimed.length, enqueued, failed };
  }
}

function nextDispatchAt(): string {
  return new Date(Date.now() + 30_000).toISOString();
}
