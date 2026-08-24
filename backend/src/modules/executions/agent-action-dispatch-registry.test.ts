import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentActionDispatchRegistry } from './application/agent-action-dispatch-registry.js';

describe('AgentActionDispatchRegistry', () => {
  it('默认注册表只放行 Agent v2 四个规范动作', () => {
    const registry = new AgentActionDispatchRegistry();
    for (const actionType of ['agent.fact.collect', 'agent.plan.validate', 'agent.plan.execute', 'agent.execution.receipt']) {
      const standard = registry.resolve({ actionType, actionSchemaVersion: '1.0' });
      assert.equal(standard?.actionType, actionType);
      assert.equal(standard?.kind, 'AGENT_V2');
      assert.equal(standard?.contract.acceptsSecrets, false);
    }
    // 旧动作只作为拒绝合同的测试输入，不能进入任何生产执行分支。
    assert.equal(registry.resolve({ actionType: 'agent.atomic_plan.execute', actionSchemaVersion: '1.0' }), undefined);
    assert.equal(registry.resolve({ actionType: 'command.execute', actionSchemaVersion: '1.0' }), undefined);
    assert.equal(registry.resolve({ actionType: 'certificate.trust.install', actionSchemaVersion: '1.0' }), undefined);
    assert.equal(registry.resolve({ actionType: 'certificate.deploy' }), undefined);
    assert.equal(registry.resolve({ type: 'windows.iis.deploy_certificate' }), undefined);
    assert.equal(registry.resolve({ type: 'linux.nginx.deploy_certificate' }), undefined);
  });

  it('未知动作不猜测执行模式', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.equal(registry.resolve({ type: 'unknown.product.deploy' }), undefined);
    assert.deepEqual(registry.requireResolution({ type: 'unknown.product.deploy' }), {
      ok: false,
      requestedActionType: undefined,
      errorCode: 'AGENT_ACTION_UNREGISTERED',
    });
  });

  it('不支持的 Action Schema 在进入执行器前被拒绝', () => {
    const registry = new AgentActionDispatchRegistry();
    assert.deepEqual(registry.requireResolution({ actionType: 'agent.plan.execute', actionSchemaVersion: '2.0' }), {
      ok: false,
      requestedActionType: 'agent.plan.execute',
      errorCode: 'AGENT_ACTION_SCHEMA_UNSUPPORTED',
    });
  });

  it('重复规范动作在注册阶段失败', () => {
    assert.throws(() => new AgentActionDispatchRegistry([
      { actionType: 'action.one', mode: 'direct_required', kind: 'AGENT_V2', contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false } },
      { actionType: 'action.one', mode: 'direct_required', kind: 'AGENT_V2', contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false } },
    ]), /重复注册/);
  });
});
