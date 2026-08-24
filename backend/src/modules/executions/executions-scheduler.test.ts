// @ts-nocheck
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import { ExecutionDetailStreamService } from './application/execution-detail-stream.service.js';
import { ExecutionResultSyncService } from './application/execution-result-sync.service.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './application/executors.js';
import { createDefaultExecutorRegistry, ExecutorRegistry, GatewayRouteExecutorAdapter, WorkflowExecutorAdapter } from './application/executors.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';

function createService() {
  return new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    stageIntervalMs: 0,
  });
}

async function createRun(service: ExecutionsApplicationService, input: {
  idempotencyKey: string;
  targetIds?: string[];
  concurrencyLimit?: number;
  stepMaxAttempts?: number;
  failurePolicy?: 'stop' | 'continue' | 'rollback';
  retry?: { maxAttempts: number; backoffSeconds: number };
  executorType?: string;
  allowMockExecutor?: boolean;
  mockResults?: Map<string, 'success' | 'fail'>;
  agentPayloads?: Map<string, Record<string, unknown>>;
  gatewayRoutes?: Map<string, Record<string, unknown>>;
  type?: 'apply' | 'dry_run';
}) {
  const targetIds = input.targetIds ?? ['target_a', 'target_b'];
  return service.createApplyRun({
    deploymentPlanId: 'plan_1',
    deploymentPlanTargetIds: targetIds,
    type: input.type ?? 'apply',
    idempotencyKey: input.idempotencyKey,
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map(targetIds.map((targetId) => [targetId, input.executorType ?? 'AGENT'] as const)),
    mockResultByTargetId: input.mockResults,
    concurrencyLimit: input.concurrencyLimit,
    stepMaxAttempts: input.stepMaxAttempts,
    failurePolicy: input.failurePolicy,
    retry: input.retry,
    allowMockExecutor: input.allowMockExecutor,
    agentPayloadByTargetId: input.agentPayloads,
    gatewayRouteByTargetId: input.gatewayRoutes,
  });
}

class TrackingExecutor implements Executor {
  readonly timeline: string[] = [];
  private runningCount = 0;
  maxRunningCount = 0;

  constructor(private readonly handler: (input: StepExecutionInput) => Promise<StepExecutionResult>, readonly type = 'AGENT') {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    this.runningCount += 1;
    this.maxRunningCount = Math.max(this.maxRunningCount, this.runningCount);
    this.timeline.push(`start:${input.step.name}`);
    try {
      const result = await this.handler(input);
      this.timeline.push(`end:${input.step.name}:${result.success ? 'success' : result.errorCode ?? 'failed'}`);
      return result;
    } finally {
      this.runningCount -= 1;
    }
  }
}

describe('ExecutionsApplicationService 调度与恢复', () => {
  it('执行器进度会先持久化到运行中步骤，再通过 SSE 逐次发布', async () => {
    const detailStream = new ExecutionDetailStreamService();
    const service = new ExecutionsApplicationService({
      deploymentPlansRepository: new DeploymentPlansRepository(),
      detailStream,
      stageIntervalMs: 0,
    });
    const created = await createRun(service, {
      idempotencyKey: 'idem_realtime_progress',
      targetIds: ['target_realtime'],
      concurrencyLimit: 1,
    });
    const stepEvents: Array<{ status: string; inputSnapshot: Record<string, unknown> }> = [];
    const unsubscribe = detailStream.subscribe(created.run.id, (event) => {
      if (event.type === 'step') {
        stepEvents.push({
          status: event.step.status,
          inputSnapshot: structuredClone(event.step.inputSnapshot),
        });
      }
    });
    let checkedPersistedProgress = false;
    const executor = new TrackingExecutor(async (input) => {
      if (!checkedPersistedProgress) {
        await input.reportProgress?.({
          workflowProgress: {
            status: 'running',
            totalSteps: 2,
            completedSteps: 0,
            steps: [
              { name: 'login', status: 'running' },
              { name: 'install', status: 'queued' },
            ],
          },
        });
        const persisted = await service.getStep(input.step.id, 'tenant_1');
        assert.equal(persisted.status, 'RUNNING');
        assert.equal(persisted.inputSnapshot.resultDetail.workflowProgress.steps[0].status, 'running');
        checkedPersistedProgress = true;
      }
      return { success: true, detail: { completed: true } };
    });

    try {
      const result = await service.runDispatchedExecution(
        created.run.id,
        'tester',
        'tenant_1',
        ExecutorRegistry.forTests([executor]),
      );
      assert.equal(result.success, true, JSON.stringify(result));
    } finally {
      unsubscribe();
    }

    assert.equal(checkedPersistedProgress, true);
    const progressEventIndex = stepEvents.findIndex((event) => {
      const resultDetail = event.inputSnapshot.resultDetail as Record<string, unknown> | undefined;
      return resultDetail?.workflowProgress !== undefined;
    });
    const successEventIndex = stepEvents.findIndex((event) => event.status === 'SUCCESS');
    assert.notEqual(progressEventIndex, -1);
    assert.notEqual(successEventIndex, -1);
    assert.equal(progressEventIndex < successEventIndex, true);
  });

  it('GatewayRouteExecutor 通过控制面主动直连下发路由任务', async () => {
    let capturedPayload: Record<string, unknown> | undefined;
    const agents = {
      enqueueDirectTask: async (_tenantId: string, input: { payload?: Record<string, unknown> }) => {
        capturedPayload = input.payload;
        return { id: 'agtask_gateway_direct', status: 'acked' };
      },
      executeTaskDirect: async () => ({ success: true, detail: { forwarded: true } }),
    } as unknown as AgentsApplicationService;
    const executor = new GatewayRouteExecutorAdapter({ agents });
    const result = await executor.executeStep({
      runType: 'apply',
      dryRun: false,
      step: {
        id: 'step_gateway_enqueue',
        tenantId: 'tenant_1',
        executionRunId: 'run_gateway_enqueue',
        deploymentPlanTargetId: 'target_gateway_enqueue',
        stepType: 'INSTALL',
        attemptCount: 0,
        inputSnapshot: {
          deploymentPlanId: 'plan_gateway_enqueue',
          gatewayRoute: {
            gatewayId: 'gw_exec_01',
            agentId: 'agt_gateway_exec_01',
            zoneId: 'zone_prod',
            adapter: 'forward.agent_task',
            delegatedTargetId: 'host_gateway_enqueue',
          },
        },
      } as any,
    });

    assert.equal(result.success, true);
    assert.equal(result.detail?.mode, 'gateway_route_direct_execute');
    assert.equal(capturedPayload?.type, 'gateway.forward.agent_task');
    const gatewayTask = capturedPayload?.gatewayTask as { delegatedTargetId: string; forwardingGrant?: { status: string; taskType: string } };
    assert.equal(gatewayTask.delegatedTargetId, 'host_gateway_enqueue');
    assert.equal(gatewayTask.forwardingGrant?.status, 'active');
    assert.equal(gatewayTask.forwardingGrant?.taskType, 'gateway.forward.agent_task');
  });

  it('Gateway Agent 提交转发结果后回写原 ExecutionStep', async () => {
    const repository = new ExecutionsRepository();
    const resultSync = new ExecutionResultSyncService(repository, {} as any, {} as any);
    const agents = new AgentsApplicationService(undefined, undefined, undefined, undefined, undefined, resultSync);
    const now = new Date().toISOString();
    const run = await repository.createRun({
      id: 'run_gateway_result_sync',
      tenantId: 'tenant_gateway_result_sync',
      deploymentPlanId: 'plan_gateway_result_sync',
      runNo: 1,
      type: 'apply',
      idempotencyKey: 'idem_gateway_result_sync',
      requestHash: 'hash_gateway_result_sync',
      status: 'RUNNING',
      concurrencyLimit: 1,
      summary: {},
      createdAt: now,
      updatedAt: now,
      createdBy: 'tester',
      version: 1,
    });
    const step = await repository.createStep({
      id: 'step_gateway_result_sync',
      tenantId: run.tenantId,
      executionRunId: run.id,
      deploymentPlanTargetId: 'target_gateway_result_sync',
      stepNo: 1,
      stepType: 'INSTALL',
      name: 'Gateway routed install',
      dependsOn: [],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: { executorType: 'GATEWAY_FORWARD' },
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      createdBy: 'tester',
      version: 1,
    });
    const gateway = await agents.register(run.tenantId, {
      agentKey: 'gateway.result.sync.01',
      hostname: 'gateway-result-sync-01',
      version: '1.0.0',
      osType: 'linux',
      role: 'gateway',
      zoneIds: ['zone_prod'],
      adapters: ['forward.agent_task'],
      capabilities: ['gateway.forward.agent_task'],
    }, 'req_gateway_result_sync_register');
    const task = await agents.enqueueTask(run.tenantId, {
      agentId: gateway.id,
      executionRunId: run.id,
      executionStepId: step.id,
      idempotencyKey: 'gateway-result-sync-task',
      payload: {
        type: 'gateway.forward.agent_task',
        gatewayTaskId: 'gateway_task_result_sync',
      },
    }, 'req_gateway_result_sync_enqueue');
    await agents.ackTask(run.tenantId, { agentId: gateway.id, taskId: task.id, leaseId: 'lease_gateway_result_sync' });
    await agents.submitResult(run.tenantId, {
      agentId: gateway.id,
      taskId: task.id,
      leaseId: 'lease_gateway_result_sync',
      success: true,
      detail: {
        mode: 'gateway_agent_process',
        gatewayTaskId: 'gateway_task_result_sync',
        delegatedTargetId: 'target_gateway_result_sync',
      },
    });

    const updatedStep = await repository.getStepOrThrow(step.id, run.tenantId);
    const updatedRun = await repository.getRunOrThrow(run.id, run.tenantId);
    assert.equal(updatedStep.status, 'SUCCESS');
    assert.equal(updatedRun.status, 'SUCCESS');
    assert.equal(updatedStep.inputSnapshot.resultDetail.gatewayTaskId, 'gateway_task_result_sync');
  });

  it('WORKFLOW 执行目标只生成一个 CUSTOM 步骤，dry-run 可预览，apply 失败关闭', async () => {
    const service = createService();
    const workflows = new WorkflowTemplatesApplicationService();
    const workflow = await workflows.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'workflow-shell-dry-run' },
        variables: { deviceHost: { type: 'string', required: true } },
        steps: [{ name: 'wait', type: 'wait', seconds: 1 }],
      },
    });
    await workflows.publishVersion(workflow.version.id);
    const targetId = 'target_workflow_shell';
    const created = await service.createApplyRun({
      deploymentPlanId: 'plan_workflow_shell',
      deploymentPlanTargetIds: [targetId],
      type: 'dry_run',
      idempotencyKey: 'idem_workflow_shell_dry_run',
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'WORKFLOW']]),
      agentPayloadByTargetId: new Map([[targetId, {
        workflowRequest: {
          workflowId: workflow.template.id,
          workflowVersionId: workflow.version.id,
          runner: 'CONTROL_PLANE',
          variableBindings: { deviceHost: 'workflow-shell.example.com' },
          credentialRefs: { ssh: 'secret://ssh/workflow' },
        },
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    const workflowStep = steps.find((step) => step.stepType === 'INSTALL')!;
    assert.equal(workflowStep.inputSnapshot.executorType, 'WORKFLOW');
    assert.equal(workflowStep.inputSnapshot.operation, 'install');

    const verifyExecutor = new TrackingExecutor(async () => ({ success: true }), 'CONTROL_PLANE_TLS');
    const dryRunResult = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', new ExecutorRegistry([new WorkflowExecutorAdapter({ workflows }), verifyExecutor]));
    assert.equal(dryRunResult.success, true);
    const dryRunStep = await service.getStep(workflowStep.id, 'tenant_1');
    assert.equal(dryRunStep.status, 'SUCCESS');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.mode, 'workflow_plan');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.workflowRequest.credentialRefs, '[REDACTED]');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunSummary.passed, 1);
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunChecks[0].key, 'workflow_step_1_wait');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunChecks[0].status, 'passed');

    const apply = await service.createApplyRun({
      deploymentPlanId: 'plan_workflow_shell',
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_workflow_shell_apply',
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'WORKFLOW']]),
      agentPayloadByTargetId: new Map([[targetId, {
        workflowRequest: {
          workflowId: 'wf_1',
          workflowVersionId: 'wfv_1',
          runner: 'CONTROL_PLANE',
        },
      }]]),
    });
    const applyResult = await service.runDispatchedExecution(apply.run.id, 'tester', 'tenant_1', createDefaultExecutorRegistry());
    assert.equal(applyResult.success, false);
    const applyStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: apply.run.id })).find((step) => step.stepType === 'INSTALL')!;
    assert.equal(applyStep.lastErrorCode, 'RESOURCE_NOT_FOUND');
  });

  it('WORKFLOW apply 通过工作流运行时分发 HTTP 和 SSH 子步骤', async () => {
    const workflows = new WorkflowTemplatesApplicationService();
    const created = await workflows.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'runtime-dispatch' },
        variables: {
          deviceHost: { type: 'string', required: true },
          credential: { type: 'credential', required: true },
        },
        steps: [
          {
            name: 'upload',
            type: 'http',
            request: {
              method: 'PUT',
              url: 'https://{{deviceHost}}/api/cert',
              auth: { type: 'bearer', credential: '{{credential}}' },
              body: { ok: true },
            },
            assert: [{ type: 'statusCode', equals: 200 }],
          },
          {
            name: 'reload',
            type: 'ssh',
            ssh: {
              mode: 'command',
              connection: {
                host: '{{deviceHost}}',
                username: 'deploy',
                credential: '{{credential}}',
                expectedHostKeyFingerprint: 'aabbccddeeff0011',
              },
              command: 'reload cert',
            },
            assert: [{ type: 'contains', value: 'ok' }],
          },
          {
            name: 'verifyHttp',
            type: 'http',
            request: {
              method: 'GET',
              url: 'https://{{deviceHost}}/api/cert/status',
              auth: { type: 'bearer', credential: '{{credential}}' },
            },
            assert: [{ type: 'statusCode', equals: 200 }],
          },
          {
            name: 'verifyReload',
            type: 'ssh',
            ssh: {
              mode: 'command',
              connection: {
                host: '{{deviceHost}}',
                username: 'deploy',
                credential: '{{credential}}',
                expectedHostKeyFingerprint: 'aabbccddeeff0011',
              },
              command: 'verify reload',
            },
            assert: [{ type: 'contains', value: 'ok' }],
          },
        ],
      },
    });
    await workflows.publishVersion(created.version.id);
    const calls: string[] = [];
    const curlIdempotencyKeys: string[] = [];
    const sshIdempotencyKeys: string[] = [];
    const adapter = new WorkflowExecutorAdapter({
      workflows,
      curlExecutor: {
        type: 'CURL',
        async executeStep(input: StepExecutionInput) {
          calls.push(`curl:${input.step.inputSnapshot.curlRequest.template.method}`);
          curlIdempotencyKeys.push(input.step.inputSnapshot.curlRequest.idempotencyKey);
          return { success: true, detail: { response: { statusCode: 200, headers: {}, bodyJson: { success: true }, bodyText: '{"success":true}' }, logs: ['curl:ok'] } };
        },
      },
      sshExecutor: {
        type: 'SSH',
        async executeStep(input: StepExecutionInput) {
          calls.push(`ssh:${input.step.inputSnapshot.sshRequest.command}`);
          sshIdempotencyKeys.push(input.step.inputSnapshot.sshRequest.idempotencyKey);
          return { success: true, detail: { commandResult: { exitCode: 0, stdout: 'reload ok', stderr: '', logs: ['ssh:ok'] } } };
        },
      },
    });

    const result = await adapter.executeStep({
      dryRun: false,
      runType: 'apply',
      step: {
        id: 'stp_workflow_runtime',
        tenantId: 'tenant_1',
        executionRunId: 'run_workflow_runtime',
        deploymentPlanTargetId: 'target_workflow_runtime',
        stepNo: 1,
        stepType: 'CUSTOM',
        name: 'workflow runtime',
        attemptCount: 0,
        maxAttempts: 1,
        inputSnapshot: {
          workflowRequest: {
            workflowId: created.template.id,
            workflowVersionId: created.version.id,
            runner: 'CONTROL_PLANE',
            variableBindings: {
              deviceHost: 'edge-runtime.example.com',
              credential: { id: 'cred_runtime', kind: 'username_password', type: 'password', username: 'deploy' },
            },
          },
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(calls, ['curl:PUT', 'ssh:reload cert', 'curl:GET', 'ssh:verify reload']);
    assert.equal(curlIdempotencyKeys.length, 2);
    assert.notEqual(curlIdempotencyKeys[0], curlIdempotencyKeys[1]);
    assert.match(curlIdempotencyKeys[0]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-curl:upload:1$/);
    assert.match(curlIdempotencyKeys[1]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-curl:verifyHttp:1$/);
    assert.equal(sshIdempotencyKeys.length, 2);
    assert.notEqual(sshIdempotencyKeys[0], sshIdempotencyKeys[1]);
    assert.match(sshIdempotencyKeys[0]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-ssh:reload:1$/);
    assert.match(sshIdempotencyKeys[1]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-ssh:verifyReload:1$/);
    assert.equal(result.detail.workflowRun.status, 'success');
  });

  it('按 dependsOn 形成 DAG 调度，不满足依赖的步骤不会先跑', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_dag', targetIds: ['target_a', 'target_b'], concurrencyLimit: 2 });
    const steps = service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }).sort((left, right) => left.stepNo - right.stepNo);

    const stepByName = new Map(steps.map((step) => [step.name, step] as const));
    service.updateStepForTest(stepByName.get('BACKUP target_b')!.id, { dependsOn: [stepByName.get('VERIFY target_a')!.stepNo] }, 'tenant_1');
    service.updateStepForTest(stepByName.get('INSTALL target_b')!.id, { dependsOn: [stepByName.get('BACKUP target_b')!.stepNo] }, 'tenant_1');
    service.updateStepForTest(stepByName.get('RELOAD target_b')!.id, { dependsOn: [stepByName.get('INSTALL target_b')!.stepNo] }, 'tenant_1');
    service.updateStepForTest(stepByName.get('VERIFY target_b')!.id, { dependsOn: [stepByName.get('RELOAD target_b')!.stepNo] }, 'tenant_1');

    const executor = new TrackingExecutor(async () => ({ success: true }));
    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([executor]));

    assert.equal(result.success, true);
    const startEvents = executor.timeline.filter((item) => item.startsWith('start:'));
    const indexOf = (name: string) => startEvents.indexOf(`start:${name}`);
    assert.equal(indexOf('BACKUP target_b') > indexOf('VERIFY target_a'), true);
    assert.equal(indexOf('INSTALL target_b') > indexOf('BACKUP target_b'), true);
  });

  it('并发限制生效，同一时刻运行中的步骤不会超过窗口', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_concurrency', concurrencyLimit: 2 });
    const executor = new TrackingExecutor(async () => {
      await Promise.resolve();
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([executor]));

    assert.equal(result.success, true);
    assert.equal(executor.maxRunningCount, 2);
  });

  it('FailurePolicyEngine 会把 transient 失败自动重试，把 unsafe/timeout/cancelled 正确分类', async () => {
    const service = createService();
    const transientRun = await createRun(service, { idempotencyKey: 'idem_transient', targetIds: ['target_a'], stepMaxAttempts: 2 });
    const transientStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: transientRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    let transientCalls = 0;
    const transientExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== transientStep.id) return { success: true };
      transientCalls += 1;
      if (transientCalls === 1) return { success: false, errorCode: 'SSH_TEMP_ERROR', errorMessage: 'temporary network glitch' };
      return { success: true };
    });
    const transientResult = await service.runDispatchedExecution(transientRun.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([transientExecutor]));
    assert.equal(transientResult.success, true);
    assert.equal(transientCalls, 2);

    const unsafeRun = await createRun(service, { idempotencyKey: 'idem_unsafe', targetIds: ['target_b'], stepMaxAttempts: 3 });
    const unsafeStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: unsafeRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    const unsafeExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== unsafeStep.id) return { success: true };
      return { success: false, errorCode: 'UNSAFE_REMOTE_STATE', errorMessage: 'unsafe to retry' };
    });
    const unsafeResult = await service.runDispatchedExecution(unsafeRun.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([unsafeExecutor]));
    const unsafeStored = service.getStep(unsafeStep.id, 'tenant_1');
    assert.equal(unsafeResult.success, false);
    assert.equal(unsafeStored.lastFailureCategory, 'unsafe');
    assert.equal(unsafeStored.attemptCount, 1);

    const timeoutRun = await createRun(service, { idempotencyKey: 'idem_timeout', targetIds: ['target_c'], stepMaxAttempts: 1 });
    const timeoutStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: timeoutRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    const timeoutExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== timeoutStep.id) return { success: true };
      return { success: false, errorCode: 'STEP_TIMEOUT', errorMessage: 'timeout waiting remote ack' };
    });
    await service.runDispatchedExecution(timeoutRun.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([timeoutExecutor]));
    assert.equal(service.getStep(timeoutStep.id, 'tenant_1').lastFailureCategory, 'timeout');

    const cancelledRun = await createRun(service, { idempotencyKey: 'idem_cancelled', targetIds: ['target_d'], stepMaxAttempts: 1 });
    const cancelledStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: cancelledRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    const cancelledExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== cancelledStep.id) return { success: true };
      return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: 'cancelled by operator' };
    });
    await service.runDispatchedExecution(cancelledRun.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([cancelledExecutor]));
    assert.equal(service.getStep(cancelledStep.id, 'tenant_1').lastFailureCategory, 'cancelled');
  });

  it('恢复 worker 会恢复 queued/dispatched/running run，但不会自动重跑不可幂等步骤', async () => {
    const service = createService();
    const queued = await createRun(service, { idempotencyKey: 'idem_recover_queued', targetIds: ['target_a'] });
    const dispatched = await createRun(service, { idempotencyKey: 'idem_recover_dispatched', targetIds: ['target_b'] });
    const running = await createRun(service, { idempotencyKey: 'idem_recover_running', targetIds: ['target_c'] });

    const runningSteps = service.listSteps({ tenantId: 'tenant_1', executionRunId: running.run.id }).sort((left, right) => left.stepNo - right.stepNo);
    service.updateRunForTest(running.run.id, { status: 'RUNNING', errorCode: undefined, errorMessage: undefined }, 'tenant_1');
    service.updateStepForTest(runningSteps[0].id, { status: 'RUNNING', idempotent: false, startedAt: new Date().toISOString() }, 'tenant_1');
    service.updateStepForTest(runningSteps[1].id, { status: 'PENDING' }, 'tenant_1');

    const executor = new TrackingExecutor(async () => ({ success: true }));
    const recovered = await service.recoverRunsForTest('recovery_bot', 'tenant_1', ExecutorRegistry.forTests([executor]));

    assert.equal(recovered.length, 3);
    const recoveredRunning = recovered.find((item) => item.run.id === running.run.id);
    assert.ok(recoveredRunning);
    assert.deepEqual(recoveredRunning?.result.skippedStepIds.length, 1);
    assert.equal(service.getStep(runningSteps[0].id, 'tenant_1').status, 'SKIPPED');
    assert.equal(service.getRun(queued.run.id, 'tenant_1').status, 'SUCCESS');
    assert.equal(service.getRun(dispatched.run.id, 'tenant_1').status, 'SUCCESS');
  });

  it('同一 step 不会被重复执行', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_dedup', targetIds: ['target_a'], concurrencyLimit: 1 });
    const firstStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    let calls = 0;
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.id === firstStep.id) {
        calls += 1;
      }
      return { success: true };
    });

    await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([executor]));

    assert.equal(calls, 1);
  });

  it('未知 executor 被拒绝，不再静默 fallback 到 MockExecutor', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_unknown_executor', targetIds: ['target_x'], executorType: 'NO_SUCH_EXECUTOR' });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1');
    const run = service.getRun(created.run.id, 'tenant_1');
    const failedStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }).find((step) => step.status === 'FAILED');

    assert.equal(result.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(failedStep?.lastErrorCode, 'RESOURCE_NOT_FOUND');
    assert.match(failedStep?.lastErrorMessage ?? '', /拒绝静默 fallback/);
  });

  it('MockExecutor 只有显式允许时才能使用', async () => {
    const service = createService();
    await assert.rejects(
      () => createRun(service, { idempotencyKey: 'idem_mock_denied', targetIds: ['target_m'], executorType: 'MOCK' }),
      /MockExecutor/,
    );

    const allowed = await createRun(service, { idempotencyKey: 'idem_mock_allowed', targetIds: ['target_m'], executorType: 'MOCK', allowMockExecutor: true });
    const result = await service.runDispatchedExecution(allowed.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests());
    assert.equal(result.success, true);
  });

  it('Apply 与 Dry-run 共用五阶段和一秒间隔，单体执行器只在更新阶段调用一次', async () => {
    for (const type of ['apply', 'dry_run'] as const) {
      const delays: number[] = [];
      const service = new ExecutionsApplicationService({
        deploymentPlansRepository: new DeploymentPlansRepository(),
        stageIntervalMs: 1_000,
        delay: async (milliseconds) => { delays.push(milliseconds); },
      });
      const targetId = `target_lifecycle_${type}`;
      const created = await createRun(service, {
        idempotencyKey: `idem_lifecycle_${type}`,
        targetIds: [targetId],
        executorType: 'AGENT',
        type,
        agentPayloads: new Map([[targetId, {
          pluginRuntimeCapability: { runtime: 'AGENT_ATOMIC' },
          certificateVerification: { connectHost: '127.0.0.1', serverName: 'example.test', port: 443 },
        }]]),
      });
      const updateExecutor = new TrackingExecutor(async () => ({ success: true }), 'AGENT');
      const verifyExecutor = new TrackingExecutor(async () => ({ success: true }), 'CONTROL_PLANE_TLS');
      const result = await service.runDispatchedExecution(
        created.run.id,
        'tester',
        'tenant_1',
        new ExecutorRegistry([updateExecutor, verifyExecutor]),
      );
      const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

      assert.equal(result.success, true);
      assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
      assert.deepEqual(updateExecutor.timeline.filter((item) => item.startsWith('start:')), [`start:INSTALL ${targetId}`]);
      assert.equal(delays.length, 4);
      assert.equal(delays.every((milliseconds) => milliseconds > 0 && milliseconds <= 1_000), true);
    }
  });

  it('Agent Atomic 使用独立控制面 TLS VERIFY，并区分连接地址与 SNI', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_atomic_control_plane_verify',
      targetIds: ['target_atomic'],
      executorType: 'AGENT',
      agentPayloads: new Map([['target_atomic', {
        pluginRuntimeCapability: { runtime: 'AGENT_ATOMIC' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.equal(steps[0]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[1]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[2]?.inputSnapshot.executorType, 'AGENT');
    assert.equal(steps[3]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[4]?.inputSnapshot.executorType, 'CONTROL_PLANE_TLS');
    assert.equal((steps[4]?.inputSnapshot.certificateVerification as Record<string, unknown>).connectHost, '10.255.0.127');
    assert.equal((steps[4]?.inputSnapshot.certificateVerification as Record<string, unknown>).serverName, 'test02.jacksonz.cn');
    assert.deepEqual(steps[4]?.dependsOn, [steps[3]?.stepNo]);
  });

  it('Agent Atomic 指定 Gateway 时由 Gateway 主动执行独立 TLS VERIFY', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_atomic_gateway_verify',
      targetIds: ['target_atomic_gateway'],
      executorType: 'AGENT',
      agentPayloads: new Map([['target_atomic_gateway', {
        pluginRuntimeCapability: { runtime: 'AGENT_ATOMIC' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
      gatewayRoutes: new Map([['target_atomic_gateway', {
        gatewayId: 'gateway-1',
        agentId: 'gateway-agent-1',
        adapter: 'probe.tls',
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    const verify = steps.find((step) => step.stepType === 'VERIFY');
    assert.equal(verify?.inputSnapshot.executorType, 'GATEWAY_FORWARD');
    assert.equal(verify?.inputSnapshot.gatewayId, 'gateway-1');
    assert.equal((verify?.inputSnapshot.certificateVerification as Record<string, unknown>).connectHost, '10.255.0.127');
    assert.equal((verify?.inputSnapshot.certificateVerification as Record<string, unknown>).serverName, 'test02.jacksonz.cn');
  });

  it('Workflow 证书部署统一追加宿主 VERIFY，默认由平台后端执行', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_workflow_host_verify',
      targetIds: ['target_workflow'],
      executorType: 'WORKFLOW',
      agentPayloads: new Map([['target_workflow', {
        pluginRuntimeCapability: { runtime: 'WORKFLOW_DSL' },
        workflowRequest: { workflowVersionId: 'workflow-version-1' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.equal(steps[0]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[1]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[2]?.inputSnapshot.executorType, 'WORKFLOW');
    assert.equal(steps[3]?.inputSnapshot.executorType, 'PLATFORM_STAGE');
    assert.equal(steps[4]?.inputSnapshot.executorType, 'CONTROL_PLANE_TLS');
  });

  it('failurePolicy=continue 跳过失败目标剩余步骤，但继续其它目标；batchSize 和 retry 写入实际调度', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_continue_batch_retry',
      targetIds: ['target_a', 'target_b', 'target_c'],
      concurrencyLimit: 2,
      failurePolicy: 'continue',
      retry: { maxAttempts: 2, backoffSeconds: 7 },
    });
    const firstStepA = service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }).find((step) => step.name === 'BACKUP target_a')!;
    let callsA = 0;
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.id === firstStepA.id) {
        callsA += 1;
        return { success: false, errorCode: 'UNSAFE_REMOTE_STATE', errorMessage: 'unsafe to retry' };
      }
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([executor]));
    const run = service.getRun(created.run.id, 'tenant_1');
    const steps = service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(run.concurrencyLimit, 2);
    assert.deepEqual(run.summary.retry, { maxAttempts: 2, backoffSeconds: 7 });
    assert.equal(steps.find((step) => step.name === 'INSTALL target_a')?.status, 'SKIPPED');
    assert.equal(steps.filter((step) => step.deploymentPlanTargetId === 'target_b').every((step) => step.status === 'SUCCESS'), true);
    assert.equal(callsA, 1);
  });

  it('failurePolicy=rollback 会自动创建 rollback run 并把源 run 标为 ROLLBACK_RUNNING', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_auto_rollback', targetIds: ['target_rb'], failurePolicy: 'rollback' });
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.stepType === 'BACKUP') return { success: false, errorCode: 'SSH_COMMAND_FAILED', errorMessage: 'install blocked' };
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests([executor]));
    const sourceRun = service.getRun(created.run.id, 'tenant_1');
    const runs = service.listRuns({ tenantId: 'tenant_1', deploymentPlanId: 'plan_1' });
    const rollbackRun = runs.find((run) => run.type === 'rollback');

    assert.equal(result.success, false);
    assert.equal(sourceRun.status, 'ROLLBACK_RUNNING');
    assert.ok(rollbackRun);
    assert.equal(rollbackRun?.status, 'DISPATCHED');
  });
});
// @ts-nocheck
