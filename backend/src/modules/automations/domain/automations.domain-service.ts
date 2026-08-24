import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import { AutomationActionRegistry } from '../application/automation-action-registry.js';
import type { AutomationConfigurationDto, AutomationStatus } from '../dto/automations.dto.js';
import type { AutomationEntity, AutomationVersionEntity } from '../schema/automations.schema.js';

const statusTransitions: Readonly<Record<AutomationStatus, readonly AutomationStatus[]>> = {
  draft: ['active', 'disabled', 'deleted'],
  active: ['disabled', 'deleted'],
  disabled: ['active', 'deleted'],
  deleted: [],
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new AppError('VALIDATION_FAILED', '自动化时区无效', { timeZone });
  }
}

function validateCron(cron: string): void {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new AppError('VALIDATION_FAILED', 'Cron 必须包含五个字段', { cron });
  const fieldPattern = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(,\d+)+)$/;
  if (fields.some((field) => !fieldPattern.test(field))) throw new AppError('VALIDATION_FAILED', 'Cron 包含不支持的字段', { cron });
}

export class AutomationsDomainService {
  constructor(private readonly actionRegistry = new AutomationActionRegistry()) {}

  validateConfiguration(configuration: AutomationConfigurationDto): void {
    if (configuration.trigger.type === 'schedule') {
      validateCron(configuration.trigger.cron);
      validateTimeZone(configuration.trigger.timeZone);
      if (configuration.trigger.startsAt && configuration.trigger.endsAt && configuration.trigger.startsAt >= configuration.trigger.endsAt) {
        throw new AppError('VALIDATION_FAILED', '自动化生效结束时间必须晚于开始时间');
      }
    }
    const guardrails = configuration.guardrails;
    if (!Number.isInteger(guardrails.maxTargetsPerRun) || guardrails.maxTargetsPerRun < 1 || guardrails.maxTargetsPerRun > 5000) {
      throw new AppError('VALIDATION_FAILED', '单次目标上限必须在 1 到 5000 之间');
    }
    if (!Number.isInteger(guardrails.concurrencyLimit) || guardrails.concurrencyLimit < 1 || guardrails.concurrencyLimit > guardrails.maxTargetsPerRun) {
      throw new AppError('VALIDATION_FAILED', '并发上限必须为不超过目标上限的正整数');
    }
    if (guardrails.failureCountThreshold !== undefined && (guardrails.failureCountThreshold < 1 || guardrails.failureCountThreshold > guardrails.maxTargetsPerRun)) {
      throw new AppError('VALIDATION_FAILED', '失败数阈值越界');
    }
    if (guardrails.failureRateThreshold !== undefined && (guardrails.failureRateThreshold <= 0 || guardrails.failureRateThreshold > 1)) {
      throw new AppError('VALIDATION_FAILED', '失败比例阈值必须大于 0 且不超过 1');
    }
    if (configuration.targetSelector.expiresWithinDays !== undefined && (configuration.targetSelector.expiresWithinDays < 0 || configuration.targetSelector.expiresWithinDays > 3650)) {
      throw new AppError('VALIDATION_FAILED', '证书到期窗口越界');
    }
    if (configuration.targetSelector.certificateVersionSelection === 'specific' && !configuration.targetSelector.certificateVersionIds?.length) {
      throw new AppError('VALIDATION_FAILED', '指定证书版本模式必须提供证书版本');
    }
    this.actionRegistry.validate(configuration.actions);
  }

  createVersion(input: { tenantId: string; automationId: string; version: number; configuration: AutomationConfigurationDto; actorId: string; now: string }): AutomationVersionEntity {
    this.validateConfiguration(input.configuration);
    return {
      id: newId('autv'), tenantId: input.tenantId, automationId: input.automationId, version: input.version,
      ...structuredClone(input.configuration), checksum: this.checksum(input.configuration), createdBy: input.actorId, createdAt: input.now,
    };
  }

  assertVersion(current: AutomationEntity, expectedVersion: number): void {
    if (current.version !== expectedVersion) throw new AppError('RESOURCE_VERSION_CONFLICT', '自动化版本冲突', { expectedVersion, actualVersion: current.version });
  }

  assertTransition(current: AutomationStatus, next: AutomationStatus): void {
    if (!statusTransitions[current].includes(next)) throw new AppError('VALIDATION_FAILED', '自动化状态不允许该操作', { current, next });
  }

  checksum(configuration: AutomationConfigurationDto): string {
    return createHash('sha256').update(stable(configuration)).digest('hex');
  }
}
