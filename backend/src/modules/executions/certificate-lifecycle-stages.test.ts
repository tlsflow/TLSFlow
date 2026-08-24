// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import { ExecutorRegistry, type Executor, type StepExecutionInput, type StepExecutionResult } from './application/executors.js';

class TrackingExecutor implements Executor {
  readonly calls: string[] = [];

  constructor(readonly type: string) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    this.calls.push(input.step.stepType);
    return { success: true };
  }
}

test('Apply 与 Dry-run 共用五阶段和一秒间隔，单体执行器只在更新阶段调用一次', async () => {
  for (const type of ['apply', 'dry_run'] as const) {
    const delays: number[] = [];
    const service = new ExecutionsApplicationService({
      deploymentPlansRepository: new DeploymentPlansRepository(),
      stageIntervalMs: 1_000,
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    const targetId = `target_lifecycle_${type}`;
    const created = await service.createApplyRun({
      deploymentPlanId: `plan_lifecycle_${type}`,
      deploymentPlanTargetIds: [targetId],
      type,
      idempotencyKey: `idem_lifecycle_${type}`,
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'AGENT']]),
      agentPayloadByTargetId: new Map([[targetId, {
        pluginRuntimeCapability: { runtime: 'AGENT_ATOMIC' },
        certificateVerification: { connectHost: '127.0.0.1', serverName: 'example.test', port: 443 },
      }]]),
    });
    const updateExecutor = new TrackingExecutor('AGENT');
    const verifyExecutor = new TrackingExecutor('CONTROL_PLANE_TLS');
    const result = await service.runDispatchedExecution(
      created.run.id,
      'tester',
      'tenant_1',
      new ExecutorRegistry([updateExecutor, verifyExecutor]),
    );
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.success, true);
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.deepEqual(updateExecutor.calls, ['INSTALL']);
    assert.deepEqual(verifyExecutor.calls, ['VERIFY']);
    assert.equal(delays.length, 4);
    assert.equal(delays.every((milliseconds) => milliseconds > 0 && milliseconds <= 1_000), true);
  }
});
