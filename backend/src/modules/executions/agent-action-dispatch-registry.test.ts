import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentActionDispatchRegistry } from './application/agent-action-dispatch-registry.js';

describe('AgentActionDispatchRegistry', () => {
  it('通过规范动作和旧任务 Alias 保持直连必选语义', () => {
    const registry = new AgentActionDispatchRegistry();
    const standard = registry.resolve({ actionType: 'certificate.deploy' });
    assert.equal(standard?.actionType, 'certificate.deploy');
    assert.equal(standard?.kind, 'HISTORICAL_PLUGIN_ALIAS');
    assert.equal(standard?.contract.riskBoundary, 'DEPLOYMENT');
    assert.equal(standard?.contract.acceptsSecrets, true);
    assert.equal(standard?.aliased, false);
    assert.equal(registry.resolve({ type: 'windows.iis.deploy_certificate' })?.mode, 'direct_required');
    assert.equal(registry.resolve({ type: 'linux.nginx.deploy_certificate' })?.mode, 'direct_required');
  });

  it('未知动作不猜测执行模式', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.equal(registry.resolve({ type: 'unknown.product.deploy' }), undefined);
    assert.deepEqual(registry.requireResolution({ type: 'unknown.product.deploy' }), {
      ok: false,
      requestedActionType: 'unknown.product.deploy',
      errorCode: 'AGENT_ACTION_UNREGISTERED',
    });
  });

  it('不支持的 Action Schema 在进入执行器前被拒绝', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.deepEqual(registry.requireResolution({ actionType: 'agent.atomic_plan.execute', actionSchemaVersion: '2.0' }), {
      ok: false,
      requestedActionType: 'agent.atomic_plan.execute',
      errorCode: 'AGENT_ACTION_SCHEMA_UNSUPPORTED',
    });
  });

  it('重复 Alias 在注册阶段失败', () => {
    assert.throws(() => new AgentActionDispatchRegistry([
      { actionType: 'action.one', aliases: ['legacy.deploy'], mode: 'direct_required', kind: 'DIRECT_STANDARD', contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false } },
      { actionType: 'action.two', aliases: ['legacy.deploy'], mode: 'direct_required', kind: 'DIRECT_STANDARD', contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false } },
    ]), /alias 冲突/);
  });
});
