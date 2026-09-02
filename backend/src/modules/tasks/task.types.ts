export const taskCategories = ['EXECUTION', 'MONITORING', 'SYSTEM'] as const;
export type TaskCategory = typeof taskCategories[number];

export const taskStatuses = [
  'QUEUED',
  'RUNNING',
  'RETRY_WAITING',
  'WAITING_RESULT',
  'AWAITING_CONFIRMATION',
  'CANCELLING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type TaskStatus = typeof taskStatuses[number];
export type TaskWaitingStatus = Extract<TaskStatus, 'WAITING_RESULT' | 'AWAITING_CONFIRMATION'>;
const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'QUEUED',
  'RUNNING',
  'RETRY_WAITING',
  'WAITING_RESULT',
  'AWAITING_CONFIRMATION',
  'CANCELLING',
]);

export const taskAttemptStatuses = ['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type TaskAttemptStatus = typeof taskAttemptStatuses[number];

export type TaskEventType =
  | 'CREATED'
  | 'CLAIMED'
  | 'STARTED'
  | 'HEARTBEAT'
  | 'PROGRESS'
  | 'LOG'
  | 'RETRY_SCHEDULED'
  | 'WAITING_RESULT'
  | 'AWAITING_CONFIRMATION'
  | 'CANCEL_REQUESTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface TaskRetryPolicy {
  maxAttempts: number;
  backoffSeconds: number;
}

export interface TaskDefinition {
  id: string;
  taskType: string;
  version: number;
  category: TaskCategory;
  displayKey: string;
  executorKey: string;
  timeoutSeconds: number;
  retryPolicy: TaskRetryPolicy;
  permissionKey: string;
  sensitivePaths: string[];
  enabled: boolean;
}

export interface TaskResourceRef {
  resourceType: string;
  resourceId: string;
  displayKey?: string;
}

export interface TaskEnqueueInput {
  tenantId: string;
  taskType: string;
  requestedBy?: string;
  triggerSource: string;
  payload?: Record<string, unknown>;
  resourceSummary?: Record<string, unknown>;
  resourceRefs?: readonly TaskResourceRef[];
  idempotencyKey?: string;
  /** 中文说明：把统一任务映射到业务动作和资源，供共用幂等记录确定作用域。 */
  idempotencyScope?: {
    actionType: string;
    resourceType: string;
    resourceId: string;
  };
  parentTaskId?: string;
  definitionVersion?: number;
  availableAt?: string;
  /** 中文说明：需要等待外部时刻或审批条件的任务，以等待状态入列，避免被 Worker 提前执行。 */
  initialStatus?: Extract<TaskStatus, 'QUEUED' | 'RETRY_WAITING' | 'WAITING_RESULT'>;
  initialProgress?: Record<string, unknown>;
}

export interface TaskRun {
  id: string;
  tenantId: string;
  taskType: string;
  definitionVersion: number;
  category: TaskCategory;
  status: TaskStatus;
  requestedBy?: string;
  triggerSource: string;
  resourceSummary?: Record<string, unknown>;
  idempotencyKey?: string;
  parentTaskId?: string;
  payload: Record<string, unknown>;
  progress?: Record<string, unknown>;
  availableAt: string;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export function isPendingApprovalTask(task: Pick<TaskRun, 'status' | 'resourceSummary' | 'progress'>): boolean {
  if (!ACTIVE_TASK_STATUSES.has(task.status)) return false;
  const approvalId = firstRecordString(task.progress, 'approvalId') ?? firstRecordString(task.resourceSummary, 'approvalId');
  if (!approvalId) return false;
  const status = firstRecordString(task.progress, 'status') ?? firstRecordString(task.resourceSummary, 'status');
  const approvalStatus = firstRecordString(task.progress, 'approvalStatus') ?? firstRecordString(task.resourceSummary, 'approvalStatus');
  return status === 'waiting_approval'
    || approvalStatus === 'pending'
    || task.progress?.approvalPending === true
    || task.resourceSummary?.approvalPending === true;
}

function firstRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface TaskAttempt {
  id: string;
  taskRunId: string;
  attemptNo: number;
  workerId: string;
  leaseExpiresAt: string;
  status: TaskAttemptStatus;
  startedAt: string;
  finishedAt?: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface TaskEvent {
  id: string;
  taskRunId: string;
  attemptId?: string;
  eventType: TaskEventType;
  eventData: Record<string, unknown>;
  actorType: string;
  actorId?: string;
  requestId?: string;
  createdAt: string;
}

export interface TaskDetail {
  task: TaskRun;
  attempts: TaskAttempt[];
  events: TaskEvent[];
  childTasks: TaskRun[];
  resourceRefs: TaskResourceRef[];
  auditEvents: Array<Record<string, unknown>>;
}

export interface TaskQuery {
  tenantId: string;
  category?: TaskCategory;
  includeAll?: boolean;
  taskType?: string;
  status?: TaskStatus;
  resourceType?: string;
  resourceId?: string;
  requestedBy?: string;
  includePendingApprovals?: boolean;
  taskId?: string;
  keyword?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: number;
  pageSize?: number;
}

export interface TaskPage {
  items: TaskRun[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MonitoringProbe {
  id: string;
  taskRunId: string;
  tenantId: string;
  monitorTargetId?: string;
  serviceAssetId: string;
  status: string;
  checkedAt: string;
  latencyMs?: number;
  summary?: string;
  detail: Record<string, unknown>;
}

export interface MonitoringProbeQuery {
  tenantId: string;
  taskRunId?: string;
  monitorTargetId?: string;
  serviceAssetId?: string;
  status?: string;
  checkedFrom?: string;
  checkedTo?: string;
  page?: number;
  pageSize?: number;
}

export interface MonitoringProbePage {
  items: MonitoringProbe[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskExecutionResult {
  success: boolean;
  /**
   * 中文说明：明确禁止统一任务层再次重试当前动作。执行运行已经进入终态时，
   * 任务层只能收敛到失败，不能再次调用已结束的执行运行。
   */
  retryable?: boolean;
  /**
   * 中文说明：真正的可重试失败才进入重试队列；不能再把外部执行等待误报为重试。
   */
  defer?: boolean;
  /**
   * 中文说明：外部动作已被可靠下发时等待其结果，或写操作结果不明时冻结在待确认状态。
   * WAITING_RESULT 会按 nextAttemptAt/retryAfterSeconds 轮询控制面已落账的结果；
   * AWAITING_CONFIRMATION 不会自动重放写操作。
   */
  waitingStatus?: TaskWaitingStatus;
  /**
   * 中文说明：由数据库基于自身时钟计算下一次执行时间，避免应用节点与数据库时钟偏差导致立即重试。
   */
  retryAfterSeconds?: number;
  nextAttemptAt?: string;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
}

export type TaskExecutor = (task: TaskRun, attempt: TaskAttempt) => Promise<TaskExecutionResult>;
