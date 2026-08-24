import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRunnerClient } from './plugin-runner-client.js';
import { BuiltinPluginRegistry } from '../builtin-plugins/builtin-plugin-registry.js';
import {
  resolveDevelopmentPluginRunnerConfig,
  resolvePluginRunnerConfig,
  resolveProductionPluginRunnerConfig,
} from './production-runner-config.js';

const runnerServer = resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js');
const hash = `sha256:${'a'.repeat(64)}`;

test('生产 Runner 未注入 PluginVersion 执行器时握手前失败关闭', async () => {
  const environment = {
    NODE_ENV: 'production',
    GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH: process.execPath,
    GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY: process.cwd(),
    GCAC_PLUGIN_RUNNER_ARGS_JSON: JSON.stringify([runnerServer]),
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

test('生产 Runner 不接受部署环境注入执行器模块', () => {
  assert.throws(() => resolveProductionPluginRunnerConfig({
    NODE_ENV: 'production',
    GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH: process.execPath,
    GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY: process.cwd(),
    GCAC_PLUGIN_RUNNER_ARGS_JSON: JSON.stringify([runnerServer, '--executor-module', runnerServer]),
    GCAC_PLUGIN_RUNNER_VERSION: '1.0.0',
    GCAC_PLUGIN_SDK_VERSION: '1.0.0',
  }), /PluginVersion/);
});

test('开发 Runner 使用固定 IPC 入口，测试与生产不允许回退到本地默认值', () => {
  const development = resolveDevelopmentPluginRunnerConfig({ NODE_ENV: 'development' });

  assert.ok(development);
  assert.equal(development.executablePath, process.execPath);
  assert.equal(development.workingDirectory, process.cwd());
  assert.equal(development.args.includes('--executor-module'), false);
  assert.match(development.args.at(-1) ?? '', /runner-server\.(?:ts|js)$/);
  assert.equal(resolveDevelopmentPluginRunnerConfig({ NODE_ENV: 'test' }), undefined);
  assert.equal(resolveDevelopmentPluginRunnerConfig({ NODE_ENV: 'production' }), undefined);
  assert.equal(resolvePluginRunnerConfig({ NODE_ENV: 'test' }), undefined);
});

test('开发 Runner 能以独立子进程握手固定 ca.microsoft-adcs PluginVersion', async () => {
  const config = resolveDevelopmentPluginRunnerConfig({ NODE_ENV: 'development' });
  assert.ok(config);
  const registry = new BuiltinPluginRegistry();
  await registry.refresh();
  const entry = registry.list().find((candidate) => candidate.pluginId === 'ca.microsoft-adcs');
  assert.ok(entry);
  const client = new PluginRunnerClient({
    ...config,
    args: replaceExecutorModule(config.args, entry.runtimeEntrypointPath),
    pluginVersionId: 'ca-microsoft-adcs-development-v1',
    pluginId: entry.pluginId,
    pluginVersion: entry.version,
    tenantId: 'tenant-development',
    environment: {
      GCAC_PLUGIN_VERSION_ID: 'ca-microsoft-adcs-development-v1',
      GCAC_PLUGIN_ID: entry.pluginId,
      GCAC_PLUGIN_VERSION: entry.version,
      GCAC_PLUGIN_PACKAGE_HASH: entry.packageSha256,
      GCAC_PLUGIN_RESOURCE_HASH: entry.resourceHash,
      GCAC_PLUGIN_MANIFEST_HASH: entry.manifestSha256,
    },
    capabilities: entry.capabilities.map((capability) => capability.key),
    hostPermissions: entry.manifest.permissions,
    packageHash: entry.packageSha256,
    resourceHash: entry.resourceHash,
    manifestHash: entry.manifestSha256,
  });

  try {
    await client.start();
    assert.equal(client.state, 'READY');
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

function replaceExecutorModule(args: readonly string[], runtimeEntrypointPath: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--executor-module') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--executor-module=')) continue;
    result.push(argument);
  }
  return [...result, '--executor-module', runtimeEntrypointPath];
}
