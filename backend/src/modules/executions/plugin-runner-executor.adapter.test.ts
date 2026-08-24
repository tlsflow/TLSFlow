import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';
import { PluginRunnerClient, PluginRunnerSupervisor } from '../plugins/runner/index.js';
import { PluginRunnerExecutorAdapter } from './application/plugin-runner-executor.adapter.js';
import type { StepExecutionInput } from './application/executors.js';

const now = '2026-08-09T00:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;
const planDigest = 'b'.repeat(64);

test('Fixture：Runner adapter 固定租户、PluginVersion、能力、Grant、摘要和审计绑定', async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    execute: async (request: { input: Record<string, unknown>; grantRefs: string[]; capability: string; writeEffect: boolean }) => {
      captured = { ...request, input: request.input };
      return successResult(request.input.auditBinding as Record<string, unknown>);
    },
  } as unknown as PluginRunnerClient;
  const adapter = new PluginRunnerExecutorAdapter('TRUSTED_JS', {
    runner: runnerConfig(),
    supervisor: { start: async (spec) => {
      assert.equal(spec.pluginVersionId, 'plugin-version-fixture');
      assert.equal(spec.tenantId, 'tenant-fixture');
      return client;
    } },
  });

  const result = await adapter.executeStep(stepInput({
    pluginRuntimeCapability: {
      pluginVersionId: 'plugin-version-fixture',
      pluginId: 'test.echo',
      pluginVersion: '1.0.0',
      capabilityKey: 'test.echo',
      packageSha256: hash,
      manifestSha256: hash,
      resourceHash: hash,
    },
    grantRefs: ['grant-1'],
    plan: { planDigest, writeEffect: false },
    capabilities: ['test.echo'],
    approvedPermissions: [],
    value: 'fixture',
  }));

  assert.equal(result.success, true);
  assert.equal((captured?.input as Record<string, unknown>).planDigest, planDigest);
  assert.deepEqual(captured?.grantRefs, ['grant-1']);
  assert.equal(captured?.capability, 'test.echo');
  assert.equal(captured?.writeEffect, true);
  const binding = (captured?.input as Record<string, unknown>).auditBinding as Record<string, unknown>;
  assert.deepEqual(binding, {
    tenantId: 'tenant-fixture',
    executionRunId: 'run-fixture',
    executionStepId: 'step-fixture',
    deploymentPlanTargetId: 'target-fixture',
    pluginVersionId: 'plugin-version-fixture',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    capability: 'test.echo',
    grantRefs: ['grant-1'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    planDigest,
    authorization: {},
  });
});

test('Fixture：Runner 崩溃、超时或取消必须返回 UNKNOWN，不得回退旧 Agent/command', async () => {
  const adapter = new PluginRunnerExecutorAdapter('AGENT', {
    runner: runnerConfig(),
    supervisor: { start: async () => ({
      execute: async () => { throw new Error('fixture runner crashed'); },
    } as unknown as PluginRunnerClient) },
  });
  const result = await adapter.executeStep(stepInput({
    pluginRuntimeCapability: { pluginVersionId: 'plugin-version-fixture', pluginId: 'test.echo', pluginVersion: '1.0.0', capabilityKey: 'test.echo', packageSha256: hash, manifestSha256: hash, resourceHash: hash },
    capabilities: ['test.echo'],
    plan: { planDigest, writeEffect: true },
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(result.detail?.executionStatus, 'UNKNOWN');
  assert.equal(result.detail?.cause, 'PLUGIN_RUNNER_FAILED');
});

test('真实子进程：executions 主链通过 PluginRunnerSupervisor/Client 完成执行', async () => {
  const supervisor = new PluginRunnerSupervisor({ maxRestarts: 0 });
  const adapter = new PluginRunnerExecutorAdapter('TRUSTED_JS', {
    runner: runnerConfig(),
    supervisor,
  });
  try {
    const result = await adapter.executeStep(stepInput({
      pluginRuntimeCapability: { pluginVersionId: 'test-version-v1', pluginId: 'test.echo', pluginVersion: '1.0.0', capabilityKey: 'test.echo' },
      capabilities: ['test.echo'],
      approvedPermissions: ['artifact.read'],
      packageSha256: hash,
      manifestSha256: hash,
      resourceHash: hash,
      planDigest,
      value: 'real-process',
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
      inputSnapshot: { executorType: 'TRUSTED_JS', ...snapshot },
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

function successResult(binding: Record<string, unknown>): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: 'fixture-request',
    sentAt: now,
    pluginVersionId: String(binding.pluginVersionId),
    tenantId: String(binding.tenantId),
    executionId: String(binding.executionRunId),
    executionStepId: String(binding.executionStepId),
    success: true,
    status: 'SUCCESS',
    summary: { value: 'fixture' },
    normalizedObjects: [],
    warnings: [],
  };
}
