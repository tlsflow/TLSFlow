import { newId } from '../../../shared/id.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { AutomationTriggerContextDto } from '../dto/automations.dto.js';
import { AutomationsRepository } from '../repository/automations.repository.js';
import { AutomationsApplicationService } from './automations.application-service.js';
import { AutomationTriggerRegistry } from './automation-trigger-registry.js';

export interface CertificateVersionCreatedEvent extends AutomationTriggerContextDto {
  eventType: 'certificate.version.created';
  tenantId: string;
  eventId: string;
  certificateAssetId: string;
  certificateVersionId: string;
  applicationAssetId?: string;
  /** 证书签发流程是否明确允许事件进入自动化；未声明只影响历史应用事件兼容处理。 */
  automationEligible?: boolean;
  sourceType: 'external_source' | 'manual_import' | 'acme_issue';
  domains: string[];
  tags: string[];
  occurredAt: string;
}

export interface CertificateVersionEventPublisher {
  publishCertificateVersionCreated(event: CertificateVersionCreatedEvent): Promise<string[]>;
}

export class DeferredCertificateVersionEventPublisher implements CertificateVersionEventPublisher {
  private delegate?: CertificateVersionEventPublisher;

  setDelegate(delegate: CertificateVersionEventPublisher): void {
    this.delegate = delegate;
  }

  async publishCertificateVersionCreated(event: CertificateVersionCreatedEvent): Promise<string[]> {
    if (!this.delegate) return [];
    return this.delegate.publishCertificateVersionCreated(event);
  }
}

export class AutomationEventDeliveryService implements CertificateVersionEventPublisher {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly automations: AutomationsApplicationService,
    private readonly triggers: AutomationTriggerRegistry,
    private readonly tasks?: TaskEnqueuer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async publishCertificateVersionCreated(event: CertificateVersionCreatedEvent): Promise<string[]> {
    if (event.automationEligible === false) return [];
    const deliveries: string[] = [];
    for (const automation of await this.repository.listAutomations(event.tenantId)) {
      if (automation.status !== 'active') continue;
      const version = await this.repository.getVersion(automation.id, automation.currentVersion, event.tenantId);
      if (!version || !this.triggers.isEventTrigger(version.trigger)) continue;
      if (!this.triggers.matchesContext(version.trigger, event)) continue;
      if (!matchesApplicationPlan(version, event.applicationAssetId)) continue;
      const deliveryKey = this.triggers.buildDeliveryKey(version.trigger, event);
      const existing = await this.repository.findDelivery(event.tenantId, automation.id, version.version, deliveryKey);
      const delivery = existing ?? await this.repository.createDelivery({
        id: newId('adel'),
        tenantId: event.tenantId,
        automationId: automation.id,
        automationVersion: version.version,
        deliveryKey,
        triggerType: version.trigger.type,
        eventType: event.eventType,
        payload: structuredClone(event),
        status: 'pending',
        createdAt: this.clock().toISOString(),
        updatedAt: this.clock().toISOString(),
      });
      deliveries.push(delivery.id);
      enqueueTaskBestEffort(this.tasks, {
        tenantId: event.tenantId,
        taskType: 'AUTOMATION_TRIGGER_DELIVERY',
        requestedBy: 'system_automation_event',
        triggerSource: event.eventType,
        idempotencyKey: `automation-delivery:${delivery.id}`,
        payload: { deliveryId: delivery.id },
        resourceRefs: [{ resourceType: 'automationDelivery', resourceId: delivery.id }],
      });
    }
    return deliveries;
  }

  async processDelivery(tenantId: string, deliveryId: string): Promise<void> {
    const delivery = await this.repository.getDelivery(deliveryId, tenantId);
    if (!delivery || delivery.runId) return;
    // 中文说明：历史版本可能已经把应用专属证书事件落成投递，但尚未创建自动化运行。
    // 新的专属自动签发必须显式携带 automationEligible=true，避免旧投递继续抢跑部署。
    if (delivery.payload.applicationAssetId && delivery.payload.automationEligible !== true) {
      await this.repository.updateDelivery(delivery.id, tenantId, {
        status: 'skipped',
        errorCode: 'AUTOMATION_SUPPRESSED_FOR_APPLICATION_CERTIFICATE',
        errorMessage: '应用专属证书由专属证书处理任务负责部署，当前事件未明确授权自动化',
        updatedAt: this.clock().toISOString(),
      });
      return;
    }
    const automation = await this.repository.getAutomation(delivery.automationId, tenantId);
    if (!automation || automation.status !== 'active') {
      await this.repository.updateDelivery(delivery.id, tenantId, {
        status: 'skipped',
        errorCode: 'AUTOMATION_DISABLED',
        errorMessage: '自动化已不存在或未启用',
        updatedAt: this.clock().toISOString(),
      });
      return;
    }
    const version = await this.repository.getVersion(delivery.automationId, delivery.automationVersion, tenantId);
    if (!version || !this.triggers.matchesContext(version.trigger, delivery.payload)) {
      await this.repository.updateDelivery(delivery.id, tenantId, {
        status: 'skipped',
        errorCode: 'AUTOMATION_TRIGGER_UNMATCHED',
        errorMessage: '触发上下文不再匹配当前自动化版本',
        updatedAt: this.clock().toISOString(),
      });
      return;
    }
    try {
      const created = await this.automations.createRunFromTrigger({
        tenantId,
        actorId: 'system_automation_event',
        automationId: delivery.automationId,
        idempotencyKey: `event:${delivery.automationId}:${delivery.automationVersion}:${delivery.deliveryKey}`,
        triggerType: version.trigger.type,
        triggerContext: {
          ...structuredClone(delivery.payload),
          deliveryId: delivery.id,
          deliveryKey: delivery.deliveryKey,
        },
        deliveryId: delivery.id,
      });
      if (!created.run) {
        await this.repository.updateDelivery(delivery.id, tenantId, {
          status: 'skipped',
          errorCode: 'AUTOMATION_TARGETS_EMPTY',
          errorMessage: '没有可执行目标',
          updatedAt: this.clock().toISOString(),
        });
        return;
      }
      await this.repository.updateDelivery(delivery.id, tenantId, {
        status: created.run.status === 'waiting_approval' ? 'waiting_approval' : 'run_created',
        runId: created.run.id,
        approvalId: created.run.approvalId,
        updatedAt: this.clock().toISOString(),
      });
    } catch (error) {
      await this.repository.updateDelivery(delivery.id, tenantId, {
        status: 'failed',
        errorCode: String((error as { errorCode?: string })?.errorCode ?? 'AUTOMATION_DELIVERY_FAILED'),
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: this.clock().toISOString(),
      });
      throw error;
    }
  }
}

function matchesApplicationPlan(version: { targetResolver: { type: string; assetIds?: string[] }; filters?: Array<{ field: string; value?: unknown }> }, applicationAssetId?: string): boolean {
  if (!applicationAssetId) return true;
  const selectedAssetIds = new Set(version.targetResolver.assetIds ?? []);
  for (const filter of version.filters ?? []) {
    if (filter.field !== 'target.assetId') continue;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) selectedAssetIds.add(value);
    }
  }
  return selectedAssetIds.has(applicationAssetId);
}
