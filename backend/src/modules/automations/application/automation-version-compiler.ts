import type { AutomationActionRegistry } from './automation-action-registry.js';
import type { AutomationFilterEvaluator } from './automation-filter-evaluator.js';
import type { AutomationTargetResolverRegistry } from './automation-target-resolver.registry.js';
import type { AutomationTriggerRegistry } from './automation-trigger-registry.js';
import type { AutomationApprovalStageDto, AutomationConfigurationDto } from '../dto/automations.dto.js';

function defaultApprovalStage(requireApproval: boolean): AutomationApprovalStageDto | undefined {
  if (!requireApproval) return undefined;
  return {
    type: 'run',
    mode: 'before_actions',
    operationType: 'automation.run.approve',
    riskLevel: 'high',
  };
}

export class AutomationVersionCompiler {
  constructor(
    private readonly triggers: AutomationTriggerRegistry,
    private readonly filters: AutomationFilterEvaluator,
    private readonly resolvers: AutomationTargetResolverRegistry,
    private readonly actions: AutomationActionRegistry,
  ) {}

  compile(configuration: AutomationConfigurationDto): AutomationConfigurationDto {
    if (!configuration.targetResolver) {
      throw new Error('automation targetResolver is required');
    }
    const approvalStage = configuration.approvalStage ?? defaultApprovalStage(configuration.guardrails.requireApproval);
    const normalized: AutomationConfigurationDto = {
      trigger: structuredClone(configuration.trigger),
      externalApi: structuredClone(configuration.externalApi),
      filters: structuredClone(configuration.filters ?? []),
      targetResolver: structuredClone(configuration.targetResolver),
      approvalStage: structuredClone(approvalStage),
      actions: structuredClone(configuration.actions),
      guardrails: structuredClone(configuration.guardrails),
    };
    this.triggers.validate(normalized.trigger);
    this.filters.validate(normalized.filters);
    this.resolvers.validate(normalized.targetResolver!);
    this.actions.validate(normalized.actions);
    return normalized;
  }
}
