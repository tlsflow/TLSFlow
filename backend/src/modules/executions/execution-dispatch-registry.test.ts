import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionsApplicationService } from './application/executions.application-service.js';

test('runDispatchedExecution 默认复用构造时注入的 executorRegistry，而不是临时 new 空 registry', async () => {
  let executorCalled = false;
  let runStatus = 'DISPATCHED';
  let stepStatus = 'PENDING';
  let stepAttemptCount = 0;
  const now = () => new Date().toISOString();

  const service = new ExecutionsApplicationService({
    repository: {
      getRunOrThrow: async () => ({
        id: 'run_registry_1',
        tenantId: 'tenant_1',
        deploymentPlanId: 'pln_1',
        runNo: 1,
        type: 'dry_run',
        idempotencyKey: 'idem_registry_1',
        status: runStatus,
        concurrencyLimit: 1,
        summary: { failurePolicy: 'stop' },
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user_1',
        version: 1,
      }),
      listSteps: async () => ([
        {
          id: 'stp_registry_1',
          tenantId: 'tenant_1',
          executionRunId: 'run_registry_1',
          deploymentPlanTargetId: 'dpt_1',
          stepNo: 1,
          stepType: 'DISCOVER',
          name: 'DISCOVER dpt_1',
          dependsOn: [],
          idempotent: true,
          attemptCount: stepAttemptCount,
          maxAttempts: 1,
          inputSnapshot: {
            executorType: 'AGENT',
            dryRun: true,
            type: 'windows.iis.deploy_certificate',
          },
          status: stepStatus,
          createdAt: now(),
          updatedAt: now(),
          createdBy: 'user_1',
          version: 1,
        },
      ]),
      updateRun: async (_runId: string, patch: Record<string, unknown>) => {
        runStatus = String(patch.status ?? runStatus);
        return {
        id: 'run_registry_1',
        tenantId: 'tenant_1',
        deploymentPlanId: 'pln_1',
        runNo: 1,
        type: 'dry_run',
        idempotencyKey: 'idem_registry_1',
        status: runStatus,
        concurrencyLimit: 1,
        summary: { failurePolicy: 'stop' },
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user_1',
        updatedBy: 'user_1',
        version: 1,
      };
      },
      updateStep: async (_stepId: string, patch: Record<string, unknown>) => {
        stepStatus = String(patch.status ?? stepStatus);
        if (typeof patch.attemptCount === 'number') {
          stepAttemptCount = patch.attemptCount;
        }
        return {
        id: 'stp_registry_1',
        tenantId: 'tenant_1',
        executionRunId: 'run_registry_1',
        deploymentPlanTargetId: 'dpt_1',
        stepNo: 1,
        stepType: 'DISCOVER',
        name: 'DISCOVER dpt_1',
        dependsOn: [],
        idempotent: true,
        attemptCount: stepAttemptCount,
        maxAttempts: 1,
        inputSnapshot: {
          executorType: 'AGENT',
          dryRun: true,
          type: 'windows.iis.deploy_certificate',
        },
        status: stepStatus,
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user_1',
        updatedBy: 'user_1',
        version: 1,
      };
      },
      createRun: async () => { throw new Error('not used'); },
      createStep: async () => { throw new Error('not used'); },
      nextRunNo: async () => 1,
      findRunByIdempotencyKey: async () => undefined,
      getStepOrThrow: async () => ({
        id: 'stp_registry_1',
        tenantId: 'tenant_1',
        executionRunId: 'run_registry_1',
        deploymentPlanTargetId: 'dpt_1',
        stepNo: 1,
        stepType: 'DISCOVER',
        name: 'DISCOVER dpt_1',
        dependsOn: [],
        idempotent: true,
        attemptCount: stepAttemptCount,
        maxAttempts: 1,
        inputSnapshot: {
          executorType: 'AGENT',
          dryRun: true,
          type: 'windows.iis.deploy_certificate',
        },
        status: stepStatus,
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user_1',
        version: 1,
      }),
    } as any,
    deploymentPlansRepository: {
      createTransition: async () => undefined,
    } as any,
    queue: {
      enqueue: async () => { throw new Error('not used'); },
      runNext: async () => null,
      size: async () => 0,
      getResult: async () => undefined,
    } as any,
    executorRegistry: {
      get: (type: string) => {
        assert.equal(type, 'AGENT');
        return {
          type: 'AGENT',
          executeStep: async () => {
            executorCalled = true;
            return { success: true };
          },
        };
      },
    } as any,
  });

  const result = await service.runDispatchedExecution('run_registry_1', 'user_1', 'tenant_1');
  assert.equal(result.success, true);
  assert.equal(executorCalled, true);
});
