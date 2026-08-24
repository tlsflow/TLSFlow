import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentTaskActionType } from './application/agents.application-service.js';

test('Agent 直连任务只接受 Agent v2 四个长期动作', () => {
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.fact.collect' }), 'agent.fact.collect');
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.plan.validate' }), 'agent.plan.validate');
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.plan.execute' }), 'agent.plan.execute');
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.execution.receipt' }), 'agent.execution.receipt');
  assert.equal(resolveAgentTaskActionType({ actionType: 'agent.atomic_plan.execute' }), undefined);
  assert.equal(resolveAgentTaskActionType({ actionType: 'command.execute' }), undefined);
  assert.equal(resolveAgentTaskActionType({ type: 'command.execute' }), undefined);
  assert.equal(resolveAgentTaskActionType({ type: 'agent.plan.execute' }), undefined);
  assert.equal(resolveAgentTaskActionType({ actionType: '  ', type: 'agent.plan.execute' }), undefined);
  assert.equal(resolveAgentTaskActionType({}), undefined);
});
