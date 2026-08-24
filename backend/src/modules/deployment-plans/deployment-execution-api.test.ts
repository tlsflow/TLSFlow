import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from '../security/security.controller.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import { DeploymentPlansController } from './controller/deployment-plans.controller.js';
import type { CreateDeploymentPlanInput } from './dto/deployment-plans.dto.js';

const userHeaders = { 'x-actor-id': 'user_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_test' };
const approverHeaders = { 'x-actor-id': 'approver_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_approve' };

function createPlanBody(idempotencyKey = 'idem_plan_1', riskLevel: 'low' | 'high' = 'low'): Omit<CreateDeploymentPlanInput, 'actorId' | 'tenantId'> {
  return {
    name: '更新 nginx 证书',
    certificateVersionId: 'certver_1',
    idempotencyKey,
    policy: { riskLevel, approvalRequired: riskLevel === 'high', failurePolicy: 'rollback' },
    targets: [
      { certificateBindingId: 'binding_1', executionTargetId: 'target_1', executorType: 'AGENT' },
    ],
  };
}

async function createReadyLowRiskPlan(app: ReturnType<typeof createApp>, idempotencyKey = 'idem_plan_low') {
  const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(idempotencyKey, 'low') });
  assert.equal(created.statusCode, 201);
  const plan = created.body as { id: string };
  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
  assert.equal(submitted.statusCode, 200);
  return submitted.body as { id: string; status: string };
}

async function createApprovedHighRiskPlan(app: ReturnType<typeof createApp>, idempotencyKey = 'idem_plan_high') {
  const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(idempotencyKey, 'high') });
  assert.equal(created.statusCode, 201);
  const plan = created.body as { id: string };
  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
  assert.equal(submitted.statusCode, 200);
  const pending = submitted.body as { approvalId: string; status: string };
  assert.equal(pending.status, 'PENDING_APPROVAL');
  assert.ok(pending.approvalId);

  const decided = await app.inject({ method: 'POST', path: '/api/v1/approvals/decide', headers: approverHeaders, body: { approvalId: pending.approvalId, decision: 'approved' } });
  assert.equal(decided.statusCode, 200);
  return { planId: plan.id, approvalId: pending.approvalId };
}

describe('部署计划与执行编排 API', () => {
  it('创建部署计划成功，并展开 certificateBindingId 目标', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody() });

    assert.equal(response.statusCode, 201);
    const plan = response.body as { status: string; targets: Array<{ certificateBindingId: string; deploymentPlanId: string }> };
    assert.equal(plan.status, 'DRAFT');
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].certificateBindingId, 'binding_1');
    assert.ok(plan.targets[0].deploymentPlanId);
  });

  it('部署目标必须引用 certificateBindingId，禁止直接部署到 Host', async () => {
    const app = createApp();
    const body = { ...createPlanBody('idem_missing_binding'), targets: [{ hostId: 'host_1', executorType: 'SSH' }] };
    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body });

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('提交低风险计划进入 READY，高风险计划进入审批', async () => {
    const app = createApp();
    const ready = await createReadyLowRiskPlan(app, 'idem_submit_low');
    assert.equal(ready.status, 'READY');

    const createdHigh = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody('idem_submit_high', 'high') });
    const highPlan = createdHigh.body as { id: string };
    const pending = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: highPlan.id } });
    assert.equal(pending.statusCode, 200);
    assert.equal((pending.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('无审批执行高风险计划失败', async () => {
    const app = createApp();
    const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody('idem_no_approval', 'high') });
    const plan = created.body as { id: string };

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_run_denied' } });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as { errorCode: string }).errorCode, 'DEPLOYMENT_APPROVAL_REQUIRED');
  });

  it('有审批执行高风险计划成功入队，并生成 ExecutionRun 和 ExecutionStep', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({ subjectType: 'user', subjectId: 'approver_1', effect: 'allow', actions: ['approval.decide'], resourceTypes: ['approval'], scope: { tenantId: 'tenant_1' } });
    const app = createApp({ security });
    const { planId, approvalId } = await createApprovedHighRiskPlan(app, 'idem_approved_high');

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId, approvalId, idempotencyKey: 'idem_run_high' } });

    assert.equal(response.statusCode, 200);
    const body = response.body as { plan: { status: string }; run: { status: string; externalRunId: string }; steps: unknown[]; jobId: string };
    assert.equal(body.plan.status, 'RUNNING');
    assert.equal(body.run.status, 'DISPATCHED');
    assert.ok(body.jobId);
    assert.equal(body.steps.length, 4);
  });

  it('dry-run 创建执行运行，步骤全部标记 dryRun=true 且不推进计划到 RUNNING', async () => {
    const app = createApp();
    const plan = await createReadyLowRiskPlan(app, 'idem_dry_run_plan');

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/dry-run', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_dry_run' } });

    assert.equal(response.statusCode, 200);
    const body = response.body as { plan: { status: string }; run: { type: string; status: string }; steps: Array<{ stepType: string; inputSnapshot: { dryRun?: boolean } }> };
    assert.equal(body.plan.status, 'READY');
    assert.equal(body.run.type, 'dry_run');
    assert.equal(body.run.status, 'DISPATCHED');
    assert.deepEqual(body.steps.map((step) => step.stepType), ['DISCOVER', 'VERIFY']);
    assert.equal(body.steps.every((step) => step.inputSnapshot.dryRun === true), true);
  });

  it('mock executor 成功时 run 和 step 从 DISPATCHED/RUNNING 走到 SUCCESS', async () => {
    const deploymentService = new DeploymentPlansApplicationService();
    const app = createApp({ deploymentPlans: new DeploymentPlansController(deploymentService) });
    const plan = await createReadyLowRiskPlan(app, 'idem_mock_success_plan');
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_mock_success_run' } });
    const runId = (executed.body as { run: { id: string } }).run.id;

    const jobResult = await deploymentService.getExecutionsService().runNextJobForTest();
    const run = deploymentService.getExecutionsService().getRun(runId, 'tenant_1');
    const steps = deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: runId });

    assert.equal(jobResult?.success, true);
    assert.equal(run.status, 'SUCCESS');
    assert.equal(steps.every((step) => step.status === 'SUCCESS'), true);
  });

  it('mock executor 失败时 run 走到 FAILED，并留下失败 step', async () => {
    const deploymentService = new DeploymentPlansApplicationService();
    const plan = deploymentService.create({ ...createPlanBody('idem_mock_fail_plan', 'low'), actorId: 'user_1', tenantId: 'tenant_1' }, { actor: { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } } });
    const ready = deploymentService.submit({ planId: plan.id, actorId: 'user_1', tenantId: 'tenant_1' });
    const targetId = ready.targets[0].id;
    const created = await deploymentService.getExecutionsService().createApplyRun({
      deploymentPlanId: ready.id,
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_mock_fail_run',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'AGENT']]),
      mockResultByTargetId: new Map([[targetId, 'fail']]),
    });

    const jobResult = await deploymentService.getExecutionsService().runNextJobForTest();
    const run = deploymentService.getExecutionsService().getRun(created.run.id, 'tenant_1');
    const steps = deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(jobResult?.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(steps.some((step) => step.status === 'FAILED'), true);
    assert.equal(steps.some((step) => step.status === 'PENDING'), true);
  });

  it('取消计划会传播到已入队 run，并取消未开始步骤', async () => {
    const deploymentService = new DeploymentPlansApplicationService();
    const app = createApp({ deploymentPlans: new DeploymentPlansController(deploymentService) });
    const plan = await createReadyLowRiskPlan(app, 'idem_cancel_plan');
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_cancel_run' } });
    const runId = (executed.body as { run: { id: string } }).run.id;

    const cancelled = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/cancel', headers: userHeaders, body: { planId: plan.id, reason: '用户取消' } });
    const run = deploymentService.getExecutionsService().getRun(runId, 'tenant_1');
    const steps = deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: runId });

    assert.equal(cancelled.statusCode, 200);
    assert.equal(run.status, 'CANCELLED');
    assert.equal(steps.every((step) => step.status === 'SKIPPED'), true);
  });

  it('执行失败后可以进入回滚', async () => {
    const deploymentService = new DeploymentPlansApplicationService();
    const app = createApp({ deploymentPlans: new DeploymentPlansController(deploymentService) });
    const plan = await createReadyLowRiskPlan(app, 'idem_rollback_plan');
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_rollback_run' } });
    assert.equal(executed.statusCode, 200);
    const runId = (executed.body as { run: { id: string } }).run.id;

    // 编排壳不接真实 SSH/Agent；这里通过服务层把 run 推到 FAILED，验证公开 rollback API。
    const failedRun = deploymentService.markRunFailedForTest(runId, 'orchestrator_1', 'tenant_1');
    assert.equal(failedRun.status, 'FAILED');

    const rollback = await app.inject({ method: 'POST', path: '/api/v1/execution-runs/rollback', headers: userHeaders, body: { runId, idempotencyKey: 'idem_rollback_ok' } });
    assert.equal(rollback.statusCode, 200);
    const body = rollback.body as { sourceRun: { status: string }; rollbackRun: { status: string }; steps: unknown[]; jobId: string };
    assert.equal(body.sourceRun.status, 'ROLLBACK_RUNNING');
    assert.equal(body.rollbackRun.status, 'DISPATCHED');
    assert.equal(body.steps.length, 2);
    assert.ok(body.jobId);
  });

  it('回滚缺少源步骤目标时拒绝创建空 rollback', async () => {
    const deploymentService = new DeploymentPlansApplicationService();
    const plan = deploymentService.create({ ...createPlanBody('idem_empty_rollback_plan', 'low'), actorId: 'user_1', tenantId: 'tenant_1' }, { actor: { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } } });
    const ready = deploymentService.submit({ planId: plan.id, actorId: 'user_1', tenantId: 'tenant_1' });
    const created = await deploymentService.getExecutionsService().createApplyRun({
      deploymentPlanId: ready.id,
      deploymentPlanTargetIds: [],
      type: 'apply',
      idempotencyKey: 'idem_empty_rollback_run',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map(),
    });
    deploymentService.markRunFailedForTest(created.run.id, 'orchestrator_1', 'tenant_1');
    const app = createApp({ deploymentPlans: new DeploymentPlansController(deploymentService) });

    const rollback = await app.inject({ method: 'POST', path: '/api/v1/execution-runs/rollback', headers: userHeaders, body: { runId: created.run.id, idempotencyKey: 'idem_empty_rollback' } });

    assert.equal(rollback.statusCode, 400);
    assert.equal((rollback.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('非法状态跳转失败', async () => {
    const app = createApp();
    const plan = await createReadyLowRiskPlan(app, 'idem_illegal_state');
    const cancelled = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/cancel', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(cancelled.statusCode, 200);

    const execute = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_illegal_run' } });
    assert.equal(execute.statusCode, 409);
    assert.equal((execute.body as { errorCode: string }).errorCode, 'DEPLOYMENT_INVALID_STATE');
  });

  it('幂等键冲突失败', async () => {
    const app = createApp();
    const first = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody('idem_conflict', 'low') });
    assert.equal(first.statusCode, 201);

    const conflictBody = createPlanBody('idem_conflict', 'low');
    conflictBody.name = '另一份计划';
    const second = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: conflictBody });
    assert.equal(second.statusCode, 409);
    assert.equal((second.body as { errorCode: string }).errorCode, 'IDEMPOTENCY_CONFLICT');
  });

  it('能力匹配 blocked 的目标不能创建计划，manual_required 会强制进入审批', async () => {
    const app = createApp();
    const blocked = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody('idem_cap_blocked', 'low'),
        targets: [{ certificateBindingId: 'binding_1', executorType: 'AGENT', matchResult: { status: 'blocked', missingCapabilities: ['file.write'] } }],
      },
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal((blocked.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody('idem_cap_manual', 'low'),
        targets: [{ certificateBindingId: 'binding_1', executorType: 'AGENT', matchResult: { status: 'manual_required', manualRisk: [{ capabilityKey: 'file.write' }] } }],
      },
    });
    assert.equal(created.statusCode, 201);
    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: (created.body as { id: string }).id } });
    assert.equal((submitted.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('能力重评估会更新目标 matchResult，blocked 目标不进入 dry-run，degraded 强制审批', async () => {
    const app = createApp();
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody('idem_cap_reeval', 'low'),
        targets: [
          { certificateBindingId: 'binding_ok', executorType: 'AGENT' },
          { certificateBindingId: 'binding_blocked', executorType: 'AGENT' },
        ],
      },
    });
    assert.equal(created.statusCode, 201);
    const plan = created.body as { id: string; targets: Array<{ id: string; certificateBindingId: string }> };
    const okTarget = plan.targets.find((target) => target.certificateBindingId === 'binding_ok')!;
    const blockedTarget = plan.targets.find((target) => target.certificateBindingId === 'binding_blocked')!;

    const reevaluated = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/capabilities/reevaluate',
      headers: userHeaders,
      body: {
        planId: plan.id,
        targetResults: [
          { targetId: okTarget.id, matchResult: { status: 'degraded', missingCapabilities: ['service.reload'] } },
          { targetId: blockedTarget.id, matchResult: { status: 'blocked', missingCapabilities: ['file.write'] } },
        ],
      },
    });
    assert.equal(reevaluated.statusCode, 200);
    const updated = reevaluated.body as { policy: { approvalRequired: boolean; riskLevel: string }; targets: Array<{ id: string; status: string; matchResult: { status: string } }> };
    assert.equal(updated.policy.approvalRequired, true);
    assert.equal(updated.policy.riskLevel, 'high');
    assert.equal(updated.targets.find((target) => target.id === blockedTarget.id)?.status, 'FAILED');
    assert.equal(updated.targets.find((target) => target.id === okTarget.id)?.matchResult.status, 'degraded');

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_cap_reeval_dry' },
    });
    assert.equal(dryRun.statusCode, 200);
    const dryRunSteps = (dryRun.body as { steps: Array<{ deploymentPlanTargetId?: string }> }).steps;
    assert.equal(dryRunSteps.length, 2);
    assert.equal(dryRunSteps.every((step) => step.deploymentPlanTargetId === okTarget.id), true);

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal((submitted.body as { status: string }).status, 'PENDING_APPROVAL');
  });
});
