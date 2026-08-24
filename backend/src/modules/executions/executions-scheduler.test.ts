import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './application/executors.js';
import { ExecutorRegistry } from './application/executors.js';

function createService() {
  return new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
  });
}

async function createRun(service: ExecutionsApplicationService, input: {
  idempotencyKey: string;
  targetIds?: string[];
  concurrencyLimit?: number;
  stepMaxAttempts?: number;
  mockResults?: Map<string, 'success' | 'fail'>;
}) {
  const targetIds = input.targetIds ?? ['target_a', 'target_b'];
  return service.createApplyRun({
    deploymentPlanId: 'plan_1',
    deploymentPlanTargetIds: targetIds,
    type: 'apply',
    idempotencyKey: input.idempotencyKey,
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map(targetIds.map((targetId) => [targetId, 'AGENT'] as const)),
    mockResultByTargetId: input.mockResults,
    concurrencyLimit: input.concurrencyLimit,
    stepMaxAttempts: input.stepMaxAttempts,
  });
}

class TrackingExecutor implements Executor {
  readonly type = 'MOCK';
  readonly timeline: string[] = [];
  private runningCount = 0;
  maxRunningCount = 0;

  constructor(private readonly handler: (input: StepExecutionInput) => Promise<StepExecutionResult>) {}

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
    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', new ExecutorRegistry([executor]));

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

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', new ExecutorRegistry([executor]));

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
    const transientResult = await service.runDispatchedExecution(transientRun.run.id, 'tester', 'tenant_1', new ExecutorRegistry([transientExecutor]));
    assert.equal(transientResult.success, true);
    assert.equal(transientCalls, 2);

    const unsafeRun = await createRun(service, { idempotencyKey: 'idem_unsafe', targetIds: ['target_b'], stepMaxAttempts: 3 });
    const unsafeStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: unsafeRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    const unsafeExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== unsafeStep.id) return { success: true };
      return { success: false, errorCode: 'UNSAFE_REMOTE_STATE', errorMessage: 'unsafe to retry' };
    });
    const unsafeResult = await service.runDispatchedExecution(unsafeRun.run.id, 'tester', 'tenant_1', new ExecutorRegistry([unsafeExecutor]));
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
    await service.runDispatchedExecution(timeoutRun.run.id, 'tester', 'tenant_1', new ExecutorRegistry([timeoutExecutor]));
    assert.equal(service.getStep(timeoutStep.id, 'tenant_1').lastFailureCategory, 'timeout');

    const cancelledRun = await createRun(service, { idempotencyKey: 'idem_cancelled', targetIds: ['target_d'], stepMaxAttempts: 1 });
    const cancelledStep = service.listSteps({ tenantId: 'tenant_1', executionRunId: cancelledRun.run.id }).sort((left, right) => left.stepNo - right.stepNo)[0];
    const cancelledExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== cancelledStep.id) return { success: true };
      return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: 'cancelled by operator' };
    });
    await service.runDispatchedExecution(cancelledRun.run.id, 'tester', 'tenant_1', new ExecutorRegistry([cancelledExecutor]));
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
    const recovered = await service.recoverRunsForTest('recovery_bot', 'tenant_1', new ExecutorRegistry([executor]));

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

    await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', new ExecutorRegistry([executor]));

    assert.equal(calls, 1);
  });
});
