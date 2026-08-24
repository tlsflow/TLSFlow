import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationDeploymentActionService } from './application/automation-deployment-actions.js';

test('证书计划动作只调用 DeploymentPlan 端口并传递快照目标', async () => {
  const calls: unknown[] = [];
  const service = new AutomationDeploymentActionService({ createFromApplicationAsset: async (input) => { calls.push(input); return { id: 'plan_1' } as never; }, dryRun: async () => ({}), submit: async () => ({}) as never, execute: async () => ({}) });
  const plan = await service.createPlan({
    runId: 'run_1', actorId: 'user_1', tenantId: 'tenant_1', requireApproval: true, failurePolicy: 'stop',
    config: { workflowTemplateId: 'workflow_1', planType: 'UPDATE' },
    target: { id: 'target_1', tenantId: 'tenant_1', runId: 'run_1', sequenceNo: 1, targetSnapshot: { certificateId: 'cert_1', certificateName: 'example.com', certificateVersionId: 'version_1', bindingId: 'binding_1', assetId: 'asset_1', tags: [] }, actionTypes: ['create_deployment_plan'], status: 'pending', notificationRequestIds: [], createdAt: '', updatedAt: '' },
  });
  assert.equal(plan.id, 'plan_1');
  assert.deepEqual(calls[0], {
    applicationAssetId: 'asset_1',
    targetCertificateVersionId: 'version_1',
    planType: 'UPDATE',
    selectionMode: 'EXPLICIT',
    policy: { approvalRequired: true, failurePolicy: 'stop', riskLevel: 'high' },
    reuseDraft: false,
    temporary: true,
    idempotencyKey: 'automation:run_1:target:target_1:create-plan',
    actorId: 'user_1',
    tenantId: 'tenant_1',
  });
});
