import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRunnerClient } from './plugin-runner-client.js';
import { resolveProductionPluginRunnerConfig } from './production-runner-config.js';

const runnerServer = resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js');
const hash = `sha256:${'a'.repeat(64)}`;

test('生产 Runner 缺少真实 PluginVersion 执行器时握手前失败关闭', async () => {
  const environment = {
    NODE_ENV: 'production',
    GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH: process.execPath,
    GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY: process.cwd(),
    GCAC_PLUGIN_RUNNER_ARGS_JSON: JSON.stringify([runnerServer]),
    // 故意把 IPC 入口自身作为执行器，验证生产接线不会把入口当成真实插件实现。
    GCAC_PLUGIN_RUNNER_EXECUTOR_MODULE_PATH: runnerServer,
    GCAC_PLUGIN_RUNNER_VERSION: '1.0.0',
    GCAC_PLUGIN_SDK_VERSION: '1.0.0',
  };
  const config = resolveProductionPluginRunnerConfig(environment)!;
  const client = new PluginRunnerClient({
    ...config,
    pluginVersionId: 'production-version-v1', pluginId: 'provider.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
    packageHash: hash, manifestHash: hash, resourceHash: hash, hostPermissions: ['network.http'], capabilities: ['provider.connection.test'],
  });
  await assert.rejects(client.start(), /执行器|Runner|握手/);
});

test('生产 Runner 配置缺失时失败关闭，不生成默认启动规格', () => {
  assert.throws(() => resolveProductionPluginRunnerConfig({
    NODE_ENV: 'production',
    GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH: process.execPath,
    GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY: process.cwd(),
    GCAC_PLUGIN_RUNNER_ARGS_JSON: JSON.stringify([runnerServer]),
    GCAC_PLUGIN_RUNNER_VERSION: '1.0.0',
    GCAC_PLUGIN_SDK_VERSION: '1.0.0',
  }), /GCAC_PLUGIN_RUNNER_EXECUTOR_MODULE_PATH/);
});
