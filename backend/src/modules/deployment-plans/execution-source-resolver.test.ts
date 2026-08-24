import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionSourceResolver } from './application/execution-source.resolver.js';
import type { ResolvedDeploymentCapability } from '../plugins/application/deployment-capability.resolver.js';
import type { WorkflowExecutionBinding } from '../workflow-templates/dto/workflow-execution-bindings.dto.js';

const resolver = new ExecutionSourceResolver();

test('执行来源解析覆盖三种合法模式', () => {
  assert.equal(resolver.resolveMode({ type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target-1', executionMode: 'PLUGIN' } }), 'PLUGIN');
  assert.equal(resolver.resolveMode({ type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target-1', executionMode: 'WORKFLOW_OVERRIDE', workflowExecutionBindingId: 'binding-1' } }), 'WORKFLOW_OVERRIDE');
  assert.equal(resolver.resolveMode({ type: 'WORKFLOW', workflow: { workflowExecutionBindingId: 'binding-2' } }), 'WORKFLOW');
});

test('执行来源解析拒绝插件和工作流混合字段', () => {
  assert.throws(
    () => resolver.resolveMode({ type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target-1', executionMode: 'PLUGIN', workflowExecutionBindingId: 'binding-1' } }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'errorCode' in error && error.errorCode === 'EXECUTION_SOURCE_CONFLICT'),
  );
  assert.throws(
    () => resolver.resolveMode({ type: 'WORKFLOW', workflow: { pluginBindingId: 'plugin-binding-1' } }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'errorCode' in error && error.errorCode === 'EXECUTION_SOURCE_CONFLICT'),
  );
});

test('执行来源解析返回严格互斥的联合类型', () => {
  const capability = {
    assignment: { id: 'assignment-1' },
    binding: { id: 'plugin-binding-1' },
    pluginVersionId: 'plugin-version-1',
    pluginRuntime: 'WORKFLOW_DSL',
  } as ResolvedDeploymentCapability;
  const workflowBinding = {
    id: 'workflow-binding-1',
    workflowTemplateId: 'workflow-1',
    version: 3,
  } as WorkflowExecutionBinding;

  assert.deepEqual(resolver.resolvePlugin({ capability, workflowVersionId: 'workflow-version-1' }), {
    type: 'PLUGIN',
    capability,
    workflowVersionId: 'workflow-version-1',
  });
  assert.deepEqual(resolver.resolveWorkflow({ mode: 'WORKFLOW_OVERRIDE', binding: workflowBinding, workflowVersionId: 'workflow-version-2' }), {
    type: 'WORKFLOW',
    mode: 'WORKFLOW_OVERRIDE',
    binding: workflowBinding,
    workflowVersionId: 'workflow-version-2',
  });
});
