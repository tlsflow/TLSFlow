import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentActionDispatchRegistry } from '../executions/application/agent-action-dispatch-registry.js';

test('Legacy Agent 模块已清退，旧动作不进入 Agent v2 注册表', async () => {
  await assertModuleMissing('./index.js');

  const registry = new AgentActionDispatchRegistry();
  for (const retiredAction of ['agent.atomic_plan.execute', 'agent.execute', 'command.execute', 'process.execute']) {
    assert.deepEqual(
      registry.requireResolution({ actionType: retiredAction, actionSchemaVersion: '1.0' }),
      { ok: false, requestedActionType: retiredAction, errorCode: 'AGENT_ACTION_UNREGISTERED' },
    );
  }
});

async function assertModuleMissing(modulePath: string): Promise<void> {
  await assert.rejects(
    () => import(modulePath),
    (error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error)) return false;
      return (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND';
    },
  );
}
