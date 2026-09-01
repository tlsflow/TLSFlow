import { AppError } from '../../../common/errors/app-error.js';
import type {
  NotificationDeliveryStatus,
  NotificationMatcher,
  NotificationRequestStatus,
} from '../schema/notifications.schema.js';

const sensitiveKeyPattern = /(password|passwd|secret|token|authorization|cookie|private.?key|webhook.?url|signature)/i;
const headerBreakPattern = /[\r\n]/;

export class NotificationsDomainService {
  sanitizeContext(value: Record<string, unknown>): Record<string, unknown> {
    return redactValue(value) as Record<string, unknown>;
  }

  matches(matcher: NotificationMatcher, event: Record<string, unknown>): boolean {
    const sourceMatches = includesOrEmpty(matcher.sources, event.source)
      || (event.source === 'monitor' && typeof event.eventType === 'string' && event.eventType.startsWith('certificate.') && matcher.sources?.includes('certificate') === true);
    return sourceMatches
      && includesOrEmpty(matcher.eventTypes, event.eventType ?? event.eventKey)
      && includesOrEmpty(matcher.severities, event.severity)
      && includesOrEmpty(matcher.environments, event.environment)
      && tagsMatch(matcher.tags, event.tags);
  }

  render(template: string, context: Record<string, unknown>, requiredVariables: string[]): string {
    for (const variable of requiredVariables) {
      if (readPath(context, variable) === undefined) {
        throw new AppError('NOTIFICATION_TEMPLATE_VARIABLE_MISSING', '通知模板缺少必需变量', { variable });
      }
    }
    return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path: string) => {
      const value = readPath(context, path);
      return value === undefined || value === null ? '' : String(value);
    });
  }

  assertSafeEmailHeader(value: string, field: string): void {
    if (headerBreakPattern.test(value)) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '邮件头字段包含非法换行', { field });
    }
  }

  assertChannelSecrets(config: Record<string, unknown>, secretRefs: Record<string, string>): void {
    const forbiddenConfigKeys = Object.keys(config).filter((key) => sensitiveKeyPattern.test(key));
    if (forbiddenConfigKeys.length) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道敏感配置必须使用 SecretRef', { fields: forbiddenConfigKeys });
    }
    const invalidRefs = Object.entries(secretRefs).filter(([, value]) => !/^secret:\/\/[a-z_]+\/[^#]+(?:#.+)?$/i.test(value));
    if (invalidRefs.length) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道包含无效 SecretRef', { fields: invalidRefs.map(([key]) => key) });
    }
  }

  aggregateRequestStatus(statuses: NotificationDeliveryStatus[]): NotificationRequestStatus {
    if (statuses.length === 0) return 'failed';
    if (statuses.every((status) => status === 'suppressed')) return 'suppressed';
    if (statuses.every((status) => status === 'delivered')) return 'delivered';
    const hasPending = statuses.some((status) => status === 'queued' || status === 'sending' || status === 'retrying');
    if (hasPending) return 'queued';
    const delivered = statuses.filter((status) => status === 'delivered').length;
    return delivered > 0 ? 'partially_delivered' : 'failed';
  }
}

function redactValue(value: unknown, key = ''): unknown {
  if (sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]));
  }
  return value;
}

function includesOrEmpty(expected: string[] | undefined, actual: unknown): boolean {
  return !expected?.length || (typeof actual === 'string' && expected.includes(actual));
}

function tagsMatch(expected: string[] | undefined, actual: unknown): boolean {
  if (!expected?.length) return true;
  if (!Array.isArray(actual)) return false;
  const actualTags = actual.filter((item): item is string => typeof item === 'string');
  return expected.every((tag) => actualTags.includes(tag));
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}
