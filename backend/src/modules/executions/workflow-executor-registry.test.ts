import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExecutorRegistry, WorkflowStepExecutorRegistry, type Executor } from './application/executors.js';

describe('共享执行器注册表', () => {
  it('顶层 Executor 重复注册时失败', () => {
    const executor: Executor = { type: 'SSH', executeStep: async () => ({ success: true }) };
    assert.throws(() => new ExecutorRegistry([executor, executor]), /重复注册/);
  });

  it('默认注册表包含 SSH、CURL 和 WORKFLOW', () => {
    const types = new ExecutorRegistry().listTypes();
    assert.ok(types.includes('SSH'));
    assert.ok(types.includes('CURL'));
    assert.ok(types.includes('WORKFLOW'));
  });

  it('未知 Workflow Executor 明确失败而不是 planned success', async () => {
    const registry = new WorkflowStepExecutorRegistry();
    const result = await registry.execute('unknown.executor', {
      input: { step: {} as never, runType: 'apply', dryRun: false },
      plan: { executor: 'unknown.executor' },
      workflowStepName: 'unknown',
      attempt: 1,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'WORKFLOW_EXECUTOR_NOT_REGISTERED');
  });

  it('Workflow Executor 重复注册时失败', () => {
    const registration = { executorId: '015.SSH', execute: async () => ({ success: true }) };
    assert.throws(() => new WorkflowStepExecutorRegistry([registration, registration]), /重复注册/);
  });
});
