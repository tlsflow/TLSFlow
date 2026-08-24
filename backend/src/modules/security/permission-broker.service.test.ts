import test from 'node:test';
import assert from 'node:assert/strict';
import { RBACService } from '../rbac/rbac.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { PluginPermissionService } from '../plugins/plugin-permission.service.js';
import { PermissionBroker } from './permission-broker.service.js';

test('PermissionBroker 生成最小 Grant，跨 step 复用失败，插件未声明权限失败', () => {
  const rbac = new RBACService();
  rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: ['secret.resolve'],
    resourceTypes: ['execution'],
    scope: {},
  });
  const grants = new ExecutionGrantService();
  const broker = new PermissionBroker(rbac, new ApprovalService(), grants, new PluginPermissionService());
  const subject = { id: 'user_1', type: 'user' as const };
  const grant = broker.createExecutorGrant({
    subject,
    action: 'secret.resolve',
    resource: { type: 'execution', id: 'run_1' },
    runId: 'run_1',
    stepId: 'step_1',
    executorType: 'ssh',
    allowedSecretRefs: ['secret://ssh_key/sec_1#v1'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.equal(grants.validate({ grantId: grant.id, runId: 'run_1', stepId: 'step_1', executorType: 'ssh', action: 'secret.resolve' }).id, grant.id);
  assert.throws(() => grants.validate({ grantId: grant.id, runId: 'run_1', stepId: 'step_2', executorType: 'ssh' }), (error: any) => error.errorCode === 'SEC_EXECUTOR_GRANT_DENIED');

  assert.throws(() => broker.createPluginGrant({
    subject,
    action: 'secret.resolve',
    resource: { type: 'execution', id: 'run_2' },
    runId: 'run_2',
    stepId: 'step_1',
    executorType: 'plugin',
    allowedSecretRefs: ['secret://api_token/sec_2#v1'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    manifest: {
      pluginId: 'plugin_1',
      name: '坏插件',
      version: '1.0.0',
      author: 'unknown',
      runtime: 'node',
      requiredPermissions: ['network.http.request'],
      requiredCapabilities: [],
      allowedSecretTypes: [],
      networkAccess: true,
    },
  }), (error: any) => error.errorCode === 'SEC_PLUGIN_PERMISSION_DENIED');
});

test('PermissionBroker 对高风险 Grant 强制校验审批', () => {
  const rbac = new RBACService();
  rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: ['deployment.execute'],
    resourceTypes: ['execution'],
    scope: {},
  });

  const approvals = new ApprovalService();
  const grants = new ExecutionGrantService();
  const broker = new PermissionBroker(rbac, approvals, grants, new PluginPermissionService());
  const subject = { id: 'user_1', type: 'user' as const };
  const approvalParameters = {
    action: 'deployment.execute',
    resource: { type: 'execution', id: 'run_9' },
    runId: 'run_9',
    stepId: 'step_1',
    executorType: 'ssh',
    allowedSecretRefs: ['secret://ssh_key/sec_9#v1'],
  };

  const input = {
    subject,
    action: 'deployment.execute',
    operationType: 'deployment.execute',
    riskLevel: 'high' as const,
    resource: { type: 'execution', id: 'run_9' },
    runId: 'run_9',
    stepId: 'step_1',
    executorType: 'ssh',
    allowedSecretRefs: ['secret://ssh_key/sec_9#v1'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    approvalParameters,
  };

  assert.throws(
    () => broker.createExecutorGrant(input),
    (error: any) => error.errorCode === 'SEC_APPROVAL_REQUIRED',
  );

  const approval = approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'execution', id: 'run_9' }],
    riskLevel: 'high',
    parameters: approvalParameters,
    requestedBy: 'user_1',
  });
  approvals.decide({ approvalId: approval.id, decision: 'approved', approverId: 'user_2' });

  assert.throws(
    () => broker.createExecutorGrant({
      ...input,
      approvalId: approval.id,
      approvalParameters: { ...approvalParameters, stepId: 'step_tampered' },
    }),
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID',
  );

  const secondApproval = approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'execution', id: 'run_9' }],
    riskLevel: 'high',
    parameters: approvalParameters,
    requestedBy: 'user_1',
  });
  approvals.decide({ approvalId: secondApproval.id, decision: 'approved', approverId: 'user_2' });

  const grant = broker.createExecutorGrant({ ...input, approvalId: secondApproval.id });
  assert.equal(grant.runId, 'run_9');
  assert.equal(grant.stepId, 'step_1');
  assert.equal(approvals.get(secondApproval.id)?.status, 'consumed');
});
