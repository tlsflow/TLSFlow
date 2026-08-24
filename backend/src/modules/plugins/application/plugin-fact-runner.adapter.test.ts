import assert from 'node:assert/strict';
import test from 'node:test';
import type { PluginRunnerExecutionInput } from '../runner/plugin-runner-client.js';
import { PluginFactRunnerAdapter } from './plugin-fact-runner.adapter.js';
import type { PluginFactRunnerInput } from './plugin-fact-pipeline.service.js';

test('Fact Runner 只从固定 Registry 生成 Runner 启动规格', async () => {
  const calls: { spec?: Record<string, unknown>; request?: Record<string, unknown> } = {};
  const runner = new PluginFactRunnerAdapter({
    runner: {
      executablePath: 'C:/runner/gcac-plugin-runner.exe',
      workingDirectory: 'C:/runner',
      args: ['--fixed', '--executor-module', 'C:/old/runtime.js'],
      executorModulePath: 'C:/runner/bootstrap.js',
      runnerVersion: 'runner-1',
      sdkVersion: 'sdk-1',
    },
    builtinRegistry: {
      async refresh() { return []; },
      get() {
        return {
          pluginId: 'web.nginx', version: '1.0.0', packageDirectory: 'web-nginx', runtimeEntrypoint: 'runtime/index.js',
          runtimeEntrypointPath: 'C:/packages/web-nginx/runtime/index.js', executionMode: 'PLUGIN_RUNNER', ipcProtocol: 'gcac.plugin-runner/v1',
          manifest: {} as never, capabilities: [{ key: 'application.discover' }] as never, workflows: [],
          packageSha256: `sha256:${'b'.repeat(64)}`, manifestSha256: `sha256:${'c'.repeat(64)}`, resourceSha256: {}, resourceHash: `sha256:${'d'.repeat(64)}`,
        };
      },
    },
    supervisor: {
      async start(spec) {
        calls.spec = spec as unknown as Record<string, unknown>;
        return {
          async execute(request: PluginRunnerExecutionInput) {
            calls.request = request as unknown as Record<string, unknown>;
            return {
              protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: 'request-1', sentAt: new Date().toISOString(),
              pluginVersionId: 'plugin-version-1', tenantId: request.tenantId, executionId: request.executionId, executionStepId: request.executionStepId,
              success: true, status: 'SUCCESS', summary: {}, normalizedObjects: [], warnings: [],
            };
          },
        } as never;
      },
    },
  });
  const result = await runner.execute(input());
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(calls.spec?.args, ['--fixed', '--executor-module', 'C:/packages/web-nginx/runtime/index.js']);
  assert.equal(calls.spec?.pluginVersionId, 'plugin-version-1');
  assert.equal(calls.request?.writeEffect, false);
});

test('Fact Runner 将真实 Runner 进程异常收敛为 UNKNOWN', async () => {
  const runner = new PluginFactRunnerAdapter({
    runner: {
      executablePath: 'C:/runner/gcac-plugin-runner.exe', workingDirectory: 'C:/runner', args: ['--fixed'], runnerVersion: 'runner-1', sdkVersion: 'sdk-1',
      executorModulePath: 'C:/runner/bootstrap.js',
    },
    builtinRegistry: {
      async refresh() { return []; },
      get() { return { pluginId: 'web.nginx', version: '1.0.0', packageDirectory: 'web-nginx', runtimeEntrypoint: 'runtime/index.js', runtimeEntrypointPath: 'C:/packages/web-nginx/runtime/index.js', executionMode: 'PLUGIN_RUNNER', ipcProtocol: 'gcac.plugin-runner/v1', manifest: {} as never, capabilities: [{ key: 'application.discover' }] as never, workflows: [], packageSha256: `sha256:${'b'.repeat(64)}`, manifestSha256: `sha256:${'c'.repeat(64)}`, resourceSha256: {}, resourceHash: `sha256:${'d'.repeat(64)}` }; },
    },
    supervisor: { async start() { throw new Error('runner crashed'); } },
  });
  const result = await runner.execute(input());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.error?.mayBeUnknown, true);
});

function input(): PluginFactRunnerInput {
  return {
    tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', workflowVersionId: 'workflow-1', planDigest: 'a'.repeat(64),
    pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', pluginVersion: '1.0.0', capability: 'application.discover', input: { factEnvelope: {} },
    grantRefs: ['grant-1'], idempotencyKey: 'idempotency-1', deadlineAt: new Date(Date.now() + 10_000).toISOString(), writeEffect: false,
    hostPermissions: ['artifact.read'], packageHash: `sha256:${'b'.repeat(64)}`, manifestHash: `sha256:${'c'.repeat(64)}`, resourceHash: `sha256:${'d'.repeat(64)}`,
  };
}
