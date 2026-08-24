import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';

test('LATEST_AUTO 的运行时材料封存到执行步骤，并优先于计划输入快照', async () => {
  const service = new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
  });
  const created = await service.createApplyRun({
    deploymentPlanId: 'plan_latest_auto_runtime',
    deploymentPlanTargetIds: ['target_latest_auto_runtime'],
    type: 'apply',
    idempotencyKey: 'idem_latest_auto_runtime',
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map([['target_latest_auto_runtime', 'AGENT']]),
    agentPayloadByTargetId: new Map([['target_latest_auto_runtime', {
      actionType: 'agent.atomic_plan.execute',
      actionSchemaVersion: '1.0',
      deploymentInputSnapshotRef: {
        apiVersion: 'gcac.deployment-input-snapshot/v1',
        snapshotId: 'dpis_latest_auto_runtime',
        revision: 1,
        resolvedSha256: 'a'.repeat(64),
      },
      executionRuntimeSnapshot: {
        apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
        resolvedDeploymentInput: {
          apiVersion: 'gcac.resolved-deployment-input/v1',
          resolvedSha256: 'b'.repeat(64),
        },
        deploymentArtifact: {
          certificateVersionId: 'certver_latest_auto',
          certificateFormatId: 'fmt_latest_auto',
          format: 'pfx',
          containsPrivateKey: true,
        },
      },
    }]]),
  });

  const step = created.steps[0]!;
  assert.equal(step.inputSnapshot.executionRuntimeSnapshot.deploymentArtifact.certificateVersionId, 'certver_latest_auto');
  const materialized = await (service as any).materializeRuntimeStep(step, 'tenant_1');
  assert.equal(materialized.inputSnapshot.deploymentArtifact.certificateVersionId, 'certver_latest_auto');
  assert.equal(materialized.inputSnapshot.resolvedDeploymentInput.resolvedSha256, 'b'.repeat(64));
});
