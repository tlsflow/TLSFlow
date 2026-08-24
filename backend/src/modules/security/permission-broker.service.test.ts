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
