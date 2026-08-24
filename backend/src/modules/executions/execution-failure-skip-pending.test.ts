import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './application/executors.js';
import { ExecutorRegistry } from './application/executors.js';
import { testDeploymentInputSnapshotsRepository, testTaskEnqueuer, withTestDeploymentInputSnapshot } from './deployment-input-runtime-snapshot.test-fixture.js';

class FailFirstDryRunExecutor implements Executor {
  readonly type = 'PLATFORM_STAGE';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    if (input.step.stepType === 'DISCOVER') {
      return {
        success: false,
        errorCode: 'NGINX_DRY_RUN_FAILED',
        errorMessage: 'preflight failed',
      };
    }
    return { success: true };
  }
}

test('dry-run 第一步失败后会跳过剩余 PENDING 步骤，避免进度卡住', async () => {
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    stageIntervalMs: 0,
    tasks: testTaskEnqueuer(),
  });
  const created = await service.createDryRun({
    deploymentPlanId: 'plan_skip_pending',
    deploymentPlanTargetIds: ['target_skip_pending'],
    type: 'dry_run',
    idempotencyKey: 'idem_skip_pending_after_failure',
    actorId: 'tester',
    tenantId: 'tenant_skip_pending',
    executorTypeByTargetId: new Map([['target_skip_pending', 'AGENT']]),
    agentPayloadByTargetId: new Map([[
      'target_skip_pending',
      withTestDeploymentInputSnapshot('plan_skip_pending', 'target_skip_pending'),
    ]]),
    failurePolicy: 'stop',
  });

  const result = await service.runDispatchedExecution(
    created.run.id,
    'tester',
    'tenant_skip_pending',
    ExecutorRegistry.forTests([new FailFirstDryRunExecutor()]),
  );
  const run = await service.getRun(created.run.id, 'tenant_skip_pending');
  const steps = await service.listSteps({ tenantId: 'tenant_skip_pending', executionRunId: created.run.id });

  assert.equal(result.success, false);
  assert.equal(run.status, 'FAILED');
  assert.equal(steps.find((step: any) => step.stepType === 'DISCOVER')?.status, 'FAILED');
  assert.equal(steps.find((step: any) => step.stepType === 'VERIFY')?.status, 'SKIPPED');
  assert.equal(steps.some((step: any) => step.status === 'PENDING'), false);
});

test('WORKFLOW 同步执行结果会进入结果同步服务用于资产回写', async () => {
  const resultSyncCalls: Array<Record<string, unknown>> = [];
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    stageIntervalMs: 0,
    tasks: testTaskEnqueuer(),
    resultSync: {
      applyAgentTaskResult: async (input: Record<string, unknown>) => {
        resultSyncCalls.push(input);
      },
    } as any,
  });
  const created = await service.createApplyRun({
    deploymentPlanId: 'plan_workflow_sync',
    deploymentPlanTargetIds: ['target_workflow_sync'],
    type: 'apply',
    idempotencyKey: 'idem_workflow_sync',
    actorId: 'tester',
    tenantId: 'tenant_workflow_sync',
    executorTypeByTargetId: new Map([['target_workflow_sync', 'WORKFLOW']]),
    agentPayloadByTargetId: new Map([[
      'target_workflow_sync',
      withTestDeploymentInputSnapshot('plan_workflow_sync', 'target_workflow_sync', {
        workflowRequest: { workflowVersionId: 'wftplv_sync' },
      }),
    ]]),
    stepMaxAttempts: 1,
  });

  const result = await service.runDispatchedExecution(
    created.run.id,
    'tester',
    'tenant_workflow_sync',
    ExecutorRegistry.forTests([{
      type: 'WORKFLOW',
      executeStep: async () => ({
        success: true,
        detail: {
          mode: 'workflow_runner',
          workflowRun: {
            status: 'success',
            stepResults: [{ extracted: { remoteFingerprintSha256: 'a'.repeat(64) } }],
          },
        },
      }),
    }]),
  );

  assert.equal(result.success, true);
  assert.equal(resultSyncCalls.length, 1);
  assert.equal(resultSyncCalls[0]?.success, true);
  assert.equal((resultSyncCalls[0]?.detail as Record<string, unknown>).executionMode, 'workflow');
});

test('WORKFLOW dry-run 不进入结果同步服务，避免重复收尾运行', async () => {
  const resultSyncCalls: Array<Record<string, unknown>> = [];
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    stageIntervalMs: 0,
    tasks: testTaskEnqueuer(),
    resultSync: {
      applyAgentTaskResult: async (input: Record<string, unknown>) => {
        resultSyncCalls.push(input);
      },
    } as any,
  });
  const created = await service.createDryRun({
    deploymentPlanId: 'plan_workflow_dry_sync',
    deploymentPlanTargetIds: ['target_workflow_dry_sync'],
    type: 'dry_run',
    idempotencyKey: 'idem_workflow_dry_sync',
    actorId: 'tester',
    tenantId: 'tenant_workflow_dry_sync',
    executorTypeByTargetId: new Map([['target_workflow_dry_sync', 'WORKFLOW']]),
    agentPayloadByTargetId: new Map([[
      'target_workflow_dry_sync',
      withTestDeploymentInputSnapshot('plan_workflow_dry_sync', 'target_workflow_dry_sync', {
        workflowRequest: { workflowVersionId: 'wftplv_sync' },
      }),
    ]]),
    stepMaxAttempts: 1,
  });

  const result = await service.runDispatchedExecution(
    created.run.id,
    'tester',
    'tenant_workflow_dry_sync',
    ExecutorRegistry.forTests([
      {
        type: 'WORKFLOW',
        executeStep: async () => ({
          success: true,
          detail: { mode: 'workflow_plan', workflowRun: { status: 'success', plannedOnly: true } },
        }),
      },
      { type: 'CONTROL_PLANE_TLS', executeStep: async () => ({ success: true }) },
    ]),
  );

  assert.equal(result.success, true);
  assert.equal(resultSyncCalls.length, 0);
});
