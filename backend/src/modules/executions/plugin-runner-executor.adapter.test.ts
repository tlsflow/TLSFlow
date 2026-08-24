import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';
import { PluginRunnerClient, PluginRunnerSupervisor } from '../plugins/runner/index.js';
import {
  createPluginRunnerExecutors,
  PluginRunnerExecutorAdapter,
  pluginRunnerBindingApiVersion,
} from './application/plugin-runner-executor.adapter.js';
import type { StepExecutionInput } from './application/executors.js';

const now = '2026-08-10T00:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;
const planDigest = 'b'.repeat(64);

test('Runner adapter 只接受固定的执行绑定并传递不可变身份', async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    execute: async (request: { input: Record<string, unknown>; grantRefs: string[]; capability: string; writeEffect: boolean }) => {
      captured = { ...request, input: structuredClone(request.input) };
      return successResult();
    },
  } as unknown as PluginRunnerClient;
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    supervisor: { start: async (spec) => {
      assert.equal(spec.pluginVersionId, 'plugin-version-fixture');
      assert.equal(spec.tenantId, 'tenant-fixture');
      assert.deepEqual(spec.capabilities, ['test.echo']);
      assert.deepEqual(spec.hostPermissions, ['artifact.grant.read']);
      return client;
    } },
  });

  const result = await adapter.executeStep(stepInput({
    pluginRunnerBinding: binding({
      writeEffect: true,
      hostPermissions: ['artifact.grant.read'],
      input: { value: 'fixture' },
    }),
    // 旧快照字段不参与任何身份、摘要或能力解析。
    pluginRuntimeCapability: { pluginVersionId: 'forbidden-legacy-version' },
    trustedJsRequest: { pluginId: 'forbidden-legacy-plugin' },
  }));

  assert.equal(result.success, true);
  assert.deepEqual(captured?.input, { value: 'fixture' });
  assert.deepEqual(captured?.grantRefs, ['grant-1']);
  assert.equal(captured?.capability, 'test.echo');
  assert.equal(captured?.writeEffect, true);
  assert.deepEqual(result.detail?.auditBinding, {
    tenantId: 'tenant-fixture',
    executionRunId: 'run-fixture',
    executionStepId: 'step-fixture',
    deploymentPlanTargetId: 'target-fixture',
    workflowVersionId: 'workflow-version-fixture',
    pluginVersionId: 'plugin-version-fixture',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    capability: 'test.echo',
    grantRefs: ['grant-1'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    planDigest,
    writeEffect: true,
  });
});

test('Runner adapter 拒绝缺失绑定、旧快照和运行步骤不一致', async () => {
  const adapter = new PluginRunnerExecutorAdapter({ runner: runnerConfig(), supervisor: { start: async () => { throw new Error('不应启动 Runner'); } } });

  const missing = await adapter.executeStep(stepInput({
    pluginRuntimeCapability: { pluginVersionId: 'legacy-version' },
    trustedJsRequest: { pluginVersionId: 'legacy-version' },
  }));
  assert.equal(missing.success, false);
  assert.equal(missing.errorCode, 'VALIDATION_FAILED');

  const tenantMismatch = await adapter.executeStep(stepInput({
    pluginRunnerBinding: binding({ tenantId: 'other-tenant' }),
  }));
  assert.equal(tenantMismatch.success, false);
  assert.equal(tenantMismatch.errorCode, 'TENANT_SCOPE_DENIED');

  const stepMismatch = await adapter.executeStep(stepInput({
    pluginRunnerBinding: binding({ executionStepId: 'other-step' }),
  }));
  assert.equal(stepMismatch.success, false);
  assert.equal(stepMismatch.errorCode, 'PLUGIN_RUNNER_VERSION_MISMATCH');
});

test('Runner 崩溃、超时或取消必须返回 UNKNOWN，不得回退旧 Agent 或命令', async () => {
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    supervisor: { start: async () => ({
      execute: async () => { throw new Error('fixture runner crashed'); },
    } as unknown as PluginRunnerClient) },
  });
  const result = await adapter.executeStep(stepInput({
    pluginRunnerBinding: binding({ writeEffect: true }),
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(result.detail?.executionStatus, 'UNKNOWN');
  assert.equal(result.detail?.cause, 'PLUGIN_RUNNER_FAILED');
});

test('真实子进程：executions 主链只经 PluginRunnerSupervisor/Client 执行固定绑定', async () => {
  const supervisor = new PluginRunnerSupervisor({ maxRestarts: 3 });
  const adapter = new PluginRunnerExecutorAdapter({ runner: runnerConfig(), supervisor });
  try {
    const result = await adapter.executeStep(stepInput({
      pluginRunnerBinding: binding({
      pluginVersionId: 'test-version-v1',
      input: { value: 'real-process' },
      writeEffect: false,
      hostPermissions: ['artifact.read'],
    }),
    }));
    assert.equal(result.success, true);
    assert.equal(result.detail?.executionMode, 'plugin_runner');
    assert.equal((result.detail?.summary as Record<string, unknown>).value, 'real-process');
    const listed = supervisor.list();
    assert.equal(listed[0]?.pluginVersionId, 'test-version-v1');
    assert.equal(typeof listed[0]?.pid, 'number');
  } finally {
    await supervisor.shutdownAll();
  }
});

test('默认 Runner 注册表只登记 PLUGIN_RUNNER，不复用历史执行器类型', () => {
  assert.deepEqual(createPluginRunnerExecutors().map((executor) => executor.type), ['PLUGIN_RUNNER']);
});

function stepInput(snapshot: Record<string, unknown>): StepExecutionInput {
  return {
    step: {
      id: 'step-fixture',
      tenantId: 'tenant-fixture',
      executionRunId: 'run-fixture',
      deploymentPlanTargetId: 'target-fixture',
      stepNo: 1,
      stepType: 'INSTALL',
      name: 'Runner adapter test',
      dependsOn: [],
      idempotent: false,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: { executorType: 'PLUGIN_RUNNER', ...snapshot },
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      createdBy: 'test',
      version: 1,
    },
    runType: 'apply',
    dryRun: false,
  };
}

function binding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: pluginRunnerBindingApiVersion,
    tenantId: 'tenant-fixture',
    executionRunId: 'run-fixture',
    executionStepId: 'step-fixture',
    workflowVersionId: 'workflow-version-fixture',
    pluginVersionId: 'plugin-version-fixture',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    capability: 'test.echo',
    grantRefs: ['grant-1'],
    planDigest,
    writeEffect: false,
    hostPermissions: [],
    input: {},
    ...overrides,
  };
}

function runnerConfig() {
  return {
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [
      resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'),
      '--executor-module',
      resolve(process.cwd(), 'dist/modules/plugins/runner/fixtures/runner-executor.js'),
    ],
    executorModulePath: resolve(process.cwd(), 'dist/modules/plugins/runner/fixtures/runner-executor.js'),
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
  } satisfies {
    executablePath: string;
    workingDirectory: string;
    args: string[];
    executorModulePath: string;
    runnerVersion: string;
    sdkVersion: string;
  };
}

function successResult(): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: 'fixture-request',
    sentAt: now,
    pluginVersionId: 'plugin-version-fixture',
    tenantId: 'tenant-fixture',
    executionId: 'run-fixture',
    executionStepId: 'step-fixture',
    success: true,
    status: 'SUCCESS',
    summary: { value: 'fixture' },
    normalizedObjects: [],
    warnings: [],
  };
}
