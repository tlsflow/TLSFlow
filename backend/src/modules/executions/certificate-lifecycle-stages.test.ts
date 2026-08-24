// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import { ExecutorRegistry, type Executor, type StepExecutionInput, type StepExecutionResult } from './application/executors.js';
import { ExecutionGrantService } from './execution-grant.service.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import { testDeploymentInputSnapshotsRepository, testTaskEnqueuer, withTestDeploymentInputSnapshot } from './deployment-input-runtime-snapshot.test-fixture.js';

class TrackingExecutor implements Executor {
  readonly calls: string[] = [];

  constructor(readonly type: string) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    this.calls.push(input.step.stepType);
    return { success: true };
  }
}

test('Apply 与 Dry-run 共用五阶段和一秒间隔，Agent v2 执行器覆盖备份、更新与重载阶段', async () => {
  for (const type of ['apply', 'dry_run'] as const) {
    const delays: number[] = [];
    const service = new ExecutionsApplicationService({
      deploymentPlansRepository: new DeploymentPlansRepository(),
      deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
      stageIntervalMs: 1_000,
      tasks: testTaskEnqueuer(),
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
      agentPayloadByTargetId: new Map([[targetId, withTestDeploymentInputSnapshot(`plan_lifecycle_${type}`, targetId, {
        pluginRuntimeCapability: { runtime: 'AGENT_V2' },
        certificateVerification: { connectHost: '127.0.0.1', serverName: 'example.test', port: 443 },
      })]]),
    });
    const agentExecutor = new TrackingExecutor('AGENT');
    const verifyExecutor = new TrackingExecutor('CONTROL_PLANE_TLS');
    const result = await service.runDispatchedExecution(
      created.run.id,
      'tester',
      'tenant_1',
      new ExecutorRegistry([agentExecutor, verifyExecutor]),
    );
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.success, true);
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.deepEqual(agentExecutor.calls, ['BACKUP', 'INSTALL', 'RELOAD']);
    assert.deepEqual(verifyExecutor.calls, ['VERIFY']);
    assert.equal(delays.length, 4);
    assert.equal(delays.every((milliseconds) => milliseconds > 0 && milliseconds <= 1_000), true);
  }
});

test('Apply 在目标宿主缺少根信任时先插入独立根信任阶段', async () => {
  const executionGrants = new ExecutionGrantService();
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    tasks: testTaskEnqueuer(),
    executionGrants,
  });
  const targetId = 'target_trust_stage';
  const created = await service.createApplyRun({
    deploymentPlanId: 'plan_trust_stage',
    deploymentPlanTargetIds: [targetId],
    type: 'apply',
    idempotencyKey: 'idem_trust_stage',
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map([[targetId, 'AGENT']]),
    agentPayloadByTargetId: new Map([[targetId, withTestDeploymentInputSnapshot('plan_trust_stage', targetId, {
      actionType: 'agent.plan.execute',
      pluginRuntimeCapability: { runtime: 'AGENT_V2' },
      plan: {
        planId: 'agent-plan-trust-stage',
        pluginId: 'fixture.certificate',
        pluginVersionId: 'plugin-version-trust-stage',
        capability: 'certificate.deploy',
        planDigest: 'f'.repeat(64),
      },
      executionAuthorization: {
        planId: 'plan_trust_stage',
        actions: ['certificate.trust.install', 'certificate.deploy'],
        lifetimeSeconds: 60,
      },
      certificateVerification: { connectHost: '127.0.0.1', serverName: 'example.test', port: 443 },
      certificateTrustPlan: {
        apiVersion: 'gcac.certificate-trust-plan/v1',
        decision: 'install',
        reasonCode: 'root_missing_install_required',
        actionType: 'certificate.trust.install',
        actionSchemaVersion: '1.0',
        store: 'root',
        agentId: 'agt_trust_stage',
        rootCertificateId: 'trustroot_1',
        fingerprintSha256: 'abc123',
        certificatePem: '-----BEGIN CERTIFICATE-----\\nTEST\\n-----END CERTIFICATE-----\\n',
        plannedAt: '2026-08-07T00:00:00.000Z',
        inspection: {
          actionType: 'certificate.trust.inspect',
          actionSchemaVersion: '1.0',
          status: 'not_found',
          inspectedAt: '2026-08-07T00:00:00.000Z',
          detail: { status: 'not_found', fingerprintSha256: 'abc123' },
        },
      },
    })]]),
  });
  const agentExecutor = new TrackingExecutor('AGENT');
  const verifyExecutor = new TrackingExecutor('CONTROL_PLANE_TLS');
  const result = await service.runDispatchedExecution(
    created.run.id,
    'tester',
    'tenant_1',
    new ExecutorRegistry([agentExecutor, verifyExecutor]),
  );
  const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

  assert.equal(result.success, true);
  assert.deepEqual(steps.map((step) => step.stepType), ['CUSTOM', 'DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
  assert.equal(steps[0]?.inputSnapshot.actionType, 'agent.plan.execute');
  assert.equal(steps[0]?.inputSnapshot.plan?.operations?.[0]?.operationType, 'certificate.store.install');
  assert.equal(steps[0]?.name, 'TRUST_INSTALL target_trust_stage');
  assert.deepEqual(agentExecutor.calls, ['CUSTOM', 'BACKUP', 'INSTALL', 'RELOAD']);
  assert.deepEqual(verifyExecutor.calls, ['VERIFY']);
});

test('Agent Grant 在步骤创建阶段失败时，运行不会遗留 PENDING', async () => {
  const executions = new ExecutionsRepository();
  const service = new ExecutionsApplicationService({
    repository: executions,
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    tasks: testTaskEnqueuer(),
    executionGrants: {
      create: async () => { throw new Error('grant unavailable'); },
    } as any,
  });
  const targetId = 'target_grant_failure_cleanup';

  await assert.rejects(
    service.createApplyRun({
      deploymentPlanId: 'plan_grant_failure_cleanup',
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_grant_failure_cleanup',
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'AGENT']]),
      agentPayloadByTargetId: new Map([[targetId, withTestDeploymentInputSnapshot('plan_grant_failure_cleanup', targetId, {
        actionType: 'agent.plan.execute',
        pluginRuntimeCapability: { runtime: 'AGENT_V2' },
        plan: {
          planId: 'agent-plan-grant-failure',
          agentId: 'agt-grant-failure',
          pluginId: 'fixture.certificate',
          pluginVersionId: 'plugin-version-grant-failure',
          capability: 'certificate.deploy',
          planDigest: 'f'.repeat(64),
        },
        executionAuthorization: {
          planId: 'plan_grant_failure_cleanup',
          actions: ['certificate.trust.install', 'certificate.deploy'],
          lifetimeSeconds: 60,
        },
        certificateTrustPlan: {
          actionType: 'certificate.trust.install',
          actionSchemaVersion: '1.0',
          decision: 'install',
          agentId: 'agt-grant-failure',
          fingerprintSha256: 'a'.repeat(64),
          certificatePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
          store: 'root',
        },
      })]]),
    }),
    /grant unavailable/,
  );

  const runs = await executions.listRuns('tenant_1', 'plan_grant_failure_cleanup');
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, 'FAILED');
  assert.equal(runs[0]?.errorCode, 'EXECUTION_STEP_CREATION_FAILED');
});
