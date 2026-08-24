// @ts-nocheck
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDeploymentPersistenceRepositories } from '../../persistence/repositories/deployment-persistence-factory.js';

describe('部署计划持久化仓储', () => {
  it('重建仓储工厂后保留计划、目标、运行、步骤和状态流转', async () => {
    const persistence = createDeploymentPersistenceRepositories({ backend: 'postgres' });
    const now = new Date().toISOString();

    await persistence.deploymentPlans.createPlan({
      id: 'pln_persist_1',
      tenantId: 'tenant_persist',
      name: '持久化部署计划',
      planType: 'UPDATE',
      certificateVersionId: 'certver_persist_1',
      status: 'RUNNING',
      approvalStatus: 'NOT_REQUIRED',
      snapshotHash: 'snapshot_persist_1',
      idempotencyKey: 'idem_persist_plan',
      requestHash: 'request_persist_plan',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
      createdReason: 'MANUAL',
      createdAt: now,
      updatedAt: now,
      createdBy: 'user_persist',
      version: 1,
    });
    await persistence.deploymentPlans.createTarget({
      id: 'dpt_persist_1',
      tenantId: 'tenant_persist',
      deploymentPlanId: 'pln_persist_1',
      certificateBindingId: 'binding_persist_1',
      executionTargetId: 'target_persist_1',
      executorType: 'AGENT',
      requiredCapabilities: ['certificate.backup', 'certificate.install', 'service.reload', 'tls.verify'],
      matchResult: { status: 'assumed' },
      status: 'READY',
      createdAt: now,
      updatedAt: now,
      createdBy: 'user_persist',
      version: 1,
    });
    await persistence.deploymentPlans.createTransition({
      id: 'ste_persist_plan_running',
      tenantId: 'tenant_persist',
      entityType: 'deploymentPlan',
      entityId: 'pln_persist_1',
      fromStatus: 'READY',
      toStatus: 'RUNNING',
      event: 'execution.started',
      actorType: 'user',
      actorId: 'user_persist',
      createdAt: now,
    });

    await persistence.executions.createRun({
      id: 'run_persist_1',
      tenantId: 'tenant_persist',
      deploymentPlanId: 'pln_persist_1',
      runNo: 1,
      type: 'apply',
      idempotencyKey: 'idem_persist_run',
      requestHash: 'request_persist_run',
      status: 'DISPATCHED',
      concurrencyLimit: 1,
      summary: {},
      createdAt: now,
      updatedAt: now,
      createdBy: 'user_persist',
      version: 1,
    });

    for (const [index, stepType] of (['BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'] as const).entries()) {
      const stepNo = index + 1;
      await persistence.executions.createStep({
        id: `stp_persist_${stepNo}`,
        tenantId: 'tenant_persist',
        executionRunId: 'run_persist_1',
        deploymentPlanTargetId: 'dpt_persist_1',
        stepNo,
        stepType,
        name: `持久化步骤${stepNo}`,
        dependsOn: stepNo === 1 ? [] : [stepNo - 1],
        idempotent: stepType !== 'RELOAD',
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: { deploymentPlanTargetId: 'dpt_persist_1' },
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        createdBy: 'user_persist',
        version: 1,
      });
      await persistence.executions.updateStep(`stp_persist_${stepNo}`, { status: 'SUCCESS', startedAt: now, finishedAt: now, updatedAt: now, updatedBy: 'orchestrator_persist' });
      await persistence.deploymentPlans.createTransition({
        id: `ste_persist_step_${stepNo}`,
        tenantId: 'tenant_persist',
        entityType: 'executionStep',
        entityId: `stp_persist_${stepNo}`,
        fromStatus: 'PENDING',
        toStatus: 'SUCCESS',
        event: 'test.step.success',
        actorType: 'orchestrator',
        actorId: 'orchestrator_persist',
        createdAt: now,
      });
    }

    await persistence.executions.updateRun('run_persist_1', { status: 'SUCCESS', startedAt: now, finishedAt: now, updatedAt: now, updatedBy: 'orchestrator_persist' });
    await persistence.deploymentPlans.updateTarget('dpt_persist_1', { status: 'COMPLETED', updatedAt: now, updatedBy: 'orchestrator_persist' });
    await persistence.deploymentPlans.updatePlan('pln_persist_1', { status: 'SUCCESS', updatedAt: now, updatedBy: 'orchestrator_persist' });
    await persistence.deploymentPlans.createTransition({
      id: 'ste_persist_run_success',
      tenantId: 'tenant_persist',
      entityType: 'executionRun',
      entityId: 'run_persist_1',
      fromStatus: 'DISPATCHED',
      toStatus: 'SUCCESS',
      event: 'test.run.success',
      actorType: 'orchestrator',
      actorId: 'orchestrator_persist',
      createdAt: now,
    });
    await persistence.deploymentPlans.createTransition({
      id: 'ste_persist_plan_success',
      tenantId: 'tenant_persist',
      entityType: 'deploymentPlan',
      entityId: 'pln_persist_1',
      fromStatus: 'RUNNING',
      toStatus: 'SUCCESS',
      event: 'test.plan.success',
      actorType: 'orchestrator',
      actorId: 'orchestrator_persist',
      createdAt: now,
    });

    const rebuilt = createDeploymentPersistenceRepositories({ backend: 'postgres' });
    const persistedPlan = await rebuilt.deploymentPlans.getPlanOrThrow('pln_persist_1', 'tenant_persist');
    const persistedTargets = await rebuilt.deploymentPlans.listTargetsByPlan('pln_persist_1', 'tenant_persist');
    const persistedRuns = await rebuilt.executions.listRuns('tenant_persist', 'pln_persist_1');
    const persistedSteps = await rebuilt.executions.listSteps('tenant_persist', 'run_persist_1');
    const persistedTransitions = await rebuilt.deploymentPlans.listTransitions();

    assert.equal(persistence.durable, true);
    assert.equal(persistedPlan.status, 'SUCCESS');
    assert.equal(persistedTargets.length, 1);
    assert.equal(persistedTargets[0].status, 'COMPLETED');
    assert.equal(persistedRuns.length, 1);
    assert.equal(persistedRuns[0].status, 'SUCCESS');
    assert.equal(persistedSteps.length, 4);
    assert.equal(persistedSteps.every((step) => step.status === 'SUCCESS'), true);
    assert.equal(persistedTransitions.some((event) => event.entityType === 'deploymentPlan' && event.toStatus === 'SUCCESS'), true);
    assert.equal(persistedTransitions.some((event) => event.entityType === 'executionRun' && event.toStatus === 'SUCCESS'), true);
    assert.equal(persistedTransitions.some((event) => event.entityType === 'executionStep' && event.toStatus === 'SUCCESS'), true);
  });
});
