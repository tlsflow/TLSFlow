import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionsApplicationService } from './application/executions.application-service.js';

test('runDispatchedExecution 默认复用构造时注入的 executorRegistry，而不是临时 new 空 registry', async () => {
  let executorCalled = false;
  let runStatus = 'DISPATCHED';
  let stepStatus = 'PENDING';
  let stepAttemptCount = 0;
  let stepLastErrorCode: string | undefined;
  let stepLastErrorMessage: string | undefined;
  let runtimeAvailable = true;
  const now = () => new Date().toISOString();
  const resolvedSha256 = 'a'.repeat(64);
  const persistedInputSnapshot = {
    deploymentPlanId: 'pln_1',
    executorType: 'AGENT',
    dryRun: true,
    deploymentInputSnapshotRef: {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotId: 'dpis_registry_1',
      revision: 1,
      resolvedSha256,
    },
  };
  let currentInputSnapshot: Record<string, unknown> = structuredClone(persistedInputSnapshot);
  let executionResult: Record<string, unknown> = { success: true };

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
          inputSnapshot: currentInputSnapshot,
          status: stepStatus,
          lastErrorCode: stepLastErrorCode,
          lastErrorMessage: stepLastErrorMessage,
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
        if (patch.inputSnapshot && typeof patch.inputSnapshot === 'object' && !Array.isArray(patch.inputSnapshot)) {
          currentInputSnapshot = patch.inputSnapshot as Record<string, unknown>;
        }
        stepLastErrorCode = typeof patch.lastErrorCode === 'string' ? patch.lastErrorCode : stepLastErrorCode;
        stepLastErrorMessage = typeof patch.lastErrorMessage === 'string' ? patch.lastErrorMessage : stepLastErrorMessage;
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
        inputSnapshot: currentInputSnapshot,
        status: stepStatus,
        lastErrorCode: stepLastErrorCode,
        lastErrorMessage: stepLastErrorMessage,
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
        inputSnapshot: currentInputSnapshot,
        status: stepStatus,
        lastErrorCode: stepLastErrorCode,
        lastErrorMessage: stepLastErrorMessage,
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user_1',
        version: 1,
      }),
    } as any,
    deploymentPlansRepository: {
      createTransition: async () => undefined,
      getPlan: async () => undefined,
    } as any,
    deploymentInputSnapshots: {
      get: async () => ({
        id: 'dpis_registry_1',
        tenantId: 'tenant_1',
        deploymentPlanId: 'pln_1',
        deploymentPlanTargetId: 'dpt_1',
        revision: 1,
        snapshot: { resolvedSha256 },
      }),
      getRuntimeSnapshot: async () => runtimeAvailable ? ({
        apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
        contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
        effectiveBinding: {
          inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
          provenance: {},
        },
        resolvedDeploymentInput: {
          apiVersion: 'gcac.resolved-deployment-input/v1',
          contractVersion: 'gcac.deployment-input/v1',
          assetContext: {}, variables: { immutableValue: 'snapshot-value' }, connections: {}, credentials: {}, artifacts: {},
          provenance: {}, sensitivePaths: [], issues: [], executable: true, resolvedSha256,
        },
        deploymentArtifact: {
          certificateVersionId: 'certver_1', certificateFormatId: 'certfmt_1', format: 'pem', containsPrivateKey: true,
          privateKeyPem: 'runtime-private-key',
        },
      }) : undefined,
    } as any,
    executorRegistry: {
      get: (type: string) => {
        assert.equal(type, 'AGENT');
        return {
          type: 'AGENT',
          executeStep: async (input: any) => {
            executorCalled = true;
            assert.equal(input.step.inputSnapshot.resolvedDeploymentInput.variables.immutableValue, 'snapshot-value');
            assert.equal(input.step.inputSnapshot.deploymentArtifact.privateKeyPem, 'runtime-private-key');
            assert.equal(JSON.stringify(persistedInputSnapshot).includes('runtime-private-key'), false);
            return executionResult;
          },
        };
      },
    } as any,
  });

  const result = await service.runDispatchedExecution('run_registry_1', 'user_1', 'tenant_1');
  assert.equal(result.success, true);
  assert.equal(executorCalled, true);

  runStatus = 'DISPATCHED';
  stepStatus = 'PENDING';
  stepAttemptCount = 0;
  stepLastErrorCode = undefined;
  stepLastErrorMessage = undefined;
  currentInputSnapshot = structuredClone(persistedInputSnapshot);
  runtimeAvailable = false;
  executorCalled = false;
  const failed = await service.runDispatchedExecution('run_registry_1', 'user_1', 'tenant_1');
  assert.equal(failed.success, false);
  assert.equal(stepStatus, 'FAILED');
  assert.equal(executorCalled, false);

  runStatus = 'DISPATCHED';
  stepStatus = 'PENDING';
  stepAttemptCount = 0;
  stepLastErrorCode = undefined;
  stepLastErrorMessage = undefined;
  currentInputSnapshot = structuredClone(persistedInputSnapshot);
  runtimeAvailable = true;
  executionResult = {
    success: false,
    errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
    errorMessage: 'Plugin Runner 返回结果不明',
    detail: { executionStatus: 'UNKNOWN', mayBeUnknown: true },
  };
  executorCalled = false;
  const unknown = await service.runDispatchedExecution('run_registry_1', 'user_1', 'tenant_1');
  assert.equal(unknown.pending, true);
  assert.equal(unknown.pendingState, 'AWAITING_CONFIRMATION');
  assert.equal(unknown.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(stepStatus, 'RUNNING');
  assert.equal((currentInputSnapshot.resultDetail as Record<string, unknown>).executionStatus, 'UNKNOWN');

  executorCalled = false;
  const repeated = await service.runDispatchedExecution('run_registry_1', 'user_1', 'tenant_1');
  assert.equal(repeated.pending, true);
  assert.equal(repeated.pendingState, 'AWAITING_CONFIRMATION');
  assert.equal(repeated.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(executorCalled, false);
});
