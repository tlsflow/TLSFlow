import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { TaskAttempt, TaskCategory, TaskExecutionResult, TaskExecutor, TaskRun } from './task.types.js';
import type { TasksApplicationService } from './task.application-service.js';

/**
 * 统一任务执行器注册表。
 *
 * 任务定义只保存稳定的 executorKey，实际执行函数由应用装配阶段注入，
 * 这样任务控制面不需要依赖任何具体业务模块。
 */
export class TaskExecutorRegistry {
  private readonly executors = new Map<string, TaskExecutor>();

  register(executorKey: string, executor: TaskExecutor): this {
    const normalized = executorKey.trim();
    if (!normalized) throw new Error('任务执行器 key 不能为空');
    if (this.executors.has(normalized)) throw new Error(`任务执行器重复注册：${normalized}`);
    this.executors.set(normalized, executor);
    return this;
  }

  has(executorKey: string): boolean {
    return this.executors.has(executorKey);
  }

  get(executorKey: string): TaskExecutor {
    const executor = this.executors.get(executorKey);
    if (!executor) throw new Error(`任务执行器未注册：${executorKey}`);
    return executor;
  }

  keys(): string[] {
    return [...this.executors.keys()].sort();
  }
}

export interface TaskWorkerSupervisorOptions {
  workerId: string;
  maxTasksPerTick?: number;
  logger?: Pick<typeof structuredLogger, 'warn' | 'info'>;
}

/**
 * 统一任务运行时 Supervisor。
 *
 * 它是唯一允许消费 task_runs 的应用级 Worker。领域 Worker 只提供按资源
 * 精确执行的方法，避免一个任务误执行其他租户或其他资源。
 */
export class TaskWorkerSupervisor {
  private readonly maxTasksPerTick: number;
  private readonly logger: Pick<typeof structuredLogger, 'warn' | 'info'>;
  private running = false;

  constructor(
    private readonly tasks: Pick<TasksApplicationService, 'runNext' | 'registry'>,
    private readonly executors: TaskExecutorRegistry,
    private readonly options: TaskWorkerSupervisorOptions,
  ) {
    this.maxTasksPerTick = positiveInteger(options.maxTasksPerTick, 10);
    this.logger = options.logger ?? structuredLogger;
  }

  async runOnce(maxTasks = this.maxTasksPerTick): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let completed = 0;
    try {
      const limit = positiveInteger(maxTasks, this.maxTasksPerTick);
      for (let index = 0; index < limit; index += 1) {
        const result = await this.tasks.runNext(
          this.options.workerId,
          (task, attempt) => this.execute(task, attempt),
        );
        if (!result) break;
        completed += 1;
      }
      return completed;
    } finally {
      this.running = false;
    }
  }

  listExecutorKeys(): string[] {
    return this.executors.keys();
  }

  private async execute(task: TaskRun, attempt: TaskAttempt): Promise<TaskExecutionResult> {
    const definition = this.tasks.registry.get(task.taskType, task.definitionVersion);
    const executor = this.executors.get(definition.executorKey);
    try {
      const result = await executor(task, attempt);
      if (shouldLogTaskExecution(task.category)) {
        this.logger.info('统一任务执行完成', {
          taskId: task.id,
          taskType: task.taskType,
          executorKey: definition.executorKey,
          attemptNo: attempt.attemptNo,
          success: result.success,
        });
      }
      return result;
    } catch (error) {
      if (shouldLogTaskExecution(task.category)) {
        this.logger.warn('统一任务执行器抛出异常', {
          taskId: task.id,
          taskType: task.taskType,
          executorKey: definition.executorKey,
          attemptNo: attempt.attemptNo,
          error: error instanceof Error ? error.message : String(error),
        }, { module: 'task-worker-supervisor', resourceType: 'task', resourceId: task.id });
      }
      return {
        success: false,
        errorCode: 'TASK_EXECUTOR_THROWN',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback;
}

function shouldLogTaskExecution(category: TaskCategory): boolean {
  return category === 'EXECUTION';
}
