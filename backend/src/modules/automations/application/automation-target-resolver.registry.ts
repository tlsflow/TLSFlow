import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationGuardrailsDto, AutomationPreviewTargetDto, AutomationTargetResolverDto, AutomationTriggerContextDto } from '../dto/automations.dto.js';

export interface AutomationTargetResolverInput {
  tenantId: string;
  actorId: string;
  triggerContext?: AutomationTriggerContextDto;
  /**
   * 仅手动运行允许把证书有效期降级目标交给执行器。
   * 自动事件和定时任务必须保持默认值，避免绕过安全门禁。
   */
  allowCertificateDowngrade?: boolean;
  guardrails: AutomationGuardrailsDto;
  resolver: AutomationTargetResolverDto;
  page?: number;
  pageSize?: number;
}

export interface AutomationTargetAccessPort {
  canReadTarget(input: { tenantId: string; actorId: string; bindingId: string; assetId?: string }): Promise<boolean>;
}

export class AllowAllAutomationTargetAccess implements AutomationTargetAccessPort {
  async canReadTarget(): Promise<boolean> {
    return true;
  }
}

export interface AutomationTargetResolver {
  type: AutomationTargetResolverDto['type'];
  validate(resolver: AutomationTargetResolverDto): void;
  resolve(input: AutomationTargetResolverInput): Promise<AutomationPreviewTargetDto[]>;
}

export class AutomationTargetResolverRegistry {
  private readonly resolvers = new Map<AutomationTargetResolverDto['type'], AutomationTargetResolver>();

  constructor() {
    this.register({
      type: 'certificate_version_targets',
      validate: () => undefined,
      resolve: async () => [],
    });
  }

  register(resolver: AutomationTargetResolver): this {
    this.resolvers.set(resolver.type, resolver);
    return this;
  }

  get(type: AutomationTargetResolverDto['type']): AutomationTargetResolver {
    const resolver = this.resolvers.get(type);
    if (!resolver) throw new AppError('VALIDATION_FAILED', '自动化目标解析器未注册', { type });
    return resolver;
  }

  validate(resolver: AutomationTargetResolverDto): void {
    this.get(resolver.type).validate(resolver);
  }

  async resolve(input: AutomationTargetResolverInput): Promise<AutomationPreviewTargetDto[]> {
    return this.get(input.resolver.type).resolve(input);
  }
}
