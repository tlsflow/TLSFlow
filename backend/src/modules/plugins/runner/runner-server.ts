import { createHash } from 'node:crypto';
import { newId } from '../../../shared/id.js';
import { assertHostApiGrant, getHostApiMethod, validateHostApiRequest, validateHostApiResult } from './protocol/host-api.registry.js';
import { pluginRunnerLimits } from './protocol/protocol.constants.js';
import { encodeJsonLine, JsonLinesDecoder } from './protocol/protocol.codec.js';
import type {
  PluginActionMessageBinding,
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
  requireDeclaredAction,
  type PluginRunnerExecutor,
  type PluginRunnerExecutorHostApi,
} from './plugin-runner-executor.js';
import { redactRunnerLog } from './runner-log.js';

/**
 * 生产 Runner IPC 入口。它只执行一个固定的 plugin.action，永远不读取 DSL、
 * rollback、checkpoint 或宿主状态机输入。
 */
const decoder = new JsonLinesDecoder();
const executorModulePath = readArgument('--executor-module');
const hostCalls = new Map<string, { resolve: (message: PluginRunnerHostResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
const expiredHostRequestIds = new Set<string>();
let executor: PluginRunnerExecutor | undefined;
let binding: RunnerBinding | undefined;
let activeExecution: ActiveExecution | undefined;
let shuttingDown = false;
let draining = false;

process.stdin.on('data', (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) void handleMessage(message).catch((error) => failClosed(error));
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
  if (message.messageType === 'host_result') return resolveHostCall(message);
  if (message.messageType === 'cancel') return handleCancel(message);
  if (message.messageType === 'ping') {
    write({ protocolVersion: 'gcac.plugin-runner/v2', messageType: 'pong', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, nonce: message.nonce });
    return;
  }
  if (message.messageType === 'shutdown') return handleShutdown(message);
  if (message.messageType === 'execute') await handleExecute(message);
}

async function handleHello(message: Extract<PluginRunnerMessage, { messageType: 'hello' }>): Promise<void> {
  if (binding || shuttingDown) failClosed(new Error('Runner 重复握手或已关闭'));
  if (!executorModulePath) failClosed(new Error('Runner 缺少固定 PluginVersion 执行器模块'));
  executor = await loadPluginRunnerExecutor(executorModulePath);
  assertExecutorBinding(executor, message);
  if (!message.tenantId) failClosed(new Error('Runner hello 缺少租户上下文'));
  binding = { tenantId: message.tenantId, executor };
  write({
    protocolVersion: 'gcac.plugin-runner/v2', messageType: 'hello_result', requestId: message.requestId, sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId, accepted: true, pluginId: executor.descriptor.pluginId, pluginVersion: executor.descriptor.pluginVersion,
    runnerVersion: message.runner.runnerVersion, sdkVersion: message.runner.sdkVersion,
    capabilities: [...executor.descriptor.capabilities], permissions: [...executor.descriptor.permissions],
    packageHash: executor.descriptor.packageHash, resourceHash: executor.descriptor.resourceHash, manifestHash: executor.descriptor.manifestHash,
  });
}

async function handleExecute(message: PluginRunnerExecute): Promise<void> {
  if (shuttingDown || draining) failClosed(new Error('Runner 正在关闭，不接受新的执行请求'));
  if (activeExecution) failClosed(new Error('Runner 同时存在多个执行请求'));
  if (!executor || !binding) failClosed(new Error('Runner 执行器未装配'));
  assertExecutionDeadline(message.deadlineAt);
  assertAtomicActionInput(message.input);
  if (!executor.descriptor.capabilities.includes(message.capability)) failClosed(new Error('执行请求的 Capability 未绑定到固定 PluginVersion'));
  requireDeclaredAction(executor.descriptor, message);

  const active = { message, controller: new AbortController(), cancelRequested: false } satisfies ActiveExecution;
  activeExecution = active;
  try {
    const rawResult = await executor.execute({
      pluginVersionId: message.pluginVersionId,
      pluginId: executor.descriptor.pluginId,
      pluginVersion: executor.descriptor.pluginVersion,
      tenantId: message.tenantId,
      executionId: message.executionId,
      executionStepId: message.executionStepId,
      workflowVersionId: message.workflowVersionId,
      capability: message.capability,
      actionId: message.actionId,
      actionContractVersion: message.actionContractVersion,
      inputSchemaSha256: message.inputSchemaSha256,
      outputSchemaSha256: message.outputSchemaSha256,
      packageHash: message.packageHash,
      manifestHash: message.manifestHash,
      resourceHash: message.resourceHash,
      planDigest: message.planDigest,
      writeEffect: message.writeEffect,
      input: message.input,
      grantRefs: [...message.grantRefs],
      idempotencyKey: message.idempotencyKey,
      deadlineAt: message.deadlineAt,
      signal: active.controller.signal,
    }, createHostApi(message));
    const result = active.cancelRequested ? cancelledResult(message) : executorResultForMessage(message, rawResult);
    write(toExecuteResult(message, result));
  } catch (error) {
    write(active.cancelRequested ? cancelledResult(message) : executeFailure(message, error));
  } finally {
    activeExecution = undefined;
    if (draining) setTimeout(() => process.exit(0), 10);
  }
}

function handleCancel(message: Extract<PluginRunnerMessage, { messageType: 'cancel' }>): void {
  const active = activeExecution;
  const matches = active && active.message.requestId === message.targetRequestId
    && active.message.executionId === message.executionId && active.message.executionStepId === message.executionStepId;
  if (!matches) {
    write({ protocolVersion: 'gcac.plugin-runner/v2', messageType: 'cancel_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, targetRequestId: message.targetRequestId, accepted: false, status: 'ALREADY_COMPLETED' });
    return;
  }
  active.cancelRequested = true;
  active.controller.abort();
  write({ protocolVersion: 'gcac.plugin-runner/v2', messageType: 'cancel_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, targetRequestId: message.targetRequestId, accepted: true, status: 'ACCEPTED' });
}

function handleShutdown(message: Extract<PluginRunnerMessage, { messageType: 'shutdown' }>): void {
  if (shuttingDown) return;
  if (activeExecution) draining = true;
  else shuttingDown = true;
  write({ protocolVersion: 'gcac.plugin-runner/v2', messageType: 'shutdown_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, accepted: true, status: activeExecution ? 'DRAINING' : 'SHUTDOWN' });
  if (!activeExecution) setTimeout(() => process.exit(0), 10);
}

function createHostApi(message: PluginRunnerExecute): PluginRunnerExecutorHostApi {
  return {
    call: async (method, input, grantRefs, timeoutMs = pluginRunnerLimits.hostCallTimeoutMs) => {
      if (!activeExecution || activeExecution.message.requestId !== message.requestId) throw new Error('Host API 调用不属于当前 Action');
      assertGrantRefsSubset(grantRefs, message.grantRefs);
      const definition = getHostApiMethod(method);
      assertHostApiGrant(method, binding!.executor.descriptor.permissions, grantRefs);
      validateHostApiRequest(method, input);
      const requestId = newId('plugin-host-call');
      const hostCall: PluginRunnerHostCall = {
        protocolVersion: 'gcac.plugin-runner/v2', messageType: 'host_call', requestId, sentAt: new Date().toISOString(),
        pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId,
        workflowVersionId: message.workflowVersionId, pluginId: message.pluginId, capability: message.capability,
        actionId: message.actionId, actionContractVersion: message.actionContractVersion,
        inputSchemaSha256: message.inputSchemaSha256, outputSchemaSha256: message.outputSchemaSha256,
        packageHash: message.packageHash, manifestHash: message.manifestHash, resourceHash: message.resourceHash,
        planDigest: message.planDigest, writeEffect: message.writeEffect,
        method, input, grantRefs: [...grantRefs], idempotencyKey: deriveHostApiIdempotencyKey(message, method, input),
        deadlineAt: new Date(Math.min(Date.parse(message.deadlineAt), Date.now() + Math.min(timeoutMs, definition.timeoutMs))).toISOString(),
        timeoutMs: Math.min(timeoutMs, definition.timeoutMs),
      };
      const result = await requestHost(hostCall, Math.min(timeoutMs, definition.timeoutMs));
      if (!result.ok) throw new HostApiCallError(result.error);
      return validateHostApiResult(method, result.output ?? {});
    },
  };
}

function requestHost(message: PluginRunnerHostCall, timeoutMs: number): Promise<PluginRunnerHostResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostCalls.delete(message.requestId);
      rememberExpiredRequestId(message.requestId);
      reject(new Error('Host API 调用超时'));
    }, timeoutMs);
    hostCalls.set(message.requestId, { resolve, reject, timer });
    try { write(message); } catch (error) { clearTimeout(timer); hostCalls.delete(message.requestId); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}

function resolveHostCall(message: PluginRunnerHostResult): void {
  const pending = hostCalls.get(message.requestId);
  if (!pending) {
    if (expiredHostRequestIds.has(message.requestId)) return;
    failClosed(new Error('Host API 返回了未知 requestId'));
  }
  assertBindingMessage(message);
  const active = activeExecution;
  if (!active || message.executionId !== active.message.executionId || message.executionStepId !== active.message.executionStepId
    || !sameActionBinding(message, active.message)) failClosed(new Error('Host API 返回了错误 Action 上下文'));
  clearTimeout(pending!.timer);
  hostCalls.delete(message.requestId);
  pending!.resolve(message);
}

function assertExecutorBinding(candidate: PluginRunnerExecutor, message: Extract<PluginRunnerMessage, { messageType: 'hello' }>): void {
  const descriptor = candidate.descriptor;
  if (message.pluginVersionId !== descriptor.pluginVersionId || message.pluginId !== descriptor.pluginId || message.pluginVersion !== descriptor.pluginVersion
    || !sameStringArray(message.capabilities, descriptor.capabilities) || !sameStringArray(message.permissions, descriptor.permissions)
    || message.packageHash !== descriptor.packageHash || message.resourceHash !== descriptor.resourceHash || message.manifestHash !== descriptor.manifestHash) {
    failClosed(new Error('hello 与固定 PluginVersion 执行器不匹配'));
  }
}

function assertBindingMessage(message: PluginRunnerMessage): void {
  if (!binding || !executor || message.pluginVersionId !== executor.descriptor.pluginVersionId) failClosed(new Error('Runner 消息携带了未固定的 PluginVersion'));
  if (message.tenantId !== undefined && message.tenantId !== binding.tenantId) failClosed(new Error('Runner 消息携带了错误租户'));
  if ('capability' in message && !executor.descriptor.capabilities.includes(message.capability)) failClosed(new Error('Runner 消息携带了未绑定的 Capability'));
}

function assertGrantRefsSubset(requested: readonly string[], allowed: readonly string[]): void {
  if (!Array.isArray(requested) || requested.length > 100 || requested.some((ref) => !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) failClosed(new Error('Runner Grant 引用格式无效'));
  const allowedSet = new Set(allowed);
  if (requested.some((ref) => !allowedSet.has(ref)) || new Set(requested).size !== requested.length) failClosed(new Error('Runner Host API 使用了未绑定的 Grant 引用'));
}

function assertAtomicActionInput(input: Record<string, unknown>): void {
  const forbidden = new Set(['workflow', 'steps', 'rollback', 'checkpoint', 'checkpoints', 'workflowRequest', 'pluginRunnerBinding', 'pluginRuntimeCapability', 'variables']);
  const visit = (value: unknown, depth: number): void => {
    if (depth > 32 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) failClosed(new Error(`Action 输入不得携带 Workflow 编排字段：${key}`));
      visit(child, depth + 1);
    }
  };
  visit(input, 0);
}

function toExecuteResult(message: PluginRunnerExecute, result: ReturnType<typeof executorResultForMessage>): PluginRunnerExecuteResult {
  return {
    protocolVersion: 'gcac.plugin-runner/v2', messageType: 'execute_result', requestId: message.requestId, sentAt: new Date().toISOString(),
    pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId,
    workflowVersionId: message.workflowVersionId, pluginId: message.pluginId, capability: message.capability, actionId: message.actionId,
    actionContractVersion: message.actionContractVersion, inputSchemaSha256: message.inputSchemaSha256, outputSchemaSha256: message.outputSchemaSha256,
    packageHash: message.packageHash, manifestHash: message.manifestHash, resourceHash: message.resourceHash, planDigest: message.planDigest, writeEffect: message.writeEffect,
    success: result.success, status: result.status, output: result.output, warnings: result.warnings ?? [],
    ...(result.externalReceipt ? { externalReceipt: result.externalReceipt } : {}), ...(result.error ? { error: result.error } : {}),
  };
}

function executeFailure(message: PluginRunnerExecute, error: unknown): PluginRunnerExecuteResult {
  const hostError = error instanceof HostApiCallError ? error.error : undefined;
  const unknown = hostError?.mayBeUnknown === true;
  return toExecuteResult(message, {
    success: false,
    status: unknown ? 'UNKNOWN' : 'FAILED',
    output: {},
    warnings: [],
    error: hostError ?? errorPayload('PLUGIN_CAPABILITY_EXECUTION_FAILED', error instanceof Error ? error.message : String(error)),
  });
}

function cancelledResult(message: PluginRunnerExecute): PluginRunnerExecuteResult {
  return toExecuteResult(message, {
    success: false, status: message.writeEffect ? 'UNKNOWN' : 'CANCELLED', output: {}, warnings: [],
    error: { code: message.writeEffect ? 'PLUGIN_OPERATION_UNKNOWN_STATE' : 'PLUGIN_OPERATION_CANCELLED', message: message.writeEffect ? '写 Action 在取消时无法确认外部结果，必须进入恢复流程' : '插件 Action 已取消', retryable: false, mayBeUnknown: message.writeEffect, secretRedacted: true },
  });
}

function errorPayload(code: string, message: string): PluginRunnerError {
  return { code, message: redactRunnerLog(message).slice(0, 512), retryable: false, mayBeUnknown: false, secretRedacted: true };
}

class HostApiCallError extends Error {
  constructor(readonly error: PluginRunnerError | undefined) {
    super(error?.message ?? 'Host API 调用失败');
  }
}

function sameActionBinding(left: PluginActionMessageBinding, right: PluginActionMessageBinding): boolean {
  return left.workflowVersionId === right.workflowVersionId && left.pluginId === right.pluginId && left.capability === right.capability
    && left.actionId === right.actionId && left.actionContractVersion === right.actionContractVersion
    && left.inputSchemaSha256 === right.inputSchemaSha256 && left.outputSchemaSha256 === right.outputSchemaSha256
    && left.packageHash === right.packageHash && left.manifestHash === right.manifestHash && left.resourceHash === right.resourceHash
    && left.planDigest === right.planDigest && left.writeEffect === right.writeEffect;
}

function write(message: PluginRunnerMessage): void { process.stdout.write(encodeJsonLine(message)); }

function failClosed(error: unknown): never {
  for (const pending of hostCalls.values()) { clearTimeout(pending.timer); pending.reject(new Error('Runner 已失败关闭')); }
  hostCalls.clear();
  process.stderr.write(`${redactRunnerLog(error instanceof Error ? error.message : String(error)).slice(0, 512)}\n`);
  process.exit(2);
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }

function deriveHostApiIdempotencyKey(message: PluginRunnerExecute, method: string, input: Record<string, unknown>): string {
  return `host-${createHash('sha256').update(`${message.idempotencyKey}\u0000${method}\u0000${stableStringify(input)}`).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function rememberExpiredRequestId(requestId: string): void {
  expiredHostRequestIds.add(requestId);
  while (expiredHostRequestIds.size > pluginRunnerLimits.maxExpiredRequestIds) {
    const oldest = expiredHostRequestIds.values().next().value as string | undefined;
    if (oldest === undefined) return;
    expiredHostRequestIds.delete(oldest);
  }
}

function assertExecutionDeadline(deadlineAt: string): void {
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) failClosed(new Error('Runner 执行截止时间已到期'));
}

interface RunnerBinding { tenantId: string; executor: PluginRunnerExecutor; }
interface ActiveExecution { message: PluginRunnerExecute; controller: AbortController; cancelRequested: boolean; }
