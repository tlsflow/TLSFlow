import { AppError } from '../../../common/errors/app-error.js';
import { NotificationsDomainService } from '../domain/notifications.domain-service.js';
import type { NotificationTemplate } from '../schema/notifications.schema.js';

export interface RenderedNotification {
  title: string;
  body: string;
  context: Record<string, unknown>;
}

export interface NotificationTemplateValidation {
  variables: string[];
  missingVariables: string[];
  undeclaredVariables: string[];
  missingDeclarations: string[];
}

export class NotificationTemplateRenderer {
  constructor(private readonly domain = new NotificationsDomainService()) {}

  validate(template: NotificationTemplate, input?: Record<string, unknown>): NotificationTemplateValidation {
    const variables = [...new Set([...extractVariables(template.titleTemplate), ...extractVariables(template.bodyTemplate)])];
    const required = new Set(template.requiredVariables);
    const missingVariables = input
      ? template.requiredVariables.filter((variable) => readPath(input, variable) === undefined)
      : [];
    return {
      variables,
      missingVariables,
      undeclaredVariables: variables.filter((variable) => !required.has(variable)),
      missingDeclarations: template.requiredVariables.filter((variable) => !variables.includes(variable)),
    };
  }

  render(template: NotificationTemplate, input: Record<string, unknown>): RenderedNotification {
    const context = this.domain.sanitizeContext(input);
    const validation = this.validate(template, context);
    if (validation.undeclaredVariables.length || validation.missingDeclarations.length) {
      throw new AppError('NOTIFICATION_TEMPLATE_INVALID', '通知模板变量声明不完整', {
        undeclaredVariables: validation.undeclaredVariables,
        missingDeclarations: validation.missingDeclarations,
      });
    }
    if (validation.missingVariables.length) {
      throw new AppError('NOTIFICATION_TEMPLATE_VARIABLE_MISSING', '通知模板缺少变量', { variables: validation.missingVariables });
    }
    return {
      title: this.domain.render(template.titleTemplate, context, template.requiredVariables),
      body: this.domain.render(template.bodyTemplate, context, template.requiredVariables),
      context,
    };
  }
}

function extractVariables(template: string): string[] {
  return [...template.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)].map((match) => match[1]!).filter(Boolean);
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}
