import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationTriggerContextDto, AutomationTriggerDto } from '../dto/automations.dto.js';

export interface AutomationTriggerContract<TTrigger extends AutomationTriggerDto = AutomationTriggerDto> {
  type: TTrigger['type'];
  validate(trigger: TTrigger): void;
  isEventTrigger: boolean;
  matchesContext?(trigger: TTrigger, context: AutomationTriggerContextDto): boolean;
  buildDeliveryKey?(trigger: TTrigger, context: AutomationTriggerContextDto): string;
}

export class AutomationTriggerRegistry {
  private readonly contracts = new Map<AutomationTriggerDto['type'], AutomationTriggerContract>();

  constructor() {
    this.registerDefaults();
  }

  register<TTrigger extends AutomationTriggerDto>(contract: AutomationTriggerContract<TTrigger>): this {
    this.contracts.set(contract.type, contract as AutomationTriggerContract);
    return this;
  }

  get<TTrigger extends AutomationTriggerDto>(type: TTrigger['type']): AutomationTriggerContract<TTrigger> {
    const contract = this.contracts.get(type);
    if (!contract) throw new AppError('VALIDATION_FAILED', '自动化触发器未注册', { type });
    return contract as AutomationTriggerContract<TTrigger>;
  }

  validate(trigger: AutomationTriggerDto): void {
    this.get(trigger.type).validate(trigger as never);
  }

  isEventTrigger(trigger: AutomationTriggerDto): boolean {
    return this.get(trigger.type).isEventTrigger;
  }

  matchesContext(trigger: AutomationTriggerDto, context: AutomationTriggerContextDto): boolean {
    const contract = this.get(trigger.type);
    if (!contract.matchesContext) return true;
    return contract.matchesContext(trigger as never, context);
  }

  buildDeliveryKey(trigger: AutomationTriggerDto, context: AutomationTriggerContextDto): string {
    const contract = this.get(trigger.type);
    if (!contract.buildDeliveryKey) {
      throw new AppError('VALIDATION_FAILED', '当前触发器不支持事件投递', { type: trigger.type });
    }
    return contract.buildDeliveryKey(trigger as never, context);
  }

  private registerDefaults(): void {
    this
      .register({
        type: 'api',
        isEventTrigger: false,
        validate: () => undefined,
      })
      .register({
        type: 'on_demand',
        isEventTrigger: false,
        validate: () => undefined,
      })
      .register({
        type: 'once',
        isEventTrigger: false,
        validate: (trigger: Extract<AutomationTriggerDto, { type: 'once' }>) => {
          if (!trigger.runAt || Number.isNaN(Date.parse(trigger.runAt))) {
            throw new AppError('VALIDATION_FAILED', '一次性触发时间无效', { runAt: trigger.runAt });
          }
        },
      })
      .register({
        type: 'schedule',
        isEventTrigger: false,
        validate: (trigger: Extract<AutomationTriggerDto, { type: 'schedule' }>) => {
          if (!trigger.cron.trim()) throw new AppError('VALIDATION_FAILED', '定时触发 Cron 不能为空');
          if (!trigger.timeZone.trim()) throw new AppError('VALIDATION_FAILED', '定时触发时区不能为空');
        },
      })
      .register({
        type: 'certificate_version_created',
        isEventTrigger: true,
        validate: (trigger: Extract<AutomationTriggerDto, { type: 'certificate_version_created' }>) => {
          const invalid = (trigger.sources ?? []).find((item) => !['external_source', 'manual_import', 'acme_issue'].includes(item));
          if (invalid) throw new AppError('VALIDATION_FAILED', '证书事件来源不受支持', { source: invalid });
        },
        matchesContext: (trigger: Extract<AutomationTriggerDto, { type: 'certificate_version_created' }>, context) => {
          if (context.eventType && context.eventType !== 'certificate.version.created') return false;
          if (trigger.sources?.length && context.sourceType) {
            const source = normalizeCertificateEventSource(context.sourceType);
            if (!source) return false;
            return trigger.sources.some((item) => normalizeCertificateEventSource(item) === source);
          }
          return true;
        },
        buildDeliveryKey: (_trigger, context) => {
          if (!context.certificateVersionId) {
            throw new AppError('VALIDATION_FAILED', '证书事件缺少 certificateVersionId');
          }
          return `certificate.version.created:${context.certificateVersionId}`;
        },
      });
  }
}

function normalizeCertificateEventSource(source: string): 'manual_import' | 'acme_issue' | undefined {
  if (source === 'external_source') return 'acme_issue';
  if (source === 'manual_import' || source === 'acme_issue') return source;
  return undefined;
}
