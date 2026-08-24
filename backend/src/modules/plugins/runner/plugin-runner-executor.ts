import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  PluginActionMessageBinding,
  PluginExecutionStatus,
  PluginRunnerError,
  PluginRunnerExecute,
  PluginRunnerWarning,
} from './protocol/protocol.types.js';

/** Runner 进程侧只声明自己可以执行的原子 Action。 */
export interface PluginRunnerActionDescriptor {
  actionId: string;
  capability: string;
  actionContractVersion: string;
  inputSchemaSha256: string;
  outputSchemaSha256: string;
  resourceHash: string;
}

/**
 * 固定 PluginVersion 的 Runner 描述。actions 是运行期白名单，禁止把 Capability
 * 当成整份 Workflow 的可执行许可。
 */
export interface PluginRunnerExecutorDescriptor {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capabilities: readonly string[];
  actions: readonly PluginRunnerActionDescriptor[];
  permissions: readonly string[];
  packageHash: string;
  resourceHash: string;
  manifestHash: string;
}

export interface PluginRunnerExecutorContext extends PluginActionMessageBinding {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  input: Record<string, unknown>;
  grantRefs: readonly string[];
  idempotencyKey: string;
  deadlineAt: string;
  /** 执行被宿主取消时触发；执行器应在外部写入边界检查该信号。 */
  signal: AbortSignal;
}

export interface PluginRunnerExecutorHostApi {
  call(method: string, input: Record<string, unknown>, grantRefs: readonly string[], timeoutMs?: number): Promise<Record<string, unknown>>;
}

export interface PluginRunnerExecutorResult {
  success: boolean;
  status: PluginExecutionStatus;
  output: Record<string, unknown>;
  externalReceipt?: Record<string, unknown>;
  warnings?: PluginRunnerWarning[];
  error?: PluginRunnerError;
}

export interface PluginRunnerExecutor {
  readonly descriptor: PluginRunnerExecutorDescriptor;
  execute(context: PluginRunnerExecutorContext, hostApi: PluginRunnerExecutorHostApi): Promise<PluginRunnerExecutorResult>;
}

export type PluginRunnerExecutorFactory = () => PluginRunnerExecutor | Promise<PluginRunnerExecutor>;

/** 仅允许 Runner 子进程加载固定启动参数指定的执行器模块。 */
export async function loadPluginRunnerExecutor(modulePath: string): Promise<PluginRunnerExecutor> {
  if (!isAbsolute(modulePath)) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器模块路径必须是绝对路径');
  let loaded: Record<string, unknown>;
  try {
    loaded = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
  } catch (error) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 真实 PluginVersion 执行器加载失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const candidate = loaded.createPluginRunnerExecutor;
  if (typeof candidate !== 'function') throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器模块没有导出固定执行器工厂');
  const executor = await (candidate as PluginRunnerExecutorFactory)();
  validateExecutor(executor);
  return executor;
}

export function requireDeclaredAction(descriptor: PluginRunnerExecutorDescriptor, message: Pick<PluginRunnerExecute, keyof PluginActionMessageBinding>): PluginRunnerActionDescriptor {
  const action = descriptor.actions.find((item) => item.actionId === message.actionId);
  if (!action
    || action.capability !== message.capability
    || action.actionContractVersion !== message.actionContractVersion
    || action.inputSchemaSha256 !== message.inputSchemaSha256
    || action.outputSchemaSha256 !== message.outputSchemaSha256
    || action.resourceHash !== message.resourceHash) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'Runner Action 与固定 PluginVersion Action Contract 不一致', {
      pluginVersionId: descriptor.pluginVersionId,
      actionId: message.actionId,
      capability: message.capability,
    });
  }
  return action;
}

function validateExecutor(value: PluginRunnerExecutor): void {
  if (!value || typeof value !== 'object' || !value.descriptor || typeof value.execute !== 'function') {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器必须提供固定描述和 execute 实现');
  }
  const descriptor = value.descriptor;
  for (const [name, item] of [
    ['pluginVersionId', descriptor.pluginVersionId], ['pluginId', descriptor.pluginId], ['pluginVersion', descriptor.pluginVersion],
    ['packageHash', descriptor.packageHash], ['resourceHash', descriptor.resourceHash], ['manifestHash', descriptor.manifestHash],
  ] as const) {
    if (typeof item !== 'string' || item.trim() === '') throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器缺少固定 ${name}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.packageHash)
    || !/^sha256:[a-f0-9]{64}$/.test(descriptor.resourceHash)
    || !/^sha256:[a-f0-9]{64}$/.test(descriptor.manifestHash)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器的 PluginVersion 摘要无效');
  }
  validateStringList(descriptor.capabilities, 'capabilities', true);
  validateStringList(descriptor.permissions, 'permissions', false);
  if (!Array.isArray(descriptor.actions) || descriptor.actions.length === 0 || descriptor.actions.length > 200) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 执行器必须声明非空 Action Contract 列表');
  }
  const actionIds = new Set<string>();
  for (const action of descriptor.actions) {
    if (!action || typeof action !== 'object'
      || !isIdentifier(action.actionId) || !isIdentifier(action.capability) || !isIdentifier(action.actionContractVersion)
      || !isHash(action.inputSchemaSha256) || !isHash(action.outputSchemaSha256) || !isHash(action.resourceHash)
      || !descriptor.capabilities.includes(action.capability) || actionIds.has(action.actionId)) {
      throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner Action Contract 描述无效或重复');
    }
    actionIds.add(action.actionId);
  }
}

function validateStringList(value: readonly string[], name: string, required: boolean): void {
  if (!Array.isArray(value) || (!required && value.length > 200) || (required && (value.length === 0 || value.length > 200))) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 列表无效`);
  }
  if (value.some((item) => !isIdentifier(item))) throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 包含无效值`);
  if (new Set(value).size !== value.length) throw new AppError('PLUGIN_RUNNER_START_FAILED', `Runner 执行器 ${name} 不允许重复值`);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

/**
 * 状态由执行器的外部操作事实决定。写操作失败不自动升级 UNKNOWN；只有明确
 * mayBeUnknown 或取消/断连等真实不确定性才允许进入 UNKNOWN。
 */
export function executorResultForMessage(message: PluginRunnerExecute, result: PluginRunnerExecutorResult): PluginRunnerExecutorResult {
  const normalized = {
    ...result,
    output: result.output ?? {},
    warnings: result.warnings ?? [],
    ...(result.externalReceipt ? { externalReceipt: result.externalReceipt } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
  const uncertain = normalized.status === 'UNKNOWN' || normalized.error?.mayBeUnknown === true;
  if (normalized.success !== (normalized.status === 'SUCCESS')
    || uncertain && (!message.writeEffect || normalized.error?.mayBeUnknown !== true)) {
    return {
      success: false,
      status: 'FAILED',
      output: {},
      warnings: normalized.warnings,
      error: {
        code: 'PLUGIN_CONTRACT_INVALID',
        message: 'Runner Action 返回了不允许的执行状态',
        retryable: false,
        mayBeUnknown: false,
        secretRedacted: true,
      },
    };
  }
  return normalized;
}
