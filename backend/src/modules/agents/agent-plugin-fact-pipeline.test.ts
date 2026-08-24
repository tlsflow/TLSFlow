import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentsApplicationService } from './application/agents.application-service.js';
import type { AgentTaskEnvelope } from './schema/agents.schema.js';
import { computeAgentFactDigest, type AgentFactEnvelopeV1 } from './security/agent-security.contract.js';
import { PluginFactPipelineService, type PluginFactRunner } from '../plugins/application/plugin-fact-pipeline.service.js';

test('Agent 事实包级 Runner 绑定失败关闭且不执行厂商代码', async () => {
  const task = createPluginFactTask();
  let runnerCalls = 0;
  const runner: PluginFactRunner = {
    async execute() {
      runnerCalls += 1;
      throw new Error('不应调用 Runner');
    },
  };
  const state = createRepository(task);
  const service = new AgentsApplicationService(
    state.repository as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new PluginFactPipelineService(runner),
  );

  await assert.rejects(
    service.submitResult(task.tenantId, {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      detail: { factEnvelope: factEnvelope() },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
  );
  assert.equal(runnerCalls, 0);
  assert.equal(state.updateCount, 0);
});

function createRepository(task: AgentTaskEnvelope) {
  let current = task;
  let updateCount = 0;
  return {
    get updateCount() {
      return updateCount;
    },
    repository: {
      getTask: async (tenantId: string, taskId: string) => current.tenantId === tenantId && current.id === taskId ? current : undefined,
      updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
        updateCount += 1;
        current = { ...current, ...patch };
        return current;
      },
    },
  };
}

function createPluginFactTask(): AgentTaskEnvelope {
  return {
    id: 'task-plugin-fact',
    tenantId: 'tenant-plugin-fact',
    agentId: 'agent-plugin-fact',
    executionRunId: 'run-plugin-fact',
    executionStepId: 'step-plugin-fact',
    idempotencyKey: 'idem-plugin-fact',
    payload: {
      actionType: 'agent.fact.collect',
      actionSchemaVersion: '1.0',
      pluginFactBinding: {
        apiVersion: 'gcac.plugin-runner-binding/v1',
        hostId: 'host-plugin-fact',
        pluginId: 'web.nginx',
        pluginVersion: '1.0.0',
        pluginVersionId: 'plugin-version-plugin-fact',
        workflowVersionId: 'workflow-version-plugin-fact',
        capability: 'application.discover',
        packageHash: `sha256:${'b'.repeat(64)}`,
        manifestHash: `sha256:${'c'.repeat(64)}`,
        resourceHash: `sha256:${'d'.repeat(64)}`,
        planDigest: 'a'.repeat(64),
        grantRefs: ['grant-plugin-fact'],
        hostPermissions: ['artifact.read'],
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        writeEffect: false,
        input: {},
      },
    },
    status: 'acked',
    leaseId: 'lease-plugin-fact',
    ackedAt: '2026-08-11T00:00:00.000Z',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    requestId: 'request-plugin-fact',
  };
}

function factEnvelope(): AgentFactEnvelopeV1 {
  const value = {
    contractVersion: 'gcac.agent-security/v1' as const,
    factId: 'fact-plugin-fact',
    agentId: 'agent-plugin-fact',
    tenantId: 'tenant-plugin-fact',
    collectedAt: '2026-08-11T00:00:00.000Z',
    ttlSeconds: 300,
    source: 'linux' as const,
    facts: [{ kind: 'process' as const, pid: 1, executablePath: '/usr/bin/gcac-agent' }],
    digest: '',
    warnings: [],
  };
  value.digest = computeAgentFactDigest(value);
  return value;
}
