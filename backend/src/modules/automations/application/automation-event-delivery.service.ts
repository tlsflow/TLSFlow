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
  sourceType: 'external_source' | 'manual_import';
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
    const deliveries: string[] = [];
    for (const automation of await this.repository.listAutomations(event.tenantId)) {
      if (automation.status !== 'active') continue;
      const version = await this.repository.getVersion(automation.id, automation.currentVersion, event.tenantId);
      if (!version || !this.triggers.isEventTrigger(version.trigger)) continue;
      if (!this.triggers.matchesContext(version.trigger, event)) continue;
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
