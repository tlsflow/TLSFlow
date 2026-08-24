import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ExecutionsApplicationService } from './application/executions.application-service.js';

const tenantId = 'tenant_legacy';
const runId = 'run_legacy';
const stepId = 'step_legacy';
const now = '2026-07-30T00:00:00.000Z';

const legacyRun = {
  id: runId,
  tenantId,
  deploymentPlanId: 'plan_legacy',
  runNo: 1,
  type: 'apply',
  idempotencyKey: 'idem_legacy',
  requestHash: 'hash_legacy',
  status: 'DISPATCHED',
  concurrencyLimit: 1,
  summary: { failurePolicy: 'stop' },
  createdAt: now,
  updatedAt: now,
  createdBy: 'user_legacy',
  version: 1,
} as const;

const legacyStep = {
  id: stepId,
  tenantId,
  executionRunId: runId,
  deploymentPlanTargetId: 'target_legacy',
  stepNo: 1,
  stepType: 'CUSTOM',
  name: 'Legacy script package',
  dependsOn: [],
  idempotent: true,
  attemptCount: 0,
  maxAttempts: 1,
  inputSnapshot: { executorType: 'SCRIPT_PACKAGE' },
  status: 'PENDING',
  createdAt: now,
  updatedAt: now,
  createdBy: 'user_legacy',
  version: 1,
} as const;

interface WriteCounts {
  createRun: number;
  createStep: number;
  updateRun: number;
  updateStep: number;
  enqueue: number;
  transition: number;
}

function createHarness(options: {
  runStatus?: string;
  stepExecutorType?: string;
  targetExecutorType?: string;
} = {}) {
  const writes: WriteCounts = {
    createRun: 0,
    createStep: 0,
    updateRun: 0,
    updateStep: 0,
    enqueue: 0,
    transition: 0,
  };
  const run = {
    ...legacyRun,
    status: options.runStatus ?? legacyRun.status,
  };
  const step = {
    ...legacyStep,
    inputSnapshot: { executorType: options.stepExecutorType ?? 'SCRIPT_PACKAGE' },
  };
  const repository = {
    listRuns: async () => [run],
    listSteps: async () => [step],
    getRun: async () => run,
    getRunOrThrow: async () => run,
    getStep: async () => step,
    getStepOrThrow: async () => step,
    findRunByIdempotencyKey: async () => undefined,
    nextRunNo: async () => 2,
    createRun: async () => {
      writes.createRun += 1;
      return run;
    },
    createStep: async () => {
      writes.createStep += 1;
      return step;
    },
    updateRun: async () => {
      writes.updateRun += 1;
      return run;
    },
    updateStep: async () => {
      writes.updateStep += 1;
      return step;
    },
  };
  const service = new ExecutionsApplicationService({
    repository: repository as never,
    deploymentPlansRepository: {
      createTransition: async () => {
        writes.transition += 1;
      },
      getTarget: async () => ({ executorType: options.targetExecutorType ?? 'SCRIPT_PACKAGE' }),
    } as never,
    queue: {
      enqueue: async () => {
        writes.enqueue += 1;
        return { jobId: 'job_legacy' };
      },
      runNext: async () => null,
    } as never,
  });
  return { service, writes };
}

function assertZeroWrites(writes: WriteCounts): void {
  assert.deepEqual(writes, {
    createRun: 0,
    createStep: 0,
    updateRun: 0,
    updateStep: 0,
    enqueue: 0,
    transition: 0,
  });
}

async function assertRetired(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal((error as { errorCode?: string }).errorCode, 'LEGACY_EXECUTION_RETIRED');
    return true;
  });
}

describe('Legacy SCRIPT_PACKAGE 执行下线守卫', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('新建运行在 Run、Step 和 Job 写入前失败', async () => {
    await assertRetired(() => harness.service.createApplyRun({
      deploymentPlanId: 'plan_legacy',
      deploymentPlanTargetIds: ['target_legacy'],
      type: 'apply',
      idempotencyKey: 'idem_new_legacy',
      actorId: 'user_legacy',
      tenantId,
      executorTypeByTargetId: new Map([['target_legacy', 'SCRIPT_PACKAGE']]),
    }));
    assertZeroWrites(harness.writes);
  });

  it('重试历史 Legacy 运行时零写入', async () => {
    await assertRetired(() => harness.service.retry({
      runId,
      actorId: 'user_legacy',
      tenantId,
      idempotencyKey: 'idem_retry_legacy',
    }));
    assertZeroWrites(harness.writes);
  });

  it('回滚历史 Legacy 运行时不修改源运行状态', async () => {
    await assertRetired(() => harness.service.rollback({
      runId,
      actorId: 'user_legacy',
      tenantId,
      idempotencyKey: 'idem_rollback_legacy',
    }));
    assertZeroWrites(harness.writes);
  });

  it('回滚不读取目标后来修改的 Legacy 配置，源快照不完整时按校验失败关闭', async () => {
    const targetChangedHarness = createHarness({
      runStatus: 'FAILED',
      stepExecutorType: 'AGENT',
      targetExecutorType: 'SCRIPT_PACKAGE',
    });
    await assert.rejects(
      () => targetChangedHarness.service.rollback({
        runId,
        actorId: 'user_legacy',
        tenantId,
        idempotencyKey: 'idem_rollback_changed_target',
      }),
      (error: unknown) => {
        assert.equal((error as { errorCode?: string }).errorCode, 'VALIDATION_FAILED');
        return true;
      },
    );
    assertZeroWrites(targetChangedHarness.writes);
  });

  it('分发历史 Legacy 运行时不进入 RUNNING 且不调用执行器', async () => {
    let executorCalls = 0;
    await assertRetired(() => harness.service.runDispatchedExecution(runId, 'user_legacy', tenantId, {
      get: () => ({
        type: 'SCRIPT_PACKAGE',
        executeStep: async () => {
          executorCalls += 1;
          return { success: true };
        },
      }),
    } as never));
    assert.equal(executorCalls, 0);
    assertZeroWrites(harness.writes);
  });

  it('恢复批次在任何状态、步骤写入前整体失败', async () => {
    await assertRetired(() => harness.service.recoverRunsForTest('recovery_bot', tenantId));
    assertZeroWrites(harness.writes);
  });

  it('历史 Run 和 Step 查询仍返回原始事实', async () => {
    assert.equal((await harness.service.listRuns({ tenantId }))[0]?.id, runId);
    assert.equal((await harness.service.getRun(runId, tenantId)).id, runId);
    assert.equal((await harness.service.listSteps({ tenantId, executionRunId: runId }))[0]?.inputSnapshot.executorType, 'SCRIPT_PACKAGE');
    assert.equal((await harness.service.getStep(stepId, tenantId)).inputSnapshot.executorType, 'SCRIPT_PACKAGE');
    assertZeroWrites(harness.writes);
  });
});
