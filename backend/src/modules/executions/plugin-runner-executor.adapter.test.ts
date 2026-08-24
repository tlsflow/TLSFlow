import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalize } from '../../shared/canonical-json.js';
import type { JsonSchema } from '../../common/validation/json-schema.js';
import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';
import type { PluginRunnerClient, PluginRunnerExecutionInput } from '../plugins/runner/plugin-runner-client.js';
import {
  createPluginRunnerExecutors,
  expandPluginActionGrantActions,
  PluginRunnerExecutorAdapter,
  PluginWorkflowCapabilityExecutorAdapter,
  pluginActionBindingApiVersion,
  type PluginActionBindingV1,
  type PluginActionExecutionInput,
} from './application/plugin-runner-executor.adapter.js';

const hash = `sha256:${'a'.repeat(64)}`;
const planDigest = 'b'.repeat(64);
const inputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } },
};
const outputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } },
};
const inputSchemaSha256 = schemaHash(inputSchema);
const outputSchemaSha256 = schemaHash(outputSchema);

test('crypto.hmac 会同步授予公开标识 Secret 的内部解析目的', () => {
  assert.deepEqual(
    expandPluginActionGrantActions(['crypto.hmac', 'network.http']),
    ['crypto.hmac', 'network.http', 'crypto.hmac.public-identifier'],
  );
  assert.deepEqual(expandPluginActionGrantActions(['cloud.service.get']), ['cloud.service.get']);
});

test('旧包级字段不能伪装成步骤级 Action Binding，直接 Capability 入口也失败关闭', async () => {
  const adapter = new PluginRunnerExecutorAdapter();
  const stepResult = await adapter.executeStep({
    step: {
      id: 'step-1',
      tenantId: 'tenant-1',
      executionRunId: 'run-1',
      stepNo: 1,
      stepType: 'INSTALL',
      name: 'legacy',
      dependsOn: [],
      idempotent: true,
      attemptCount: 0,
      maxAttempts: 1,
      inputSnapshot: { pluginRunnerBinding: {} },
      status: 'RUNNING',
      createdAt: '',
      updatedAt: '',
      createdBy: 'test',
      version: 1,
    },
    runType: 'apply',
    dryRun: false,
  });
  assert.equal(stepResult.errorCode, 'VALIDATION_FAILED');

  const legacyResult = await new PluginWorkflowCapabilityExecutorAdapter().execute({
    tenantId: 'tenant-1',
    workflowVersionId: 'workflow-1',
    pluginVersionId: 'plugin-version-1',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    capability: 'test.echo',
    writeEffect: false,
    hostPermissions: [],
    input: {},
  });
  assert.equal(legacyResult.errorCode, 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
});

test('Action v2 固定全部身份字段并只发送单个结构化输入', async () => {
  let request: Record<string, unknown> | undefined;
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry(),
    executionGrants: executionGrants(),
    supervisor: {
      start: async () => ({
        execute: async (candidate: PluginRunnerExecutionInput) => {
          request = structuredClone(candidate) as unknown as Record<string, unknown>;
          return successResult(candidate, { value: 'done' });
        },
      } as unknown as PluginRunnerClient),
    },
  });

  const result = await adapter.executeAction(actionInput());
  assert.equal(result.success, true);
  assert.deepEqual(result.output, { value: 'done' });
  assert.deepEqual(request?.input, { value: 'input' });
  assert.equal(request?.tenantId, 'tenant-1');
  assert.equal(request?.executionId, 'run-1');
  assert.equal(request?.executionStepId, 'step-1');
  assert.equal(request?.workflowVersionId, 'workflow-1');
  assert.equal(request?.pluginVersionId, 'plugin-version-1');
  assert.equal(request?.pluginId, 'test.echo');
  assert.equal(request?.capability, 'test.echo');
  assert.equal(request?.actionId, 'test.echo.v1');
  assert.equal(request?.actionContractVersion, 'v1');
  assert.equal(request?.inputSchemaSha256, inputSchemaSha256);
  assert.equal(request?.outputSchemaSha256, outputSchemaSha256);
  assert.equal(request?.grantRefs instanceof Array, true);
  assert.equal('workflow' in (request ?? {}), false);
  assert.equal('rollback' in (request ?? {}), false);
  assert.equal('checkpoint' in (request ?? {}), false);
  assert.equal('variables' in (request ?? {}), false);
});

test('Action 输出不符合冻结 Schema 时当前 DSL 步骤失败', async () => {
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry(),
    executionGrants: executionGrants(),
    supervisor: {
      start: async () => ({
        execute: async (request: PluginRunnerExecutionInput) => successResult(request, { unexpected: true }),
      } as unknown as PluginRunnerClient),
    },
  });

  const result = await adapter.executeAction(actionInput());
  assert.equal(result.success, false);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'PLUGIN_CONTRACT_INVALID');
});

test('只有写入结果明确未知时才进入 UNKNOWN', async () => {
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry(),
    executionGrants: executionGrants(),
    supervisor: {
      start: async () => ({
        execute: async (request: PluginRunnerExecutionInput) => ({
          ...successResult(request, {}),
          success: false,
          status: 'UNKNOWN',
          error: {
            code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
            message: '外部写入超时',
            retryable: false,
            mayBeUnknown: true,
            secretRedacted: true,
          },
        }),
      } as unknown as PluginRunnerClient),
    },
  });

  const result = await adapter.executeAction({ ...actionInput(), binding: { ...binding(), writeEffect: true } });
  assert.equal(result.success, false);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.errorCode, 'PLUGIN_OPERATION_UNKNOWN_STATE');
});

test('非写 Action 或缺少不确定证据时拒绝 UNKNOWN', async () => {
  const adapter = new PluginRunnerExecutorAdapter({
    runner: runnerConfig(),
    builtinRegistry: builtinRegistry(),
    executionGrants: executionGrants(),
    supervisor: {
      start: async () => ({
        execute: async (request: PluginRunnerExecutionInput) => ({
          ...successResult(request, {}),
          success: false,
          status: 'UNKNOWN',
          error: { code: 'UNKNOWN', message: '不完整状态', retryable: false, mayBeUnknown: false, secretRedacted: true },
        }),
      } as unknown as PluginRunnerClient),
    },
  });

  const nonWrite = await adapter.executeAction(actionInput());
  assert.equal(nonWrite.status, 'FAILED');
  assert.equal(nonWrite.errorCode, 'PLUGIN_CONTRACT_INVALID');

  const write = await adapter.executeAction({ ...actionInput(), binding: { ...binding(), writeEffect: true } });
  assert.equal(write.status, 'FAILED');
  assert.equal(write.errorCode, 'PLUGIN_CONTRACT_INVALID');
});

test('默认注册表只提供 plugin.action，不能作为部署目标执行器', () => {
  assert.deepEqual(createPluginRunnerExecutors().map((executor) => executor.type), ['plugin.action']);
});

test('证书部署和回滚 Action 只能由普通 DSL 执行', async () => {
  let started = false;
  const adapter = new PluginRunnerExecutorAdapter({
    supervisor: { start: async () => { started = true; throw new Error('不应启动 Runner'); } },
  });
  const result = await adapter.executeAction({
    ...actionInput(),
    binding: { ...binding(), capability: 'certificate.deploy', actionId: 'certificate.deploy.v1' },
  });
  assert.equal(result.success, false);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
  assert.equal(started, false);
});

function actionInput(): PluginActionExecutionInput {
  return {
    binding: binding(),
    executionId: 'run-1',
    executionStepId: 'step-1',
    input: { value: 'input' },
    grantRefs: ['grant-1'],
    idempotencyKey: 'idem-1',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function binding(): PluginActionBindingV1 {
  return {
    apiVersion: pluginActionBindingApiVersion,
    tenantId: 'tenant-1',
    workflowVersionId: 'workflow-1',
    workflowStepName: 'sign-request',
    pluginVersionId: 'plugin-version-1',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    capability: 'test.echo',
    actionId: 'test.echo.v1',
    actionContractVersion: 'v1',
    inputSchema,
    outputSchema,
    inputSchemaSha256,
    outputSchemaSha256,
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    planDigest,
    writeEffect: false,
    hostPermissions: [],
  };
}

function builtinRegistry() {
  return {
    refresh: async () => undefined,
    get: () => ({
      packageSha256: hash,
      manifestSha256: hash,
      resourceHash: hash,
      runtimeEntrypointPath: '/runner/test-echo.js',
      executionMode: 'DSL_STEP_ACTION',
      manifest: { permissions: [] },
      capabilities: [{ key: 'test.echo' }],
    }),
  } as never;
}

function runnerConfig() {
  return {
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: ['/runner/server.js'],
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
  } as never;
}

function executionGrants() {
  return {
    validate: async (input: Record<string, unknown>) => {
      assert.equal(input.executorType, 'plugin.action');
      assert.equal(input.actionId, 'test.echo.v1');
      assert.equal(input.actionContractVersion, 'v1');
      assert.equal(input.inputSchemaSha256, inputSchemaSha256);
      assert.equal(input.outputSchemaSha256, outputSchemaSha256);
      return { id: input.grantId, allowedActions: ['plugin.action.execute'] } as never;
    },
  } as never;
}

function successResult(request: PluginRunnerExecutionInput, output: Record<string, unknown>): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v2',
    messageType: 'execute_result',
    requestId: 'request-1',
    sentAt: new Date().toISOString(),
    pluginVersionId: String(request.pluginVersionId),
    tenantId: String(request.tenantId),
    executionId: String(request.executionId),
    executionStepId: String(request.executionStepId),
    workflowVersionId: String(request.workflowVersionId),
    pluginId: String(request.pluginId),
    capability: String(request.capability),
    actionId: String(request.actionId),
    actionContractVersion: String(request.actionContractVersion),
    inputSchemaSha256: String(request.inputSchemaSha256),
    outputSchemaSha256: String(request.outputSchemaSha256),
    packageHash: String(request.packageHash),
    manifestHash: String(request.manifestHash),
    resourceHash: String(request.resourceHash),
    planDigest: String(request.planDigest),
    writeEffect: Boolean(request.writeEffect),
    success: true,
    status: 'SUCCESS',
    output,
    warnings: [],
  };
}

function schemaHash(schema: JsonSchema): string {
  return `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`;
}
