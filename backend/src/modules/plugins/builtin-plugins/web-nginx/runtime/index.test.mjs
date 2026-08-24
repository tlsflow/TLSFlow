import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createPluginRunnerExecutor } from './index.js';
import { PluginRunnerClient } from '../../../runner/plugin-runner-client.js';

const hash = `sha256:${'a'.repeat(64)}`;
const planDigest = 'b'.repeat(64);
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const pluginVersion = manifest.version;
const capabilities = manifest.capabilities.map((item) => item.key);
const permissions = manifest.permissions;
const env = {
  GCAC_PLUGIN_VERSION_ID: `web-nginx-${pluginVersion.replaceAll('.', '-')}-dev`,
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};

test('Nginx Runner 声明固定发现 Action，并拒绝篡改的执行绑定', async () => {
  await withEnvironmentAsync(env, async () => {
    const executor = createPluginRunnerExecutor();
    assert.deepEqual(executor.descriptor.capabilities, ['application.discover']);
    assert.equal(executor.descriptor.actions.length, 1);
    const action = executor.descriptor.actions[0];
    assert.deepEqual({
      actionId: action.actionId,
      capability: action.capability,
      actionContractVersion: action.actionContractVersion,
      resourceHash: action.resourceHash,
    }, {
      actionId: 'application.discover.v1',
      capability: 'application.discover',
      actionContractVersion: 'v1',
      resourceHash: hash,
    });
    assert.match(action.inputSchemaSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(action.outputSchemaSha256, /^sha256:[a-f0-9]{64}$/);

    const context = executionInput(executor);
    const result = await executor.execute(context);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.output.summary.discoveryMode, 'agent-standard-facts');
    assert.deepEqual(result.output.normalizedObjects, []);
    assert.equal(result.warnings[0]?.code, 'DISCOVERY_PROJECTED_BY_HOST');

    await assert.rejects(
      () => executor.execute({ ...context, outputSchemaSha256: `sha256:${'c'.repeat(64)}` }),
      (error) => error?.code === 'PLUGIN_RUNNER_VERSION_MISMATCH',
    );
    await assert.rejects(
      () => executor.execute({ ...context, writeEffect: true }),
      (error) => error?.code === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
    );
  });
});

test('Nginx Runner 子进程可装载并执行只读发现 Action', async () => {
  await withEnvironmentAsync(env, async () => {
    const executor = createPluginRunnerExecutor();
    const client = new PluginRunnerClient({
      pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
      pluginId: manifest.pluginId,
      pluginVersion,
      tenantId: 'tenant-nginx',
      executablePath: process.execPath,
      args: [
        resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'),
        '--executor-module',
        resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/web-nginx/runtime/index.js'),
      ],
      workingDirectory: process.cwd(),
      environment: env,
      runnerVersion: '1.0.0',
      sdkVersion: '1.0.0',
      capabilities,
      hostPermissions: permissions,
      packageHash: hash,
      manifestHash: hash,
      resourceHash: hash,
      startupTimeoutMs: 1000,
      helloTimeoutMs: 500,
      executeTimeoutMs: 1000,
    });
    try {
      const result = await client.execute({
        tenantId: 'tenant-nginx',
        executionId: 'run-nginx',
        executionStepId: 'step-discover',
        ...actionBinding(executor),
        grantRefs: ['agent-fact-grant'],
        idempotencyKey: 'idem-nginx-discover',
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        input: {},
      });
      assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
      assert.equal(result.output.summary.discoveryMode, 'agent-standard-facts');
      assert.deepEqual(result.output.normalizedObjects, []);
      assert.equal(client.state, 'READY');
    } finally {
      if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
      else await client.stop(true);
    }
  });
});

test('Nginx Runner 缺少固定资源摘要时失败关闭', () => {
  withEnvironment(env, () => {
    delete process.env.GCAC_PLUGIN_RESOURCE_HASH;
    assert.throws(() => createPluginRunnerExecutor(), /GCAC_PLUGIN_RESOURCE_HASH/);
  });
});

function executionInput(executor) {
  const action = executor.descriptor.actions.find((item) => item.actionId === 'application.discover.v1');
  assert.ok(action, '缺少 application.discover.v1 Action Contract');
  return {
    tenantId: 'tenant-nginx',
    executionId: 'run-nginx',
    executionStepId: 'step-discover',
    ...actionBinding(executor),
    pluginVersion,
    grantRefs: ['agent-fact-grant'],
    idempotencyKey: 'idem-nginx-discover',
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    input: {},
    signal: new AbortController().signal,
  };
}

function actionBinding(executor) {
  const action = executor.descriptor.actions.find((item) => item.actionId === 'application.discover.v1');
  assert.ok(action, '缺少 application.discover.v1 Action Contract');
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: manifest.pluginId,
    workflowVersionId: 'workflow-nginx-1',
    capability: action.capability,
    actionId: action.actionId,
    actionContractVersion: action.actionContractVersion,
    inputSchemaSha256: action.inputSchemaSha256,
    outputSchemaSha256: action.outputSchemaSha256,
    packageHash: env.GCAC_PLUGIN_PACKAGE_HASH,
    manifestHash: env.GCAC_PLUGIN_MANIFEST_HASH,
    resourceHash: action.resourceHash,
    planDigest,
    writeEffect: false,
  };
}

function withEnvironment(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

async function withEnvironmentAsync(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
