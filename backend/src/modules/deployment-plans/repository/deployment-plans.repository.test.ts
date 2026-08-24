// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { DeploymentPlansRepository } from './deployment-plans.repository.js';

test('部署计划精确 SQL 保持租户、资产和历史转换边界', async () => {
  const db = new PgliteDatabase();
  const repository = new DeploymentPlansRepository(db);
  try {
    assert.deepEqual(await repository.listPlans('tenant-a'), []);

    await repository.createPlan(plan('plan-a-old', 'tenant-a', '2026-08-17T01:00:00.000Z', 'DRAFT'));
    await repository.createPlan(plan('plan-a-new', 'tenant-a', '2026-08-17T02:00:00.000Z', 'DRAFT'));
    await repository.createPlan(plan('plan-b', 'tenant-b', '2026-08-17T03:00:00.000Z', 'DRAFT'));
    await repository.createTarget(target('target-a-old', 'tenant-a', 'plan-a-old', 'asset-a'));
    await repository.createTarget(target('target-a-new', 'tenant-a', 'plan-a-new', 'asset-a'));
    await repository.createTarget(target('target-b', 'tenant-b', 'plan-b', 'asset-a'));

    assert.deepEqual((await repository.listPlansByApplicationAsset('tenant-a', 'asset-a')).map((item) => item.id), ['plan-a-old', 'plan-a-new']);
    assert.equal((await repository.findPlanByIdempotencyKey('tenant-a', 'tester', 'idempotency-plan-a-old'))?.id, 'plan-a-old');
    assert.equal(await repository.findPlanByIdempotencyKey('tenant-b', 'tester', 'idempotency-plan-a-old'), undefined);
    assert.equal((await repository.findLatestManualDraftByApplicationAsset('tenant-a', 'asset-a'))?.id, 'plan-a-new');

    await repository.createTransition(transition('transition-a', 'tenant-a', 'plan-a-new'));
    await repository.createTransition(transition('transition-b', 'tenant-b', 'plan-a-new'));
    assert.deepEqual((await repository.listTransitions('plan-a-new')).map((item) => item.id), ['transition-a', 'transition-b']);
    assert.equal(await repository.deleteTransitionsByEntityIds(['plan-a-new'], 'tenant-a'), 1);
    assert.deepEqual((await repository.listTransitions('plan-a-new')).map((item) => item.id), ['transition-b']);
  } finally {
    await db.close();
  }
});

function plan(id, tenantId, createdAt, status) {
  return {
    id,
    tenantId,
    name: id,
    planType: 'UPDATE',
    certificateVersionId: 'certificate-version',
    status,
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: `snapshot-${id}`,
    idempotencyKey: `idempotency-${id}`,
    requestHash: `request-${id}`,
    policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
    createdReason: 'MANUAL',
    createdAt,
    updatedAt: createdAt,
    createdBy: 'tester',
    version: 1,
  };
}

function target(id, tenantId, deploymentPlanId, applicationAssetId) {
  return {
    id,
    tenantId,
    deploymentPlanId,
    applicationAssetId,
    certificateBindingId: `binding-${id}`,
    executionTargetId: `execution-${id}`,
    executorType: 'AGENT',
    requiredCapabilities: [],
    status: 'READY',
    createdAt: '2026-08-17T01:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
    createdBy: 'tester',
    version: 1,
  };
}

function transition(id, tenantId, entityId) {
  return {
    id,
    tenantId,
    entityType: 'deploymentPlan',
    entityId,
    toStatus: 'READY',
    event: 'test.transition',
    actorType: 'system',
    createdAt: '2026-08-17T01:00:00.000Z',
  };
}
