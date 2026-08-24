import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { TaskEnqueueInput, TaskRun } from './task.types.js';

export interface TaskEnqueuer {
  enqueue(input: TaskEnqueueInput): Promise<TaskRun>;
  /** 中文说明：补偿扫描需要确认幂等代次是否已经存在，无论任务是否已进入终态。 */
  findByIdempotencyKey?(tenantId: string, taskType: string, idempotencyKey: string): Promise<TaskRun | undefined>;
  /** 中文说明：补偿扫描需要确认同一幂等代次是否仍有可执行统一任务。 */
  findActiveByIdempotency?(tenantId: string, taskType: string, idempotencyKey: string): Promise<TaskRun | undefined>;
  /** 中文说明：活动 Job 关联的终态失败任务可原子重置为 QUEUED，避免同键重建冲突。 */
  retry?(tenantId: string, id: string, actorId?: string): Promise<TaskRun>;
}

/**
 * 统一任务 Worker 的唯一运行期开关。
 *
 * 回退模式由各领域旧 Worker 继续消费，因此不能把新任务写入统一队列后
 * 再期待旧 Worker 偶然处理它们。
 */
export function isUnifiedTaskWorkerEnabled(): boolean {
  return process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED?.trim().toLowerCase() !== 'false';
}

/**
 * 中文说明：当前启动入口只注册统一任务 Worker，没有恢复旧 ACME Worker 循环。
 * 生产环境若关闭统一 Worker，续签任务会只落 RenewalJob 而永远无人消费，必须失败关闭。
 */
export function assertUnifiedTaskWorkerConfiguration(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV === 'production' && environment.GCAC_UNIFIED_TASK_WORKER_ENABLED?.trim().toLowerCase() === 'false') {
    throw new Error('生产环境禁止设置 GCAC_UNIFIED_TASK_WORKER_ENABLED=false：当前启动流程未恢复旧 ACME Worker 循环');
  }
}

/**
 * 领域动作已经完成本地状态落库后，再把统一任务记录写入控制面。
 * 控制面故障不能回滚已有领域状态，但必须留下结构化告警供运维处理。
 */
export async function enqueueTaskBestEffort(
  tasks: TaskEnqueuer | undefined,
  input: TaskEnqueueInput,
): Promise<void> {
  if (!tasks || !isUnifiedTaskWorkerEnabled()) return;
  try {
    await tasks.enqueue(input);
  } catch (error: unknown) {
    structuredLogger.warn('统一任务入列失败，领域动作已保留', {
      taskType: input.taskType,
      tenantId: input.tenantId,
      error: error instanceof Error ? error.message : String(error),
    }, { module: 'task-control-plane', resourceType: 'task' });
  }
}
