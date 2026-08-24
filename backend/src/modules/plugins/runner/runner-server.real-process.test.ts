import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRunnerClient, type PluginRunnerExecutionInput, type PluginRunnerLaunchSpec } from './plugin-runner-client.js';

const runnerServer = resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js');
const executorModule = resolve(process.cwd(), 'dist/modules/plugins/runner/fixtures/runner-executor.js');
const hash = `sha256:${'a'.repeat(64)}`;

test('runner-server 只装配固定执行器并在真实子进程执行绑定能力', async () => {
  const client = new PluginRunnerClient({
    ...spec(),
    args: [runnerServer, '--executor-module', executorModule],
  });
  try {
    await client.start();
    const result = await client.execute(actionInput());
    assert.equal(result.status, 'SUCCESS');
    assert.deepEqual(result.output, { value: 'hello' });
    await assert.rejects(client.execute(actionInput({
      executionId: 'execution-2',
      executionStepId: 'step-2',
      capability: 'test.other',
      actionId: 'test.other.v1',
      input: {},
      idempotencyKey: 'idem-2',
    })), /Capability|固定 PluginVersion/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('runner-server 真实子进程可在执行期间往返 Host API，并及时处理取消', async () => {
  const hostCalls: string[] = [];
  const client = new PluginRunnerClient({
    ...spec(),
    args: [runnerServer, '--executor-module', executorModule],
    hostApiHandler: async (context) => {
      hostCalls.push(context.method);
      return { ok: true, data: { id: String(context.input.artifactRef) } };
    },
  });
  try {
    await client.start();
    const hostResult = await client.execute(actionInput({
      executionId: 'execution-host',
      executionStepId: 'step-host',
      input: { value: 'hello', hostCall: true },
      grantRefs: ['grant-1'],
      idempotencyKey: 'idem-host',
    }));
    assert.deepEqual(hostResult.output, { value: 'hello', hostResult: { ok: true, data: { id: 'artifact://artifact-1' } } });
    assert.deepEqual(hostCalls, ['artifact.grant.read']);

    const execution = client.execute(actionInput({
      executionId: 'execution-cancel',
      executionStepId: 'step-cancel',
      input: { delayMs: 10_000 },
      idempotencyKey: 'idem-cancel',
    }));
    await waitFor(() => client.activeRequestId !== undefined);
    const targetRequestId = client.activeRequestId!;
    const cancelResult = await client.cancel({
      tenantId: 'tenant-1', executionId: 'execution-cancel', executionStepId: 'step-cancel', targetRequestId,
      reason: 'test cancellation',
    });
    assert.equal(cancelResult.accepted, true);
    assert.equal((await execution).status, 'CANCELLED');

    const writeExecution = client.execute(actionInput({
      executionId: 'execution-write-cancel',
      executionStepId: 'step-write-cancel',
      input: { delayMs: 10_000 },
      idempotencyKey: 'idem-write-cancel',
      writeEffect: true,
    }));
    await waitFor(() => client.activeRequestId !== undefined);
    await client.cancel({
      tenantId: 'tenant-1', executionId: 'execution-write-cancel', executionStepId: 'step-write-cancel', targetRequestId: client.activeRequestId!,
      reason: 'test write cancellation',
    });
    assert.equal((await writeExecution).status, 'UNKNOWN');
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

function spec(): PluginRunnerLaunchSpec {
  return {
    pluginVersionId: 'test-version-v1',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-1',
    executablePath: process.execPath,
    args: [],
    workingDirectory: process.cwd(),
    environment: { NODE_ENV: 'test' },
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['test.echo'],
    hostPermissions: ['artifact.read'],
    packageHash: hash,
    resourceHash: hash,
    manifestHash: hash,
    startupTimeoutMs: 500,
    helloTimeoutMs: 300,
    executeTimeoutMs: 300,
    shutdownGraceMs: 300,
  };
}

function actionInput(overrides: Partial<PluginRunnerExecutionInput> = {}): PluginRunnerExecutionInput {
  return {
    tenantId: 'tenant-1',
    executionId: 'execution-1',
    executionStepId: 'step-1',
    workflowVersionId: 'workflow-version-1',
    pluginVersionId: 'test-version-v1',
    pluginId: 'test.echo',
    capability: 'test.echo',
    actionId: 'test.echo.v1',
    actionContractVersion: 'v1',
    inputSchemaSha256: hash,
    outputSchemaSha256: hash,
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    planDigest: 'b'.repeat(64),
    writeEffect: false,
    input: { value: 'hello' },
    grantRefs: [],
    idempotencyKey: 'idem-1',
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  assert.equal(predicate(), true, '等待 Runner 活动执行超时');
}
