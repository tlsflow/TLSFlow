import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDefinitions, TaskRegistry } from './task.registry.js';
import { TaskExecutorRegistry, TaskWorkerSupervisor } from './task-worker-supervisor.js';
import { createTaskExecutorRegistry } from './task-worker-adapters.js';
import type { TaskAttempt, TaskRun } from './task.types.js';

function task(taskType: string, payload: Record<string, unknown>): TaskRun {
  return {
    id: `task-${taskType}`,
    tenantId: 'tenant-task-adapter',
    taskType,
    definitionVersion: 1,
    category: 'SYSTEM',
    status: 'RUNNING',
    triggerSource: 'test',
    payload,
    availableAt: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
  };
}

const attempt: TaskAttempt = {
  id: 'attempt-1',
  taskRunId: 'task-1',
  attemptNo: 1,
  workerId: 'worker-1',
  leaseExpiresAt: '2026-08-06T00:10:00.000Z',
  status: 'RUNNING',
  startedAt: '2026-08-06T00:00:00.000Z',
};

test('统一任务适配器覆盖所有默认注册类型，未接入类型也有明确失败执行器', () => {
  const registry = createTaskExecutorRegistry({}, defaultDefinitions.map((definition) => definition.executorKey));
  const keys = new Set(registry.keys());
  for (const definition of defaultDefinitions) assert.equal(keys.has(definition.executorKey), true, definition.executorKey);
});

test('宿主 ACME 签发和续签执行器恢复，独立 Challenge 与 Provider 执行器保持退役', () => {
  const registry = createTaskExecutorRegistry({
    acme: {
      runJob: async () => undefined,
    } as never,
  });
  for (const executorKey of ['acme.challenge', 'provider.operation']) {
    assert.equal(registry.has(executorKey), false, executorKey);
    assert.throws(() => registry.get(executorKey), /任务执行器未注册/);
  }
  assert.equal(registry.has('acme.issue'), true);
  assert.equal(registry.has('acme.renewal'), true);
});

test('Internal CA 统一签发任务按申请状态签发、轮询并收敛终态', async () => {
  const calls: string[] = [];
  const request = (status: string) => ({ id: 'request-1', status, providerRequestId: status === 'issuing' ? 'provider-request-1' : undefined });
  const registry = createTaskExecutorRegistry({
    internalCa: {
      listRequests: async () => [request('approved')],
      issueRequest: async () => { calls.push('issue'); return { ...request('approved'), status: 'issued', certificateVersionId: 'version-1' }; },
      refreshRequestIssuance: async () => { calls.push('refresh'); return { ...request('issuing'), status: 'issued', certificateVersionId: 'version-1' }; },
    } as never,
  });
  const issued = await registry.get('certificate.issue')(task('CERTIFICATE_ISSUE', { certificateRequestId: 'request-1' }), attempt);
  assert.equal(issued.success, true);
  assert.deepEqual(calls, ['issue']);

  const pollingRegistry = createTaskExecutorRegistry({
    internalCa: {
      listRequests: async () => [request('issuing')],
      issueRequest: async () => { throw new Error('issuing 状态不得重复提交'); },
      refreshRequestIssuance: async () => ({ ...request('issuing'), status: 'issuing', providerRequestId: 'provider-request-1' }),
    } as never,
  });
  const waiting = await pollingRegistry.get('certificate.issue')(task('CERTIFICATE_ISSUE', { certificateRequestId: 'request-1' }), attempt);
  assert.equal(waiting.waitingStatus, 'WAITING_RESULT');
  assert.equal(waiting.retryAfterSeconds, 10);
});

test('Internal CA 统一签发任务支持显式重试失败申请，并保持已签发申请幂等成功', async () => {
  let retryCalls = 0;
  const failedRegistry = createTaskExecutorRegistry({
    internalCa: {
      listRequests: async () => [{ id: 'request-failed', status: 'issue_failed', failureCode: 'CA_DOWN', failureMessage: 'CA 不可用' }],
      issueRequest: async () => { retryCalls += 1; return { id: 'request-failed', status: 'issue_failed', failureCode: 'CA_DOWN', failureMessage: 'CA 仍不可用' }; },
      refreshRequestIssuance: async () => { throw new Error('失败申请不应查询'); },
    } as never,
  });
  const failed = await failedRegistry.get('certificate.issue')(task('CERTIFICATE_ISSUE', { certificateRequestId: 'request-failed' }), attempt);
  assert.equal(failed.success, false);
  assert.equal(failed.retryable, false);
  assert.equal(failed.errorCode, 'CA_DOWN');
  assert.equal(retryCalls, 1);

  const issuedRegistry = createTaskExecutorRegistry({
    internalCa: {
      listRequests: async () => [{ id: 'request-issued', status: 'issued', certificateVersionId: 'version-1' }],
      issueRequest: async () => { throw new Error('已签发申请不得重复签发'); },
      refreshRequestIssuance: async () => { throw new Error('已签发申请不得查询'); },
    } as never,
  });
  const issued = await issuedRegistry.get('certificate.issue')(task('CERTIFICATE_ISSUE', { certificateRequestId: 'request-issued' }), attempt);
  assert.equal(issued.success, true);
  assert.equal((issued.detail as { certificateVersionId?: string }).certificateVersionId, 'version-1');
});

test('专属证书申请父任务在签发成功后创建标准部署任务', async () => {
  let plans = 0;
  let parentTaskId: string | undefined;
  const registry = createTaskExecutorRegistry({
    applicationCertificateSupply: {
      createDedicatedDeploymentPlan: async (input: { parentTaskId?: string }) => { plans += 1; parentTaskId = input.parentTaskId; return { planId: 'plan-1', jobId: 'child-deploy-1' }; },
    } as never,
    taskControl: {
      detail: async (_tenantId: string, _taskId: string) => ({ task: task('CERTIFICATE_DEPLOY', { applicationAssetId: 'app-1' }), attempts: [], events: [], childTasks: [], resourceRefs: [], auditEvents: [] }),
      list: async () => ({ items: [{ taskType: 'CERTIFICATE_ISSUE', status: 'SUCCEEDED', progress: { certificateVersionId: 'version-fixed' } }] }),
    } as never,
  });
  const result = await registry.get('application.certificate-supply')(task('APPLICATION_CERTIFICATE_SUPPLY', { applicationAssetId: 'app-1', certificateRequestId: 'request-1' }), attempt);
  assert.equal(result.waitingStatus, 'WAITING_RESULT');
  assert.equal(plans, 1);
  assert.equal(parentTaskId, 'task-APPLICATION_CERTIFICATE_SUPPLY');
  assert.equal((result.detail as { certificateVersionId?: string }).certificateVersionId, 'version-fixed');
});

test('专属证书父任务已有部署子任务但尚未回写进度时不会再次创建部署链路', async () => {
  let plans = 0;
  const parent = task('APPLICATION_CERTIFICATE_SUPPLY', { applicationAssetId: 'app-1', certificateRequestId: 'request-1', certificateVersionId: 'version-fixed' });
  const child = { ...task('CERTIFICATE_DEPLOY', { applicationAssetId: 'app-1' }), id: 'child-deploy-1', parentTaskId: parent.id, status: 'RUNNING' as const };
  const registry = createTaskExecutorRegistry({
    applicationCertificateSupply: {
      createDedicatedDeploymentPlan: async () => { plans += 1; return { planId: 'plan-unexpected', jobId: 'child-unexpected' }; },
    } as never,
    taskControl: {
      detail: async (_tenantId: string, taskId: string) => taskId === parent.id
        ? { task: parent, attempts: [], events: [], childTasks: [child], resourceRefs: [], auditEvents: [] }
        : { task: child, attempts: [], events: [], childTasks: [], resourceRefs: [], auditEvents: [] },
      list: async () => { throw new Error('已有部署子任务时不应再次查询签发任务'); },
    } as never,
  });

  const result = await registry.get('application.certificate-supply')(parent, attempt);

  assert.equal(result.success, false);
  assert.equal(result.waitingStatus, 'WAITING_RESULT');
  assert.equal(result.errorCode, 'CERTIFICATE_DEPLOY_PENDING');
  assert.equal((result.detail as { deploymentTaskId?: string }).deploymentTaskId, child.id);
  assert.equal(plans, 0);
});

test('专属证书签发任务未完成时继续等待，不创建部署任务', async () => {
  let plans = 0;
  const registry = createTaskExecutorRegistry({
    applicationCertificateSupply: {
      createDedicatedDeploymentPlan: async () => { plans += 1; return { planId: 'plan-unexpected', jobId: 'job-unexpected' }; },
    } as never,
    taskControl: {
      detail: async (_tenantId: string, _taskId: string) => ({ task: task('CERTIFICATE_DEPLOY', { applicationAssetId: 'app-1' }), attempts: [], events: [], childTasks: [], resourceRefs: [], auditEvents: [] }),
      list: async () => ({ items: [{ taskType: 'CERTIFICATE_ISSUE', status: 'RUNNING' }] }),
    } as never,
  });
  const result = await registry.get('application.certificate-supply')(task('APPLICATION_CERTIFICATE_SUPPLY', { applicationAssetId: 'app-1', certificateRequestId: 'request-1' }), attempt);
  assert.equal(result.success, false);
  assert.equal(result.waitingStatus, 'WAITING_RESULT');
  assert.equal(result.errorCode, 'CERTIFICATE_ISSUE_PENDING');
  assert.equal(plans, 0);
});

test('专属证书签发失败时终止部署父任务，不创建部署子任务', async () => {
  let plans = 0;
  const registry = createTaskExecutorRegistry({
    applicationCertificateSupply: {
      createDedicatedDeploymentPlan: async () => { plans += 1; return { planId: 'plan-unexpected', jobId: 'job-unexpected' }; },
    } as never,
    taskControl: {
      detail: async (_tenantId: string, _taskId: string) => ({ task: task('CERTIFICATE_DEPLOY', { applicationAssetId: 'app-1' }), attempts: [], events: [], childTasks: [], resourceRefs: [], auditEvents: [] }),
      list: async () => ({ items: [{ taskType: 'CERTIFICATE_ISSUE', status: 'FAILED', lastErrorCode: 'CERTIFICATE_ISSUE_FAILED', lastErrorMessage: '专属证书签发失败' }] }),
    } as never,
  });
  const result = await registry.get('application.certificate-supply')(task('APPLICATION_CERTIFICATE_SUPPLY', { applicationAssetId: 'app-1', certificateRequestId: 'request-1' }), attempt);
  assert.equal(result.success, false);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, 'CERTIFICATE_ISSUE_FAILED');
  assert.equal(plans, 0);
});

test('ACME 旧代次统一任务不会在人工重试后再次执行 RenewalJob', async () => {
  let runCalls = 0;
  const registry = createTaskExecutorRegistry({
    acme: {
      runJob: async () => {
        runCalls += 1;
        return undefined;
      },
    },
    acmeJobs: {
      getRenewalJob: async () => ({ taskGeneration: 2 }),
    } as never,
  });

  const result = await registry.get('acme.renewal')(
    task('ACME_CERTIFICATE_RENEWAL', { renewalJobId: 'job-1', taskGeneration: 1 }),
    attempt,
  );

  assert.equal(result.success, true);
  assert.equal((result.detail as { staleTaskGeneration?: boolean }).staleTaskGeneration, true);
  assert.equal(runCalls, 0);
});

test('执行任务遇到异步步骤时等待控制面结果，不进入重试队列', async () => {
  const registry = createTaskExecutorRegistry({
    executions: {
      runDispatchedExecution: async () => ({ success: true, pending: true }),
    },
  });
  const result = await registry.get('certificate.deploy')(
    task('CERTIFICATE_DEPLOY', { runId: 'execution-run-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.waitingStatus, 'WAITING_RESULT');
  assert.equal(result.defer, undefined);
  assert.equal(result.retryAfterSeconds, 10);
  assert.equal(result.errorCode, 'EXECUTION_PENDING');
});

test('Agent 更新任务持续读取 UpgradePlan，成功和失败都收敛为明确结果', async () => {
  const waitingRegistry = createTaskExecutorRegistry({
    agents: {
      getUpgradeStatus: async () => ({ status: 'accepted', reason: '等待本地执行', result: {} }),
    } as never,
  });
  const waiting = await waitingRegistry.get('agent.update')(
    task('AGENT_UPDATE', { agentId: 'agent-1', planId: 'plan-1', currentVersion: '0.1.32', targetVersion: '0.1.33' }),
    attempt,
  );
  assert.equal(waiting.success, false);
  assert.equal(waiting.waitingStatus, 'WAITING_RESULT');
  assert.equal((waiting.detail as { phase?: string }).phase, 'accepted');
  assert.equal((waiting.detail as { summaryCode?: string }).summaryCode, 'accepted');

  const successRegistry = createTaskExecutorRegistry({
    agents: {
      getUpgradeStatus: async () => ({ status: 'succeeded', reason: '完成', result: { receipt: { phase: 'succeeded' } } }),
    } as never,
  });
  const succeeded = await successRegistry.get('agent.update')(
    task('AGENT_UPDATE', { agentId: 'agent-1', planId: 'plan-1', currentVersion: '0.1.32', targetVersion: '0.1.33' }),
    attempt,
  );
  assert.equal(succeeded.success, true);
  assert.equal((succeeded.detail as { phase?: string }).phase, 'succeeded');

  const failedRegistry = createTaskExecutorRegistry({
    agents: {
      getUpgradeStatus: async () => ({ status: 'failed', reason: '制品校验失败', result: { receipt: { errorCode: 'AGENT_UPGRADE_ARTIFACT_INVALID' } } }),
    } as never,
  });
  const failed = await failedRegistry.get('agent.update')(
    task('AGENT_UPDATE', { agentId: 'agent-1', planId: 'plan-1', currentVersion: '0.1.32', targetVersion: '0.1.33' }),
    attempt,
  );
  assert.equal(failed.success, false);
  assert.equal(failed.retryable, false);
  assert.equal(failed.errorCode, 'AGENT_UPGRADE_ARTIFACT_INVALID');

  const unknownRegistry = createTaskExecutorRegistry({
    agents: {
      getUpgradeStatus: async () => ({ status: 'unknown', reason: '本地结果无法确认', result: { receipt: { phase: 'unknown', errorCode: 'AGENT_UPGRADE_RESULT_UNKNOWN' } } }),
    } as never,
  });
  const unknown = await unknownRegistry.get('agent.update')(
    task('AGENT_UPDATE', { agentId: 'agent-1', planId: 'plan-1', currentVersion: '0.1.32', targetVersion: '0.1.33' }),
    attempt,
  );
  assert.equal(unknown.success, false);
  assert.equal(unknown.retryable, false);
  assert.equal(unknown.errorCode, 'AGENT_UPGRADE_RESULT_UNKNOWN');
});

test('执行任务写入结果不明时冻结待确认，不允许自动重放', async () => {
  const registry = createTaskExecutorRegistry({
    executions: {
      runDispatchedExecution: async () => ({
        success: true,
        pending: true,
        pendingState: 'AWAITING_CONFIRMATION',
        errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
        errorMessage: 'Plugin Runner 返回结果不明',
      }),
    },
  });
  const result = await registry.get('certificate.deploy')(
    task('CERTIFICATE_DEPLOY', { runId: 'execution-run-unknown' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.waitingStatus, 'AWAITING_CONFIRMATION');
  assert.equal(result.retryAfterSeconds, undefined);
  assert.equal(result.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(result.errorMessage, 'Plugin Runner 返回结果不明');
});

test('执行运行进入终态失败后不再由统一任务层重试', async () => {
  const registry = createTaskExecutorRegistry({
    executions: {
      runDispatchedExecution: async () => ({
        success: false,
        errorCode: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
        errorMessage: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
      }),
    },
  });
  const result = await registry.get('certificate.deploy')(
    task('CERTIFICATE_DEPLOY', { runId: 'execution-run-failed' }),
    attempt,
  );

  assert.equal(result.success, false);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, 'TLS_VERIFY_FINGERPRINT_MISMATCH');
});

test('自动化运行等待审批时使用相对退避，不生成应用侧绝对时间', async () => {
  const registry = createTaskExecutorRegistry({
    automation: {
      runRun: async () => false,
    } as never,
    automationRuns: {
      getRun: async () => ({
        id: 'automation-run-1',
        tenantId: 'tenant-task-adapter',
        automationId: 'automation-1',
        automationNameSnapshot: '审批自动化',
        triggerType: 'manual',
        status: 'waiting_approval',
        approvalId: 'approval-1',
        targetSummary: {
          total: 1,
          pending: 1,
          running: 0,
          waitingApproval: 1,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
      }),
      listRunTargets: async () => [],
      listRunActionResults: async () => [],
    } as never,
  });
  const result = await registry.get('automation.run')(
    task('AUTOMATION_RUN', { runId: 'automation-run-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.retryAfterSeconds, 5);
  assert.equal(result.nextAttemptAt, undefined);
  assert.equal(result.errorCode, 'AUTOMATION_RUN_LEASE_UNAVAILABLE');
});

test('自动化运行已进入部分成功终态时直接收敛，不再次进入统一任务重试', async () => {
  let coordinatorCalls = 0;
  const registry = createTaskExecutorRegistry({
    automation: {
      runRun: async () => {
        coordinatorCalls += 1;
        return true;
      },
    } as never,
    automationRuns: {
      getRun: async () => ({
        id: 'automation-run-partial',
        tenantId: 'tenant-task-adapter',
        automationId: 'automation-1',
        automationNameSnapshot: '部分成功自动化',
        triggerType: 'on_demand',
        status: 'partially_succeeded',
        targetSummary: {
          total: 5,
          pending: 0,
          running: 0,
          waitingApproval: 0,
          succeeded: 4,
          failed: 1,
          skipped: 0,
          cancelled: 0,
        },
      }),
      listRunTargets: async () => [],
      listRunActionResults: async () => [],
    } as never,
  });

  const result = await registry.get('automation.run')(
    task('AUTOMATION_RUN', { runId: 'automation-run-partial' }),
    attempt,
  );

  assert.equal(result.success, true);
  assert.equal(result.retryable, undefined);
  assert.equal(coordinatorCalls, 1);
  assert.equal((result.detail as { succeededTargets?: number }).succeededTargets, 4);
  assert.equal((result.detail as { failedTargets?: number }).failedTargets, 1);
});

test('Supervisor 只执行当前 Claim 的任务并返回执行器结果', async () => {
  const taskRun = task('WORKFLOW_RUN', { workflowRunId: 'workflow-1' });
  const registry = new TaskExecutorRegistry()
    .register('workflow.run', async () => ({ success: true, detail: { executed: true } }));
  const definition = {
    id: 'definition-workflow',
    taskType: 'WORKFLOW_RUN',
    version: 1,
    category: 'SYSTEM' as const,
    displayKey: 'tasks.types.workflowRun',
    executorKey: 'workflow.run',
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    permissionKey: 'workflow.read',
    sensitivePaths: [],
    enabled: true,
  };
  let executed = 0;
  const supervisor = new TaskWorkerSupervisor(
    {
      registry: new TaskRegistry([definition]),
      runNext: async (_workerId, executor) => {
        executed += 1;
        await executor(taskRun, attempt);
        return taskRun;
      },
    },
    registry,
    { workerId: 'worker-supervisor', maxTasksPerTick: 1 },
  );
  assert.equal(await supervisor.runOnce(), 1);
  assert.equal(executed, 1);
});
