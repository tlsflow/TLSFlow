import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  PluginCheckpointRef,
  PluginExecutionStatus,
  PluginRunnerError,
  PluginRunnerExecute,
  PluginRunnerWarning,
} from './protocol/protocol.types.js';

/**
 * Runner 进程侧的固定执行器描述。
 * 描述必须由真实 PluginVersion 执行器提供，不能由宿主的 hello 请求临时拼接。
 */
export interface PluginRunnerExecutorDescriptor {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capabilities: readonly string[];
  permissions: readonly string[];
  packageHash: string;
  resourceHash: string;
  manifestHash: string;
}

export interface PluginRunnerExecutorContext {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  capability: string;
  input: Record<string, unknown>;
  grantRefs: readonly string[];
  idempotencyKey: string;
  deadlineAt: string;
  writeEffect: boolean;
  /** 执行被宿主取消时触发；执行器应在安全边界检查该信号。 */
  signal: AbortSignal;
  checkpoint?: PluginCheckpointRef;
}

export interface PluginRunnerExecutorHostApi {
  call(
    method: string,
    input: Record<string, unknown>,
    grantRefs: readonly string[],
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
}

export interface PluginRunnerExecutorResult {
  success: boolean;
  status: PluginExecutionStatus;
  summary: Record<string, unknown>;
  normalizedObjects: Record<string, unknown>[];
  warnings: PluginRunnerWarning[];
  checkpoint?: PluginCheckpointRef;
  error?: PluginRunnerError;
}

export interface PluginRunnerExecutor {
  readonly descriptor: PluginRunnerExecutorDescriptor;
  execute(context: PluginRunnerExecutorContext, hostApi: PluginRunnerExecutorHostApi): Promise<PluginRunnerExecutorResult>;
}

export type PluginRunnerExecutorFactory = () => PluginRunnerExecutor | Promise<PluginRunnerExecutor>;

/** 仅允许 Runner 子进程加载固定启动参数指定的执行器模块。 */
export async function loadPluginRunnerExecutor(modulePath: string): Promise<PluginRunnerExecutor> {
  if (!isAbsolute(modulePath)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器模块路径必须是绝对路径');
  }
  let loaded: Record<string, unknown>;
  try {
    loaded = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
  } catch (error) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 真实 PluginVersion 执行器加载失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // 生产 Runner 只接受固定工厂导出，禁止通过旧别名或默认导出静默切换执行器。
  const candidate = loaded.createPluginRunnerExecutor;
  if (typeof candidate !== 'function') {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器模块没有导出固定执行器工厂');
  }
  const executor = await (candidate as PluginRunnerExecutorFactory)();
  validateExecutor(executor);
  return executor;
}

function validateExecutor(value: PluginRunnerExecutor): void {
  if (!value || typeof value !== 'object' || !value.descriptor || typeof value.execute !== 'function') {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器必须提供固定描述和 execute 实现');
  }
  const descriptor = value.descriptor;
  for (const [name, item] of [
    ['pluginVersionId', descriptor.pluginVersionId],
    ['pluginId', descriptor.pluginId],
    ['pluginVersion', descriptor.pluginVersion],
    ['packageHash', descriptor.packageHash],
    ['resourceHash', descriptor.resourceHash],
    ['manifestHash', descriptor.manifestHash],
  ] as const) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器缺少固定 ${name}`);
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.packageHash)
    || !/^sha256:[a-f0-9]{64}$/.test(descriptor.resourceHash)
    || !/^sha256:[a-f0-9]{64}$/.test(descriptor.manifestHash)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器的 PluginVersion 摘要无效');
  }
  validateStringList(descriptor.capabilities, 'capabilities', true);
  validateStringList(descriptor.permissions, 'permissions', false);
}

function validateStringList(value: readonly string[], name: string, required: boolean): void {
  if (!Array.isArray(value) || (!required && value.length > 200) || (required && (value.length === 0 || value.length > 200))) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 列表无效`);
  }
  if (value.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(item))) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 包含无效值`);
  }
  if (new Set(value).size !== value.length) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 不允许重复值`);
  }
}

export function executorResultForMessage(
  message: PluginRunnerExecute,
  result: PluginRunnerExecutorResult,
): PluginRunnerExecutorResult {
  return {
    ...result,
    summary: result.summary ?? {},
    normalizedObjects: result.normalizedObjects ?? [],
    warnings: result.warnings ?? [],
    ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
    ...(result.error ? { error: result.error } : {}),
    // 让调用方只能复用执行数据，身份字段仍由 runner-server 统一写入。
    success: result.success,
    status: result.status,
    ...(message.writeEffect && result.status !== 'SUCCESS'
      ? { success: false, status: 'UNKNOWN' as const }
      : {}),
  };
}
