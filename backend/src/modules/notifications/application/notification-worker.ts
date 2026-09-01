import type { SecretService } from '../../secrets/secret.service.js';
import type { NotificationsRepository } from '../repository/notifications.repository.js';
import type { ChannelAdapterRegistry } from './channel-adapter-registry.js';
import type { NotificationChannel, NotificationSettings } from '../schema/notifications.schema.js';

export interface NotificationSecretResolver {
  resolve(secretRef: string, tenantId: string, channelId: string): Promise<string>;
}

export class ServiceNotificationSecretResolver implements NotificationSecretResolver {
  constructor(private readonly secrets: SecretService) {}

  async resolve(secretRef: string, tenantId: string, channelId: string): Promise<string> {
    const result = await this.secrets.resolveForService({
      secretRef,
      tenantId,
      purpose: 'notification.delivery',
      actorId: 'notification-worker',
      context: { requestId: `notification:${channelId}` },
    });
    return result.plainText;
  }
}

export class NotificationWorker {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly secretResolver: NotificationSecretResolver,
    private readonly workerId: string,
    private readonly leaseSeconds = 60,
  ) {}

  async runNext(): Promise<boolean> {
    const delivery = await this.repository.leaseNextDelivery(this.workerId, this.leaseSeconds);
    if (!delivery) return false;
    return this.processDelivery(delivery);
  }

  async runDelivery(tenantId: string, deliveryId: string): Promise<boolean> {
    const delivery = await this.repository.leaseDelivery(tenantId, deliveryId, this.workerId, this.leaseSeconds);
    if (!delivery) return false;
    return this.processDelivery(delivery);
  }

  async getDelivery(tenantId: string, deliveryId: string) {
    return this.repository.getDelivery(tenantId, deliveryId);
  }

  private async processDelivery(delivery: Awaited<ReturnType<NotificationsRepository['getDelivery']>> & object): Promise<boolean> {
    const startedAt = Date.now();
    let channel: NotificationChannel | undefined;
    try {
      const [loadedChannel, request, settings] = await Promise.all([
        this.repository.getChannel(delivery.tenantId, delivery.channelId),
        this.repository.getRequest(delivery.tenantId, delivery.requestId),
        this.repository.getSettings(delivery.tenantId),
      ]);
      channel = loadedChannel;
      if (!channel || !request || !(channel.status === 'active' || request.source === 'test' && channel.status === 'disabled')) {
        await this.repository.completeDeliveryAttempt({
          deliveryId: delivery.id,
          leaseOwner: this.workerId,
          success: false,
          retryable: false,
          failureCategory: 'configuration',
          failureMessage: '通知渠道不可用',
          latencyMs: Date.now() - startedAt,
        });
        return true;
      }
      const activeChannel = channel;
      const adapter = this.adapters.get(activeChannel.type);
      await adapter.validateConfig(activeChannel);
      const secrets = Object.fromEntries(await Promise.all(Object.entries(activeChannel.secretRefs).map(async ([key, secretRef]) => [
        key,
        await this.secretResolver.resolve(secretRef, delivery.tenantId, activeChannel.id),
      ])));
      const privateOrigins = trustedPrivateOriginsForChannel(activeChannel, settings);
      const result = await adapter.send({ channel: activeChannel, request, delivery, secrets, privateOrigins });
      const latencyMs = Date.now() - startedAt;
      await this.repository.completeDeliveryAttempt({
        deliveryId: delivery.id,
        leaseOwner: this.workerId,
        ...result,
        latencyMs,
        nextAttemptAt: result.retryable ? retryAt(delivery.attemptCount) : undefined,
      });
      await this.repository.updateChannelHealth(activeChannel.id, result.success, latencyMs);
    } catch (error) {
      await this.repository.completeDeliveryAttempt({
        deliveryId: delivery.id,
        leaseOwner: this.workerId,
        success: false,
        retryable: isRetryableError(error),
        failureCategory: classifyError(error),
        failureMessage: safeErrorMessage(error),
        latencyMs: Date.now() - startedAt,
        nextAttemptAt: retryAt(delivery.attemptCount),
      });
      if (channel) await this.repository.updateChannelHealth(channel.id, false, Date.now() - startedAt);
    }
    return true;
  }
}

/**
 * 私有化地址属于具体渠道，而非整租户的通用开关。
 * 历史设置仅在旧渠道尚未写入 privateOrigin 时作为兼容回退，避免升级后存量渠道立即失效。
 */
export function trustedPrivateOriginsForChannel(channel: NotificationChannel, legacySettings: NotificationSettings): string[] {
  if (channel.type !== 'wecom' && channel.type !== 'feishu' && channel.type !== 'dingtalk') return [];
  const configured = channel.config.privateOrigin;
  if (typeof configured === 'string' && configured.trim()) return [configured.trim()];
  return legacySettings.privateOrigins[channel.type];
}

function retryAt(attemptCount: number): string {
  const seconds = Math.min(3600, 15 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isRetryableError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code);
}

function classifyError(error: unknown): 'timeout' | 'network' | 'configuration' | 'unknown' {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code.startsWith('ECONN') || code === 'EAI_AGAIN') return 'network';
  if (error instanceof Error && /config|配置|SecretRef/.test(error.message)) return 'configuration';
  return 'unknown';
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]').slice(0, 500);
}
