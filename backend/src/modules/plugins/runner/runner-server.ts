import { newId } from '../../../shared/id.js';
import { assertHostApiGrant, getHostApiMethod, validateHostApiRequest, validateHostApiResult } from './protocol/host-api.registry.js';
import { pluginRunnerLimits } from './protocol/protocol.constants.js';
import { decodeJsonLine, encodeJsonLine, JsonLinesDecoder } from './protocol/protocol.codec.js';
import type {
  PluginRunnerError,
  PluginRunnerExecute,
  PluginRunnerExecuteResult,
  PluginRunnerHostCall,
  PluginRunnerHostResult,
  PluginRunnerMessage,
} from './protocol/protocol.types.js';
import {
  executorResultForMessage,
  loadPluginRunnerExecutor,
  type PluginRunnerExecutor,
  type PluginRunnerExecutorHostApi,
} from './plugin-runner-executor.js';
import { redactRunnerLog } from './runner-log.js';

/**
 * 生产 Runner 的 IPC 入口。
 * 插件执行器只存在于 Runner 进程；宿主只能通过 IPC 提供通用 Host API。
 */
const decoder = new JsonLinesDecoder();
const executorModulePath = readArgument('--executor-module');
const hostCalls = new Map<string, { resolve: (message: PluginRunnerHostResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let executor: PluginRunnerExecutor | undefined;
let binding: RunnerBinding | undefined;
let activeExecution: ActiveExecution | undefined;
let shuttingDown = false;
let draining = false;

process.stdin.on('data', (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) {
      // execute 会等待 Host API 回包，因此 host_result/cancel 必须能在执行期间立即处理。
      void handleMessage(message).catch((error) => failClosed(error));
    }
  } catch (error) {
    failClosed(error);
  }
});

process.stdin.on('end', () => {
  try {
    decoder.finish();
    if (!shuttingDown) process.exitCode = 2;
  } catch (error) {
    failClosed(error);
  }
});

async function handleMessage(message: PluginRunnerMessage): Promise<void> {
  if (message.messageType === 'hello') {
    await handleHello(message);
    return;
  }
  if (!binding || !executor) failClosed(new Error('Runner 尚未完成真实 PluginVersion 执行器装配'));
  assertBindingMessage(message);
  if (message.messageType === 'host_result') {
    resolveHostCall(message);
    return;
  }
  if (message.messageType === 'cancel') {
    handleCancel(message);
    return;
  }
  if (message.messageType === 'ping') {
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'pong', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, nonce: message.nonce });
    return;
  }
  if (message.messageType === 'shutdown') {
    await handleShutdown(message);
    return;
  }
  if (message.messageType === 'execute') {
    await handleExecute(message);
  }
}

async function handleHello(message: Extract<PluginRunnerMessage, { messageType: 'hello' }>): Promise<void> {
  if (binding || shuttingDown) failClosed(new Error('Runner 重复握手或已关闭'));
  if (!executorModulePath) failClosed(new Error('Runner 缺少固定 PluginVersion 执行器模块'));
  executor = await loadPluginRunnerExecutor(executorModulePath);
  assertExecutorBinding(executor, message);
  if (!message.tenantId) failClosed(new Error('Runner hello 缺少租户上下文'));
  binding = { tenantId: message.tenantId, executor };
  write({
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'hello_result',
    requestId: message.requestId,
    sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId,
    accepted: true,
    pluginId: executor.descriptor.pluginId,
    pluginVersion: executor.descriptor.pluginVersion,
    runnerVersion: message.runner.runnerVersion,
    sdkVersion: message.runner.sdkVersion,
    capabilities: [...executor.descriptor.capabilities],
    permissions: [...executor.descriptor.permissions],
    packageHash: executor.descriptor.packageHash,
    resourceHash: executor.descriptor.resourceHash,
    manifestHash: executor.descriptor.manifestHash,
  });
}

async function handleExecute(message: PluginRunnerExecute): Promise<void> {
  if (shuttingDown || draining) failClosed(new Error('Runner 正在关闭，不接受新的执行请求'));
  if (activeExecution) failClosed(new Error('Runner 同时存在多个执行请求'));
  if (!executor || !binding) failClosed(new Error('Runner 执行器未装配'));
  if (!executor.descriptor.capabilities.includes(message.capability)) {
    failClosed(new Error('执行请求的 Capability 未绑定到固定 PluginVersion'));
  }
  const active = {
    message,
    controller: new AbortController(),
    cancelRequested: false,
  } satisfies ActiveExecution;
  activeExecution = active;
  try {
    const rawResult = await executor.execute({
      pluginVersionId: message.pluginVersionId,
      pluginId: executor.descriptor.pluginId,
      pluginVersion: executor.descriptor.pluginVersion,
      tenantId: message.tenantId,
      executionId: message.executionId,
      executionStepId: message.executionStepId,
      capability: message.capability,
      input: message.input,
      grantRefs: [...message.grantRefs],
      idempotencyKey: message.idempotencyKey,
      deadlineAt: message.deadlineAt,
      writeEffect: message.writeEffect,
      signal: active.controller.signal,
      ...(message.checkpoint ? { checkpoint: message.checkpoint } : {}),
    }, createHostApi(message));
    const result = active.cancelRequested
      ? cancelledResult(message)
      : executorResultForMessage(message, rawResult);
    write({
      protocolVersion: 'gcac.plugin-runner/v1',
      messageType: 'execute_result',
      requestId: message.requestId,
      sentAt: new Date().toISOString(),
      pluginVersionId: message.pluginVersionId,
      tenantId: message.tenantId,
      executionId: message.executionId,
      executionStepId: message.executionStepId,
      success: result.success,
      status: result.status,
      summary: result.summary,
      normalizedObjects: result.normalizedObjects,
      warnings: result.warnings,
      ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (error) {
    write(active.cancelRequested ? cancelledResult(message) : executeFailure(message, error));
  } finally {
    activeExecution = undefined;
    if (draining) setTimeout(() => process.exit(0), 10);
  }
}

function handleCancel(message: Extract<PluginRunnerMessage, { messageType: 'cancel' }>): void {
  const active = activeExecution;
  const matches = active
    && active.message.requestId === message.targetRequestId
    && active.message.executionId === message.executionId
    && active.message.executionStepId === message.executionStepId;
  if (!matches) {
    write({
      protocolVersion: 'gcac.plugin-runner/v1',
      messageType: 'cancel_result',
      requestId: message.requestId,
      sentAt: new Date().toISOString(),
      pluginVersionId: message.pluginVersionId,
      tenantId: message.tenantId,
      executionId: message.executionId,
      executionStepId: message.executionStepId,
      targetRequestId: message.targetRequestId,
      accepted: false,
      status: 'ALREADY_COMPLETED',
    });
    return;
  }
  active.cancelRequested = true;
  active.controller.abort();
  write({
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'cancel_result',
    requestId: message.requestId,
    sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId,
    tenantId: message.tenantId,
    executionId: message.executionId,
    executionStepId: message.executionStepId,
    targetRequestId: message.targetRequestId,
    accepted: true,
    status: 'ACCEPTED',
  });
}

async function handleShutdown(message: Extract<PluginRunnerMessage, { messageType: 'shutdown' }>): Promise<void> {
  if (shuttingDown) return;
  if (activeExecution) draining = true;
  else shuttingDown = true;
  write({
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'shutdown_result',
    requestId: message.requestId,
    sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId,
    accepted: true,
    status: activeExecution ? 'DRAINING' : 'SHUTDOWN',
  });
  if (!activeExecution) setTimeout(() => process.exit(0), 10);
}

function createHostApi(message: PluginRunnerExecute): PluginRunnerExecutorHostApi {
  return {
    call: async (method, input, grantRefs, timeoutMs = pluginRunnerLimits.hostCallTimeoutMs) => {
      if (!activeExecution || activeExecution.message.requestId !== message.requestId) throw new Error('Host API 调用不属于当前执行');
      assertGrantRefsSubset(grantRefs, message.grantRefs);
      const definition = getHostApiMethod(method);
      assertHostApiGrant(method, binding!.executor.descriptor.permissions, grantRefs);
      validateHostApiRequest(method, input);
      const requestId = newId('plugin-host-call');
      const hostCall: PluginRunnerHostCall = {
        protocolVersion: 'gcac.plugin-runner/v1',
        messageType: 'host_call',
        requestId,
        sentAt: new Date().toISOString(),
        pluginVersionId: message.pluginVersionId,
        tenantId: message.tenantId,
        executionId: message.executionId,
        executionStepId: message.executionStepId,
        capability: message.capability,
        method,
        input,
        grantRefs: [...grantRefs],
        timeoutMs: Math.min(timeoutMs, definition.timeoutMs),
      };
      const result = await requestHost(hostCall, Math.min(timeoutMs, definition.timeoutMs));
      if (!result.ok) throw new Error(result.error?.message ?? 'Host API 调用失败');
      return validateHostApiResult(method, result.output ?? {});
    },
  };
}

function requestHost(message: PluginRunnerHostCall, timeoutMs: number): Promise<PluginRunnerHostResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostCalls.delete(message.requestId);
      reject(new Error('Host API 调用超时'));
    }, timeoutMs);
    hostCalls.set(message.requestId, { resolve, reject, timer });
    try {
      write(message);
    } catch (error) {
      clearTimeout(timer);
      hostCalls.delete(message.requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function resolveHostCall(message: PluginRunnerHostResult): void {
  const pending = hostCalls.get(message.requestId);
  if (!pending) failClosed(new Error('Host API 返回了未知 requestId'));
  assertBindingMessage(message);
  if (!activeExecution || message.executionId !== activeExecution.message.executionId || message.executionStepId !== activeExecution.message.executionStepId) {
    failClosed(new Error('Host API 返回了错误执行上下文'));
  }
  if (message.capability !== activeExecution.message.capability) failClosed(new Error('Host API 返回了错误 Capability'));
  clearTimeout(pending!.timer);
  hostCalls.delete(message.requestId);
  pending!.resolve(message);
}

function assertExecutorBinding(
  candidate: PluginRunnerExecutor,
  message: Extract<PluginRunnerMessage, { messageType: 'hello' }>,
): void {
  const descriptor = candidate.descriptor;
  if (message.pluginVersionId !== descriptor.pluginVersionId
    || message.pluginId !== descriptor.pluginId
    || message.pluginVersion !== descriptor.pluginVersion
    || !sameStringArray(message.capabilities, descriptor.capabilities)
    || !sameStringArray(message.permissions, descriptor.permissions)
    || message.packageHash !== descriptor.packageHash
    || message.resourceHash !== descriptor.resourceHash
    || message.manifestHash !== descriptor.manifestHash) {
    failClosed(new Error('hello 与固定 PluginVersion 执行器不匹配'));
  }
}

function assertBindingMessage(message: PluginRunnerMessage): void {
  if (!binding || !executor || message.pluginVersionId !== executor.descriptor.pluginVersionId) {
    failClosed(new Error('Runner 消息携带了未固定的 PluginVersion'));
  }
  if (message.tenantId !== undefined && message.tenantId !== binding.tenantId) {
    failClosed(new Error('Runner 消息携带了错误租户'));
  }
  if ('capability' in message && !executor.descriptor.capabilities.includes(message.capability)) {
    failClosed(new Error('Runner 消息携带了未绑定的 Capability'));
  }
}

function assertGrantRefsSubset(requested: readonly string[], allowed: readonly string[]): void {
  if (!Array.isArray(requested) || requested.length > 100 || requested.some((ref) => !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) {
    failClosed(new Error('Runner Grant 引用格式无效'));
  }
  const allowedSet = new Set(allowed);
  if (requested.some((ref) => !allowedSet.has(ref))) failClosed(new Error('Runner Host API 使用了未绑定的 Grant 引用'));
  if (new Set(requested).size !== requested.length) failClosed(new Error('Runner Host API Grant 引用不得重复'));
}

function executeFailure(message: PluginRunnerExecute, error: unknown): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: message.requestId,
    sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId,
    tenantId: message.tenantId,
    executionId: message.executionId,
    executionStepId: message.executionStepId,
    success: false,
    status: 'FAILED',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: errorPayload('PLUGIN_CAPABILITY_EXECUTION_FAILED', error instanceof Error ? error.message : String(error)),
  };
}

function errorPayload(code: string, message: string): PluginRunnerError {
  return { code, message: redactRunnerLog(message).slice(0, 512), retryable: false, mayBeUnknown: false, secretRedacted: true };
}

function cancelledResult(message: PluginRunnerExecute): PluginRunnerExecuteResult {
  const writeEffect = message.writeEffect;
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: message.requestId,
    sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId,
    tenantId: message.tenantId,
    executionId: message.executionId,
    executionStepId: message.executionStepId,
    success: false,
    status: writeEffect ? 'UNKNOWN' : 'CANCELLED',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: {
      code: writeEffect ? 'PLUGIN_OPERATION_UNKNOWN_STATE' : 'PLUGIN_OPERATION_CANCELLED',
      message: writeEffect ? '写操作取消后无法确认外部结果，必须进入恢复流程' : '插件执行已取消',
      retryable: false,
      mayBeUnknown: writeEffect,
      secretRedacted: true,
    },
  };
}

function write(message: PluginRunnerMessage): void {
  process.stdout.write(encodeJsonLine(message));
}

function failClosed(error: unknown): never {
  for (const pending of hostCalls.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Runner 已失败关闭'));
  }
  hostCalls.clear();
  writeStderr(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

function writeStderr(message: string): void {
  process.stderr.write(`${redactRunnerLog(message).slice(0, 512)}\n`);
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

interface RunnerBinding {
  tenantId: string;
  executor: PluginRunnerExecutor;
}

interface ActiveExecution {
  message: PluginRunnerExecute;
  controller: AbortController;
  cancelRequested: boolean;
}
