import { spawn } from 'node:child_process';
import { JsonLinesDecoder, encodeJsonLine } from '../protocol/protocol.codec.js';
import type { PluginRunnerMessage, PluginRunnerHostResult } from '../protocol/protocol.types.js';

const argumentsMap = new Map<string, string>();
for (let index = 2; index < process.argv.length - 1; index += 1) if (process.argv[index]?.startsWith('--')) argumentsMap.set(process.argv[index]!.slice(2), process.argv[index + 1]!);
const pluginVersionId = argumentsMap.get('plugin-version-id') ?? 'test-version-v1';
const pluginId = argumentsMap.get('plugin-id') ?? 'test.echo';
const pluginVersion = argumentsMap.get('plugin-version') ?? '1.0.0';
const mode = argumentsMap.get('mode') ?? 'echo';
const decoder = new JsonLinesDecoder();
let activeRequestId: string | undefined;
let activeTimer: NodeJS.Timeout | undefined;
let hostCallRequestId: string | undefined;
let childProcess: ReturnType<typeof spawn> | undefined;
let drainingRequested = false;

if (mode === 'stderr-overflow') process.stderr.write('x'.repeat(40 * 1024));
if (mode === 'stderr-secret') {
  process.stderr.write('runner Bearer super-');
  process.stderr.write('secret-value\n');
}

process.stdin.on('data', (chunk: Buffer) => {
  try {
    decoder.push(chunk).forEach((message) => void handleMessage(message));
  } catch (error) {
    process.stderr.write(`runner protocol error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
});
process.stdin.on('end', () => {
  try { decoder.finish(); } catch { process.exitCode = 2; }
});

async function handleMessage(message: PluginRunnerMessage): Promise<void> {
  if (message.messageType === 'hello') {
    if (mode === 'hello-timeout') return;
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'hello_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, accepted: mode !== 'hello-rejected', pluginId: mode === 'hello-mismatch' ? 'test.wrong' : pluginId, pluginVersion: mode === 'hello-mismatch' ? '9.9.9' : pluginVersion, runnerVersion: mode === 'runner-version-mismatch' ? '9.9.9' : '1.0.0', sdkVersion: '1.0.0', capabilities: ['test.echo'], permissions: [...message.permissions], packageHash: mode === 'hash-mismatch' ? hash('a') : message.packageHash ?? hash('a'), resourceHash: mode === 'hash-mismatch' ? hash('b') : message.resourceHash ?? hash('a'), manifestHash: mode === 'hash-mismatch' ? hash('c') : message.manifestHash ?? hash('a'), ...(mode === 'hello-rejected' ? { error: errorPayload('PLUGIN_RUNNER_HANDSHAKE_FAILED', '测试拒绝握手') } : {}) });
    return;
  }
  if (message.messageType === 'ping') {
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'pong', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, nonce: message.nonce });
    return;
  }
  if (message.messageType === 'shutdown') {
    if (mode === 'shutdown-timeout') return;
    if (activeRequestId) {
      drainingRequested = true;
      write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'shutdown_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, accepted: true, status: 'DRAINING' });
      return;
    }
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'shutdown_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, accepted: true, status: 'SHUTDOWN' });
    if (mode === 'shutdown-late-exit') { setTimeout(() => process.exit(0), 5000); return; }
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (message.messageType === 'cancel') {
    if (activeRequestId !== message.targetRequestId) {
      write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'cancel_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, targetRequestId: message.targetRequestId, accepted: false, status: 'ALREADY_COMPLETED' });
      return;
    }
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = undefined;
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'cancel_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, targetRequestId: message.targetRequestId, accepted: true, status: 'ACCEPTED' });
    write(executeResult(message.targetRequestId, message, false, 'CANCELLED', { cancelled: true }, errorPayload('PLUGIN_RUNNER_TIMEOUT', '测试取消', false, false)));
    activeRequestId = undefined;
    return;
  }
  if (message.messageType === 'host_result') {
    if (hostCallRequestId !== message.requestId || !activeRequestId) return;
    hostCallRequestId = undefined;
    write(executeResult(activeRequestId, message, message.ok, message.ok ? 'SUCCESS' : 'FAILED', message.output ?? {}, message.error));
    activeRequestId = undefined;
    return;
  }
  if (message.messageType !== 'execute') return;
  activeRequestId = message.requestId;
  if (mode === 'crash') { process.exit(17); return; }
  if (mode === 'invalid-output') { process.stdout.write('runner log on stdout\n'); return; }
  if (mode === 'stdout-overflow') { process.stdout.write(`${'x'.repeat(70 * 1024)}\n`); return; }
  if (mode === 'spawn-child') {
    childProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    return;
  }
  if (mode === 'timeout') return;
  if (mode === 'late-execute') {
    setTimeout(() => finishExecute(message, true), 150);
    return;
  }
  if (mode === 'write-failed') {
    write(executeResult(message.requestId, message, false, 'FAILED', {}, errorPayload('PLUGIN_CAPABILITY_EXECUTION_FAILED', '测试写操作失败', false, false)));
    activeRequestId = undefined;
    return;
  }
  if (mode === 'host-call-crash') { sendHostCall(message); process.exit(19); return; }
  if (mode === 'host-call' || mode === 'host-call-late' || mode === 'host-call-bad-capability') { sendHostCall(message); return; }
  if (mode === 'progress') {
    write(progress(message, 1));
    write(progress(message, 1));
    write(progress(message, 2));
  }
  if (mode === 'cancel') {
    activeTimer = setTimeout(() => {
      finishExecute(message, true);
    }, 5000);
    return;
  }
  if (mode === 'drain-active') {
    activeTimer = setTimeout(() => finishExecute(message, true), 40);
    return;
  }
  finishExecute(message, true);
}

function sendHostCall(message: Extract<PluginRunnerMessage, { messageType: 'execute' }>): void {
  hostCallRequestId = `host-${message.requestId}`;
  write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'host_call', requestId: hostCallRequestId, sentAt: new Date().toISOString(), pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, capability: mode === 'host-call-bad-capability' ? 'test.other' : message.capability, method: 'artifact.grant.read', input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' }, grantRefs: ['grant-1'], timeoutMs: mode === 'host-call-late' ? 50 : 5000 });
}

function finishExecute(message: Extract<PluginRunnerMessage, { messageType: 'execute' }>, success: boolean): void {
  write(executeResult(message.requestId, message, success, success ? 'SUCCESS' : 'FAILED', { value: message.input }, undefined));
  activeRequestId = undefined;
  if (drainingRequested) setTimeout(() => process.exit(0), 10);
}

function executeResult(requestId: string, context: { tenantId: string; executionId: string; executionStepId: string }, success: boolean, status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED', summary: Record<string, unknown>, error: PluginRunnerHostResult['error'] | undefined): PluginRunnerMessage {
  return { protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId, sentAt: new Date().toISOString(), pluginVersionId, tenantId: context.tenantId, executionId: context.executionId, executionStepId: context.executionStepId, success, status, summary, normalizedObjects: [], warnings: [], ...(error ? { error } : {}) };
}

function progress(context: Extract<PluginRunnerMessage, { messageType: 'execute' }>, sequence: number): PluginRunnerMessage {
  return { protocolVersion: 'gcac.plugin-runner/v1', messageType: 'progress', requestId: `progress-${context.requestId}-${sequence}-${Math.random()}`, sentAt: new Date().toISOString(), pluginVersionId, tenantId: context.tenantId, executionId: context.executionId, executionStepId: context.executionStepId, sequence, stage: 'execute', percent: sequence * 25, summary: `progress-${sequence}` };
}

function errorPayload(code: string, message: string, retryable = false, mayBeUnknown = false) {
  return { code, message, retryable, mayBeUnknown, secretRedacted: true as const };
}

function hash(fill: string): string {
  return `sha256:${fill.repeat(64).slice(0, 64)}`;
}

function write(message: PluginRunnerMessage): void {
  process.stdout.write(encodeJsonLine(message));
}
