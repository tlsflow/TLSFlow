import { AppError } from '../../../common/errors/app-error.js';
import type { AutomationActionDto, AutomationActionType } from '../dto/automations.dto.js';

const supportedActions = new Set<AutomationActionType>([
  'create_deployment_plan',
  'execute_deployment_plan',
  'send_notification',
]);

export class AutomationActionRegistry {
  validate(actions: AutomationActionDto[]): void {
    if (actions.length === 0) throw new AppError('VALIDATION_FAILED', '自动化至少需要一个动作');
    const positions = new Set<number>();
    for (const action of actions) {
      if (!supportedActions.has(action.type)) throw new AppError('VALIDATION_FAILED', '自动化动作不受支持', { type: action.type });
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
}
