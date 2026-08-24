import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { TaskEnqueueInput, TaskRun } from './task.types.js';

export interface TaskEnqueuer {
  enqueue(input: TaskEnqueueInput): Promise<TaskRun>;
}

/**
 * 领域动作已经完成本地状态落库后，再把统一任务记录写入控制面。
 * 控制面故障不能回滚已有领域状态，但必须留下结构化告警供运维处理。
 */
export function enqueueTaskBestEffort(
  tasks: TaskEnqueuer | undefined,
  input: TaskEnqueueInput,
): void {
  if (!tasks) return;
  void tasks.enqueue(input).catch((error: unknown) => {
    structuredLogger.warn('统一任务入列失败，领域动作已保留', {
      taskType: input.taskType,
      tenantId: input.tenantId,
      error: error instanceof Error ? error.message : String(error),
    }, { module: 'task-control-plane', resourceType: 'task' });
  });
}
