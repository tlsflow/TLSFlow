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

test('幂等记录迁移缺失时任务控制面在启动前失败', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    await db.exec('drop table idempotency_records');
    const service = new TasksApplicationService(new TaskRepository(db));

    await assert.rejects(
      service.initialize(),
      /idempotency_records.*20260823000000_unified_current_baseline\.sql/,
    );
    assert.equal(service.getLifecycle().status, 'FAILED');
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

test('持久化幂等记录支持完成任务重放、同键不同请求体冲突和并发收敛', async () => {
  const { db, service } = await createFixture();
  const input = {
    tenantId: 'tenant-task-idempotency',
    taskType: 'CERTIFICATE_DRY_RUN',
    requestedBy: 'user-idempotency',
    triggerSource: 'test',
    idempotencyKey: 'certificate-dry-run-idempotency',
    idempotencyScope: {
      actionType: 'certificate.dry-run',
      resourceType: 'deploymentPlan',
      resourceId: 'plan-idempotency',
    },
    payload: { deploymentPlanId: 'plan-idempotency', input: { dryRun: true } },
  } as const;
  const concurrent = await Promise.all([service.enqueue(input), service.enqueue(input)]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  await db.query(`update task_runs set status='SUCCEEDED', finished_at=now() where id=$1`, [concurrent[0].id]);
  const replay = await service.enqueue(input);
  assert.equal(replay.id, concurrent[0].id);
  assert.equal(replay.status, 'SUCCEEDED');
  const record = await db.query<{ request_hash: string; status_code: number; resource_id: string }>(
    `select request_hash, status_code, resource_id from idempotency_records
     where tenant_id=$1 and action_type=$2 and resource_type=$3 and resource_id=$4 and idempotency_key=$5`,
    [input.tenantId, input.idempotencyScope.actionType, input.idempotencyScope.resourceType, input.idempotencyScope.resourceId, input.idempotencyKey],
  );
  assert.equal(record.rows.length, 1);
  assert.equal(record.rows[0]?.status_code, 202);
  assert.equal(record.rows[0]?.resource_id, input.idempotencyScope.resourceId);
  await assert.rejects(
    () => service.enqueue({ ...input, payload: { ...input.payload, input: { dryRun: false } } }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'IDEMPOTENCY_CONFLICT',
  );
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

test('执行运行终态失败会直接结束统一任务，不再次领取已结束 Run', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-terminal-execution-failure',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
  });
  const first = await service.runNext(
    'worker-terminal-execution-failure',
    async () => ({
      success: false,
      retryable: false,
      errorCode: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      errorMessage: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
    }),
    task.tenantId,
  );

  assert.equal(first?.status, 'FAILED');
  assert.equal(first?.lastErrorCode, 'TLS_VERIFY_FINGERPRINT_MISMATCH');
  assert.equal(await repository.claimNext(task.tenantId, 'worker-must-not-retry-terminal-run', 60), undefined);
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

test('defer 失败不能绕过任务定义的最大尝试次数', async () => {
  const { service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-defer-limit',
    taskType: 'REPORT_EXPORT',
    triggerSource: 'test',
  });
  const execute = async () => ({
    success: false,
    defer: true,
    retryAfterSeconds: 0,
    errorCode: 'TEMPORARY',
    errorMessage: '临时失败',
  });

  const first = await service.runNext('worker-defer-limit', execute, task.tenantId);
  const second = await service.runNext('worker-defer-limit', execute, task.tenantId);
  const third = await service.runNext('worker-defer-limit', execute, task.tenantId);

  assert.equal(first?.status, 'RETRY_WAITING');
  assert.equal(second?.status, 'RETRY_WAITING');
  assert.equal(third?.status, 'FAILED');
  assert.equal(third?.lastErrorCode, 'TEMPORARY');
});

test('等待外部结果的任务可再次领取以主动读取控制面状态，不消耗失败重试', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-waiting-result',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
  });
  const waiting = await service.runNext(
    'worker-wait-result',
    async () => ({
      success: false,
      waitingStatus: 'WAITING_RESULT',
      nextAttemptAt: '2000-01-01T00:00:00.000Z',
      errorCode: 'EXECUTION_PENDING',
      errorMessage: '执行运行仍在等待外部结果',
    }),
    task.tenantId,
  );

  assert.equal(waiting?.status, 'WAITING_RESULT');
  assert.equal(waiting?.finishedAt, undefined);
  const detail = await service.detail(task.tenantId, task.id);
  assert.equal(detail.attempts[0]?.status, 'WAITING');
  assert.equal(detail.events.some((event) => event.eventType === 'WAITING_RESULT'), true);

  const polled = await repository.claimNext(task.tenantId, 'worker-poll-control-plane', 60);
  assert.equal(polled?.task.id, task.id);
  assert.equal(polled?.attempt.attemptNo, 2);
});

test('写入结果待确认的任务不能再次领取或自动重放', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-awaiting-confirmation',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
  });
  const waiting = await service.runNext(
    'worker-await-confirmation',
    async () => ({
      success: false,
      waitingStatus: 'AWAITING_CONFIRMATION',
      errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      errorMessage: 'Plugin Runner 返回结果不明',
    }),
    task.tenantId,
  );

  assert.equal(waiting?.status, 'AWAITING_CONFIRMATION');
  assert.equal(waiting?.nextAttemptAt, undefined);
  const detail = await service.detail(task.tenantId, task.id);
  assert.equal(detail.attempts[0]?.status, 'WAITING');
  assert.equal(detail.events.some((event) => event.eventType === 'AWAITING_CONFIRMATION'), true);
  assert.equal(await repository.claimNext(task.tenantId, 'worker-must-not-replay', 60), undefined);
});

test('证书未知写结果具备指纹核验材料时会提升为主动轮询任务', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-promote-recovery',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
    payload: { runId: 'run-promote-recovery' },
  });
  const waiting = await service.runNext(
    'worker-promote-initial',
    async () => ({
      success: false,
      waitingStatus: 'AWAITING_CONFIRMATION',
      errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      errorMessage: 'Plugin Runner 返回结果不明',
    }),
    task.tenantId,
  );
  assert.equal(waiting?.status, 'AWAITING_CONFIRMATION');

  await db.query(
    `insert into pg_documents (namespace, document_id, payload)
     values ('executions:steps', 'step-promote-recovery', $1::jsonb)`,
    [JSON.stringify({
      id: 'step-promote-recovery',
      executionRunId: 'run-promote-recovery',
      status: 'RUNNING',
      lastErrorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      inputSnapshot: {
        resultDetail: { executionStatus: 'UNKNOWN' },
        certificateVerification: {
          capabilityKey: 'certificate.verify',
          schemaVersion: '1.0',
        },
        deploymentArtifact: { expectedFingerprintSha256: 'a'.repeat(64) },
      },
    })],
  );

  assert.equal(await repository.promoteRecoverableExecutionTasks(task.tenantId), 1);
  const promoted = await repository.getById(task.tenantId, task.id);
  assert.equal(promoted?.status, 'WAITING_RESULT');
  assert.equal(promoted?.progress?.automaticRecovery, true);
  assert.equal((await service.detail(task.tenantId, task.id)).events.some((event) => event.eventType === 'WAITING_RESULT'), true);
  assert.equal((await repository.claimNext(task.tenantId, 'worker-promote-recovery', 60))?.task.id, task.id);
});

test('旧 RETRY_WAITING 未知写结果没有核验材料时会转为人工确认', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-promote-confirmation',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
    payload: { runId: 'run-promote-confirmation' },
  });
  const retried = await service.runNext(
    'worker-promote-confirmation-initial',
    async () => ({ success: false, errorCode: 'EXECUTION_PENDING', errorMessage: '执行结果待确认' }),
    task.tenantId,
  );
  assert.equal(retried?.status, 'RETRY_WAITING');

  await db.query(
    `insert into pg_documents (namespace, document_id, payload)
     values ('executions:steps', 'step-promote-confirmation', $1::jsonb)`,
    [JSON.stringify({
      id: 'step-promote-confirmation',
      executionRunId: 'run-promote-confirmation',
      status: 'RUNNING',
      lastErrorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      inputSnapshot: { resultDetail: { executionStatus: 'UNKNOWN' } },
    })],
  );

  assert.equal(await repository.promoteRecoverableExecutionTasks(task.tenantId), 1);
  const promoted = await repository.getById(task.tenantId, task.id);
  assert.equal(promoted?.status, 'AWAITING_CONFIRMATION');
  assert.equal(promoted?.progress?.automaticRecovery, false);
  assert.equal(await repository.claimNext(task.tenantId, 'worker-must-not-replay-unknown', 60), undefined);
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

test('强制结束会清理运行租约并吞掉旧 Worker 的完成回写', async () => {
  const { repository, service } = await createFixture();
  const cancelledRuns: string[] = [];
  service.setExecutionCancellationHandler({
    cancelRun: async (runId, actorId, tenantId) => {
      cancelledRuns.push(`${runId}:${actorId}:${tenantId}`);
    },
  });
  const task = await service.enqueue({
    tenantId: 'tenant-force-cancel',
    taskType: 'CERTIFICATE_DEPLOY',
    requestedBy: 'user-deploy',
    triggerSource: 'deployment.manual',
    payload: { runId: 'run-force-cancel' },
  });

  const finished = await service.runNext(
    'worker-force-cancel',
    async (claimedTask) => {
      await service.forceCancel(claimedTask.tenantId, claimedTask.id, 'admin-force', '远端动作已失去控制');
      return { success: true, detail: { stale: true } };
    },
    task.tenantId,
  );

  assert.equal(finished?.status, 'CANCELLED');
  const detail = await service.detail(task.tenantId, task.id);
  assert.equal(detail.task.lastErrorCode, 'TASK_FORCE_CANCELLED');
  assert.equal(detail.attempts[0]?.status, 'CANCELLED');
  assert.equal(detail.attempts[0]?.finishedAt !== undefined, true);
  assert.equal(detail.events.some((event) => event.eventType === 'CANCELLED' && event.eventData.force === true), true);
  const persisted = await repository.getById(task.tenantId, task.id);
  assert.equal(persisted?.leaseOwner, undefined);
  assert.equal(persisted?.leaseExpiresAt, undefined);
  assert.deepEqual(cancelledRuns, ['run-force-cancel:admin-force:tenant-force-cancel']);
});

test('强制结束 Agent 升级任务会同步通知升级计划进入人工处置', async () => {
  const { service } = await createFixture();
  const cancellations: string[] = [];
  service.setAgentUpgradeCancellationHandler({
    cancelUpgrade: async (tenantId, agentId, planId, actorId, reason) => {
      cancellations.push(`${tenantId}:${agentId}:${planId}:${actorId}:${reason}`);
    },
  });
  const task = await service.enqueue({
    tenantId: 'tenant-agent-upgrade-cancel',
    taskType: 'AGENT_UPDATE',
    requestedBy: 'user-upgrade',
    triggerSource: 'agent-upgrade-confirmed',
    payload: { agentId: 'agent-cancel', planId: 'plan-cancel' },
  });

  const finished = await service.forceCancel(task.tenantId, task.id, 'admin-force', '远端升级结果无法确认');

  assert.equal(finished.status, 'CANCELLED');
  assert.deepEqual(cancellations, [
    'tenant-agent-upgrade-cancel:agent-cancel:plan-cancel:admin-force:远端升级结果无法确认',
  ]);
});

test('部署审批占位任务只在审批决策后收敛，不会被 Worker 抢占', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-deployment-approval',
    taskType: 'DEPLOYMENT_APPROVAL',
    requestedBy: 'user-deploy',
    triggerSource: 'deployment.approval.requested',
    initialStatus: 'RETRY_WAITING',
    availableAt: '2099-01-01T00:00:00.000Z',
    resourceSummary: {
      displayName: 'example.com 证书部署',
      deploymentPlanId: 'plan-approval',
      approvalId: 'approval-1',
      approvalPending: true,
      approvalStatus: 'pending',
      status: 'waiting_approval',
    },
    initialProgress: { approvalPending: true, approvalStatus: 'pending', status: 'waiting_approval', approvalId: 'approval-1' },
    resourceRefs: [{ resourceType: 'deploymentPlan', resourceId: 'plan-approval' }],
  });

  assert.equal(await repository.claimNext(task.tenantId, 'worker-approval-placeholder', 60), undefined);
  const executionTask = await service.enqueue({
    tenantId: task.tenantId,
    taskType: 'CERTIFICATE_DEPLOY',
    requestedBy: 'user-deploy',
    triggerSource: 'execution.apply.enqueue',
    resourceSummary: { displayName: 'example.com 证书部署', deploymentPlanId: 'plan-approval', executionType: 'apply' },
    payload: { deploymentPlanId: 'plan-approval', executionType: 'apply', runId: 'run-approval' },
    resourceRefs: [{ resourceType: 'deploymentPlan', resourceId: 'plan-approval' }],
  });
  const resolved = await service.resolveApprovalTask(task.tenantId, 'deploymentPlan', 'plan-approval', {
    approvalId: 'approval-1',
    approvalStatus: 'approved',
    status: 'approved',
  }, 'approved');

  assert.equal(resolved?.status, 'SUCCEEDED');
  assert.equal(resolved?.progress?.approvalPending, false);
  assert.equal(resolved?.progress?.approvalStatus, 'approved');
  assert.equal((await repository.getById(task.tenantId, executionTask.id))?.status, 'QUEUED');
});

test('带审批占位的证书任务不会被 Worker 领取', async () => {
  const { repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-approval-gate',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'certificate.deploy.requested',
    initialStatus: 'RETRY_WAITING',
    availableAt: '2000-01-01T00:00:00.000Z',
    resourceSummary: {
      approvalId: 'approval-cert-1',
      approvalPending: true,
      approvalStatus: 'pending',
      status: 'waiting_approval',
    },
    initialProgress: {
      approvalId: 'approval-cert-1',
      approvalPending: true,
      approvalStatus: 'pending',
      status: 'waiting_approval',
    },
  });

  assert.equal(await repository.claimNext(task.tenantId, 'worker-must-wait-approval', 60), undefined);
  assert.equal((await repository.getById(task.tenantId, task.id))?.status, 'RETRY_WAITING');
});

test('历史 WAITING_RESULT 缺少退避时间时会被补成延迟轮询', async () => {
  const { db, repository, service } = await createFixture();
  const task = await service.enqueue({
    tenantId: 'tenant-task-legacy-waiting',
    taskType: 'CERTIFICATE_DEPLOY',
    triggerSource: 'execution.apply.enqueue',
  });
  await db.query(`update task_runs set status = 'WAITING_RESULT', next_attempt_at = null where id = $1`, [task.id]);

  assert.equal(await repository.claimNext(task.tenantId, 'worker-legacy-waiting', 60), undefined);
  const repaired = await repository.getById(task.tenantId, task.id);
  assert.ok(repaired?.nextAttemptAt);
  assert.ok(Date.parse(repaired.nextAttemptAt) > Date.now() - 1000);
});
