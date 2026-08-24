import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationActionDto, AutomationActionType, AutomationFailureStage } from '../dto/automations.dto.js';

export interface AutomationActionContract {
  type: AutomationActionType;
  executorKey: string;
  referenceTypes: Array<'deployment_plan' | 'execution_run' | 'notification_request'>;
  asyncMode: 'sync' | 'async';
  failureStages: AutomationFailureStage[];
}

export class AutomationActionRegistry {
  private readonly contracts = new Map<AutomationActionType, AutomationActionContract>();

  constructor() {
    this.registerDefaults();
  }

  register(contract: AutomationActionContract): this {
    this.contracts.set(contract.type, contract);
    return this;
  }

  get(type: AutomationActionType): AutomationActionContract {
    const contract = this.contracts.get(type);
    if (!contract) throw new AppError('VALIDATION_FAILED', '自动化动作未注册', { type });
    return contract;
  }

  validate(actions: AutomationActionDto[]): void {
    if (actions.length === 0) throw new AppError('VALIDATION_FAILED', '自动化至少需要一个动作');
    const positions = new Set<number>();
    for (const action of actions) {
      this.get(action.type);
      if (!Number.isInteger(action.position) || action.position < 1 || positions.has(action.position)) {
        throw new AppError('VALIDATION_FAILED', '自动化动作顺序必须是唯一正整数', { position: action.position });
      }
      positions.add(action.position);
    }
    const ordered = [...positions].sort((left, right) => left - right);
    if (ordered.some((position, index) => position !== index + 1)) {
      throw new AppError('VALIDATION_FAILED', '自动化动作顺序必须连续');
    }
  }

  private registerDefaults(): void {
    this
      .register({
        type: 'create_deployment_plan',
        executorKey: 'deployment.plan.create',
        referenceTypes: ['deployment_plan'],
        asyncMode: 'sync',
        failureStages: ['plan_creation', 'approval'],
      })
      .register({
        type: 'execute_deployment_plan',
        executorKey: 'deployment.plan.execute',
        referenceTypes: ['deployment_plan', 'execution_run'],
        asyncMode: 'async',
        failureStages: ['dry_run', 'execution', 'verification', 'rollback', 'approval'],
      })
      .register({
        type: 'send_notification',
        executorKey: 'notification.send',
        referenceTypes: ['notification_request'],
        asyncMode: 'sync',
        failureStages: ['notification'],
      });
  }
}
