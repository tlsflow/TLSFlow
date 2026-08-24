import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertTransition, canTransition, InvalidStateTransitionError } from './core-state-machine.js';

describe('核心状态机', () => {
  it('允许部署计划按正常路径执行成功', () => {
    assert.equal(canTransition('deploymentPlan', 'DRAFT', 'READY'), true);
    assert.equal(canTransition('deploymentPlan', 'READY', 'RUNNING'), true);
    assert.equal(canTransition('deploymentPlan', 'RUNNING', 'SUCCESS'), true);
  });

  it('禁止部署计划从草稿直接成功', () => {
    assert.equal(canTransition('deploymentPlan', 'DRAFT', 'SUCCESS'), false);
    assert.throws(() => assertTransition('deploymentPlan', 'DRAFT', 'SUCCESS'), InvalidStateTransitionError);
  });

  it('允许执行运行失败后进入回滚', () => {
    assert.equal(canTransition('executionRun', 'RUNNING', 'FAILED'), true);
    assert.equal(canTransition('executionRun', 'FAILED', 'ROLLBACK_RUNNING'), true);
    assert.equal(canTransition('executionRun', 'ROLLBACK_RUNNING', 'ROLLBACK_SUCCESS'), true);
  });

  it('禁止已经成功的执行运行重新失败', () => {
    assert.equal(canTransition('executionRun', 'SUCCESS', 'FAILED'), false);
  });

  it('允许绑定从纳管进入漂移再恢复纳管', () => {
    assert.equal(canTransition('certificateBinding', 'MANAGED', 'DRIFTED'), true);
    assert.equal(canTransition('certificateBinding', 'DRIFTED', 'MANAGED'), true);
  });

  it('禁止忽略绑定直接漂移', () => {
    assert.equal(canTransition('certificateBinding', 'IGNORED', 'DRIFTED'), false);
  });

  it('允许 Agent 心跳状态变化', () => {
    assert.equal(canTransition('agent', 'UNKNOWN', 'ONLINE'), true);
    assert.equal(canTransition('agent', 'ONLINE', 'OFFLINE'), true);
    assert.equal(canTransition('agent', 'OFFLINE', 'ONLINE'), true);
  });
});
