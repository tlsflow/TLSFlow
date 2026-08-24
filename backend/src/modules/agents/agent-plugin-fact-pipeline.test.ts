import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { AgentsApplicationService } from './application/agents.application-service.js';
import type { AgentTaskEnvelope } from './schema/agents.schema.js';
import { computeAgentFactDigest, type AgentFactEnvelopeV1 } from './security/agent-security.contract.js';
import { PluginFactPipelineService, type PluginFactRunner, type PluginFactRunnerInput } from '../plugins/application/plugin-fact-pipeline.service.js';
import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';

test('Agent 插件事实任务接通 Fact、Runner、标准对象和 Atomic Plan', async () => {
  const task = createPluginFactTask();
  let capturedInput: PluginFactRunnerInput | undefined;
  const pipeline = createPipeline(async (input) => {
    capturedInput = input;
    return runnerResult(input, 'SUCCESS');
  });
  const state = createRepository(task);
  const service = createService(state.repository, pipeline);

  const updated = await service.submitResult('tenant-plugin-fact', {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: true,
    detail: { factEnvelope: factEnvelope() },
  });

  assert.equal(capturedInput?.tenantId, task.tenantId);
  assert.equal(capturedInput?.executionId, task.executionRunId);
  assert.equal(capturedInput?.executionStepId, task.executionStepId);
  assert.equal(capturedInput?.idempotencyKey, task.idempotencyKey);
  assert.equal(((capturedInput?.input as Record<string, unknown>)?.factEnvelope as AgentFactEnvelopeV1).digest, factEnvelope().digest);
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.result?.status, 'SUCCESS');
  assert.equal(updated.result?.success, true);
  const detail = updated.result?.detail as Record<string, unknown>;
  const pipelineResult = detail.pluginFactPipeline as Record<string, unknown>;
  assert.equal(pipelineResult.status, 'SUCCESS');
  assert.equal((pipelineResult.atomicPlan as Record<string, unknown>).writeEffect, false);
  assert.equal(Array.isArray(pipelineResult.normalizedObjects), true);
  assert.equal((pipelineResult.runnerSummary as Record<string, unknown>).planDigest, 'a'.repeat(64));
});

test('Agent 插件事实任务的 Runner UNKNOWN 不得保留成功状态', async () => {
  const task = createPluginFactTask();
  const pipeline = createPipeline(async (input) => runnerResult(input, 'UNKNOWN'));
  const state = createRepository(task);
  const service = createService(state.repository, pipeline);

  const updated = await service.submitResult(task.tenantId, {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: true,
    detail: { factEnvelope: factEnvelope() },
  });

  assert.equal(updated.status, 'failed');
  assert.equal(updated.result?.success, false);
  assert.equal(updated.result?.status, 'UNKNOWN');
  assert.equal(updated.result?.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  const detail = updated.result?.detail as Record<string, unknown>;
  assert.equal((detail.pluginFactPipeline as Record<string, unknown>).atomicPlan, undefined);
});

test('Agent 插件事实任务重复提交只复用终态，不重复执行 Runner', async () => {
  const task = createPluginFactTask();
  let executions = 0;
  const pipeline = createPipeline(async (input) => {
    executions += 1;
    return runnerResult(input, 'SUCCESS');
  });
  const state = createRepository(task);
  const service = createService(state.repository, pipeline);
  const input = {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: true,
    detail: { factEnvelope: factEnvelope() },
  };

  await service.submitResult(task.tenantId, input);
  const duplicate = await service.submitResult(task.tenantId, input);

  assert.equal(executions, 1);
  assert.equal(duplicate.status, 'succeeded');
});

test('Agent 插件事实任务拒绝跨租户事实，不写入任务结果', async () => {
  const task = createPluginFactTask();
  let runnerCalls = 0;
  const runner: PluginFactRunner = {
    async execute(input) {
      runnerCalls += 1;
      return runnerResult(input, 'SUCCESS');
    },
  };
  const state = createRepository(task);
  const service = createService(state.repository, new PluginFactPipelineService(runner));
  const crossTenant = factEnvelope({ tenantId: 'tenant-other' });

  await assert.rejects(
    service.submitResult(task.tenantId, {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      detail: { factEnvelope: crossTenant },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'TENANT_SCOPE_DENIED',
  );
  assert.equal(runnerCalls, 0);
  assert.equal(state.updateCount, 0);
});

test('Agent 插件事实任务缺少 Fact、Grant、固定摘要或安全材料时失败关闭', async () => {
  const missingFactTask = createPluginFactTask();
  const missingFactState = createRepository(missingFactTask);
  const missingFactService = createService(missingFactState.repository, createPipeline(async (input) => runnerResult(input, 'SUCCESS')));
  await assert.rejects(
    missingFactService.submitResult(missingFactTask.tenantId, {
      agentId: missingFactTask.agentId,
      taskId: missingFactTask.id,
      leaseId: missingFactTask.leaseId!,
      success: true,
      detail: {},
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
  );
  assert.equal(missingFactState.updateCount, 0);

  const invalidBindingTask = createPluginFactTask({ grantRefs: [] });
  const invalidBindingState = createRepository(invalidBindingTask);
  const invalidBindingService = createService(invalidBindingState.repository, createPipeline(async (input) => runnerResult(input, 'SUCCESS')));
  await assert.rejects(
    invalidBindingService.submitResult(invalidBindingTask.tenantId, {
      agentId: invalidBindingTask.agentId,
      taskId: invalidBindingTask.id,
      leaseId: invalidBindingTask.leaseId!,
      success: true,
      detail: { factEnvelope: factEnvelope() },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_HOST_CALL_DENIED',
  );
  assert.equal(invalidBindingState.updateCount, 0);

  const invalidDigestTask = createPluginFactTask({ packageHash: 'sha256:bad' });
  const invalidDigestState = createRepository(invalidDigestTask);
  const invalidDigestService = createService(invalidDigestState.repository, createPipeline(async (input) => runnerResult(input, 'SUCCESS')));
  await assert.rejects(
    invalidDigestService.submitResult(invalidDigestTask.tenantId, {
      agentId: invalidDigestTask.agentId,
      taskId: invalidDigestTask.id,
      leaseId: invalidDigestTask.leaseId!,
      success: true,
      detail: { factEnvelope: factEnvelope() },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_RUNNER_VERSION_MISMATCH',
  );
  assert.equal(invalidDigestState.updateCount, 0);

  const securityState = createRepository(createPluginFactTask());
  const securityRunner: PluginFactRunner = {
    async execute() {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', '开发 Runner 缺少安全材料');
    },
  };
  const securityService = createService(securityState.repository, new PluginFactPipelineService(securityRunner));
  await assert.rejects(
    securityService.submitResult(securityState.task.tenantId, {
      agentId: securityState.task.agentId,
      taskId: securityState.task.id,
      leaseId: securityState.task.leaseId!,
      success: true,
      detail: { factEnvelope: factEnvelope() },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_HOST_CALL_DENIED',
  );
  assert.equal(securityState.updateCount, 0);
});

function createService(repository: unknown, pipeline: PluginFactPipelineService): AgentsApplicationService {
  return new AgentsApplicationService(
    repository as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    pipeline,
  );
}

function createPipeline(execute: PluginFactRunner['execute']): PluginFactPipelineService {
  return new PluginFactPipelineService({ execute });
}

function createRepository(task: AgentTaskEnvelope): {
  task: AgentTaskEnvelope;
  updateCount: number;
  repository: { getTask: (tenantId: string, taskId: string) => Promise<AgentTaskEnvelope | undefined>; updateTask: (taskId: string, patch: Partial<AgentTaskEnvelope>) => Promise<AgentTaskEnvelope> };
} {
  let current = task;
  const state = {
    task,
    updateCount: 0,
    repository: {
      getTask: async (tenantId: string, taskId: string) => current.tenantId === tenantId && current.id === taskId ? current : undefined,
      updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
        state.updateCount += 1;
        current = { ...current, ...patch };
        return current;
      },
    },
  };
  return state;
}

function createPluginFactTask(overrides: Record<string, unknown> = {}): AgentTaskEnvelope {
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
      pluginFactBinding: { ...pluginFactBinding(), ...overrides },
    },
    status: 'acked',
    leaseId: 'lease-plugin-fact',
    ackedAt: '2026-08-11T00:00:00.000Z',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    requestId: 'request-plugin-fact',
  };
}

function pluginFactBinding(): Record<string, unknown> {
  return {
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
  };
}

function factEnvelope(overrides: Partial<AgentFactEnvelopeV1> = {}): AgentFactEnvelopeV1 {
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
    ...overrides,
  };
  value.digest = computeAgentFactDigest(value);
  return value;
}

function runnerResult(input: PluginFactRunnerInput, status: 'SUCCESS' | 'UNKNOWN'): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: 'runner-request-plugin-fact',
    sentAt: new Date().toISOString(),
    pluginVersionId: input.pluginVersionId,
    tenantId: input.tenantId,
    executionId: input.executionId,
    executionStepId: input.executionStepId,
    success: status === 'SUCCESS',
    status,
    summary: status === 'SUCCESS' ? {
      planDigest: input.planDigest,
      operationResults: [{ operationId: 'discover-plugin-fact', operationType: input.capability, input: {} }],
    } : {},
    normalizedObjects: status === 'SUCCESS' ? [{
      apiVersion: 'gcac.application/v1',
      kind: 'Application',
      stableKey: 'web.nginx:agent-plugin-fact',
      tenantId: input.tenantId,
      pluginId: input.pluginId,
      pluginVersionId: input.pluginVersionId,
    }] : [],
    warnings: [],
    ...(status === 'UNKNOWN' ? { error: { code: 'PLUGIN_OPERATION_UNKNOWN_STATE', message: 'Runner 状态不明', retryable: false, mayBeUnknown: true, secretRedacted: true } } : {}),
  };
}
