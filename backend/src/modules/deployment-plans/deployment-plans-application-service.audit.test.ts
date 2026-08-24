// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';

const now = '2026-08-10T00:00:00.000Z';

function createPlan(status = 'DRAFT') {
  return {
    id: 'plan_audit_wait',
    tenantId: 'tenant_audit_wait',
    name: '审计等待测试计划',
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    certificateVersionId: 'certificate_version_audit_wait',
    status,
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: 'snapshot_audit_wait',
    idempotencyKey: 'idempotency_audit_wait',
    requestHash: 'request_audit_wait',
    policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
    createdReason: 'MANUAL',
    createdAt: now,
    updatedAt: now,
    createdBy: 'actor_audit_wait',
    version: 1,
  };
}

function createTarget(planId = 'plan_audit_wait') {
  return {
    id: 'target_audit_wait',
    tenantId: 'tenant_audit_wait',
    deploymentPlanId: planId,
    executionTargetId: 'execution_target_audit_wait',
    executorType: 'AGENT',
    requiredCapabilities: [],
    matchResult: { status: 'assumed' },
    status: 'READY',
    createdAt: now,
    updatedAt: now,
    createdBy: 'actor_audit_wait',
    version: 1,
  };
}

function createAuditGate() {
  let release;
  let resolveGate;
  const gate = new Promise((resolve) => {
    resolveGate = resolve;
  });
  const audit = {
    started: false,
    writes: 0,
    write: async () => {
      audit.started = true;
      audit.writes += 1;
      await gate;
      throw new Error('审计存储不可用');
    },
  };
  release = () => resolveGate();
  return { audit, release };
}

function createService(audit) {
  const plan = createPlan();
  const target = createTarget(plan.id);
  const repository = {
    getPlanOrThrow: async () => plan,
    findPlanByIdempotencyKey: async () => undefined,
    createPlan: async (input) => ({ ...plan, ...input }),
    createTarget: async (input) => input,
    updatePlan: async (_id, patch) => ({ ...plan, ...patch }),
    updateTarget: async () => undefined,
    listTargetsByPlan: async () => [target],
    deleteTargetsByPlan: async () => undefined,
  };
  const domain = {
    assertCreateInput: () => undefined,
    buildRequestHash: () => 'request_audit_wait',
    normalizePolicy: (policy) => ({
      riskLevel: 'low',
      approvalRequired: false,
      failurePolicy: 'rollback',
      ...policy,
    }),
    buildSnapshotHash: () => 'snapshot_audit_wait',
    defaultExecutorType: (executorType) => executorType ?? 'AGENT',
  };
  const service = new DeploymentPlansApplicationService({
    repository,
    audit,
    approval: {} as never,
    domain: domain as never,
    executions: {
      listRuns: async () => [],
      cancelRun: async () => undefined,
    } as never,
    gateways: {} as never,
    bindings: {} as never,
    assets: {} as never,
    agents: {} as never,
    agentsApp: {} as never,
    certificates: {} as never,
    certificatesApp: {} as never,
  });
  const privateService = service as any;
  const resolved = {
    selectionMode: 'EXPLICIT',
    certificateVersionId: plan.certificateVersionId,
    targets: [{
      certificateBindingId: 'binding_audit_wait',
      executionTargetId: target.executionTargetId,
      executorType: 'AGENT',
      requiredCapabilities: [],
      matchResult: { status: 'assumed' },
    }],
  };
  const applicationAssetDraft = {
    name: plan.name,
    certificateVersionId: plan.certificateVersionId,
    selectionMode: 'EXPLICIT',
    targets: resolved.targets,
    idempotencyKey: 'idempotency_update_audit_wait',
    actorId: 'actor_audit_wait',
    tenantId: plan.tenantId,
  };

  privateService.resolveCreateInput = async () => resolved;
  privateService.buildCreateInputFromApplicationAsset = async () => applicationAssetDraft;
  privateService.normalizeGatewayRoute = async () => undefined;
  privateService.normalizeRouteMatchResult = () => ({ status: 'assumed' });
  privateService.persistDeploymentInputSnapshot = async () => undefined;
  privateService.recordTransition = async () => undefined;
  privateService.transitionPlan = async (currentPlan) => ({ ...currentPlan, status: 'CANCELLED' });
  privateService.toDto = async (entity) => entity;

  return {
    service,
    plan,
    target,
    createInput: {
      name: plan.name,
      certificateVersionId: plan.certificateVersionId,
      selectionMode: 'EXPLICIT',
      targets: resolved.targets,
      idempotencyKey: 'idempotency_create_audit_wait',
      actorId: 'actor_audit_wait',
      tenantId: plan.tenantId,
    },
    updateInput: {
      applicationAssetId: 'application_asset_audit_wait',
      planId: plan.id,
      idempotencyKey: 'idempotency_update_audit_wait',
      actorId: 'actor_audit_wait',
      tenantId: plan.tenantId,
    },
  };
}

async function assertAuditIsAwaited(invoke, audit, release) {
  const operation = invoke();
  let settled = false;
  void operation.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  for (let attempt = 0; attempt < 20 && !audit.started; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(audit.started, true, '业务方法应触发审计写入');
  assert.equal(settled, false, '审计写入完成前业务方法不应返回');

  release();
  await operation;
  assert.equal(audit.writes, 1);
}

test('创建部署计划等待审计写入且吞掉审计异常', async () => {
  const { audit, release } = createAuditGate();
  const { service, createInput } = createService(audit);
  await assertAuditIsAwaited(() => service.create(createInput), audit, release);
});

test('更新草稿等待审计写入且吞掉审计异常', async () => {
  const { audit, release } = createAuditGate();
  const { service, updateInput } = createService(audit);
  await assertAuditIsAwaited(() => service.updateDraftFromApplicationAsset(updateInput), audit, release);
});

test('取消部署计划等待审计写入且吞掉审计异常', async () => {
  const { audit, release } = createAuditGate();
  const { service, plan } = createService(audit);
  await assertAuditIsAwaited(() => service.cancel({ planId: plan.id, actorId: plan.createdBy, tenantId: plan.tenantId }), audit, release);
});

test('能力重算等待审计写入且吞掉审计异常', async () => {
  const { audit, release } = createAuditGate();
  const { service, plan, target } = createService(audit);
  await assertAuditIsAwaited(() => service.reevaluateCapabilities({
    planId: plan.id,
    actorId: plan.createdBy,
    tenantId: plan.tenantId,
    targetResults: [{ targetId: target.id, matchResult: { status: 'assumed' } }],
  }), audit, release);
});

test('审批判定只使用租户全局开关和应用级审批配置', async () => {
  const { service, plan } = createService({ write: async () => undefined } as never);
  const requiresApproval = (service as any).requiresApproval.bind(service);

  assert.equal(await requiresApproval({ ...plan, policy: { ...plan.policy, approvalRequired: false } }, { approvalEnabled: false, dryRunEnabled: false }), false);
  assert.equal(await requiresApproval({ ...plan, policy: { ...plan.policy, approvalRequired: true } }, { approvalEnabled: false, dryRunEnabled: false }), true);
  assert.equal(await requiresApproval({ ...plan, policy: { ...plan.policy, approvalRequired: false } }, { approvalEnabled: true, dryRunEnabled: false }), true);
});
