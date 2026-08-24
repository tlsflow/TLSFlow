import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginRunnerClient, type PluginRunnerLaunchSpec } from './plugin-runner-client.js';
import { PluginRunnerSupervisor } from './plugin-runner-supervisor.js';

const runnerServer = resolve(process.cwd(), 'dist/modules/plugins/runner/fixtures/runner-server.js');

test('真实子进程完成 hello、ping、execute 和 progress 去重', async () => {
  const progress: number[] = [];
  const client = new PluginRunnerClient(spec('progress'), (message) => progress.push(message.sequence));
  try {
    await client.start();
    await client.ping();
    const result = await client.execute(executionInput(false));
    assert.equal(result.success, true);
    assert.deepEqual(progress, [1, 2]);
  } finally {
    await close(client);
  }
});

test('真实子进程执行 Host API，权限缺失时失败关闭', async () => {
  const allowed = new PluginRunnerClient({ ...spec('host-call'), hostPermissions: ['artifact.read'], hostApiHandler: async () => ({ ok: true, data: { id: 'artifact-1' } }) });
  try {
    await allowed.start();
    const result = await allowed.execute(executionInput(false, ['grant-1']));
    assert.equal(result.success, true);
    assert.equal((result.summary.data as { id: string }).id, 'artifact-1');
  } finally {
    await close(allowed);
  }

  const denied = new PluginRunnerClient({ ...spec('host-call'), hostApiHandler: async () => ({ ok: true, data: { id: 'artifact-1' } }) });
  try {
    await denied.start();
    const result = await denied.execute(executionInput(false, ['grant-1']));
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'PLUGIN_HOST_CALL_DENIED');
  } finally {
    await close(denied);
  }
});

test('Host API 超时后迟到结果不会二次写回', async () => {
  const client = new PluginRunnerClient({ ...spec('host-call-late'), hostPermissions: ['artifact.read'], hostCallTimeoutMs: 30, hostApiHandler: async () => { await delay(120); return { id: 'late' }; } });
  try {
    await client.start();
    const result = await client.execute(executionInput(false, ['grant-1']));
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'PLUGIN_RUNNER_TIMEOUT');
  } finally {
    await close(client);
  }
});

test('Host API capability 绑定错误时失败关闭，租户边界在执行前拒绝', async () => {
  const client = new PluginRunnerClient({ ...spec('host-call-bad-capability'), hostPermissions: ['artifact.read'], hostApiHandler: async () => ({ ok: true }) });
  try {
    await client.start();
    await assert.rejects(client.execute(executionInput(false, ['grant-1'])), /capability|协议|失败关闭/);
    assert.equal(client.state, 'CRASHED');
  } finally {
    await close(client);
  }

  const tenantMismatch = new PluginRunnerClient(spec('echo'));
  try {
    await tenantMismatch.start();
    await assert.rejects(tenantMismatch.execute({ ...executionInput(false), tenantId: 'tenant-other' }), /租户/);
  } finally {
    await close(tenantMismatch);
  }
});

test('取消与 execute_result 竞态只完成一次并返回 CANCELLED', async () => {
  const client = new PluginRunnerClient(spec('cancel'));
  try {
    await client.start();
    const execution = client.execute(executionInput(false));
    await waitFor(() => client.activeRequestId !== undefined);
    const cancel = await client.cancel({ tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', targetRequestId: client.activeRequestId!, reason: '测试取消' });
    assert.equal(cancel.status, 'ACCEPTED');
    assert.equal((await execution).status, 'CANCELLED');
  } finally {
    await close(client);
  }
});

test('Runner 启动、握手、stdout/stderr 和崩溃故障真实失败', async () => {
  const missingExecutable = resolve(process.cwd(), 'dist/modules/plugins/runner/fixtures/missing-runner.js');
  assert.throws(() => new PluginRunnerClient(spec('echo', { executablePath: missingExecutable })), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_START_FAILED'));
  const startupFailure = new PluginRunnerClient(spec('startup-failure'));
  await assert.rejects(startupFailure.start(), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_START_FAILED'));

  const helloTimeout = new PluginRunnerClient(spec('hello-timeout', { helloTimeoutMs: 50, startupTimeoutMs: 50 }));
  await assert.rejects(helloTimeout.start(), /超时|Runner/);
  const helloMismatch = new PluginRunnerClient(spec('hello-mismatch'));
  await assert.rejects(helloMismatch.start(), /固定|握手/);
  const runnerVersionMismatch = new PluginRunnerClient(spec('runner-version-mismatch'));
  await assert.rejects(runnerVersionMismatch.start(), /固定|握手/);
  const hashValue = 'sha256:' + 'a'.repeat(64);
  const hashOk = new PluginRunnerClient(spec('echo', { packageHash: hashValue, resourceHash: hashValue, manifestHash: hashValue }));
  await hashOk.start();
  await close(hashOk);
  const hashMismatch = new PluginRunnerClient(spec('hash-mismatch', { packageHash: hashValue, resourceHash: hashValue, manifestHash: hashValue }));
  await assert.rejects(hashMismatch.start(), /固定|握手/);
  for (const field of ['packageHash', 'resourceHash', 'manifestHash'] as const) {
    const changed = { packageHash: hashValue, resourceHash: hashValue, manifestHash: hashValue, [field]: `sha256:${'b'.repeat(64)}` };
    await assert.rejects(new PluginRunnerClient(spec('hash-mismatch', changed)).start(), /固定|握手/);
  }
  const invalid = new PluginRunnerClient(spec('invalid-output'));
  await invalid.start();
  await assert.rejects(invalid.execute(executionInput(false)), /协议|合同/);
  const overflow = new PluginRunnerClient(spec('stdout-overflow'));
  await overflow.start();
  await assert.rejects(overflow.execute(executionInput(false)), /最大消息长度|协议/);
  const stderr = new PluginRunnerClient(spec('stderr-overflow'));
  await assert.rejects(stderr.start(), /stderr|日志|协议/);
  const stderrSecret = new PluginRunnerClient(spec('stderr-secret'));
  await stderrSecret.start();
  assert.match(stderrSecret.stderrLog, /\[REDACTED\]/);
  assert.doesNotMatch(stderrSecret.stderrLog, /super-secret-value/);
  assert.doesNotMatch(stderrSecret.stderrLog, /secret-value/);
  const timeout = new PluginRunnerClient(spec('timeout', { executeTimeoutMs: 40 }));
  await timeout.start();
  await assert.rejects(timeout.execute(executionInput(false)), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_TIMEOUT'));
  await timeout.ping();
  const timeoutResult = await timeout.execute(executionInput(true));
  assert.equal(timeoutResult.status, 'UNKNOWN');
  assert.equal(timeoutResult.error?.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  const late = new PluginRunnerClient(spec('late-execute', { executeTimeoutMs: 40 }));
  await late.start();
  const lateResult = await late.execute(executionInput(true));
  assert.equal(lateResult.status, 'UNKNOWN');
  await delay(220);
  assert.equal(late.state, 'READY');
  await late.ping();
  const failedWrite = new PluginRunnerClient(spec('write-failed'));
  await failedWrite.start();
  const failedWriteResult = await failedWrite.execute(executionInput(true));
  assert.equal(failedWriteResult.status, 'UNKNOWN');
  assert.equal(failedWriteResult.error?.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  const crash = new PluginRunnerClient(spec('crash'));
  await crash.start();
  const crashResult = await crash.execute(executionInput(true));
  assert.equal(crashResult.status, 'UNKNOWN');
  assert.equal(crashResult.error?.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  await close(overflow);
  await close(stderr);
  await close(stderrSecret);
  await close(timeout);
  await close(late);
  await close(failedWrite);
  await close(invalid);
  await close(helloTimeout);
  await close(helloMismatch);
  await close(crash);
  await close(startupFailure);
});

test('shutdown 超时会强制终止进程树，且不重放写操作', async () => {
  const client = new PluginRunnerClient(spec('shutdown-timeout', { shutdownGraceMs: 40 }));
  await client.start();
  await assert.rejects(client.shutdown(), /超时|Runner/);
  await client.stop(true);
  assert.equal(client.state, 'STOPPED');

  const tree = new PluginRunnerClient(spec('spawn-child', { executeTimeoutMs: 100 }));
  await tree.start();
  const execution = tree.execute(executionInput(true));
  await waitFor(() => tree.activeRequestId !== undefined);
  await tree.stop(true);
  const executionResult = await execution;
  assert.equal(executionResult.status, 'UNKNOWN');
  assert.equal(executionResult.error?.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  assert.equal(tree.state, 'STOPPED');

  const lateExit = new PluginRunnerClient(spec('shutdown-late-exit', { shutdownGraceMs: 40 }));
  await lateExit.start();
  await assert.rejects(lateExit.shutdown(), /关闭宽限期|超时|Runner/);
  await lateExit.stop(true);
  assert.equal(lateExit.state, 'STOPPED');
});

test('drain 会等待活动执行完成后再回收 Runner', async () => {
  const client = new PluginRunnerClient(spec('drain-active'));
  await client.start();
  const execution = client.execute(executionInput(false));
  await waitFor(() => client.activeRequestId !== undefined);
  await client.drain();
  assert.equal((await execution).success, true);
  assert.equal(client.state, 'STOPPED');
});

test('Supervisor 固定 PluginVersion、串行执行、drain 和版本切换', async () => {
  const supervisor = new PluginRunnerSupervisor();
  const firstSpec = spec('echo', { pluginVersionId: 'test-version-v1' });
  const firstStart = supervisor.start(firstSpec);
  const concurrentStart = supervisor.start(firstSpec);
  const first = await firstStart;
  assert.equal(await concurrentStart, first);
  await assert.rejects(supervisor.start(spec('progress', { pluginVersionId: 'test-version-v1' })), /固定|启动规格/);
  const next = await supervisor.switchVersion('test-version-v1', 'tenant-1', spec('echo', { pluginVersionId: 'test-version-v2', pluginVersion: '2.0.0' }));
  assert.equal(next.state, 'READY');
  assert.equal(first.state, 'STOPPED');
  assert.equal(first.retired, true);
  await assert.rejects(first.start(), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_VERSION_MISMATCH'));
  await assert.rejects(first.execute(executionInput(false)), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_VERSION_MISMATCH'));
  await assert.rejects(supervisor.start(firstSpec), (error: unknown) => hasErrorCode(error, 'PLUGIN_RUNNER_VERSION_MISMATCH'));
  assert.deepEqual(supervisor.list().map((item) => item.pluginVersionId), ['test-version-v2']);
  await supervisor.shutdownAll();
});

test('Runner 拒绝执行控制环境变量，且不接受已过期截止时间', async () => {
  const unsafe = new PluginRunnerClient(spec('echo', { environment: { NODE_OPTIONS: '--require evil.js' } }));
  await assert.rejects(unsafe.start(), /启动失败/);
  const client = new PluginRunnerClient(spec('echo'));
  try {
    await client.start();
    await assert.rejects(client.execute({ ...executionInput(false), deadlineAt: new Date(Date.now() - 1).toISOString() }), /截止时间|超时/);
  } finally {
    await close(client);
  }
});

test('Supervisor 重启上限为零时失败关闭', async () => {
  const supervisor = new PluginRunnerSupervisor({ maxRestarts: 0 });
  await supervisor.start(spec('echo'));
  await assert.rejects(supervisor.restart('test-version-v1', 'tenant-1'), /熔断上限/);
  await supervisor.shutdownAll();
  assert.throws(() => new PluginRunnerSupervisor({ maxRestarts: -1 }), /重启次数/);
});

test('Supervisor 仅在后续新入口受控重建崩溃 Runner，且达到上限后熔断', async () => {
  const supervisor = new PluginRunnerSupervisor({ maxRestarts: 1 });
  const crashSpec = spec('crash');
  const first = await supervisor.start(crashSpec);
  await assert.rejects(first.execute(executionInput(false)), /异常退出|崩溃/);
  await waitFor(() => first.state === 'CRASHED');

  const recovered = await supervisor.start(crashSpec);
  assert.notEqual(recovered, first);
  assert.equal(recovered.state, 'READY');
  assert.equal(supervisor.list()[0]?.restartCount, 1);

  await assert.rejects(recovered.execute(executionInput(false)), /异常退出|崩溃/);
  await waitFor(() => recovered.state === 'CRASHED');
  await assert.rejects(supervisor.start(crashSpec), /熔断上限/);
  await supervisor.shutdownAll();
});

function spec(mode: string, overrides: Partial<PluginRunnerLaunchSpec> = {}): PluginRunnerLaunchSpec {
  const pluginVersionId = overrides.pluginVersionId ?? 'test-version-v1';
  return {
    pluginVersionId, pluginId: overrides.pluginId ?? 'test.echo', pluginVersion: overrides.pluginVersion ?? '1.0.0', tenantId: overrides.tenantId ?? 'tenant-1', packageHash: overrides.packageHash ?? `sha256:${'a'.repeat(64)}`, resourceHash: overrides.resourceHash ?? `sha256:${'a'.repeat(64)}`, manifestHash: overrides.manifestHash ?? `sha256:${'a'.repeat(64)}`,
    executablePath: process.execPath, args: ['--no-warnings', runnerServer, '--plugin-version-id', pluginVersionId, '--plugin-id', overrides.pluginId ?? 'test.echo', '--plugin-version', overrides.pluginVersion ?? '1.0.0', '--mode', mode, ...(overrides.packageHash ? ['--package-hash', overrides.packageHash] : []), ...(overrides.resourceHash ? ['--resource-hash', overrides.resourceHash] : []), ...(overrides.manifestHash ? ['--manifest-hash', overrides.manifestHash] : [])],
    workingDirectory: process.cwd(), environment: { NODE_ENV: 'test' }, runnerVersion: '1.0.0', sdkVersion: '1.0.0', capabilities: ['test.echo'], startupTimeoutMs: 500, helloTimeoutMs: 300, executeTimeoutMs: 300, hostCallTimeoutMs: 100, shutdownGraceMs: 300,
    ...overrides,
  };
}

function executionInput(writeEffect: boolean, grantRefs: string[] = []) {
  return { tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', workflowVersionId: 'workflow-version-1', planDigest: 'b'.repeat(64), capability: 'test.echo', input: { value: 'hello' }, grantRefs, idempotencyKey: 'idem-1', deadlineAt: new Date(Date.now() + 60_000).toISOString(), writeEffect };
}

async function close(client: PluginRunnerClient): Promise<void> {
  try {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  } catch {
    await client.stop(true);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.equal(predicate(), true, '等待 Runner 状态变化超时');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function hasErrorCode(error: unknown, errorCode: string): boolean {
  return error instanceof Error && (error as Error & { errorCode?: string }).errorCode === errorCode;
}
