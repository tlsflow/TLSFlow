import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';

import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';
import { PluginRunnerClient, PluginRunnerSupervisor } from '../plugins/runner/index.js';
import {
  createPluginRunnerExecutors,
  PluginRunnerExecutorAdapter,
  PluginWorkflowCapabilityExecutorAdapter,
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

test('生产 Runner 启动前验证每个 Grant 的租户、运行、版本、能力和 planDigest 绑定', async () => {
  const validations: Record<string, unknown>[] = [];
  const client = { execute: async () => successResult() } as unknown as PluginRunnerClient;
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    executionGrants: {
      validate: async (input) => {
        validations.push(input as unknown as Record<string, unknown>);
        return { id: String(input.grantId), allowedActions: ['artifact.read'] } as never;
      },
    },
    supervisor: { start: async () => client },
  });
  const result = await adapter.executeStep(stepInput({ pluginRunnerBinding: binding({ grantRefs: ['grant-1', 'grant-2'] }) }));
  assert.equal(result.success, true);
  assert.deepEqual(validations.map((input) => input.grantId), ['grant-1', 'grant-2']);
  assert.equal(validations.every((input) => input.tenantId === 'tenant-fixture' && input.runId === 'run-fixture' && input.stepId === 'step-fixture'), true);
  assert.equal(validations.every((input) => input.workflowVersionId === 'workflow-version-fixture' && input.pluginVersionId === 'plugin-version-fixture' && input.pluginId === 'test.echo' && input.capability === 'test.echo' && input.planDigest === planDigest && input.executorType === 'PLUGIN_RUNNER'), true);

  const denied = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    executionGrants: { validate: async () => { throw new AppError('SEC_EXECUTOR_GRANT_DENIED', 'fixture grant denied'); } },
    supervisor: { start: async () => { throw new Error('Grant 拒绝后不应启动 Runner'); } },
  });
  const deniedResult = await denied.executeStep(stepInput({ pluginRunnerBinding: binding() }));
  assert.equal(deniedResult.success, false);
  assert.equal(deniedResult.errorCode, 'PLUGIN_HOST_CALL_DENIED');
});

test('内置包只兼容可由当前资源精确重算的历史数组摘要', async () => {
  const resourceSha256 = { 'runtime/index.js': `sha256:${'c'.repeat(64)}`, 'workflows/deploy.json': `sha256:${'d'.repeat(64)}` };
  const legacyResourceHash = `sha256:${createHash('sha256').update(JSON.stringify(Object.entries(resourceSha256).sort(([left], [right]) => left.localeCompare(right))), 'utf8').digest('hex')}`;
  const canonicalResourceHash = `sha256:${createHash('sha256').update(JSON.stringify(resourceSha256), 'utf8').digest('hex')}`;
  let launchedResourceHash: string | undefined;
  const client = { execute: async () => successResult() } as unknown as PluginRunnerClient;
  const builtinRegistry = {
    refresh: async () => undefined,
    get: () => ({
      packageSha256: hash,
      manifestSha256: hash,
      resourceSha256,
      resourceHash: canonicalResourceHash,
    }),
  };
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry as never,
    supervisor: { start: async (spec) => {
      launchedResourceHash = spec.resourceHash;
      return client;
    } },
  });

  const accepted = await adapter.executeStep(stepInput({ pluginRunnerBinding: binding({ resourceHash: legacyResourceHash }) }));
  assert.equal(accepted.success, true);
  assert.equal(launchedResourceHash, canonicalResourceHash);

  const rejected = await adapter.executeStep(stepInput({ pluginRunnerBinding: binding({ resourceHash: `sha256:${'e'.repeat(64)}` }) }));
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorCode, 'PLUGIN_RUNNER_VERSION_MISMATCH');
  assert.deepEqual(rejected.detail, {
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    expectedPackageSha256: hash,
    actualPackageSha256: hash,
    expectedManifestSha256: hash,
    actualManifestSha256: hash,
    expectedResourceHash: `sha256:${'e'.repeat(64)}`,
    actualResourceHash: canonicalResourceHash,
  });
});

test('内置多能力插件启动时传递 Manifest 的完整原始能力顺序', async () => {
  let launchedCapabilities: readonly string[] | undefined;
  const client = { execute: async () => successResult() } as unknown as PluginRunnerClient;
  const builtinRegistry = {
    refresh: async () => undefined,
    get: () => ({
      packageSha256: hash,
      manifestSha256: hash,
      resourceSha256: { 'runtime/index.js': hash },
      resourceHash: hash,
      capabilities: [
        { key: 'device.connection.test' },
        { key: 'device.identity.detect' },
        { key: 'device.discover' },
        { key: 'certificate.deploy' },
        { key: 'certificate.rollback' },
      ],
    }),
  };
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry as never,
    supervisor: {
      start: async (spec) => {
        launchedCapabilities = spec.capabilities;
        return client;
      },
    },
  });

  const result = await adapter.executeStep(stepInput({
    pluginRunnerBinding: binding({ capability: 'certificate.deploy' }),
  }));

  assert.equal(result.success, true);
  assert.deepEqual(launchedCapabilities, [
    'device.connection.test',
    'device.identity.detect',
    'device.discover',
    'certificate.deploy',
    'certificate.rollback',
  ]);
});

test('Runner 启动或握手失败在执行请求前明确失败，不进入 UNKNOWN', async () => {
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    supervisor: {
      start: async () => {
        throw new AppError('PLUGIN_RUNNER_START_FAILED', 'fixture handshake failed');
      },
    },
  });

  const result = await adapter.executeStep(stepInput({ pluginRunnerBinding: binding() }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'PLUGIN_RUNNER_START_FAILED');
  assert.equal(result.detail?.executionStatus, 'FAILED');
  assert.equal(result.detail?.mayBeUnknown, false);
});

test('非部署计划的 PluginWorkflow 能力入口先创建 Grant，再调用独立 Runner', async () => {
  let captured: StepExecutionInput | undefined;
  const grantCalls: Record<string, unknown>[] = [];
  const capabilityExecutor = new PluginWorkflowCapabilityExecutorAdapter(
    {
      executeStep: async (input) => {
        captured = input;
        return { success: true, detail: { executionMode: 'plugin_runner' } };
      },
    },
    {
      create: async (input) => {
        grantCalls.push(input as unknown as Record<string, unknown>);
        return { id: 'grant-capability' } as never;
      },
    },
  );
  const result = await capabilityExecutor.execute({
    tenantId: 'tenant-fixture',
    targetId: 'device-fixture',
    workflowVersionId: 'workflow-version-fixture',
    pluginVersionId: 'plugin-version-fixture',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    capability: 'test.echo',
    writeEffect: false,
    hostPermissions: ['secret.resolve'],
    input: { credential: { secretRef: 'secret://credential/password' } },
  });

  assert.equal(result.success, true);
  assert.equal(result.executionId.startsWith('plugin-run_'), true);
  assert.equal(grantCalls.length, 1);
  assert.deepEqual(grantCalls[0]?.allowedSecretRefs, ['secret://credential/password']);
  assert.equal(grantCalls[0]?.executorType, 'PLUGIN_RUNNER');
  assert.equal(captured?.step.inputSnapshot.executorType, 'PLUGIN_RUNNER');
  const binding = captured?.step.inputSnapshot.pluginRunnerBinding as Record<string, unknown>;
  assert.equal(binding.workflowVersionId, 'workflow-version-fixture');
  assert.equal(binding.pluginVersionId, 'plugin-version-fixture');
  assert.deepEqual(binding.grantRefs, ['grant-capability']);
});

test('Runner adapter 拒绝缺失绑定、旧快照和运行步骤不一致', async () => {
  const adapter = new PluginRunnerExecutorAdapter({ runner: runnerConfig(), supervisor: { start: async () => { throw new Error('不应启动 Runner'); } } });

  const missing = await adapter.executeStep(stepInput({
    pluginRuntimeCapability: { pluginVersionId: 'legacy-version' },
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
