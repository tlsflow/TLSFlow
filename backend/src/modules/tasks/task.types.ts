export const taskCategories = ['EXECUTION', 'MONITORING', 'SYSTEM'] as const;
export type TaskCategory = typeof taskCategories[number];

export const taskStatuses = [
  'QUEUED',
  'RUNNING',
  'RETRY_WAITING',
  'CANCELLING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type TaskStatus = typeof taskStatuses[number];
const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING']);

export const taskAttemptStatuses = ['RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type TaskAttemptStatus = typeof taskAttemptStatuses[number];

export type TaskEventType =
  | 'CREATED'
  | 'CLAIMED'
  | 'STARTED'
  | 'HEARTBEAT'
  | 'PROGRESS'
  | 'LOG'
  | 'RETRY_SCHEDULED'
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
  parentTaskId?: string;
  definitionVersion?: number;
  availableAt?: string;
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
   * 中文说明：外部系统尚未完成时保留任务在重试队列，不能伪造成功或消耗完固定失败次数。
   */
  defer?: boolean;
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
