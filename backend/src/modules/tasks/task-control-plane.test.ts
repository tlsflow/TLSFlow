import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AppError } from '../../common/errors/app-error.js';
import { defaultDefinitions, TaskRegistry } from './task.registry.js';
import { TasksApplicationService } from './task.application-service.js';
import { appendEvent, TaskRepository } from './task.repository.js';

async function createFixture() {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const repository = new TaskRepository(db);
  const service = new TasksApplicationService(repository);
  await service.initialize();
  assert.equal(service.getLifecycle().status, 'READY');
  return { db, repository, service };
}

test('任务注册表拒绝重复、无效和未注册类型', () => {
  const definition = defaultDefinitions[0]!;
  const registry = new TaskRegistry([definition]);
  assert.throws(() => registry.register(definition), (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_ALREADY_EXISTS');
  assert.throws(() => new TaskRegistry([{ ...definition, taskType: '', version: 2 }]), (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED');
  assert.throws(() => registry.get('UNKNOWN_TASK'), (error: unknown) => error instanceof AppError && error.errorCode === 'TASK_TYPE_NOT_REGISTERED');
  for (const retiredTaskType of ['ACME_CHALLENGE', 'PROVIDER_OPERATION']) {
    assert.throws(() => registry.get(retiredTaskType), (error: unknown) => error instanceof AppError && error.errorCode === 'TASK_TYPE_NOT_REGISTERED');
  }
  const defaultRegistry = new TaskRegistry();
  assert.equal(defaultRegistry.get('ACME_CERTIFICATE_ISSUE').executorKey, 'acme.issue');
  assert.equal(defaultRegistry.get('ACME_CERTIFICATE_RENEWAL').executorKey, 'acme.renewal');
});

test('数据库迁移前初始化错误向调用方传播并标记任务控制面失败', async () => {
  const db = new PgliteDatabase();
  const service = new TasksApplicationService(new TaskRepository(db));
  try {
    await assert.rejects(
      service.initialize(),
      /relation "task_definitions" does not exist/,
    );
    assert.equal(service.getLifecycle().status, 'FAILED');
    assert.match(service.getLifecycle().error?.message ?? '', /task_definitions/);
  } finally {
    await db.close();
  }
});

test('任务入列按租户和类型执行幂等', async () => {
  const { service } = await createFixture();
  const input = {
    tenantId: 'tenant-task-1',
    taskType: 'CERTIFICATE_DRY_RUN',
    requestedBy: 'user-1',
    triggerSource: 'test',
    idempotencyKey: 'dry-run:plan-1',
    resourceRefs: [{ resourceType: 'deploymentPlan', resourceId: 'plan-1' }],
  } as const;
  const first = await service.enqueue(input);
  const second = await service.enqueue(input);
  assert.equal(first.id, second.id);
  assert.equal((await service.list({ tenantId: input.tenantId, page: 1, pageSize: 20 })).total, 1);
});

test('并发 Claim 不会重复领取同一个任务', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-claim',
    taskType: 'AGENT_UPDATE',
    triggerSource: 'test',
    idempotencyKey: 'agent-update:1',
  });
  const claimed = await Promise.all([
    repository.claimNext(task.tenantId, 'worker-a', 60),
    repository.claimNext(task.tenantId, 'worker-b', 60),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  assert.equal(claimed.find(Boolean)?.task.id, task.id);
});

test('过期租约会回收为重试并生成新的尝试记录', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-recovery',
    taskType: 'WORKFLOW_RUN',
    triggerSource: 'test',
  });
  const first = await repository.claimNext(task.tenantId, 'dead-worker', 60);
  assert.ok(first);
  await db.query(
    `update task_runs set lease_expires_at = now() - interval '1 minute'
      where id = $1`,
    [task.id],
  );
  const second = await repository.claimNext(task.tenantId, 'recovery-worker', 60);
  assert.ok(second);
  assert.equal(second.task.id, task.id);
  assert.equal(second.attempt.attemptNo, 2);
  const attempts = await db.query<{ status: string; attempt_no: number }>(
    'select status, attempt_no from task_attempts where task_run_id = $1 order by attempt_no',
    [task.id],
  );
  assert.deepEqual(attempts.rows.map((row) => [row.attempt_no, row.status]), [[1, 'EXPIRED'], [2, 'RUNNING']]);
});

test('任务详情包含尝试、事件、资源引用，监控探测单独分页', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-detail',
    taskType: 'MONITORING_BATCH',
    requestedBy: 'user-detail',
    triggerSource: 'scheduler',
    resourceRefs: [{ resourceType: 'monitorTarget', resourceId: 'monitor-1' }],
  });
  await db.query(
    `insert into task_monitor_probes
      (id, task_run_id, tenant_id, monitor_target_id, service_asset_id, status, checked_at, summary, detail)
     values ('probe-1', $1, $2, 'monitor-1', 'asset-1', 'UP', now(), 'ok', '{"token":"hidden"}'::jsonb)`,
    [task.id, task.tenantId],
  );
  await appendEvent(db, task.id, 'LOG', { message: 'monitor log should not be returned' });
  const detail = await service.detail(task.tenantId, task.id);
  assert.equal(detail.task.id, task.id);
  assert.equal(detail.resourceRefs[0]?.resourceId, 'monitor-1');
  assert.equal(detail.events[0]?.eventType, 'CREATED');
  assert.equal(detail.events.some((event) => event.eventType === 'LOG'), false);
  assert.equal(JSON.stringify(detail.events).includes('hidden'), false);
  const probes = await service.listMonitoringProbes({ tenantId: task.tenantId, page: 1, pageSize: 20 });
  assert.equal(probes.total, 1);
  assert.equal(probes.items[0]?.detail.token, '[REDACTED]');
  const unrelatedProbes = await service.listMonitoringProbes({ tenantId: task.tenantId, taskRunId: 'task-other', page: 1, pageSize: 20 });
  assert.equal(unrelatedProbes.total, 0);
});

test('includeAll=true 时分类过滤仍然生效，避免监控任务挤掉执行任务列表', async () => {
  const { service } = await createFixture();
  await service.enqueue({
    tenantId: 'tenant-task-category',
    taskType: 'MONITORING_BATCH',
    requestedBy: 'user-monitor',
    triggerSource: 'scheduler',
  });
  const executionTask = await service.enqueue({
    tenantId: 'tenant-task-category',
    taskType: 'CERTIFICATE_DRY_RUN',
    requestedBy: 'user-execution',
    triggerSource: 'deployment.dry-run',
  });

  const page = await service.list({
    tenantId: 'tenant-task-category',
    category: 'EXECUTION',
    includeAll: true,
    page: 1,
    pageSize: 20,
  });

  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, executionTask.id);
  assert.equal(page.items[0]?.category, 'EXECUTION');
});

test('实时首帧的最近完成任务排除监控任务并遵守发起人范围', async () => {
  const { db, repository, service } = await createFixture();
  const tenantId = 'tenant-task-recent';
  const monitoringTask = await service.enqueue({
    tenantId,
    taskType: 'MONITORING_BATCH',
    requestedBy: 'user-monitor',
    triggerSource: 'scheduler',
  });
  const executionTask = await service.enqueue({
    tenantId,
    taskType: 'CERTIFICATE_DRY_RUN',
    requestedBy: 'user-execution',
    triggerSource: 'deployment.dry-run',
  });
  const automationTask = await service.enqueue({
    tenantId,
    taskType: 'AUTOMATION_RUN',
    requestedBy: 'user-execution',
    triggerSource: 'automation.manual',
  });
  await db.query(
    `update task_runs set status = 'SUCCEEDED', finished_at = now()
      where id = any($1::text[])`,
    [[monitoringTask.id, executionTask.id, automationTask.id]],
  );

  const allRecent = await repository.listRecentTaskRuns(tenantId);
  assert.deepEqual(new Set(allRecent.map((task) => task.id)), new Set([executionTask.id, automationTask.id]));
  const userRecent = await repository.listRecentTaskRuns(tenantId, 'user-execution');
  assert.deepEqual(new Set(userRecent.map((task) => task.id)), new Set([executionTask.id, automationTask.id]));
});

test('执行器失败会按注册策略进入重试并最终失败', async () => {
  const { service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-retry',
    taskType: 'REPORT_EXPORT',
    triggerSource: 'test',
  });
  const first = await service.runNext('worker-retry', async () => ({ success: false, errorCode: 'TEMPORARY', errorMessage: 'temporary' }), task.tenantId);
  assert.equal(first?.status, 'RETRY_WAITING');
});

test('外部异步任务使用 defer 时不会伪造成功或提前进入终态', async () => {
  const { service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-defer',
    taskType: 'AGENT_UPDATE',
    triggerSource: 'test',
  });
  const first = await service.runNext(
    'worker-defer',
    async () => ({
      success: false,
      defer: true,
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
      errorCode: 'EXTERNAL_PENDING',
      errorMessage: '等待外部 Agent 回报',
    }),
    task.tenantId,
  );
  assert.equal(first?.status, 'RETRY_WAITING');
  assert.equal(Date.parse(first?.nextAttemptAt ?? ''), Date.parse('2099-01-01T00:00:00.000Z'));
  assert.equal(first?.finishedAt, undefined);
});

test('审批决定后会唤醒自动化任务并清除等待审批摘要', async () => {
  const { service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-approval',
    taskType: 'AUTOMATION_RUN',
    triggerSource: 'automation.manual',
    resourceSummary: {
      automationRunId: 'run-approval',
      approvalId: 'approval-1',
      approvalPending: true,
      approvalStatus: 'pending',
      status: 'waiting_approval',
    },
    resourceRefs: [{ resourceType: 'automationRun', resourceId: 'run-approval' }],
    payload: { runId: 'run-approval' },
  });
  await service.runNext(
    'worker-approval',
    async () => ({
      success: false,
      defer: true,
      retryAfterSeconds: 300,
      errorCode: 'AUTOMATION_RUN_PENDING',
      errorMessage: '等待审批',
    }),
    task.tenantId,
  );

  const woken = await service.resolveAutomationRunTask(task.tenantId, 'run-approval', {
    automationRunId: 'run-approval',
    approvalId: 'approval-1',
    approvalPending: false,
    approvalStatus: 'approved',
    status: 'queued',
  }, 'approved');

  assert.equal(woken?.status, 'QUEUED');
  assert.equal(woken?.nextAttemptAt, undefined);
  assert.equal(woken?.resourceSummary?.approvalPending, false);
  assert.equal(woken?.resourceSummary?.status, 'queued');
  assert.equal(woken?.progress?.approvalPending, false);
});

test('相对退避由数据库计算，避免应用与数据库时钟偏差导致立即重试', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-relative-backoff',
    taskType: 'REPORT_EXPORT',
    triggerSource: 'test',
  });
  const first = await service.runNext(
    'worker-relative-backoff',
    async () => ({
      success: false,
      defer: true,
      retryAfterSeconds: 30,
      errorCode: 'EXTERNAL_PENDING',
      errorMessage: '等待外部系统回报',
    }),
    task.tenantId,
  );
  assert.equal(first?.status, 'RETRY_WAITING');
  assert.ok(first?.nextAttemptAt);

  const nextAttempt = await db.query<{ next_attempt_at: string; database_now: string }>(
    `select next_attempt_at, now() as database_now
       from task_runs
      where id = $1`,
    [task.id],
  );
  assert.ok(nextAttempt.rows[0]);
  assert.ok(Date.parse(nextAttempt.rows[0].next_attempt_at) > Date.parse(nextAttempt.rows[0].database_now));
  assert.equal(await repository.claimNext(task.tenantId, 'worker-relative-backoff-2', 60), undefined);
});

test('父子任务不能跨租户，详情也不能越过租户边界', async () => {
  const { service } = await createFixture();
  const parent = await service.enqueue({
    tenantId: 'tenant-parent',
    taskType: 'WORKFLOW_RUN',
    triggerSource: 'test',
  });
  await assert.rejects(
    service.enqueue({
      tenantId: 'tenant-child',
      taskType: 'AUTOMATION_RUN',
      triggerSource: 'test',
      parentTaskId: parent.id,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_NOT_FOUND',
  );
  await assert.rejects(
    service.detail('tenant-other', parent.id),
    (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_NOT_FOUND',
  );
});

test('取消原因写入任务事件并保留操作者上下文', async () => {
  const { service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-cancel',
    taskType: 'REPORT_EXPORT',
    requestedBy: 'user-cancel',
    triggerSource: 'test',
  });
  await service.cancel(task.tenantId, task.id, 'admin-cancel', '用户请求停止');
  const detail = await service.detail(task.tenantId, task.id);
  const cancelEvent = detail.events.find((event) => event.eventType === 'CANCEL_REQUESTED');
  assert.equal(cancelEvent?.actorId, 'admin-cancel');
  assert.equal(cancelEvent?.eventData.reason, '用户请求停止');
});
