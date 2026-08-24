import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationFilterClauseDto, AutomationRunDto, AutomationTargetSnapshotDto, AutomationTriggerContextDto } from '../dto/automations.dto.js';

export interface AutomationFilterContext {
  event?: AutomationTriggerContextDto;
  target?: AutomationTargetSnapshotDto;
  run?: AutomationRunDto;
}

type AutomationFilterAccessor = (context: AutomationFilterContext) => unknown;

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function contains(actual: unknown, expected: unknown): boolean {
  return asArray(actual).some((item) => normalize(item) === normalize(expected));
}

function normalize(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
}

export class AutomationFilterEvaluator {
  private readonly accessors = new Map<string, AutomationFilterAccessor>();

  constructor() {
    this.registerDefaults();
  }

  register(field: string, accessor: AutomationFilterAccessor): this {
    this.accessors.set(field, accessor);
    return this;
  }

  validate(filters: readonly AutomationFilterClauseDto[] = []): void {
    for (const filter of filters) {
      if (!this.accessors.has(filter.field)) {
        throw new AppError('VALIDATION_FAILED', '自动化过滤字段未注册', { field: filter.field });
      }
      if (!['eq', 'neq', 'in', 'contains_any', 'contains_all'].includes(filter.operator)) {
        throw new AppError('VALIDATION_FAILED', '自动化过滤操作符不受支持', { operator: filter.operator });
      }
    }
  }

  evaluate(filters: readonly AutomationFilterClauseDto[] = [], context: AutomationFilterContext): { matched: boolean; failedField?: string } {
    this.validate(filters);
    for (const filter of filters) {
      const accessor = this.accessors.get(filter.field)!;
      const actual = accessor(context);
      const matched = this.match(actual, filter.operator, filter.value);
      if (!matched) return { matched: false, failedField: filter.field };
    }
    return { matched: true };
  }

  private match(actual: unknown, operator: AutomationFilterClauseDto['operator'], expected: unknown): boolean {
    if (operator === 'eq') return normalize(actual) === normalize(expected);
    if (operator === 'neq') return normalize(actual) !== normalize(expected);
    if (operator === 'in') return asArray(expected).some((item) => normalize(item) === normalize(actual));
    if (operator === 'contains_any') return asArray(expected).some((item) => contains(actual, item));
    if (operator === 'contains_all') return asArray(expected).every((item) => contains(actual, item));
    return false;
  }

  private registerDefaults(): void {
    this
      .register('event.eventType', (context) => context.event?.eventType)
      .register('event.sourceType', (context) => context.event?.sourceType)
      .register('event.certificateAssetId', (context) => context.event?.certificateAssetId)
      .register('event.certificateVersionId', (context) => context.event?.certificateVersionId)
      .register('event.domains', (context) => context.event?.domains ?? [])
      .register('event.tags', (context) => context.event?.tags ?? [])
      .register('target.certificateId', (context) => context.target?.certificateId)
      .register('target.certificateVersionId', (context) => context.target?.certificateVersionId)
      .register('target.bindingId', (context) => context.target?.bindingId)
      .register('target.assetId', (context) => context.target?.assetId)
      .register('target.environment', (context) => context.target?.environment)
      .register('target.ownerId', (context) => context.target?.ownerId)
      .register('target.tags', (context) => context.target?.tags ?? []);
  }
}
