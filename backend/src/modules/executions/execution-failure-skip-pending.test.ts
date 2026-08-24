import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './application/executors.js';
import { ExecutorRegistry } from './application/executors.js';

class FailFirstDryRunExecutor implements Executor {
  readonly type = 'AGENT';

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
  });
  const created = await service.createDryRun({
    deploymentPlanId: 'plan_skip_pending',
    deploymentPlanTargetIds: ['target_skip_pending'],
    type: 'dry_run',
    idempotencyKey: 'idem_skip_pending_after_failure',
    actorId: 'tester',
    tenantId: 'tenant_skip_pending',
    executorTypeByTargetId: new Map([['target_skip_pending', 'AGENT']]),
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
