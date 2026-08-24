import { AppError } from '../../../common/errors/app-error.js';

export interface NotificationPort {
  enqueue(input: {
    tenantId: string;
    routeId?: string;
    channelId?: string;
    templateKey: string;
    eventKey: string;
    idempotencyKey: string;
    context: Record<string, unknown>;
  }): Promise<{ requestId: string }>;
}

/**
 * 自动化在通知服务完成装配前只持有这个窄接口，避免生产路径注入测试 Fake。
 * 真实通知服务绑定前调用会失败关闭，不会伪造 requestId 或吞掉投递失败。
 */
export class DeferredNotificationPort implements NotificationPort {
  private delegate?: NotificationPort;

  bind(delegate: NotificationPort): void {
    if (this.delegate) throw new Error('通知端口只能绑定一次');
    this.delegate = delegate;
  }

  async enqueue(input: Parameters<NotificationPort['enqueue']>[0]): Promise<{ requestId: string }> {
    if (!this.delegate) {
      throw new AppError('NOTIFICATION_CHANNEL_UNAVAILABLE', '通知服务尚未完成生产装配，拒绝伪造通知请求');
    }
    return this.delegate.enqueue(input);
  }
}
