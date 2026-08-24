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

test('PLUGIN_RUNNER 步骤执行前创建绑定和 Grant，成功收尾保留绑定快照', async () => {
  const grantCalls: Array<Record<string, unknown>> = [];
  let runnerInput: Record<string, unknown> | undefined;
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    executionGrants: {
      create: async (input: Record<string, unknown>) => {
        grantCalls.push(input);
        return { id: 'grant-plugin-runner-1' };
      },
    } as any,
    stageIntervalMs: 0,
    tasks: testTaskEnqueuer(),
  });
  const bindingDraft = {
    apiVersion: 'gcac.plugin-runner-binding/v1',
    workflowVersionId: 'workflow-plugin-1',
    pluginVersionId: 'plugin-version-plugin-1',
    pluginId: 'fixture.plugin',
    pluginVersion: '1.0.0',
    packageHash: `sha256:${'a'.repeat(64)}`,
    manifestHash: `sha256:${'b'.repeat(64)}`,
    resourceHash: `sha256:${'c'.repeat(64)}`,
    capability: 'certificate.deploy',
    writeEffect: true,
    hostPermissions: ['network.http'],
  };
  const created = await service.createApplyRun({
    deploymentPlanId: 'plan_plugin_runner',
    deploymentPlanTargetIds: ['target_plugin_runner'],
    type: 'apply',
    idempotencyKey: 'idem_plugin_runner_binding',
    actorId: 'tester',
    tenantId: 'tenant_plugin_runner',
    executorTypeByTargetId: new Map([['target_plugin_runner', 'PLUGIN_RUNNER']]),
    agentPayloadByTargetId: new Map([[
      'target_plugin_runner',
      withTestDeploymentInputSnapshot('plan_plugin_runner', 'target_plugin_runner', {
        pluginRunnerBindingDraft: bindingDraft,
        executionRuntimeSnapshot: {
          apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
          resolvedDeploymentInput: {
            apiVersion: 'gcac.resolved-deployment-input/v1',
            variables: { targetVirtualServers: ['lb-one'] },
            connections: { management: { host: '192.0.2.20', port: 443 } },
            credentials: { management: { username: 'fixture-user', secretRefs: { password: 'secret://citrix/password' } } },
            artifacts: {
              certificate: {
                artifactRef: 'artifact://certificate-format/certfmt_test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                artifactSha256: `sha256:${'a'.repeat(64)}`,
              },
            },
          },
          deploymentArtifact: { certificateVersionId: 'certver_test', certificateFormatId: 'certfmt_test', format: 'pem', containsPrivateKey: true },
        },
      }),
    ]]),
    stepMaxAttempts: 1,
  });

  const result = await service.runDispatchedExecution(
    created.run.id,
    'tester',
    'tenant_plugin_runner',
    ExecutorRegistry.forTests([{
      type: 'PLUGIN_RUNNER',
      executeStep: async ({ step }) => {
        runnerInput = step.inputSnapshot.pluginRunnerBinding as Record<string, unknown>;
        return { success: true, detail: { executionStatus: 'SUCCESS', runner: 'plugin' } };
      },
    }, {
      type: 'CONTROL_PLANE_TLS',
      executeStep: async () => ({ success: true }),
    }]),
  );

  assert.equal(result.success, true);
  assert.equal(grantCalls.length, 1);
  assert.equal(grantCalls[0]?.executorType, 'PLUGIN_RUNNER');
  assert.deepEqual(grantCalls[0]?.allowedArtifactRefs, ['artifact://certificate-format/certfmt_test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  assert.equal((runnerInput?.grantRefs as string[])[0], 'grant-plugin-runner-1');
  assert.equal((runnerInput?.input as Record<string, unknown>)?.artifact && ((runnerInput?.input as Record<string, unknown>).artifact as Record<string, unknown>).artifactRef, 'artifact://certificate-format/certfmt_test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const steps = await service.listSteps({ tenantId: 'tenant_plugin_runner', executionRunId: created.run.id });
  const install = steps.find((step: any) => step.stepType === 'INSTALL');
  assert.equal(install?.status, 'SUCCESS');
  assert.equal((install?.inputSnapshot.pluginRunnerBinding as Record<string, unknown>)?.executionRunId, created.run.id);
});
