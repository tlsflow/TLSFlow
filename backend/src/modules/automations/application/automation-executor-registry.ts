import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationActionDto, AutomationRunDto, AutomationRunTargetDto } from '../dto/automations.dto.js';

export interface AutomationExecutorInput {
  run: AutomationRunDto;
  target: AutomationRunTargetDto;
  action: AutomationActionDto;
  requireApproval: boolean;
}

export interface AutomationExecutorResult {
  status: 'succeeded' | 'running' | 'waiting_approval';
  referenceType?: 'deployment_plan' | 'execution_run' | 'notification_request';
  referenceId?: string;
}

export type AutomationExecutor = (input: AutomationExecutorInput) => Promise<AutomationExecutorResult>;

export class AutomationExecutorRegistry {
  private readonly executors = new Map<string, AutomationExecutor>();

  register(key: string, executor: AutomationExecutor): this {
    this.executors.set(key, executor);
    return this;
  }

  get(key: string): AutomationExecutor {
    const executor = this.executors.get(key);
    if (!executor) throw new AppError('CAPABILITY_MISSING', '自动化执行器未注册', { key });
    return executor;
  }
}
