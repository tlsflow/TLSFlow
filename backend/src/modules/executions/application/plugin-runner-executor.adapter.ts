import { AppError } from '../../../common/errors/app-error.js';
import {
  PluginRunnerSupervisor,
  type PluginRunnerClient,
  type PluginRunnerExecutionInput,
  type PluginRunnerHostApiHandler,
  type PluginRunnerLaunchSpec,
} from '../../plugins/runner/index.js';
import { resolveProductionPluginRunnerConfig, type ProductionPluginRunnerConfig } from '../../plugins/runner/production-runner-config.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './executors.js';

export interface PluginRunnerExecutionDependencies {
  /** 生产只能注入 Supervisor；测试可以注入同样形状的 Fixture。 */
  supervisor?: Pick<PluginRunnerSupervisor, 'start'>;
  runner?: ProductionPluginRunnerConfig;
  hostApiHandler?: PluginRunnerHostApiHandler;
  deadlineMs?: number;
}

interface RunnerBinding {
  tenantId: string;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  capability: string;
  grantRefs: string[];
  planDigest: string;
  writeEffect: boolean;
  input: Record<string, unknown>;
  auditBinding: Record<string, unknown>;
}

/**
 * executions 到 Plugin Runner 的唯一插件执行适配器。
 *
 * 这里不加载插件资源，也不调用插件对象；宿主只把已经固定的执行快照封装成
 * IPC 请求。Runner 进程异常时统一返回 UNKNOWN，让 executions 主链持久化不确定性。
 */
export class PluginRunnerExecutorAdapter implements Executor {
  constructor(
    readonly type: string,
    private readonly dependencies: PluginRunnerExecutionDependencies = {},
  ) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    let binding: RunnerBinding;
    try {
      binding = await resolveRunnerBinding(input);
    } catch (error) {
      return validationFailure(error);
    }

    const runner = this.dependencies.runner;
    const supervisor = this.dependencies.supervisor;
    if (!runner || !supervisor) {
      return {
        success: false,
        errorCode: 'PLUGIN_RUNNER_START_FAILED',
        errorMessage: '生产 Plugin Runner 未完成 executions 装配，已失败关闭',
        detail: { executionStatus: 'UNKNOWN', runnerRequired: true, auditBinding: binding.auditBinding },
      };
    }

    const spec = buildLaunchSpec(runner, binding, this.dependencies.hostApiHandler);
    const request: PluginRunnerExecutionInput = {
      tenantId: binding.tenantId,
      executionId: input.step.executionRunId,
      executionStepId: input.step.id,
      capability: binding.capability,
      input: binding.input,
      grantRefs: binding.grantRefs,
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      deadlineAt: deadlineAt(input, this.dependencies.deadlineMs),
      writeEffect: binding.writeEffect,
    };

    try {
      const client = await supervisor.start(spec);
      const result = await client.execute(request);
      return toStepResult(result, binding);
    } catch (error) {
      return unknownFailure(error, binding);
    }
  }
}

/** 创建默认生产 adapter；非 production 环境没有配置时保持失败关闭。 */
export function createDefaultPluginRunnerExecutionDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): PluginRunnerExecutionDependencies {
  const runner = resolveProductionPluginRunnerConfig(environment);
  return runner
    ? { runner, supervisor: new PluginRunnerSupervisor({ maxRestarts: 0 }) }
    : {};
}

export function createPluginRunnerExecutors(
  dependencies: PluginRunnerExecutionDependencies = {},
): Executor[] {
  return ['AGENT', 'WORKFLOW', 'TRUSTED_JS']
    .map((type) => new PluginRunnerExecutorAdapter(type, dependencies));
}

async function resolveRunnerBinding(input: StepExecutionInput): Promise<RunnerBinding> {
  const snapshot = input.step.inputSnapshot;
  const runnerRequest = readRecord(snapshot.runnerRequest);
  const runtime = readRecord(snapshot.pluginRuntimeCapability);
  const workflow = readRecord(snapshot.workflowRequest);
  const trustedJs = readRecord(snapshot.trustedJsRequest);
  const plan = readRecord(snapshot.plan);
  const token = readRecord(snapshot.token);
  const authorization = readRecord(snapshot.executionAuthorization) ?? {};
  const tenantId = requiredString(input.step.tenantId ?? snapshot.tenantId, 'tenantId');
  const pluginVersionId = fixedString('pluginVersionId',
    firstString(runnerRequest.pluginVersionId, runtime.pluginVersionId, workflow.pluginVersionId, trustedJs.pluginVersionId, snapshot.pluginVersionId),
    runnerRequest.pluginVersionId, runtime.pluginVersionId, workflow.pluginVersionId, trustedJs.pluginVersionId, snapshot.pluginVersionId,
  );
  const pluginId = fixedString('pluginId',
    firstString(runnerRequest.pluginId, runtime.pluginId, workflow.pluginId, trustedJs.pluginId, snapshot.pluginId),
    runnerRequest.pluginId, runtime.pluginId, workflow.pluginId, trustedJs.pluginId, snapshot.pluginId,
  );
  const pluginVersion = fixedString('pluginVersion',
    firstString(runnerRequest.pluginVersion, runtime.pluginVersion, workflow.pluginVersion, trustedJs.pluginVersion, snapshot.pluginVersion),
    runnerRequest.pluginVersion, runtime.pluginVersion, workflow.pluginVersion, trustedJs.pluginVersion, snapshot.pluginVersion,
  );
  const packageHash = fixedHash('packageHash', firstString(
    runnerRequest.packageHash,
    runnerRequest.packageSha256,
    runtime.packageHash,
    runtime.packageSha256,
    workflow.packageHash,
    workflow.packageSha256,
    trustedJs.packageHash,
    trustedJs.packageSha256,
    snapshot.packageHash,
    snapshot.packageSha256,
  ),
  runnerRequest.packageHash,
  runnerRequest.packageSha256,
  runtime.packageHash,
  runtime.packageSha256,
  workflow.packageHash,
  workflow.packageSha256,
  trustedJs.packageHash,
  trustedJs.packageSha256,
  snapshot.packageHash,
  snapshot.packageSha256,
  );
  const manifestHash = fixedHash('manifestHash', firstString(
    runnerRequest.manifestHash,
    runnerRequest.manifestSha256,
    runtime.manifestHash,
    runtime.manifestSha256,
    workflow.manifestHash,
    workflow.manifestSha256,
    trustedJs.manifestHash,
    trustedJs.manifestSha256,
    snapshot.manifestHash,
    snapshot.manifestSha256,
  ),
  runnerRequest.manifestHash,
  runnerRequest.manifestSha256,
  runtime.manifestHash,
  runtime.manifestSha256,
  workflow.manifestHash,
  workflow.manifestSha256,
  trustedJs.manifestHash,
  trustedJs.manifestSha256,
  snapshot.manifestHash,
  snapshot.manifestSha256,
  );
  const resourceHash = fixedHash('resourceHash', firstString(
    runnerRequest.resourceHash,
    runnerRequest.resourceSha256,
    runtime.resourceHash,
    workflow.resourceHash,
    trustedJs.resourceHash,
    snapshot.resourceHash,
  ),
  runnerRequest.resourceHash,
  runnerRequest.resourceSha256,
  runtime.resourceHash,
  workflow.resourceHash,
  trustedJs.resourceHash,
  snapshot.resourceHash,
  );
  const capability = fixedString('capability',
    firstString(
      runnerRequest.capability,
      runtime.capabilityKey,
      runtime.capability,
      workflow.capabilityKey,
      trustedJs.capability,
      plan.capability,
      snapshot.capability,
      actionCapability(snapshot.actionType),
    ),
    runnerRequest.capability,
    runtime.capabilityKey,
    runtime.capability,
    workflow.capabilityKey,
    trustedJs.capability,
    plan.capability,
    snapshot.capability,
    actionCapability(snapshot.actionType),
  );
  const grantRefs = readStringArray(
    runnerRequest.grantRefs,
    snapshot.grantRefs,
    snapshot.executionGrantRefs,
    plan.grantRefs,
  );
  const declaredPlanDigest = fixedOptionalString('planDigest',
    runnerRequest.planDigest,
    snapshot.planDigest,
    runtime.planDigest,
    workflow.planDigest,
    trustedJs.planDigest,
    plan.planDigest,
    token.planDigest,
  );
  const planDigest = requiredHash('planDigest', declaredPlanDigest, /^[a-f0-9]{64}$/);
  const writeEffect = !input.dryRun && (
    snapshot.writeEffect === true
    || plan.writeEffect === true
    || snapshot.actionType === 'agent.plan.execute'
    || capability.endsWith('.deploy')
    || capability.endsWith('.rollback')
    || input.step.stepType === 'INSTALL'
    || input.step.stepType === 'ROLLBACK'
  );
  const auditBinding = {
    tenantId,
    executionRunId: input.step.executionRunId,
    executionStepId: input.step.id,
    deploymentPlanTargetId: input.step.deploymentPlanTargetId,
    pluginVersionId,
    pluginId,
    pluginVersion,
    packageHash,
    manifestHash,
    resourceHash,
    capability,
    grantRefs: [...grantRefs],
    planDigest,
    authorization: structuredClone(authorization),
  } satisfies Record<string, unknown>;
  const inputPayload = {
    ...structuredClone(snapshot),
    apiVersion: 'gcac.execution-plugin-runner-input/v1',
    pluginVersionId,
    packageHash,
    manifestHash,
    resourceHash,
    tenantId,
    capability,
    planDigest,
    auditBinding,
    runType: input.runType,
    dryRun: input.dryRun,
    stepType: input.step.stepType,
    snapshot: structuredClone(snapshot),
  } satisfies Record<string, unknown>;
  return {
    tenantId,
    pluginVersionId,
    pluginId,
    pluginVersion,
    packageHash,
    manifestHash,
    resourceHash,
    capability,
    grantRefs,
    planDigest,
    writeEffect,
    input: inputPayload,
    auditBinding,
  };
}

function buildLaunchSpec(
  runner: ProductionPluginRunnerConfig,
  binding: RunnerBinding,
  hostApiHandler: PluginRunnerHostApiHandler | undefined,
): PluginRunnerLaunchSpec {
  const snapshot = binding.input.snapshot as Record<string, unknown>;
  const capabilities = readStringArray(snapshot.capabilities, readRecord(snapshot.pluginRuntimeCapability)?.capabilities);
  const hostPermissions = readStringArray(snapshot.approvedPermissions, snapshot.hostPermissions, snapshot.permissions);
  return {
    pluginVersionId: binding.pluginVersionId,
    pluginId: binding.pluginId,
    pluginVersion: binding.pluginVersion,
    tenantId: binding.tenantId,
    executablePath: runner.executablePath,
    args: runner.args,
    workingDirectory: runner.workingDirectory,
    runnerVersion: runner.runnerVersion,
    sdkVersion: runner.sdkVersion,
    capabilities: capabilities.length > 0 ? capabilities : [binding.capability],
    hostPermissions,
    packageHash: binding.packageHash,
    resourceHash: binding.resourceHash,
    manifestHash: binding.manifestHash,
    ...(hostApiHandler ? { hostApiHandler } : {}),
  };
}

function toStepResult(
  result: Awaited<ReturnType<PluginRunnerClient['execute']>>,
  binding: RunnerBinding,
): StepExecutionResult {
  const detail = {
    executionMode: 'plugin_runner',
    executionStatus: result.status,
    pluginVersionId: binding.pluginVersionId,
    pluginId: binding.pluginId,
    pluginVersion: binding.pluginVersion,
    packageHash: binding.packageHash,
    manifestHash: binding.manifestHash,
    resourceHash: binding.resourceHash,
    capability: binding.capability,
    grantRefs: [...binding.grantRefs],
    planDigest: binding.planDigest,
    auditBinding: binding.auditBinding,
    summary: result.summary,
    normalizedObjects: result.normalizedObjects,
    warnings: result.warnings,
    ...(result.error ? { error: result.error } : {}),
  } satisfies Record<string, unknown>;
  if (result.status === 'SUCCESS' && result.success) return { success: true, detail };
  if (result.status === 'UNKNOWN' || result.status === 'CANCELLED' || result.error?.mayBeUnknown === true) {
    return {
      success: false,
      errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      errorMessage: 'Plugin Runner 返回结果不明，必须进入恢复流程',
      detail: { ...detail, executionStatus: 'UNKNOWN', mayBeUnknown: true },
    };
  }
  return {
    success: false,
    errorCode: result.error?.code ?? 'PLUGIN_CAPABILITY_EXECUTION_FAILED',
    errorMessage: result.error?.message ?? 'Plugin Runner 执行失败',
    detail,
  };
}

function unknownFailure(error: unknown, binding: RunnerBinding): StepExecutionResult {
  return {
    success: false,
    errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
    errorMessage: 'Plugin Runner 崩溃、超时、迟到或取消导致执行结果不明，必须进入恢复流程',
    detail: {
      executionMode: 'plugin_runner',
      executionStatus: 'UNKNOWN',
      mayBeUnknown: true,
      pluginVersionId: binding.pluginVersionId,
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
      packageHash: binding.packageHash,
      manifestHash: binding.manifestHash,
      resourceHash: binding.resourceHash,
      capability: binding.capability,
      planDigest: binding.planDigest,
      auditBinding: binding.auditBinding,
      cause: error instanceof AppError ? error.errorCode : 'PLUGIN_RUNNER_FAILED',
    },
  };
}

function validationFailure(error: unknown): StepExecutionResult {
  const appError = error instanceof AppError ? error : undefined;
  return {
    success: false,
    errorCode: appError?.errorCode ?? 'VALIDATION_FAILED',
    errorMessage: appError?.message ?? (error instanceof Error ? error.message : String(error)),
    detail: appError?.details && typeof appError.details === 'object' ? appError.details as Record<string, unknown> : undefined,
  };
}

function deadlineAt(input: StepExecutionInput, configuredDeadlineMs = 120_000): string {
  const configured = Number.isInteger(configuredDeadlineMs) && configuredDeadlineMs > 0 ? configuredDeadlineMs : 120_000;
  const snapshotDeadline = firstString(input.step.inputSnapshot.deadlineAt, input.step.inputSnapshot.executionDeadlineAt);
  return snapshotDeadline ?? new Date(Date.now() + configured).toISOString();
}

function actionCapability(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.startsWith('agent.') ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(...values: unknown[]): string[] {
  const candidate = values.find((value) => Array.isArray(value));
  if (!Array.isArray(candidate)) return [];
  const result = candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  if (new Set(result).size !== result.length) throw new AppError('VALIDATION_FAILED', 'Runner 绑定数组不允许重复值');
  return result;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function requiredString(value: unknown, name: string): string {
  const result = firstString(value);
  if (!result) throw new AppError('VALIDATION_FAILED', `Runner 执行缺少固定 ${name}`);
  return result;
}

function fixedString(name: string, preferred: string | undefined, ...values: unknown[]): string {
  const declared = values
    .map((value) => firstString(value))
    .filter((value): value is string => Boolean(value));
  const distinct = [...new Set(declared)];
  if (distinct.length > 1) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `Runner ${name} 绑定来源不一致`);
  return requiredString(preferred, name);
}

function fixedOptionalString(name: string, ...values: unknown[]): string | undefined {
  const declared = values
    .map((value) => firstString(value))
    .filter((value): value is string => Boolean(value));
  const distinct = [...new Set(declared)];
  if (distinct.length > 1) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `Runner ${name} 绑定来源不一致`);
  return distinct[0];
}

function fixedHash(name: string, preferred: string | undefined, ...values: unknown[]): string {
  const value = requiredString(preferred, name);
  const declared = values
    .map((item) => firstString(item))
    .filter((item): item is string => Boolean(item));
  const distinct = [...new Set(declared)];
  if (distinct.length > 1) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `Runner ${name} 绑定来源不一致`);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须是 sha256 摘要`);
  return value;
}

function requiredHash(name: string, value: string | undefined, pattern: RegExp): string {
  const result = requiredString(value, name);
  if (!pattern.test(result)) throw new AppError('VALIDATION_FAILED', `Runner ${name} 格式无效`);
  return result;
}
