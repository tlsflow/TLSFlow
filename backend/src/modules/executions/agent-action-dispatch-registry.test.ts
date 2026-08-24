import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentActionDispatchRegistry } from './application/agent-action-dispatch-registry.js';

describe('AgentActionDispatchRegistry', () => {
  it('通过规范动作和旧任务 Alias 保持直连优先语义', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.deepEqual(registry.resolve({ actionType: 'certificate.deploy' }), {
      requestedActionType: 'certificate.deploy',
      actionType: 'certificate.deploy',
      mode: 'direct_preferred',
      aliased: false,
    });
    assert.equal(registry.resolve({ type: 'windows.iis.deploy_certificate' })?.mode, 'direct_preferred');
    assert.equal(registry.resolve({ type: 'linux.nginx.deploy_certificate' })?.mode, 'direct_preferred');
  });

  it('未知动作不猜测执行模式', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.equal(registry.resolve({ type: 'unknown.product.deploy' }), undefined);
  });

  it('重复 Alias 在注册阶段失败', () => {
    assert.throws(() => new AgentActionDispatchRegistry([
      { actionType: 'action.one', aliases: ['legacy.deploy'], mode: 'queued' },
      { actionType: 'action.two', aliases: ['legacy.deploy'], mode: 'direct_preferred' },
    ]), /alias 冲突/);
  });
});
