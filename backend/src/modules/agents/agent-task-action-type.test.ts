import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentTaskActionType } from './application/agents.application-service.js';

test('Agent 直连任务同时兼容 actionType 和旧 type 字段', () => {
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.atomic_plan.execute' }), 'agent.atomic_plan.execute');
  assert.equal(resolveAgentTaskActionType({ type: 'windows.iis.deploy_certificate' }), 'windows.iis.deploy_certificate');
  assert.equal(resolveAgentTaskActionType({ actionType: '  ', type: 'agent.self_test' }), 'agent.self_test');
  assert.equal(resolveAgentTaskActionType({}), undefined);
});
