import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AgentsApplicationService } from './application/agents.application-service.js';
import { PgAgentsRepository } from './repository/agents.repository.js';

describe('Agent 任务 payload', () => {
  it('入队和拉取任务时保留执行所需的 PFX 明文密码', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const service = new AgentsApplicationService(new PgAgentsRepository(db));
    const agent = await service.register('default', {
      agentKey: 'agent-key-for-payload-test',
      hostname: 'win-agent',
      version: '1.0.0',
      osType: 'windows',
    }, 'req-agent-payload-register');

    await service.enqueueTask('default', {
      agentId: agent.id,
      executionRunId: 'run_payload_plaintext',
      executionStepId: 'step_payload_plaintext',
      idempotencyKey: 'agent.payload.plaintext',
      payload: {
        actionType: 'agent.plan.execute',
        pfxPassword: 'real-pfx-password',
      },
    }, 'req-agent-payload-enqueue');

    const tasks = await service.pullTasks('default', agent.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].payload.pfxPassword, 'real-pfx-password');
    assert.notEqual(tasks[0].payload.pfxPassword, '[REDACTED]');
  });
});
