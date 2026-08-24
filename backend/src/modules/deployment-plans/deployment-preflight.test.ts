import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import type { CertificateVersionEntity } from '../certificates/schema/certificates.schema.js';
import type { DeploymentPlanEntity } from './schema/deployment-plans.schema.js';

test('部署计划预检一次返回多个目标的证书产物问题', async () => {
  const certificateVersion = {
    id: 'certver-preflight',
    certificateAssetId: 'certasset-preflight',
    versionNo: 1,
    sans: ['preflight.example.com'],
    issuer: { raw: 'issuer' },
    subject: { raw: 'subject' },
    serialNumber: 'preflight',
    notBefore: '2026-07-01T00:00:00.000Z',
    notAfter: '2026-10-25T00:00:00.000Z',
    fingerprintSha256: 'preflight',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'SHA256',
    leafStorageRef: 'storage://preflight',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
  } satisfies CertificateVersionEntity;
  const service = new DeploymentPlansApplicationService({
    certificates: {
      getVersion: async (id: string) => id === certificateVersion.id ? certificateVersion : undefined,
    } as never,
    bindings: {
      getCertificateBinding: async () => undefined,
    } as never,
  });

  await assert.rejects(() => service.create({
    name: '聚合预检',
    selectionMode: 'EXPLICIT',
    certificateVersionId: certificateVersion.id,
    idempotencyKey: 'preflight-aggregate',
    actorId: 'user-preflight',
    tenantId: 'tenant-preflight',
    targets: [
      { executorType: 'WORKFLOW', executionTargetId: 'target-1', certificateBindingId: 'missing-binding', strategyPayload: { workflowRequest: {} } },
      { executorType: 'WORKFLOW', executionTargetId: 'target-2', strategyPayload: { workflowRequest: {} } },
    ],
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.errorCode, 'VALIDATION_FAILED');
    const details = error.details as { code?: string; issues?: Array<{ stage: string; targetIndex: number }> };
    assert.equal(details.code, 'DEPLOYMENT_PREFLIGHT_FAILED');
    assert.deepEqual(details.issues?.map((issue) => ({ stage: issue.stage, targetIndex: issue.targetIndex })), [
      { stage: 'TARGET', targetIndex: 0 },
      { stage: 'ARTIFACT', targetIndex: 1 },
    ]);
    return true;
  });
});

test('证书部署计划优先使用应用资产域名，而不是运行快照绑定字段', async () => {
  const certificateVersion = {
    id: 'certver-domain-consistency',
    certificateAssetId: 'certasset-domain-consistency',
    versionNo: 1,
    commonName: '*.jacksonz.cn',
    sans: ['*.jacksonz.cn'],
    issuer: { raw: 'issuer' },
    subject: { raw: 'subject' },
    serialNumber: 'domain-consistency',
    notBefore: '2026-07-01T00:00:00.000Z',
    notAfter: '2026-10-25T00:00:00.000Z',
    fingerprintSha256: 'domain-consistency',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'SHA256',
    leafStorageRef: 'storage://domain-consistency',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
  } satisfies CertificateVersionEntity;
  const certificateAsset = {
    id: certificateVersion.certificateAssetId,
    name: '*.jacksonz.cn',
    primaryDomain: '*.jacksonz.cn',
    sans: ['*.jacksonz.cn'],
    sourceType: 'manual',
    status: 'ACTIVE',
    tags: [],
    createdBy: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
  const binding = {
    id: 'binding-domain-consistency',
    tenantId: 'tenant-domain-consistency',
    serviceInstanceId: 'service-instance-domain-consistency',
    domainName: 'other.example.com',
    bindingKey: 'other',
    bindingType: 'FILE',
    verifyMethod: 'TLS_CONNECT',
    status: 'MANAGED',
    metadata: {},
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    version: 1,
  } as const;
  const service = new DeploymentPlansApplicationService({
    certificates: {
      getVersion: async (id: string) => id === certificateVersion.id ? certificateVersion : undefined,
      getAsset: async (id: string) => id === certificateAsset.id ? certificateAsset : undefined,
    } as never,
    bindings: {
      getCertificateBinding: async (tenantId: string, id: string) => tenantId === binding.tenantId && id === binding.id ? binding : undefined,
    } as never,
  });

  const createInput = (idempotencyKey: string, domain?: string) => ({
    name: '域名一致性校验',
    selectionMode: 'EXPLICIT' as const,
    certificateVersionId: certificateVersion.id,
    idempotencyKey,
    actorId: 'user-domain-consistency',
    tenantId: binding.tenantId,
    targets: [{
      certificateBindingId: binding.id,
      domain,
      executorType: 'AGENT' as const,
    }],
  });

  await assert.rejects(() => service.create(createInput('domain-consistency-application-asset', 'test02.jacksonz.cn')), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.errorCode, 'VALIDATION_FAILED');
    assert.match(error.message, /部署目标缺少证书产物绑定或 certificateFormatId/);
    const details = error.details as { issues?: Array<{ stage?: string; targetIndex?: number }> };
    assert.deepEqual(details.issues?.map((issue) => ({ stage: issue.stage, targetIndex: issue.targetIndex })), [
      { stage: 'ARTIFACT', targetIndex: 0 },
    ]);
    return true;
  });

  await assert.rejects(() => service.create({
    ...createInput('domain-consistency-workflow', 'other.example.com'),
    targets: [{
      domain: 'other.example.com',
      executorType: 'WORKFLOW' as const,
      strategyPayload: { workflowRequest: {} },
    }],
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.errorCode, 'VALIDATION_FAILED');
    assert.match(error.message, /证书版本域名与部署目标域名不匹配/);
    const details = error.details as { issues?: Array<{ stage?: string; targetIndex?: number }> };
    assert.deepEqual(details.issues?.map((issue) => ({ stage: issue.stage, targetIndex: issue.targetIndex })), [
      { stage: 'VERSION', targetIndex: 0 },
    ]);
    return true;
  });
});

test('临时部署计划不进入部署计划列表，并可在执行结束后清理', async () => {
  const now = '2026-08-08T00:00:00.000Z';
  const makePlan = (id: string, temporary?: boolean): DeploymentPlanEntity => ({
    id,
    tenantId: 'tenant-temporary',
    name: id,
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    certificateVersionId: 'certver-temporary',
    status: 'SUCCESS',
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: `${id}-snapshot`,
    idempotencyKey: `${id}-idempotency`,
    requestHash: `${id}-request`,
    policy: { approvalRequired: false, riskLevel: 'medium', failurePolicy: 'stop' },
    createdReason: 'MANUAL',
    temporary,
    createdAt: now,
    updatedAt: now,
    createdBy: 'automation',
    version: 1,
  });
  const temporaryPlan = makePlan('plan-temporary', true);
  const visiblePlan = makePlan('plan-visible');
  const deleted: string[] = [];
  const repository = {
    listPlans: async () => [temporaryPlan, visiblePlan],
    listTargetsByPlans: async () => [],
    getPlan: async (id: string) => id === temporaryPlan.id ? temporaryPlan : undefined,
    listTargetsByPlan: async () => [],
    deleteTransitionsByEntityIds: async () => 0,
    deleteTargetsByPlan: async () => undefined,
    deletePlan: async (id: string) => { deleted.push(id); },
  };
  const service = new DeploymentPlansApplicationService({
    repository: repository as never,
    executions: { listRuns: async () => [] } as never,
    approval: { getMany: async () => new Map(), deleteByDeploymentPlan: async () => [] } as never,
  });

  const listed = await service.list({ tenantId: 'tenant-temporary' });
  assert.deepEqual(listed.map((plan) => plan.id), [visiblePlan.id]);
  assert.equal(await service.cleanupTemporaryPlan({ planId: temporaryPlan.id, tenantId: 'tenant-temporary' }), true);
  assert.deepEqual(deleted, [temporaryPlan.id]);
});

test('历史工作流目标缺少固定身份快照时仍可读取部署计划列表', async () => {
  const now = '2026-08-12T00:00:00.000Z';
  const plan: DeploymentPlanEntity = {
    id: 'plan-legacy-workflow-list',
    tenantId: 'tenant-legacy-workflow-list',
    name: '历史工作流计划',
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    certificateVersionId: 'certver-legacy-workflow-list',
    status: 'READY',
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: 'snapshot-legacy-workflow-list',
    idempotencyKey: 'idempotency-legacy-workflow-list',
    requestHash: 'request-legacy-workflow-list',
    policy: { riskLevel: 'medium', approvalRequired: false, failurePolicy: 'stop' },
    createdReason: 'MANUAL',
    createdAt: now,
    updatedAt: now,
    createdBy: 'user-legacy-workflow-list',
    version: 1,
  };
  const target = {
    id: 'target-legacy-workflow-list',
    tenantId: plan.tenantId,
    deploymentPlanId: plan.id,
    executorType: 'WORKFLOW',
    requiredCapabilities: ['workflow.run'],
    strategyPayload: {
      executionSource: {
        type: 'WORKFLOW',
        workflowVersionSelection: 'FIXED',
        workflowTemplateId: 'workflow-legacy',
      },
    },
    status: 'READY',
    createdAt: now,
    updatedAt: now,
    createdBy: plan.createdBy,
    version: 1,
  };
  const service = new DeploymentPlansApplicationService({
    repository: {
      listPlans: async () => [plan],
      listTargetsByPlans: async () => [target],
      listTargetsByPlan: async () => [target],
    } as never,
    executions: { listRuns: async () => [] } as never,
    approval: { getMany: async () => new Map() } as never,
  });

  const listed = await service.list({ tenantId: plan.tenantId });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, plan.id);
  assert.equal(listed[0]?.targets[0]?.id, target.id);
  assert.equal(listed[0]?.workflowExecutionIdentities, undefined);
});

test('历史工作流快照读取兼容不放宽正式执行校验', async () => {
  const target = {
    id: 'target-legacy-workflow-execution',
    tenantId: 'tenant-legacy-workflow-execution',
    deploymentPlanId: 'plan-legacy-workflow-execution',
    executorType: 'WORKFLOW',
    requiredCapabilities: ['workflow.run'],
    strategyPayload: {
      executionSource: {
        type: 'WORKFLOW',
        workflowVersionSelection: 'FIXED',
        workflowTemplateId: 'workflow-legacy',
      },
      workflowRequest: { workflowId: 'workflow-legacy' },
    },
    status: 'READY',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    version: 1,
  };
  const service = new DeploymentPlansApplicationService();

  await assert.rejects(
    () => (service as any).resolveLiveWorkflowStrategyPayloadForTarget(target),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'VALIDATION_FAILED'
      && (error.details as { code?: string })?.code === 'DEPLOYMENT_WORKFLOW_SNAPSHOT_INVALID',
  );
});

test('工作流版本已清理时部署计划列表仍可读取', async () => {
  const now = '2026-08-12T00:00:00.000Z';
  const plan = {
    id: 'plan-missing-workflow-version-list',
    tenantId: 'tenant-missing-workflow-version-list',
    name: '工作流版本已清理的计划',
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    certificateVersionId: 'certver-missing-workflow-version-list',
    status: 'READY',
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: 'snapshot-missing-workflow-version-list',
    idempotencyKey: 'idempotency-missing-workflow-version-list',
    requestHash: 'request-missing-workflow-version-list',
    policy: { riskLevel: 'medium', approvalRequired: false, failurePolicy: 'stop' },
    createdReason: 'MANUAL',
    createdAt: now,
    updatedAt: now,
    createdBy: 'user-missing-workflow-version-list',
    version: 1,
  };
  const target = {
    id: 'target-missing-workflow-version-list',
    tenantId: plan.tenantId,
    deploymentPlanId: plan.id,
    executorType: 'WORKFLOW',
    requiredCapabilities: ['workflow.run'],
    strategyPayload: {
      executionSource: {
        type: 'WORKFLOW',
        workflowTemplateId: 'workflow-missing',
        workflowVersionSelection: 'FIXED',
        workflowVersionId: 'workflow-version-missing',
        pluginId: 'plugin-missing',
        pluginVersion: '1.0.0',
        pluginVersionId: 'plugin-version-missing',
        capabilityKey: 'certificate.deploy',
        packageSha256: 'package-hash',
        manifestSha256: 'manifest-hash',
        resourceSha256: { workflow: 'resource-hash' },
        workflowContentSha256: 'workflow-content-hash',
      },
    },
    status: 'READY',
    createdAt: now,
    updatedAt: now,
    createdBy: plan.createdBy,
    version: 1,
  };
  const service = new DeploymentPlansApplicationService({
    repository: {
      listPlans: async () => [plan],
      listTargetsByPlans: async () => [target],
      listTargetsByPlan: async () => [target],
    } as never,
    executions: { listRuns: async () => [] } as never,
    approval: { getMany: async () => new Map() } as never,
    workflows: { getVersion: async () => { throw new Error('workflow version not found'); } } as never,
  });

  const listed = await service.list({ tenantId: plan.tenantId });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, plan.id);
  assert.equal(listed[0]?.workflowExecutionIdentities, undefined);
});

test('自动化运行审批可以直接提交高风险临时计划且不会消费第二张审批单', async () => {
  const plan: DeploymentPlanEntity = {
    id: 'plan-automation-approval',
    tenantId: 'tenant-automation-approval',
    name: '自动化临时计划',
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    certificateVersionId: 'certver-automation-approval',
    status: 'DRAFT',
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: 'snapshot-automation-approval',
    idempotencyKey: 'idempotency-automation-approval',
    requestHash: 'request-automation-approval',
    policy: { approvalRequired: true, riskLevel: 'high', failurePolicy: 'stop' },
    createdReason: 'MANUAL',
    temporary: true,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    createdBy: 'automation',
    version: 1,
  };
  const automationApproval = {
    id: 'approval-automation-run',
    tenantId: plan.tenantId,
    operationType: 'automation.run.approve',
    resourceRefs: [{ type: 'automationRun', id: 'run-automation-approval' }],
    riskLevel: 'high',
    parameterHash: 'hash',
    status: 'consumed',
    requestedBy: 'user_1',
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  } as const;
  let consumeCount = 0;
  const repository = {
    getPlanOrThrow: async () => plan,
    updatePlan: async (_id: string, patch: Partial<DeploymentPlanEntity>) => ({ ...plan, ...patch, version: plan.version + 1 }),
    createTransition: async () => undefined,
    listTargetsByPlan: async () => [],
  };
  const service = new DeploymentPlansApplicationService({
    repository: repository as never,
    executions: { listRuns: async () => [] } as never,
    approval: {
      get: async () => automationApproval,
      getMany: async () => new Map(),
      consume: async () => { consumeCount += 1; return automationApproval; },
    } as never,
  });

  const submitted = await service.submit({
    planId: plan.id,
    actorId: 'automation',
    tenantId: plan.tenantId,
    executionSource: {
      type: 'automation',
      automationRunId: 'run-automation-approval',
      approvalId: automationApproval.id,
    },
  });
  assert.equal(submitted.status, 'READY');
  assert.equal(submitted.approvalId, undefined);
  assert.equal(consumeCount, 0);
});
