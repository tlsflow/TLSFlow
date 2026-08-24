import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import { newId } from '../../../shared/id.js';
import {
  PluginRunnerSupervisor,
  type PluginRunnerClient,
  type PluginRunnerExecutionInput,
  type PluginRunnerHostApiHandler,
  type PluginRunnerLaunchSpec,
} from '../../plugins/runner/index.js';
import { resolvePluginRunnerConfig, type ProductionPluginRunnerConfig } from '../../plugins/runner/production-runner-config.js';
import { BuiltinPluginRegistry, type BuiltinPluginRegistryEntry } from '../../plugins/builtin-plugins/builtin-plugin-registry.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './executors.js';
import { normalizeAgentV2DryRunDetail } from './agent-v2-dry-run-result.js';
import type { ExecutionGrantService } from '../execution-grant.service.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';

export const pluginRunnerExecutorType = 'PLUGIN_RUNNER' as const;
export const pluginRunnerBindingApiVersion = 'gcac.plugin-runner-binding/v1' as const;

export interface PluginRunnerExecutionDependencies {
  /** 生产只能注入 Supervisor；测试可以注入同样形状的 Fixture。 */
  supervisor?: Pick<PluginRunnerSupervisor, 'start'>;
  runner?: ProductionPluginRunnerConfig;
  /** 生产必须从当前内置 Registry 解析 Runner 入口；测试 Fixture 可不注入。 */
  builtinRegistry?: Pick<BuiltinPluginRegistry, 'refresh' | 'get'>;
  hostApiHandler?: PluginRunnerHostApiHandler;
  /** 生产主链必须注入，用于在 Runner 启动前验证完整 Grant 绑定。 */
  executionGrants?: Pick<ExecutionGrantService, 'validate'>;
  deadlineMs?: number;
}

export interface PluginWorkflowCapabilityExecutionInput {
  tenantId: string;
  targetId?: string;
  planId?: string;
  actorId?: string;
  workflowVersionId: string;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  capability: string;
  writeEffect: boolean;
  hostPermissions: string[];
  input: Record<string, unknown>;
}

export interface PluginWorkflowCapabilityExecutionResult extends StepExecutionResult {
  executionId: string;
  executionStepId: string;
}

export interface PluginWorkflowCapabilityExecutor {
  execute(input: PluginWorkflowCapabilityExecutionInput): Promise<PluginWorkflowCapabilityExecutionResult>;
}

/**
 * 非部署计划入口（例如设备接入时的连接测试/发现）仍必须经过同一套
 * Plugin Runner 绑定和 Grant 校验，不能退回 WorkflowTemplatesApplicationService。
 */
export class PluginWorkflowCapabilityExecutorAdapter implements PluginWorkflowCapabilityExecutor {
  constructor(
    private readonly executor: Pick<Executor, 'executeStep'>,
    private readonly grants: Pick<ExecutionGrantService, 'create'>,
  ) {}

  async execute(input: PluginWorkflowCapabilityExecutionInput): Promise<PluginWorkflowCapabilityExecutionResult> {
    validateCapabilityInput(input);
    const executionId = newId('plugin-run');
    const executionStepId = newId('plugin-step');
    const planDigest = createHash('sha256').update(canonicalize({
      workflowVersionId: input.workflowVersionId,
      pluginVersionId: input.pluginVersionId,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      packageHash: input.packageHash,
      manifestHash: input.manifestHash,
      resourceHash: input.resourceHash,
      capability: input.capability,
      writeEffect: input.writeEffect,
      hostPermissions: input.hostPermissions,
      input: input.input,
    }), 'utf8').digest('hex');
    const grant = await this.grants.create({
      tenantId: input.tenantId,
      planId: input.planId,
      runId: executionId,
      stepId: executionStepId,
      targetId: input.targetId,
      workflowVersionId: input.workflowVersionId,
      pluginVersionId: input.pluginVersionId,
      pluginId: input.pluginId,
      capability: input.capability,
      planDigest,
      executorType: 'PLUGIN_RUNNER',
      allowedSecretRefs: collectReferences(input.input, 'secret://'),
      allowedArtifactRefs: collectReferences(input.input, 'artifact://'),
      allowedActions: pluginRunnerGrantActions(input.hostPermissions),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const boundInput = bindGeneratedGrant(input.input, grant.id);
    const binding = {
      apiVersion: pluginRunnerBindingApiVersion,
      tenantId: input.tenantId,
      executionRunId: executionId,
      executionStepId,
      workflowVersionId: input.workflowVersionId,
      pluginVersionId: input.pluginVersionId,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      packageHash: input.packageHash,
      manifestHash: input.manifestHash,
      resourceHash: input.resourceHash,
      capability: input.capability,
      grantRefs: [grant.id],
      planDigest,
      writeEffect: input.writeEffect,
      hostPermissions: [...input.hostPermissions],
      input: boundInput,
    } satisfies PluginRunnerExecutionBindingV1;
    const now = new Date().toISOString();
    const step: ExecutionStepEntity = {
      id: executionStepId,
      tenantId: input.tenantId,
      executionRunId: executionId,
      deploymentPlanTargetId: input.targetId,
      stepNo: 1,
      stepType: 'CUSTOM',
      name: `PLUGIN_RUNNER ${input.capability}`,
      dependsOn: [],
      idempotent: input.writeEffect !== true,
      attemptCount: 0,
      maxAttempts: 1,
      inputSnapshot: { executorType: 'PLUGIN_RUNNER', pluginRunnerBinding: binding },
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    };
    const result = await this.executor.executeStep({ step, runType: 'apply', dryRun: false });
    return { ...result, executionId, executionStepId };
  }
}

/** 中文说明：Capability 任务直到执行前才知道 Grant ID，内部占位符在此处一次性绑定。 */
function bindGeneratedGrant(input: Record<string, unknown>, grantId: string): Record<string, unknown> {
  const output = structuredClone(input);
  const credential = output.credential;
  if (credential && typeof credential === 'object' && !Array.isArray(credential)) {
    const record = credential as Record<string, unknown>;
    if (record.grantId === '__AUTO_GRANT__') record.grantId = grantId;
  }
  const security = output.security;
  if (security && typeof security === 'object' && !Array.isArray(security)) {
    const record = security as Record<string, unknown>;
    if (record.grantRef === '__AUTO_GRANT__') record.grantRef = grantId;
  }
  return output;
}

/**
 * 由控制面在创建执行步骤时写入的一次性 Runner 绑定。
 *
 * 插件 Runner 不再从 Workflow、Agent 或 Trusted JS 快照推断身份。所有绑定字段
 * 都必须在此对象中一次性固定，并与执行步骤的租户、运行和步骤身份完全一致。
 */
export interface PluginRunnerExecutionBindingV1 {
  apiVersion: typeof pluginRunnerBindingApiVersion;
  tenantId: string;
  executionRunId: string;
  executionStepId: string;
  workflowVersionId: string;
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
  hostPermissions: string[];
  input: Record<string, unknown>;
}

interface RunnerBinding extends PluginRunnerExecutionBindingV1 {
  auditBinding: Record<string, unknown>;
}

/**
 * executions 到 Plugin Runner 的唯一插件执行适配器。
 *
 * 它不加载插件资源，也不调用插件对象；宿主只把已经固定的执行绑定封装成 IPC 请求。
 * Runner 启动/握手失败发生在任何插件代码执行之前，应明确失败；只有已提交 IPC
 * 执行后断连、超时或崩溃才可能形成外部写入结果不明。
 */
export class PluginRunnerExecutorAdapter implements Executor {
  readonly type = pluginRunnerExecutorType;

  constructor(private readonly dependencies: PluginRunnerExecutionDependencies = {}) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    let binding: RunnerBinding;
    try {
      binding = resolvePluginRunnerBinding(input);
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
        detail: { executionStatus: 'FAILED', runnerRequired: true, auditBinding: binding.auditBinding },
      };
    }

    let packageEntry: BuiltinPluginRegistryEntry | undefined;
    try {
      packageEntry = await resolveBuiltinPackage(this.dependencies.builtinRegistry, binding);
    } catch (error) {
      return validationFailure(error);
    }
    let spec: PluginRunnerLaunchSpec;
    try {
      spec = buildLaunchSpec(runner, binding, this.dependencies.hostApiHandler, packageEntry);
    } catch (error) {
      return validationFailure(error);
    }
    if (this.dependencies.executionGrants) {
      try {
        await Promise.all(binding.grantRefs.map((grantId) => this.dependencies.executionGrants!.validate({
          grantId,
          tenantId: binding.tenantId,
          runId: binding.executionRunId,
          stepId: binding.executionStepId,
          workflowVersionId: binding.workflowVersionId,
          pluginVersionId: binding.pluginVersionId,
          pluginId: binding.pluginId,
          capability: binding.capability,
          planDigest: binding.planDigest,
          executorType: pluginRunnerExecutorType,
        })));
      } catch (error) {
        return {
          success: false,
          errorCode: 'PLUGIN_HOST_CALL_DENIED',
          errorMessage: 'Plugin Runner 执行 Grant 未通过完整绑定校验',
          detail: { executionStatus: 'FAILED', auditBinding: binding.auditBinding, cause: error instanceof AppError ? error.errorCode : 'GRANT_VALIDATION_FAILED' },
        };
      }
    }
    const request: PluginRunnerExecutionInput = {
      tenantId: binding.tenantId,
      executionId: binding.executionRunId,
      executionStepId: binding.executionStepId,
      workflowVersionId: binding.workflowVersionId,
      planDigest: binding.planDigest,
      capability: binding.capability,
      input: structuredClone(binding.input),
      grantRefs: [...binding.grantRefs],
      idempotencyKey: `${binding.executionRunId}:${binding.executionStepId}:${input.step.attemptCount}`,
      deadlineAt: deadlineAt(this.dependencies.deadlineMs),
      writeEffect: binding.writeEffect,
    };

    let client: PluginRunnerClient;
    try {
      client = await supervisor.start(spec);
    } catch (error) {
      return startFailure(error, binding);
    }
    try {
      const result = await client.execute(request);
      return toStepResult(result, binding);
    } catch (error) {
      return unknownFailure(error, binding);
    }
  }
}

/** 创建默认受控 Runner adapter；生产严格读取配置，开发使用固定本地 Runner，测试保持失败关闭。 */
export function createDefaultPluginRunnerExecutionDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): PluginRunnerExecutionDependencies {
  const runner = resolvePluginRunnerConfig(environment);
  return runner
    ? { runner, supervisor: new PluginRunnerSupervisor({ maxRestarts: 3 }), builtinRegistry: new BuiltinPluginRegistry() }
    : {};
}

export function createPluginRunnerExecutors(
  dependencies: PluginRunnerExecutionDependencies = {},
): Executor[] {
  return [new PluginRunnerExecutorAdapter(dependencies)];
}

export function resolvePluginRunnerBinding(input: StepExecutionInput): RunnerBinding {
  const binding = requiredRecord(input.step.inputSnapshot.pluginRunnerBinding, 'pluginRunnerBinding');
  assertKnownBindingKeys(binding);

  const resolved: PluginRunnerExecutionBindingV1 = {
    apiVersion: requiredLiteral(binding.apiVersion, 'apiVersion', pluginRunnerBindingApiVersion),
    tenantId: requiredIdentifier(binding.tenantId, 'tenantId'),
    executionRunId: requiredIdentifier(binding.executionRunId, 'executionRunId'),
    executionStepId: requiredIdentifier(binding.executionStepId, 'executionStepId'),
    workflowVersionId: requiredIdentifier(binding.workflowVersionId, 'workflowVersionId'),
    pluginVersionId: requiredIdentifier(binding.pluginVersionId, 'pluginVersionId'),
    pluginId: requiredIdentifier(binding.pluginId, 'pluginId'),
    pluginVersion: requiredIdentifier(binding.pluginVersion, 'pluginVersion'),
    packageHash: requiredHash(binding.packageHash, 'packageHash'),
    manifestHash: requiredHash(binding.manifestHash, 'manifestHash'),
    resourceHash: requiredHash(binding.resourceHash, 'resourceHash'),
    capability: requiredIdentifier(binding.capability, 'capability'),
    grantRefs: requiredIdentifierArray(binding.grantRefs, 'grantRefs', true),
    planDigest: requiredPlanDigest(binding.planDigest),
    writeEffect: requiredBoolean(binding.writeEffect, 'writeEffect'),
    hostPermissions: requiredIdentifierArray(binding.hostPermissions, 'hostPermissions', false),
    input: requiredRecord(binding.input, 'input'),
  };

  if (input.step.tenantId !== undefined && resolved.tenantId !== input.step.tenantId) {
    throw new AppError('TENANT_SCOPE_DENIED', 'Runner 绑定租户与执行步骤不一致');
  }
  if (resolved.executionRunId !== input.step.executionRunId) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 绑定 executionRunId 与执行步骤不一致');
  }
  if (resolved.executionStepId !== input.step.id) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 绑定 executionStepId 与执行步骤不一致');
  }

  return {
    ...resolved,
    grantRefs: [...resolved.grantRefs],
    hostPermissions: [...resolved.hostPermissions],
    input: structuredClone(resolved.input),
    auditBinding: {
      tenantId: resolved.tenantId,
      executionRunId: resolved.executionRunId,
      executionStepId: resolved.executionStepId,
      deploymentPlanTargetId: input.step.deploymentPlanTargetId,
      workflowVersionId: resolved.workflowVersionId,
      pluginVersionId: resolved.pluginVersionId,
      pluginId: resolved.pluginId,
      pluginVersion: resolved.pluginVersion,
      packageHash: resolved.packageHash,
      manifestHash: resolved.manifestHash,
      resourceHash: resolved.resourceHash,
      capability: resolved.capability,
      grantRefs: [...resolved.grantRefs],
      planDigest: resolved.planDigest,
      writeEffect: resolved.writeEffect,
    },
  };
}

function buildLaunchSpec(
  runner: ProductionPluginRunnerConfig,
  binding: RunnerBinding,
  hostApiHandler: PluginRunnerHostApiHandler | undefined,
  packageEntry: BuiltinPluginRegistryEntry | undefined,
): PluginRunnerLaunchSpec {
  const runtimeEntrypointPath = packageEntry?.runtimeEntrypointPath;
  const resourceHash = packageEntry?.resourceHash ?? binding.resourceHash;
  const capabilities = resolveLaunchCapabilities(packageEntry, binding);
  return {
    pluginVersionId: binding.pluginVersionId,
    pluginId: binding.pluginId,
    pluginVersion: binding.pluginVersion,
    tenantId: binding.tenantId,
    executablePath: runner.executablePath,
    args: runtimeEntrypointPath ? replaceExecutorModule(runner.args, runtimeEntrypointPath) : runner.args,
    workingDirectory: runner.workingDirectory,
    environment: {
      GCAC_PLUGIN_VERSION_ID: binding.pluginVersionId,
      GCAC_PLUGIN_ID: binding.pluginId,
      GCAC_PLUGIN_VERSION: binding.pluginVersion,
      GCAC_PLUGIN_PACKAGE_HASH: binding.packageHash,
      GCAC_PLUGIN_MANIFEST_HASH: binding.manifestHash,
      GCAC_PLUGIN_RESOURCE_HASH: resourceHash,
    },
    runnerVersion: runner.runnerVersion,
    sdkVersion: runner.sdkVersion,
    capabilities,
    hostPermissions: [...binding.hostPermissions],
    packageHash: binding.packageHash,
    resourceHash,
    manifestHash: binding.manifestHash,
    ...(hostApiHandler ? { hostApiHandler } : {}),
  };
}

/**
 * Runner 的 hello 会校验 Manifest 全量能力，而不是本次绑定的单一能力。
 * 只给一项能力会让多能力插件（例如 Citrix ADC）在握手前被拒绝。
 * 没有 Registry 的测试夹具继续按绑定能力启动，生产路径必须使用完整内置包快照。
 */
function resolveLaunchCapabilities(
  packageEntry: BuiltinPluginRegistryEntry | undefined,
  binding: RunnerBinding,
): string[] {
  const declared = packageEntry?.capabilities
    ?.map((capability) => capability.key)
    .filter((capability) => capability.trim().length > 0);
  if (!declared?.length) return [binding.capability];
  // hello 使用顺序敏感的数组比较，必须保持 Manifest 原始声明顺序。
  const capabilities = [...declared];
  if (new Set(capabilities).size !== capabilities.length) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '固定内置插件包包含重复 Capability 声明', {
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
    });
  }
  if (!capabilities.includes(binding.capability)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 执行绑定能力不在固定内置插件包中', {
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
      capability: binding.capability,
    });
  }
  return capabilities;
}

async function resolveBuiltinPackage(
  registry: Pick<BuiltinPluginRegistry, 'refresh' | 'get'> | undefined,
  binding: RunnerBinding,
): Promise<BuiltinPluginRegistryEntry | undefined> {
  if (!registry) return undefined;
  await registry.refresh();
  const entry = registry.get(binding.pluginId, binding.pluginVersion);
  if (entry.packageSha256 !== binding.packageHash
    || entry.manifestSha256 !== binding.manifestHash
    || (entry.resourceHash !== binding.resourceHash && !isLegacyResourceAggregateHash(binding.resourceHash, entry.resourceSha256))) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '执行绑定摘要与固定内置插件包不一致', {
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
      expectedPackageSha256: binding.packageHash,
      actualPackageSha256: entry.packageSha256,
      expectedManifestSha256: binding.manifestHash,
      actualManifestSha256: entry.manifestSha256,
      expectedResourceHash: binding.resourceHash,
      actualResourceHash: entry.resourceHash,
    });
  }
  return entry;
}

/**
 * 仅兼容曾由错误数组序列化生成的历史绑定。它仍必须与当前内置包的每个
 * 资源摘要精确对应，且包与 Manifest 摘要已经在调用方完成严格校验。
 */
function isLegacyResourceAggregateHash(resourceHash: string, resourceHashes: Record<string, string>): boolean {
  const entries = Object.entries(resourceHashes).sort(([left], [right]) => left.localeCompare(right));
  const legacyHash = `sha256:${createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex')}`;
  return resourceHash === legacyHash;
}

function replaceExecutorModule(args: readonly string[], runtimeEntrypointPath: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--executor-module') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--executor-module=')) continue;
    result.push(argument);
  }
  return [...result, '--executor-module', runtimeEntrypointPath];
}

function toStepResult(
  result: Awaited<ReturnType<PluginRunnerClient['execute']>>,
  binding: RunnerBinding,
): StepExecutionResult {
  const summary = result.summary;
  const operationResults = readRecordArray(summary.operationResults);
  const dryRunProjection = operationResults.length > 0
    ? normalizeAgentV2DryRunDetail({ operationResults })
    : undefined;
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
    summary,
    ...(operationResults.length > 0 ? {
      operationResults,
      dryRunChecks: dryRunProjection!.dryRunChecks,
      dryRunSummary: dryRunProjection!.dryRunSummary,
    } : {}),
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

function startFailure(error: unknown, binding: RunnerBinding): StepExecutionResult {
  const appError = error instanceof AppError ? error : undefined;
  return {
    success: false,
    errorCode: appError?.errorCode ?? 'PLUGIN_RUNNER_START_FAILED',
    errorMessage: appError?.message ?? (error instanceof Error ? error.message : String(error)),
    detail: {
      executionMode: 'plugin_runner',
      executionStatus: 'FAILED',
      startupFailure: true,
      mayBeUnknown: false,
      auditBinding: binding.auditBinding,
      cause: appError?.errorCode ?? 'PLUGIN_RUNNER_START_FAILED',
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

function deadlineAt(configuredDeadlineMs = 120_000): string {
  const configured = Number.isInteger(configuredDeadlineMs) && configuredDeadlineMs > 0 ? configuredDeadlineMs : 120_000;
  return new Date(Date.now() + configured).toISOString();
}

function validateCapabilityInput(input: PluginWorkflowCapabilityExecutionInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (name === 'input' || name === 'hostPermissions' || name === 'writeEffect') continue;
    if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_FAILED', `Plugin Runner 能力执行缺少 ${name}`);
  }
  for (const [name, value] of Object.entries({ packageHash: input.packageHash, manifestHash: input.manifestHash, resourceHash: input.resourceHash })) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `${name} 不是固定 SHA-256 摘要`);
  }
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(input.pluginVersionId)) {
    throw new AppError('VALIDATION_FAILED', 'Plugin Runner PluginVersion 标识无效');
  }
  if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
    throw new AppError('VALIDATION_FAILED', 'Plugin Runner 能力输入必须是对象');
  }
  if (!Array.isArray(input.hostPermissions) || new Set(input.hostPermissions).size !== input.hostPermissions.length) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Plugin Runner Host 权限列表无效');
  }
}

function collectReferences(value: unknown, scheme: 'secret://' | 'artifact://'): string[] {
  const output = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(new RegExp(`${scheme}[A-Za-z0-9._:/#-]{1,512}`, 'g'))) output.add(match[0]);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...output].sort();
}

function pluginRunnerGrantActions(hostPermissions: readonly string[]): string[] {
  const mapping: Record<string, string> = {
    'secret.resolve': 'secret.resolve',
    'artifact.read': 'artifact.read',
    'network.http': 'network.http',
    'execution.progress.write': 'execution.progress',
    'execution.checkpoint.write': 'execution.checkpoint',
    'execution.checkpoint.read': 'execution.checkpoint',
    'execution.cancel.read': 'execution.cancel',
    'resource.lock': 'resource.lock',
    'audit.append': 'audit.append',
    'cloud.service.get': 'cloud.service.get',
    'crypto.sign': 'crypto.sign',
  };
  return [...new Set(hostPermissions.map((permission) => mapping[permission]).filter((permission): permission is string => Boolean(permission)))];
}

function assertKnownBindingKeys(binding: Record<string, unknown>): void {
  const allowed = new Set([
    'apiVersion', 'tenantId', 'executionRunId', 'executionStepId', 'workflowVersionId',
    'pluginVersionId', 'pluginId', 'pluginVersion', 'packageHash', 'manifestHash',
    'resourceHash', 'capability', 'grantRefs', 'planDigest', 'writeEffect',
    'hostPermissions', 'input',
  ]);
  const unknown = Object.keys(binding).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new AppError('VALIDATION_FAILED', 'Runner 执行绑定包含未知字段', { unknown });
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', `Runner 执行缺少对象 ${name}`);
  }
  return value as Record<string, unknown>;
}

function requiredLiteral(value: unknown, name: string, expected: string): typeof pluginRunnerBindingApiVersion {
  if (value !== expected) throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须为 ${expected}`);
  return pluginRunnerBindingApiVersion;
}

function requiredIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须是固定标识符`);
  }
  return value;
}

function requiredHash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须是 sha256 摘要`);
  }
  return value;
}

function requiredPlanDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'Runner planDigest 格式无效');
  }
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须是布尔值`);
  return value;
}

function requiredIdentifierArray(value: unknown, name: string, requireValue: boolean): string[] {
  if (!Array.isArray(value) || (requireValue && value.length === 0) || value.length > 100) {
    throw new AppError('VALIDATION_FAILED', `Runner ${name} 必须是有界标识符数组`);
  }
  const values = value.map((item) => requiredIdentifier(item, name));
  if (new Set(values).size !== values.length) throw new AppError('VALIDATION_FAILED', `Runner ${name} 不允许重复`);
  return values;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}
