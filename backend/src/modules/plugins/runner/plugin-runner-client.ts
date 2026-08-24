import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { newId } from '../../../shared/id.js';
import { AppError } from '../../../common/errors/app-error.js';
import { redactSensitive } from '../../../common/logging/redact.js';
import { assertHostApiGrant, getHostApiMethod, validateHostApiRequest, validateHostApiResult } from './protocol/host-api.registry.js';
import { pluginRunnerLimits } from './protocol/protocol.constants.js';
import { encodeJsonLine, JsonLinesDecoder } from './protocol/protocol.codec.js';
import type {
  PluginCheckpointRef,
  PluginRunnerCancelResult,
  PluginRunnerError,
  PluginRunnerExecute,
  PluginRunnerExecuteResult,
  PluginRunnerHostCall,
  PluginRunnerHostResult,
  PluginRunnerInboundMessage,
  PluginRunnerMessage,
  PluginRunnerMessageType,
  PluginRunnerOutboundMessage,
  PluginRunnerProgress,
  PluginRunnerShutdownResult,
} from './protocol/protocol.types.js';
import { redactRunnerLog } from './runner-log.js';

export type PluginRunnerState = 'STOPPED' | 'STARTING' | 'READY' | 'DRAINING' | 'CRASHED';

export interface PluginRunnerLaunchSpec {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  tenantId: string;
  executablePath: string;
  args: readonly string[];
  workingDirectory: string;
  environment?: Readonly<Record<string, string>>;
  runnerVersion: string;
  sdkVersion: string;
  startupTimeoutMs?: number;
  helloTimeoutMs?: number;
  executeTimeoutMs?: number;
  hostCallTimeoutMs?: number;
  shutdownGraceMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  capabilities: readonly string[];
  hostPermissions?: readonly string[];
  packageHash: string;
  resourceHash: string;
  manifestHash: string;
  hostApiHandler?: PluginRunnerHostApiHandler;
}

export interface PluginRunnerHostCallContext {
  requestId: string;
  method: string;
  input: Record<string, unknown>;
  grantRefs: readonly string[];
  timeoutMs: number;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capability: string;
  idempotencyKey: string;
  deadlineAt: string;
  workflowVersionId: string;
  planDigest: string;
  hostPermissions: readonly string[];
}

export type PluginRunnerHostApiHandler = (context: PluginRunnerHostCallContext) => Promise<Record<string, unknown>>;

export interface PluginRunnerExecutionInput {
  tenantId: string;
  executionId: string;
  executionStepId: string;
  /** 仅供宿主内部执行绑定使用；缺失时拒绝执行。 */
  workflowVersionId?: string;
  /** 仅供宿主内部执行绑定使用；缺失时拒绝执行。 */
  planDigest?: string;
  capability: string;
  input: Record<string, unknown>;
  grantRefs: string[];
  idempotencyKey: string;
  deadlineAt: string;
  writeEffect: boolean;
  checkpoint?: PluginCheckpointRef;
}

export interface PluginRunnerCancelInput {
  tenantId: string;
  executionId: string;
  executionStepId: string;
  targetRequestId: string;
  reason: string;
}

interface PendingRequest<T extends PluginRunnerInboundMessage> {
  expectedType: PluginRunnerMessageType;
  resolve: (message: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  writeEffect: boolean;
  executionId?: string;
  executionStepId?: string;
  nonce?: string;
}

interface ActiveExecution {
  requestId: string;
  executionId: string;
  executionStepId: string;
  workflowVersionId: string;
  planDigest: string;
  writeEffect: boolean;
  deadlineAt: string;
  capability: string;
  grantRefs: readonly string[];
}

/**
 * 一个客户端只绑定一个 PluginVersion 和一个租户。
 * 它没有业务缓存；所有跨执行状态必须由宿主的执行账本或 checkpoint 管理。
 */
export class PluginRunnerClient {
  private readonly spec: PluginRunnerLaunchSpec;
  private child?: ChildProcessWithoutNullStreams;
  private decoder = new JsonLinesDecoder();
  private readonly pending = new Map<string, PendingRequest<PluginRunnerInboundMessage>>();
  private readonly expiredRequestIds = new Set<string>();
  private readonly inboundRequestIds = new Set<string>();
  private readonly completedInboundRequestIds = new Set<string>();
  private readonly lastProgressSequence = new Map<string, number>();
  private readonly stderrChunks: string[] = [];
  private stderrRaw = '';
  private stderrBytes = 0;
  private stdoutBytes = 0;
  private hostCallCount = 0;
  private activeExecution?: ActiveExecution;
  private readonly expiredExecutionKeys = new Set<string>();
  private connectionGeneration = 0;
  private shutdownPromise?: Promise<PluginRunnerShutdownResult>;
  private startPromise?: Promise<void>;
  private exitPromise?: Promise<void>;
  private resolveExit?: () => void;
  private stateValue: PluginRunnerState = 'STOPPED';
  private failure?: Error;
  private resourceMonitor?: NodeJS.Timeout;
  private retiredValue = false;

  constructor(spec: PluginRunnerLaunchSpec, private readonly onProgress?: (message: PluginRunnerProgress) => void) {
    this.spec = immutableLaunchSpec(spec);
    for (const [name, value] of [['pluginVersionId', spec.pluginVersionId], ['pluginId', spec.pluginId], ['pluginVersion', spec.pluginVersion], ['tenantId', spec.tenantId], ['runnerVersion', spec.runnerVersion], ['sdkVersion', spec.sdkVersion]] as const) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner ${name} 不是固定标识符`);
    }
    if (!isAbsolute(spec.executablePath)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner executable 必须是绝对路径');
    if (!isAbsolute(spec.workingDirectory)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 工作目录必须是绝对路径');
    if (!existsSync(spec.executablePath) || !existsSync(spec.workingDirectory)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner executable 或工作目录不存在');
    if (spec.args.length === 0 || spec.args.length > 64 || spec.args.some((argument) => typeof argument !== 'string' || argument.length === 0 || argument.length > 4096)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 启动参数必须是有界固定字符串数组');
    validateLaunchLimits(this.spec);
  }

  get state(): PluginRunnerState { return this.stateValue; }
  get pluginVersionId(): string { return this.spec.pluginVersionId; }
  get tenantId(): string { return this.spec.tenantId; }
  get pid(): number | undefined { return this.child?.pid; }
  get activeRequestId(): string | undefined { return this.activeExecution?.requestId; }
  get stderrLog(): string { return redactRunnerLog(this.stderrRaw); }
  get retired(): boolean { return this.retiredValue; }

  async start(): Promise<void> {
    if (this.retiredValue) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner PluginVersion 已退休，不能重新启动');
    if (this.stateValue === 'READY') return;
    if (this.stateValue === 'CRASHED') throw this.failure ?? new AppError('PLUGIN_RUNNER_CRASHED', 'Runner 已崩溃，需要显式重启');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async execute(input: PluginRunnerExecutionInput): Promise<PluginRunnerExecuteResult> {
    await this.start();
    this.assertReady();
    if (input.tenantId !== this.spec.tenantId) throw new AppError('TENANT_SCOPE_DENIED', 'Runner 不允许跨租户执行');
    const workflowVersionId = requiredExecutionBinding(input.workflowVersionId, 'workflowVersionId');
    const planDigest = requiredPlanDigest(input.planDigest);
    assertDeadline(input.deadlineAt);
    if (this.activeExecution) throw new AppError('PLUGIN_RUNNER_BUSY', 'Runner 默认只允许一个执行中的请求');
    if (this.spec.capabilities && !this.spec.capabilities.includes(input.capability)) {
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Capability 未绑定到固定 PluginVersion');
    }
    const grantRefs = validateGrantRefs(input.grantRefs);
    const requestId = newId('plugin-execute');
    const message: PluginRunnerExecute = {
      protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute', requestId, sentAt: new Date().toISOString(),
      pluginVersionId: this.spec.pluginVersionId, tenantId: input.tenantId, executionId: input.executionId, executionStepId: input.executionStepId,
      capability: input.capability, input: input.input, grantRefs, idempotencyKey: input.idempotencyKey,
      deadlineAt: input.deadlineAt, writeEffect: input.writeEffect, ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    };
    this.activeExecution = {
      requestId,
      executionId: input.executionId,
      executionStepId: input.executionStepId,
      workflowVersionId,
      planDigest,
      writeEffect: input.writeEffect,
      deadlineAt: input.deadlineAt,
      capability: input.capability,
      grantRefs,
    };
    try {
      const timeoutMs = Math.min(this.spec.executeTimeoutMs ?? pluginRunnerLimits.executeTimeoutMs, Math.max(1, Date.parse(input.deadlineAt) - Date.now()));
      const result = await this.request<PluginRunnerExecuteResult>(message, 'execute_result', timeoutMs);
      return input.writeEffect ? normalizeWriteResult(result) : result;
    } catch (error) {
      rememberBounded(this.expiredExecutionKeys, executionKey(input.executionId, input.executionStepId), pluginRunnerLimits.maxExpiredRequestIds);
      if (input.writeEffect) return unknownResult(message, error);
      throw error;
    } finally {
      if (this.activeExecution?.requestId === requestId) this.activeExecution = undefined;
    }
  }

  async cancel(input: PluginRunnerCancelInput): Promise<PluginRunnerCancelResult> {
    this.assertReadyOrDraining();
    if (input.tenantId !== this.spec.tenantId) throw new AppError('TENANT_SCOPE_DENIED', 'Runner 不允许跨租户取消');
    const active = this.activeExecution;
    if (!active || active.requestId !== input.targetRequestId || active.executionId !== input.executionId || active.executionStepId !== input.executionStepId) {
      throw new AppError('PLUGIN_RUNNER_BUSY', '取消目标不是当前 Runner 的活动执行');
    }
    const message = {
      protocolVersion: 'gcac.plugin-runner/v1' as const, messageType: 'cancel' as const, requestId: newId('plugin-cancel'), sentAt: new Date().toISOString(),
      pluginVersionId: this.spec.pluginVersionId, tenantId: input.tenantId, executionId: input.executionId, executionStepId: input.executionStepId,
      targetRequestId: input.targetRequestId, reason: input.reason,
    };
    const remainingMs = Math.max(1, Date.parse(active.deadlineAt) - Date.now());
    return this.request<PluginRunnerCancelResult>(message, 'cancel_result', Math.min(this.spec.executeTimeoutMs ?? pluginRunnerLimits.executeTimeoutMs, remainingMs));
  }

  async ping(): Promise<void> {
    await this.start();
    this.assertReadyOrDraining();
    const message = { protocolVersion: 'gcac.plugin-runner/v1' as const, messageType: 'ping' as const, requestId: newId('plugin-ping'), sentAt: new Date().toISOString(), pluginVersionId: this.spec.pluginVersionId, nonce: newId('nonce') };
    await this.request(message, 'pong', pluginRunnerLimits.helloTimeoutMs);
  }

  async shutdown(reason: 'DRAIN' | 'HOST_EXIT' | 'VERSION_SWITCH' | 'DOCKER_STOP' = 'DRAIN'): Promise<PluginRunnerShutdownResult> {
    this.assertReadyOrDraining();
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownInternal(reason);
    try {
      return await this.shutdownPromise;
    } finally {
      this.shutdownPromise = undefined;
    }
  }

  async drain(): Promise<void> {
    if (this.stateValue === 'STOPPED') return;
    try {
      await this.shutdown('DRAIN');
    } catch (error) {
      await this.stop(true);
      throw error;
    }
  }

  /**
   * 退休是版本切换后的终态；与普通 drain 不同，退休后的 Client 永远不能重新启动。
   */
  async retire(): Promise<void> {
    this.retiredValue = true;
    const startPromise = this.startPromise;
    if (startPromise) {
      try { await startPromise; } catch { return; }
    }
    if (this.stateValue === 'READY' || this.stateValue === 'DRAINING') {
      await this.drain();
      return;
    }
    if (this.child) await this.stop(true);
  }

  private async shutdownInternal(reason: 'DRAIN' | 'HOST_EXIT' | 'VERSION_SWITCH' | 'DOCKER_STOP'): Promise<PluginRunnerShutdownResult> {
    this.stateValue = 'DRAINING';
    const graceMs = this.spec.shutdownGraceMs ?? pluginRunnerLimits.shutdownGraceMs;
    const shutdownDeadline = Date.now() + graceMs;
    const message = {
      protocolVersion: 'gcac.plugin-runner/v1' as const,
      messageType: 'shutdown' as const,
      requestId: newId('plugin-shutdown'),
      sentAt: new Date().toISOString(),
      pluginVersionId: this.spec.pluginVersionId,
      reason,
      graceMs,
    };
    const result = await this.request<PluginRunnerShutdownResult>(message, 'shutdown_result', graceMs);
    await this.waitForExit(Math.max(1, shutdownDeadline - Date.now()));
    if (this.child) {
      await terminateProcessTree(this.child, true);
      await this.waitForExit(500);
      throw new AppError('PLUGIN_RUNNER_TIMEOUT', 'Runner 未在关闭宽限期内退出');
    }
    return result;
  }

  async stop(force = true): Promise<void> {
    const child = this.child;
    if (!child) {
      this.stateValue = 'STOPPED';
      this.activeExecution = undefined;
      return;
    }
    this.stateValue = 'STOPPED';
    this.activeExecution = undefined;
    this.rejectPending(new AppError('PLUGIN_RUNNER_CRASHED', 'Runner 已被宿主终止', { force }));
    await terminateProcessTree(child, force);
    await this.waitForExit(500);
  }

  private async startInternal(): Promise<void> {
    if (this.stateValue === 'DRAINING') throw new AppError('PLUGIN_RUNNER_DRAINING', 'Runner 正在排空');
    this.stateValue = 'STARTING';
    this.failure = undefined;
    this.decoder = new JsonLinesDecoder();
    this.stderrChunks.length = 0;
    this.stderrRaw = '';
    this.stderrBytes = 0;
    this.stdoutBytes = 0;
    this.hostCallCount = 0;
    this.inboundRequestIds.clear();
    this.completedInboundRequestIds.clear();
    this.expiredRequestIds.clear();
    this.expiredExecutionKeys.clear();
    this.lastProgressSequence.clear();
    const generation = ++this.connectionGeneration;
    this.exitPromise = new Promise<void>((resolveExit) => { this.resolveExit = resolveExit; });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.spec.executablePath, [...this.spec.args], {
        cwd: this.spec.workingDirectory,
        env: cleanEnvironment(this.spec.environment),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      const failure = new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 进程启动失败', { error: error instanceof Error ? error.message : String(error) });
      this.failure = failure;
      this.stateValue = 'CRASHED';
      this.resolveExit?.();
      this.resolveExit = undefined;
      throw failure;
    }
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => { if (generation === this.connectionGeneration) this.handleStdout(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { if (generation === this.connectionGeneration) this.handleStderr(chunk); });
    child.stdin.on('error', (error) => { if (generation === this.connectionGeneration) this.handleChildError(error); });
    child.on('error', (error) => { if (generation === this.connectionGeneration) this.handleChildError(error); });
    child.on('close', (code, signal) => this.handleExit(code, signal, generation));
    this.resourceMonitor = setInterval(() => this.checkResourceLimits(generation), pluginRunnerLimits.resourcePollIntervalMs);
    if (!child.pid) {
      const failure = new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 未获得有效进程 ID');
      this.failure = failure;
      this.stateValue = 'CRASHED';
      await terminateProcessTree(child, true);
      throw failure;
    }
    const hello = {
      protocolVersion: 'gcac.plugin-runner/v1' as const, messageType: 'hello' as const, requestId: newId('plugin-hello'), sentAt: new Date().toISOString(),
      pluginVersionId: this.spec.pluginVersionId, pluginId: this.spec.pluginId, pluginVersion: this.spec.pluginVersion, tenantId: this.spec.tenantId,
      runner: { pid: child.pid ?? 0, sdkVersion: this.spec.sdkVersion, runnerVersion: this.spec.runnerVersion }, capabilities: [...(this.spec.capabilities ?? [])],
      permissions: [...(this.spec.hostPermissions ?? [])],
      packageHash: this.spec.packageHash!,
      resourceHash: this.spec.resourceHash!,
      manifestHash: this.spec.manifestHash!,
    };
    try {
      const result = await this.request(hello, 'hello_result', Math.min(this.spec.startupTimeoutMs ?? pluginRunnerLimits.startupTimeoutMs, this.spec.helloTimeoutMs ?? pluginRunnerLimits.helloTimeoutMs));
      this.assertHandshake(result);
      this.stateValue = 'READY';
    } catch (error) {
      this.stateValue = 'CRASHED';
      await terminateProcessTree(child, true);
      await this.waitForExit(500);
      throw error instanceof AppError ? error : new AppError('PLUGIN_RUNNER_HANDSHAKE_FAILED', 'Runner 握手失败', { error: String(error) });
    }
  }

  private handleStdout(chunk: Buffer): void {
    if (this.failure) return;
    this.stdoutBytes += chunk.byteLength;
    const maximum = this.spec.maxStdoutBytes ?? pluginRunnerLimits.maxStdoutBytes;
    if (this.stdoutBytes > maximum) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner stdout 超过最大总量', { maximum }));
      return;
    }
    try {
      const messages = this.decoder.push(chunk);
      messages.forEach((message) => this.handleMessage(message));
    } catch (error) {
      this.failProtocol(error);
    }
  }

  private handleStderr(chunk: Buffer): void {
    if (this.stateValue === 'STOPPED') return;
    this.stderrBytes += chunk.byteLength;
    const maximum = this.spec.maxStderrBytes ?? pluginRunnerLimits.maxStderrBytes;
    if (this.stderrBytes > maximum) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner stderr 超过最大日志长度', { maximum }));
      return;
    }
    // 保存有界原文只用于跨 chunk 脱敏，公开日志始终经过完整文本扫描。
    this.stderrRaw += chunk.toString('utf8');
    if (this.stderrRaw.length > maximum) this.stderrRaw = this.stderrRaw.slice(-maximum);
  }

  private handleMessage(message: PluginRunnerMessage): void {
    if (message.pluginVersionId !== this.spec.pluginVersionId) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 消息携带了未固定的 PluginVersion', { expected: this.spec.pluginVersionId, actual: message.pluginVersionId }));
      return;
    }
    if (message.tenantId && message.tenantId !== this.spec.tenantId) {
      this.failProtocol(new AppError('TENANT_SCOPE_DENIED', 'Runner 消息携带了错误租户')); return;
    }
    if (message.messageType === 'progress') {
      if (this.assertExecutionContext(message)) this.handleProgress(message);
      return;
    }
    if (message.messageType === 'host_call') {
      if (this.assertExecutionContext(message) && message.capability === this.activeExecution?.capability) void this.handleHostCall(message);
      else if (this.activeExecution) this.failProtocol(new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Host API capability 与当前执行不匹配'));
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      if (this.expiredRequestIds.has(message.requestId)) return;
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner 返回了未知 requestId', { requestId: message.requestId }));
      return;
    }
    if (pending.expectedType !== message.messageType) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner response 类型与 request 不匹配', { requestId: message.requestId, expected: pending.expectedType, actual: message.messageType }));
      return;
    }
    if (pending.executionId !== undefined && pending.executionId !== message.executionId
      || pending.executionStepId !== undefined && pending.executionStepId !== message.executionStepId) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner response 执行上下文与 request 不匹配', { requestId: message.requestId }));
      return;
    }
    if (message.messageType === 'pong' && message.nonce !== pending.nonce) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner pong nonce 与 ping 不匹配', { requestId: message.requestId }));
      return;
    }
    if (message.messageType === 'cancel_result') {
      const validStatus = message.accepted ? message.status === 'ACCEPTED' : message.status !== 'ACCEPTED';
      if (!validStatus) {
        this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'cancel_result 的 accepted 与 status 不匹配', { requestId: message.requestId }));
        return;
      }
    }
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    pending.resolve(message as PluginRunnerInboundMessage);
  }

  private handleProgress(message: PluginRunnerProgress): void {
    const key = `${message.executionId}:${message.executionStepId}`;
    const previous = this.lastProgressSequence.get(key);
    if (previous !== undefined && message.sequence < previous) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'progress sequence 乱序')); return;
    }
    if (previous !== undefined && message.sequence === previous) return;
    this.lastProgressSequence.set(key, message.sequence);
    this.onProgress?.(message);
  }

  private async handleHostCall(message: PluginRunnerHostCall): Promise<void> {
    if (this.inboundRequestIds.has(message.requestId) || this.completedInboundRequestIds.has(message.requestId)) { this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'host_call requestId 重复')); return; }
    if (this.hostCallCount >= (pluginRunnerLimits.maxConcurrentHostCalls)) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner Host API 并发请求超过限制'));
      return;
    }
    this.inboundRequestIds.add(message.requestId);
    this.hostCallCount += 1;
    let definition: ReturnType<typeof getHostApiMethod>;
    try {
      definition = getHostApiMethod(message.method);
    } catch (error) {
      this.inboundRequestIds.delete(message.requestId);
      this.hostCallCount -= 1;
      this.failProtocol(error);
      return;
    }
    const generation = this.connectionGeneration;
    const sendResult = (result: PluginRunnerHostResult): void => {
      this.inboundRequestIds.delete(message.requestId);
      if (generation !== this.connectionGeneration) return;
      this.completedInboundRequestIds.add(message.requestId);
      while (this.completedInboundRequestIds.size > pluginRunnerLimits.maxCompletedInboundRequestIds) {
        const oldest = this.completedInboundRequestIds.values().next().value as string | undefined;
        if (oldest === undefined) break;
        this.completedInboundRequestIds.delete(oldest);
      }
      this.hostCallCount -= 1;
      try { this.write(result); } catch (error) { this.failProtocol(error); }
    };
    try {
      assertHostApiGrant(message.method, this.spec.hostPermissions ?? [], message.grantRefs);
      assertGrantRefsSubset(message.grantRefs, this.activeExecution?.grantRefs ?? []);
      validateHostApiRequest(message.method, message.input);
      if (!this.spec.hostApiHandler) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner 未配置 Host API 处理器');
      let settled = false;
      const timeoutMs = Math.min(message.timeoutMs, this.spec.hostCallTimeoutMs ?? pluginRunnerLimits.hostCallTimeoutMs, definition.timeoutMs);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sendResult(this.hostResult(message, false, undefined, this.errorPayload('PLUGIN_RUNNER_TIMEOUT', 'Host API 调用超时', definition.retryable, !definition.readOnly)));
      }, timeoutMs);
      try {
        const activeExecution = this.activeExecution;
        if (!activeExecution) throw new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Host API 调用没有活动执行');
        if (message.capability !== activeExecution.capability) throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Host API capability 与当前执行不匹配');
        const output = await this.spec.hostApiHandler({
          requestId: message.requestId,
          method: message.method,
          input: message.input,
          grantRefs: message.grantRefs,
          timeoutMs,
          tenantId: message.tenantId,
          executionId: message.executionId,
          executionStepId: message.executionStepId,
          pluginVersionId: message.pluginVersionId,
          pluginId: this.spec.pluginId,
          pluginVersion: this.spec.pluginVersion,
          capability: message.capability,
          idempotencyKey: message.idempotencyKey,
          deadlineAt: message.deadlineAt,
          workflowVersionId: activeExecution.workflowVersionId,
          planDigest: activeExecution.planDigest,
          hostPermissions: this.spec.hostPermissions ?? [],
        });
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const validatedOutput = validateHostApiResult(message.method, output);
        if (Buffer.byteLength(JSON.stringify(validatedOutput), 'utf8') > definition.maxOutputBytes) throw new AppError('PLUGIN_CONTRACT_INVALID', 'Host API 输出超过限制');
        sendResult(this.hostResult(message, true, validatedOutput));
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sendResult(this.hostResult(message, false, undefined, this.errorPayload(error instanceof AppError ? error.errorCode : 'PLUGIN_HOST_CALL_DENIED', String(redactSensitive(error instanceof Error ? error.message : error)), definition.retryable, !definition.readOnly)));
      }
    } catch (error) {
      sendResult(this.hostResult(message, false, undefined, this.errorPayload(error instanceof AppError ? error.errorCode : 'PLUGIN_HOST_CALL_DENIED', String(redactSensitive(error instanceof Error ? error.message : error)), definition.retryable, !definition.readOnly)));
    }
  }

  private hostResult(message: PluginRunnerHostCall, ok: boolean, output?: Record<string, unknown>, error?: PluginRunnerError): PluginRunnerHostResult {
    return { protocolVersion: 'gcac.plugin-runner/v1', messageType: 'host_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: message.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, capability: message.capability, ok, ...(output ? { output } : {}), ...(error ? { error } : {}) };
  }

  private errorPayload(code: string, message: string, retryable: boolean, mayBeUnknown: boolean): PluginRunnerError {
    return { code, message: message.slice(0, 512), retryable, mayBeUnknown, secretRedacted: true };
  }

  private assertHandshake(message: PluginRunnerInboundMessage): void {
    if (message.messageType !== 'hello_result' || !message.accepted || message.pluginId !== this.spec.pluginId || message.pluginVersion !== this.spec.pluginVersion
      || message.runnerVersion !== this.spec.runnerVersion || message.sdkVersion !== this.spec.sdkVersion
      || !sameStringArray(message.capabilities, this.spec.capabilities ?? [])
      || !sameStringArray(message.permissions, this.spec.hostPermissions ?? [])
      || !matchesExpectedHash(this.spec.packageHash, message.packageHash)
      || !matchesExpectedHash(this.spec.resourceHash, message.resourceHash)
      || !matchesExpectedHash(this.spec.manifestHash, message.manifestHash)) {
      throw new AppError('PLUGIN_RUNNER_HANDSHAKE_FAILED', 'Runner hello_result 不接受固定的 PluginVersion', { pluginVersionId: this.spec.pluginVersionId });
    }
  }

  private assertExecutionContext(message: PluginRunnerHostCall | PluginRunnerProgress): boolean {
    const active = this.activeExecution;
    if (!active && this.expiredExecutionKeys.has(executionKey(message.executionId, message.executionStepId))) return false;
    if (!active || active.executionId !== message.executionId || active.executionStepId !== message.executionStepId) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner 消息不属于当前活动执行'));
      return false;
    }
    return true;
  }

  private assertReady(): void {
    if (this.stateValue === 'DRAINING') throw new AppError('PLUGIN_RUNNER_DRAINING', 'Runner 正在排空');
    if (this.stateValue !== 'READY') throw this.failure ?? new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 尚未就绪');
  }

  private assertReadyOrDraining(): void {
    if (this.stateValue !== 'READY' && this.stateValue !== 'DRAINING') throw this.failure ?? new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 尚未就绪');
  }

  private request<T extends PluginRunnerInboundMessage>(message: PluginRunnerOutboundMessage, expectedType: PluginRunnerMessageType, timeoutMs: number): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child?.stdin || this.child.stdin.destroyed) return Promise.reject(new AppError('PLUGIN_RUNNER_CRASHED', 'Runner stdin 不可用'));
    if (this.pending.has(message.requestId)) return Promise.reject(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'requestId 重复', { requestId: message.requestId }));
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        rememberBounded(this.expiredRequestIds, message.requestId, pluginRunnerLimits.maxExpiredRequestIds);
        rejectRequest(new AppError('PLUGIN_RUNNER_TIMEOUT', 'Runner 请求超时', { requestId: message.requestId, expectedType, mayBeUnknown: message.messageType === 'execute' && this.activeExecution?.writeEffect === true }));
      }, timeoutMs);
      this.pending.set(message.requestId, {
        expectedType,
        resolve: resolveRequest as (message: PluginRunnerInboundMessage) => void,
        reject: rejectRequest,
        timer,
        writeEffect: message.messageType === 'execute' && message.writeEffect,
        executionId: 'executionId' in message ? message.executionId : undefined,
        executionStepId: 'executionStepId' in message ? message.executionStepId : undefined,
        nonce: 'nonce' in message ? message.nonce : undefined,
      });
      try {
        this.child!.stdin.write(encodeJsonLine(message), 'utf8', (error?: Error | null) => {
          if (!error) return;
          const pending = this.pending.get(message.requestId);
          if (!pending) return;
          this.handleChildError(error);
        });
      } catch (error) {
        this.pending.delete(message.requestId);
        clearTimeout(timer);
        rememberBounded(this.expiredRequestIds, message.requestId, pluginRunnerLimits.maxExpiredRequestIds);
        const failure = error instanceof Error ? error : new Error(String(error));
        this.handleChildError(failure);
        rejectRequest(failure);
      }
    });
  }

  private write(message: PluginRunnerMessage): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) throw new AppError('PLUGIN_RUNNER_CRASHED', 'Runner stdin 不可用');
    this.child.stdin.write(encodeJsonLine(message));
  }

  private handleChildError(error: Error): void {
    if (this.stateValue === 'STOPPED') return;
    const errorCode = this.stateValue === 'STARTING' ? 'PLUGIN_RUNNER_START_FAILED' : 'PLUGIN_RUNNER_CRASHED';
    const message = errorCode === 'PLUGIN_RUNNER_START_FAILED' ? 'Runner 进程启动失败' : 'Runner 进程错误';
    const failure = new AppError(errorCode, message, { error: String(redactSensitive(error.message)) });
    this.failure = failure;
    this.stateValue = 'CRASHED';
    this.rejectPending(failure);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null, generation: number): void {
    if (generation !== this.connectionGeneration) return;
    if (this.resourceMonitor) { clearInterval(this.resourceMonitor); this.resourceMonitor = undefined; }
    let protocolError: Error | undefined;
    try { this.decoder.finish(); } catch (error) { protocolError = error instanceof Error ? error : new Error(String(error)); }
    if (protocolError && this.stateValue !== 'STOPPED') this.failure = protocolError;
    const intentional = this.stateValue === 'STOPPED' || !protocolError && this.stateValue === 'DRAINING' && code === 0;
    if (!intentional && !this.failure) {
      const errorCode = this.stateValue === 'STARTING' ? 'PLUGIN_RUNNER_START_FAILED' : 'PLUGIN_RUNNER_CRASHED';
      const message = errorCode === 'PLUGIN_RUNNER_START_FAILED' ? 'Runner 在握手前退出' : 'Runner 异常退出';
      this.failure = new AppError(errorCode, message, { code, signal });
    }
    if (this.failure) this.rejectPending(this.failure);
    if (this.stateValue !== 'CRASHED') this.stateValue = intentional ? 'STOPPED' : 'CRASHED';
    this.resolveExit?.();
    this.resolveExit = undefined;
    this.child = undefined;
  }

  private failProtocol(error: unknown): void {
    if (this.stateValue === 'STOPPED') return;
    const failure = error instanceof AppError ? error : new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner IPC 协议违规', { error: String(error) });
    this.failure = failure;
    this.stateValue = 'CRASHED';
    this.rejectPending(failure);
    if (this.child) void terminateProcessTree(this.child, true);
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pending) { clearTimeout(pending.timer); this.pending.delete(requestId); rememberBounded(this.expiredRequestIds, requestId, pluginRunnerLimits.maxExpiredRequestIds); pending.reject(error); }
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    if (!this.child) return Promise.resolve();
    const exitPromise = this.exitPromise ?? Promise.resolve();
    return Promise.race([exitPromise, new Promise<void>((resolveExit) => setTimeout(resolveExit, timeoutMs))]);
  }

  private checkResourceLimits(generation: number): void {
    if (generation !== this.connectionGeneration || !this.child?.pid) return;
    const usage = readProcessTreeUsage(this.child.pid);
    if (!usage) return;
    if (usage.rssBytes > pluginRunnerLimits.maxResidentMemoryBytes || usage.cpuTimeMs > pluginRunnerLimits.maxCpuTimeMs) {
      this.failProtocol(new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', 'Runner 进程树超过资源限制', {
        maxResidentMemoryBytes: pluginRunnerLimits.maxResidentMemoryBytes,
        maxCpuTimeMs: pluginRunnerLimits.maxCpuTimeMs,
      }));
    }
  }
}

export async function terminateProcessTree(child: ChildProcessWithoutNullStreams, force: boolean): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolveExit) => {
      const taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      taskkill.once('exit', () => resolveExit());
      taskkill.once('error', () => resolveExit());
    });
    return;
  }
  try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* 进程已经退出 */ } }
}

function cleanEnvironment(environment: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 环境变量名无效');
    if (forbiddenRunnerEnvironmentKeys.has(key.toUpperCase())) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 环境变量包含受禁止的加载或执行控制项', { key });
    if (typeof value !== 'string' || value.length > 4096) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 环境变量值无效或过长', { key });
    output[key] = value;
  }
  return output;
}

const forbiddenRunnerEnvironmentKeys = new Set([
  'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'COMSPEC', 'PATHEXT', 'PSMODULEPATH', 'BASH_ENV', 'ENV', 'RUBYOPT', 'PYTHONPATH', 'PERL5OPT',
]);

function matchesExpectedHash(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined ? true : actual === expected;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function executionKey(executionId: string, executionStepId: string): string {
  return `${executionId}\u0000${executionStepId}`;
}

function rememberBounded(set: Set<string>, value: string, maximum: number): void {
  set.add(value);
  while (set.size > maximum) {
    const oldest = set.values().next().value as string | undefined;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}

function immutableLaunchSpec(spec: PluginRunnerLaunchSpec): PluginRunnerLaunchSpec {
  return Object.freeze({
    ...spec,
    args: Object.freeze([...spec.args]),
    environment: Object.freeze({ ...(spec.environment ?? {}) }),
    hostPermissions: Object.freeze([...(spec.hostPermissions ?? [])]),
    capabilities: Object.freeze([...(spec.capabilities ?? [])]),
  });
}

function validateLaunchLimits(spec: PluginRunnerLaunchSpec): void {
  const limits: Array<[string, number | undefined, number]> = [
    ['maxStdoutBytes', spec.maxStdoutBytes, pluginRunnerLimits.maxStdoutBytes],
    ['maxStderrBytes', spec.maxStderrBytes, pluginRunnerLimits.maxStderrBytes],
    ['startupTimeoutMs', spec.startupTimeoutMs, pluginRunnerLimits.startupTimeoutMs],
    ['helloTimeoutMs', spec.helloTimeoutMs, pluginRunnerLimits.helloTimeoutMs],
    ['executeTimeoutMs', spec.executeTimeoutMs, pluginRunnerLimits.executeTimeoutMs],
    ['hostCallTimeoutMs', spec.hostCallTimeoutMs, pluginRunnerLimits.hostCallTimeoutMs],
    ['shutdownGraceMs', spec.shutdownGraceMs, pluginRunnerLimits.shutdownGraceMs],
  ];
  for (const [name, value, maximum] of limits) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > maximum)) {
      throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner ${name} 超出固定资源或时间上限`, { name, maximum });
    }
  }
  if (!spec.capabilities || spec.capabilities.length === 0 || spec.capabilities.length > 200 || new Set(spec.capabilities).size !== spec.capabilities.length) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 必须绑定非空且唯一的 PluginVersion Capability');
  }
  for (const [name, value] of [['packageHash', spec.packageHash], ['resourceHash', spec.resourceHash], ['manifestHash', spec.manifestHash] ] as const) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner ${name} 不是有效 SHA-256 摘要`, { name });
    }
  }
}

interface ProcessTreeUsage {
  rssBytes: number;
  cpuTimeMs: number;
}

function readProcessTreeUsage(rootPid: number): ProcessTreeUsage | undefined {
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return undefined;
  }
  const processes = new Map<number, { parentPid: number; rssBytes: number; cpuTimeMs: number }>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closingName = stat.lastIndexOf(')');
      const fields = stat.slice(closingName + 2).split(' ');
      const parentPid = Number(fields[1]);
      const cpuTicks = Number(fields[11]) + Number(fields[12]);
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const rssKb = Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0);
      if (Number.isFinite(parentPid) && Number.isFinite(cpuTicks)) processes.set(pid, { parentPid, rssBytes: rssKb * 1024, cpuTimeMs: cpuTicks * 10 });
    } catch { /* 进程可能在读取期间退出 */ }
  }
  if (!processes.has(rootPid)) return undefined;
  const children = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, item] of processes) if (children.has(item.parentPid) && !children.has(pid)) { children.add(pid); changed = true; }
  }
  return [...children].reduce((total, pid) => {
    const item = processes.get(pid);
    return item ? { rssBytes: total.rssBytes + item.rssBytes, cpuTimeMs: total.cpuTimeMs + item.cpuTimeMs } : total;
  }, { rssBytes: 0, cpuTimeMs: 0 });
}

function assertDeadline(deadlineAt: string): void {
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new AppError('PLUGIN_RUNNER_TIMEOUT', '插件执行截止时间已到期');
}

function requiredExecutionBinding(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `Runner 执行缺少固定 ${name}`);
  }
  return value;
}

function requiredPlanDigest(value: string | undefined): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 执行缺少固定 planDigest');
  }
  return value;
}

function validateGrantRefs(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((ref) => !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Grant 引用格式无效');
  }
  if (new Set(value).size !== value.length) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Grant 引用不允许重复');
  return [...value];
}

function assertGrantRefsSubset(requested: readonly string[], allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (requested.some((ref) => !allowedSet.has(ref))) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 使用了未绑定的 Grant 引用');
}

function normalizeWriteResult(result: PluginRunnerExecuteResult): PluginRunnerExecuteResult {
  if (result.success && result.status === 'SUCCESS') return result;
  return {
    ...result,
    success: false,
    status: 'UNKNOWN',
    normalizedObjects: [],
    error: {
      code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      message: '写操作结果需要通过恢复流程确认',
      retryable: false,
      mayBeUnknown: true,
      secretRedacted: true,
    },
  };
}

function unknownResult(message: PluginRunnerExecute, error: unknown): PluginRunnerExecuteResult {
  const cause = error instanceof AppError ? error.errorCode : 'PLUGIN_RUNNER_CRASHED';
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
    status: 'UNKNOWN',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: {
      code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      message: '写操作未能确认外部结果，必须进入恢复流程',
      retryable: false,
      mayBeUnknown: true,
      details: { cause },
      secretRedacted: true,
    },
  };
}
