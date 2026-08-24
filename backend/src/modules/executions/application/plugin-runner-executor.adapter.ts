import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { GCAC_VERSION } from '../../../common/version.js';
import { assertJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import {
  PluginRunnerSupervisor,
  type PluginRunnerClient,
  type PluginRunnerExecutionInput,
  type PluginRunnerHostApiHandler,
  type PluginRunnerLaunchSpec,
} from '../../plugins/runner/index.js';
import type { PluginRunnerExecuteResult } from '../../plugins/runner/protocol/protocol.types.js';
import { resolvePluginRunnerConfig, type ProductionPluginRunnerConfig } from '../../plugins/runner/production-runner-config.js';
import { BuiltinPluginRegistry, type BuiltinPluginRegistryEntry } from '../../plugins/builtin-plugins/builtin-plugin-registry.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './executors.js';
import type { ExecutionGrantService } from '../execution-grant.service.js';
import { evaluatePluginCompatibility } from '../../plugins/capabilities/plugin-compatibility.evaluator.js';

export const pluginActionBindingApiVersion = 'gcac.plugin-action-binding/v1' as const;
export const pluginRunnerExecutorType = 'plugin.action' as const;
const dslCertificateCapabilities = new Set(['certificate.deploy', 'certificate.rollback']);

/**
 * 这是 DeploymentPlan/Execution 冻结的步骤级绑定，不是另一份 Workflow。
 * Schema 本体和摘要一同冻结，因此 Runner 返回值能在回到 DSL 之前被宿主验证。
 */
export interface PluginActionBindingV1 {
  apiVersion: typeof pluginActionBindingApiVersion;
  tenantId: string;
  workflowVersionId: string;
  workflowStepName: string;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capability: string;
  actionId: string;
  actionContractVersion: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  inputSchemaSha256: string;
  outputSchemaSha256: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  planDigest: string;
  writeEffect: boolean;
  hostPermissions: string[];
}

export interface PluginActionExecutionInput {
  binding: PluginActionBindingV1;
  executionId: string;
  executionStepId: string;
  input: Record<string, unknown>;
  grantRefs: string[];
  idempotencyKey: string;
  deadlineAt: string;
}

export interface PluginActionExecutionResult {
  success: boolean;
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  output: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  detail: Record<string, unknown>;
}

export interface PluginRunnerExecutionDependencies {
  supervisor?: Pick<PluginRunnerSupervisor, 'start'>;
  runner?: ProductionPluginRunnerConfig;
  builtinRegistry?: Pick<BuiltinPluginRegistry, 'refresh' | 'get'>;
  hostApiHandler?: PluginRunnerHostApiHandler;
  executionGrants?: Pick<ExecutionGrantService, 'validate'>;
}

/**
 * 保留设备/云旧入口的类型，以便调用方在迁移期间得到明确拒绝，而不是重新创建
 * 一条隐蔽的包级 Runner 执行链。
 */
export interface PluginWorkflowCapabilityExecutionInput {
  tenantId: string;
  planId?: string;
  targetId?: string;
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

/** 包级入口已经废弃；只有 DSL plugin.action 能调用下面的 Action 执行器。 */
export class PluginWorkflowCapabilityExecutorAdapter implements PluginWorkflowCapabilityExecutor {
  async execute(input: PluginWorkflowCapabilityExecutionInput): Promise<PluginWorkflowCapabilityExecutionResult> {
    return {
      success: false,
      errorCode: 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
      errorMessage: '包级 Plugin Runner 请求已禁止；请在普通 DSL 中声明 plugin.action 步骤',
      detail: { pluginId: input.pluginId, capability: input.capability, workflowVersionId: input.workflowVersionId },
      executionId: 'not-created',
      executionStepId: 'not-created',
    };
  }
}

/**
 * Runner 适配器只执行一项已冻结的 Action。它不读取 workflow、rollback、
 * checkpoint 或变量全集，也不拥有 DSL 的流程控制权。
 */
export class PluginRunnerExecutorAdapter implements Executor {
  readonly type = pluginRunnerExecutorType;

  constructor(private readonly dependencies: PluginRunnerExecutionDependencies = {}) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    try {
      const binding = resolvePluginActionBinding(input.step.inputSnapshot.pluginActionBinding);
      const actionInput = requiredRecord(input.step.inputSnapshot.pluginActionInput, 'pluginActionInput');
      const grantRefs = requiredIdentifiers(input.step.inputSnapshot.pluginActionGrantRefs, 'pluginActionGrantRefs', true);
      const result = await this.executeAction({
        binding,
        executionId: input.step.executionRunId,
        executionStepId: input.step.id,
        input: actionInput,
        grantRefs,
        idempotencyKey: requiredIdentifier(input.step.inputSnapshot.pluginActionIdempotencyKey, 'pluginActionIdempotencyKey'),
        deadlineAt: requiredDate(input.step.inputSnapshot.pluginActionDeadlineAt, 'pluginActionDeadlineAt'),
      });
      return {
        success: result.success,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        detail: result.detail,
      };
    } catch (error) {
      return actionFailure(error, {});
    }
  }

  async executeAction(input: PluginActionExecutionInput): Promise<PluginActionExecutionResult> {
    if (dslCertificateCapabilities.has(input.binding.capability)) {
      return actionFailure(new AppError(
        'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
        '证书部署和回滚必须由普通 DSL Workflow 执行，禁止进入 Plugin Runner',
      ), emptyDetail(input.binding));
    }
    let binding: PluginActionBindingV1;
    try {
      binding = validateActionExecutionInput(input);
      assertJsonSchema(input.input, binding.inputSchema, 'plugin.action 输入');
    } catch (error) {
      return actionFailure(error, emptyDetail(input.binding));
    }

    const runner = this.dependencies.runner;
    const supervisor = this.dependencies.supervisor;
    if (!runner || !supervisor) {
      return actionFailure(new AppError('PLUGIN_RUNNER_START_FAILED', 'Plugin Action Runner 未完成生产装配，已失败关闭'), auditDetail(binding, input));
    }

    let packageEntry: BuiltinPluginRegistryEntry | undefined;
    try {
      packageEntry = await resolveBuiltinPackage(this.dependencies.builtinRegistry, binding);
      const capability = packageEntry.capabilities.find((item) => item.key === binding.capability);
      if (!capability) throw new AppError('CAPABILITY_MISSING', '固定插件包未声明当前能力', { capability: binding.capability });
      const compatibility = evaluatePluginCompatibility(packageEntry.manifest, {
        executionLocation: 'CONTROL_PLANE',
        hostVersion: GCAC_VERSION,
        runtimeVersions: { CONTROL_PLANE: runner.runnerVersion },
      }, capability);
      if (!compatibility.compatible) {
        throw new AppError('CAPABILITY_MISSING', 'Plugin Runner 执行前兼容性门禁未通过', {
          status: compatibility.status,
          reasons: compatibility.reasons,
          inputs: compatibility.inputs,
        });
      }
      if (!this.dependencies.executionGrants) {
        throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Plugin Action 缺少 ExecutionGrantService，已失败关闭');
      }
      await Promise.all(input.grantRefs.map((grantId) => this.dependencies.executionGrants!.validate({
        grantId,
        tenantId: binding.tenantId,
        runId: input.executionId,
        stepId: input.executionStepId,
        workflowVersionId: binding.workflowVersionId,
        pluginVersionId: binding.pluginVersionId,
        pluginId: binding.pluginId,
        capability: binding.capability,
        actionId: binding.actionId,
        actionContractVersion: binding.actionContractVersion,
        inputSchemaSha256: binding.inputSchemaSha256,
        outputSchemaSha256: binding.outputSchemaSha256,
        planDigest: binding.planDigest,
        executorType: pluginRunnerExecutorType,
      })));
    } catch (error) {
      return actionFailure(error, auditDetail(binding, input));
    }

    let client: PluginRunnerClient;
    try {
      client = await supervisor.start(buildLaunchSpec(runner, binding, this.dependencies.hostApiHandler, packageEntry));
    } catch (error) {
      return actionFailure(error, auditDetail(binding, input));
    }

    const request: PluginRunnerExecutionInput = {
      tenantId: binding.tenantId,
      executionId: input.executionId,
      executionStepId: input.executionStepId,
      pluginVersionId: binding.pluginVersionId,
      workflowVersionId: binding.workflowVersionId,
      pluginId: binding.pluginId,
      capability: binding.capability,
      actionId: binding.actionId,
      actionContractVersion: binding.actionContractVersion,
      inputSchemaSha256: binding.inputSchemaSha256,
      outputSchemaSha256: binding.outputSchemaSha256,
      packageHash: binding.packageHash,
      manifestHash: binding.manifestHash,
      resourceHash: binding.resourceHash,
      planDigest: binding.planDigest,
      writeEffect: binding.writeEffect,
      input: structuredClone(input.input),
      grantRefs: [...input.grantRefs],
      idempotencyKey: input.idempotencyKey,
      deadlineAt: input.deadlineAt,
    };
    try {
      const result = await client.execute(request);
      if (result.success && result.status === 'SUCCESS') {
        try {
          assertJsonSchema(result.output, binding.outputSchema, 'plugin.action 输出');
        } catch (error) {
          return actionFailure(new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action 输出不符合冻结 Schema', {
            cause: error instanceof AppError ? error.errorCode : 'SCHEMA_VALIDATION_FAILED',
          }), auditDetail(binding, input, result.output));
        }
        return {
          success: true,
          status: 'SUCCESS',
          output: structuredClone(result.output),
          detail: auditDetail(binding, input, result.output, result.externalReceipt, result.warnings),
        };
      }
      const invalidState = invalidRunnerResultState(result, binding.writeEffect);
      if (invalidState) return actionFailure(invalidState, auditDetail(binding, input, undefined, result.externalReceipt, result.warnings, result.error));
      const unknown = binding.writeEffect && result.error?.mayBeUnknown === true;
      return {
        success: false,
        status: unknown ? 'UNKNOWN' : result.status,
        output: {},
        errorCode: unknown ? 'PLUGIN_OPERATION_UNKNOWN_STATE' : result.error?.code ?? 'PLUGIN_ACTION_FAILED',
        errorMessage: unknown ? 'Plugin Action 外部写入结果未知，必须由 DSL 恢复流程处理' : result.error?.message ?? 'Plugin Action 执行失败',
        detail: auditDetail(binding, input, undefined, result.externalReceipt, result.warnings, result.error),
      };
    } catch (error) {
      const unknown = binding.writeEffect && isUncertainExternalWrite(error);
      return {
        success: false,
        status: unknown ? 'UNKNOWN' : 'FAILED',
        output: {},
        errorCode: unknown ? 'PLUGIN_OPERATION_UNKNOWN_STATE' : errorCode(error, 'PLUGIN_ACTION_FAILED'),
        errorMessage: unknown ? 'Plugin Action 外部写入结果未知，必须由 DSL 恢复流程处理' : errorMessage(error),
        detail: auditDetail(binding, input, undefined, undefined, undefined, error),
      };
    }
  }
}

function invalidRunnerResultState(
  result: PluginRunnerExecuteResult,
  writeEffect: boolean,
): AppError | undefined {
  const uncertain = result.status === 'UNKNOWN' || result.error?.mayBeUnknown === true;
  if (uncertain && (!writeEffect || result.error?.mayBeUnknown !== true)) {
    return new AppError('PLUGIN_CONTRACT_INVALID', 'Plugin Runner 只能为真实写入不确定性返回 UNKNOWN');
  }
  if (result.success !== (result.status === 'SUCCESS')) {
    return new AppError('PLUGIN_CONTRACT_INVALID', 'Plugin Runner success 与 status 不一致');
  }
  return undefined;
}

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

export function resolvePluginActionBinding(value: unknown): PluginActionBindingV1 {
  const record = requiredRecord(value, 'pluginActionBinding');
  const known = new Set([
    'apiVersion', 'tenantId', 'workflowVersionId', 'workflowStepName', 'pluginVersionId', 'pluginId', 'pluginVersion',
    'capability', 'actionId', 'actionContractVersion', 'inputSchema', 'outputSchema', 'inputSchemaSha256',
    'outputSchemaSha256', 'packageHash', 'manifestHash', 'resourceHash', 'planDigest', 'writeEffect', 'hostPermissions',
  ]);
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new AppError('VALIDATION_FAILED', 'pluginActionBinding 包含未登记字段', { unknown });
  const binding: PluginActionBindingV1 = {
    apiVersion: requiredLiteral(record.apiVersion, 'apiVersion', pluginActionBindingApiVersion),
    tenantId: requiredIdentifier(record.tenantId, 'tenantId'),
    workflowVersionId: requiredIdentifier(record.workflowVersionId, 'workflowVersionId'),
    workflowStepName: requiredIdentifier(record.workflowStepName, 'workflowStepName'),
    pluginVersionId: requiredIdentifier(record.pluginVersionId, 'pluginVersionId'),
    pluginId: requiredIdentifier(record.pluginId, 'pluginId'),
    pluginVersion: requiredIdentifier(record.pluginVersion, 'pluginVersion'),
    capability: requiredIdentifier(record.capability, 'capability'),
    actionId: requiredIdentifier(record.actionId, 'actionId'),
    actionContractVersion: requiredIdentifier(record.actionContractVersion, 'actionContractVersion'),
    inputSchema: requiredSchema(record.inputSchema, 'inputSchema'),
    outputSchema: requiredSchema(record.outputSchema, 'outputSchema'),
    inputSchemaSha256: requiredHash(record.inputSchemaSha256, 'inputSchemaSha256'),
    outputSchemaSha256: requiredHash(record.outputSchemaSha256, 'outputSchemaSha256'),
    packageHash: requiredHash(record.packageHash, 'packageHash'),
    manifestHash: requiredHash(record.manifestHash, 'manifestHash'),
    resourceHash: requiredHash(record.resourceHash, 'resourceHash'),
    planDigest: requiredDigest(record.planDigest),
    writeEffect: requiredBoolean(record.writeEffect, 'writeEffect'),
    hostPermissions: requiredIdentifiers(record.hostPermissions, 'hostPermissions', false),
  };
  if (schemaHash(binding.inputSchema) !== binding.inputSchemaSha256 || schemaHash(binding.outputSchema) !== binding.outputSchemaSha256) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'pluginActionBinding 的 Schema 摘要与冻结 Schema 不一致');
  }
  return binding;
}

function validateActionExecutionInput(input: PluginActionExecutionInput): PluginActionBindingV1 {
  const binding = resolvePluginActionBinding(input.binding);
  if (!input || binding.tenantId === '') throw new AppError('VALIDATION_FAILED', 'plugin.action 执行输入无效');
  requiredIdentifier(input.executionId, 'executionId');
  requiredIdentifier(input.executionStepId, 'executionStepId');
  requiredRecord(input.input, 'input');
  requiredIdentifiers(input.grantRefs, 'grantRefs', true);
  requiredIdentifier(input.idempotencyKey, 'idempotencyKey');
  requiredDate(input.deadlineAt, 'deadlineAt');
  return binding;
}

function buildLaunchSpec(
  runner: ProductionPluginRunnerConfig,
  binding: PluginActionBindingV1,
  hostApiHandler: PluginRunnerHostApiHandler | undefined,
  packageEntry: BuiltinPluginRegistryEntry | undefined,
): PluginRunnerLaunchSpec {
  if (!packageEntry) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Plugin Action 缺少固定内置插件包快照');
  if (!packageEntry.runtimeEntrypointPath || packageEntry.executionMode !== 'DSL_STEP_ACTION') {
    throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '声明式 Agent Plan 插件不得进入 Plugin Runner', {
      pluginId: binding.pluginId,
    });
  }
  const permissions = [...binding.hostPermissions];
  if (permissions.some((permission) => !packageEntry.manifest.permissions.includes(permission))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'plugin.action 请求了未在固定 PluginVersion 声明的 Host API 权限', {
      pluginId: binding.pluginId,
      actionId: binding.actionId,
    });
  }
  return {
    pluginVersionId: binding.pluginVersionId,
    pluginId: binding.pluginId,
    pluginVersion: binding.pluginVersion,
    tenantId: binding.tenantId,
    executablePath: runner.executablePath,
    args: replaceExecutorModule(runner.args, packageEntry.runtimeEntrypointPath),
    workingDirectory: runner.workingDirectory,
    environment: {
      GCAC_PLUGIN_VERSION_ID: binding.pluginVersionId,
      GCAC_PLUGIN_ID: binding.pluginId,
      GCAC_PLUGIN_VERSION: binding.pluginVersion,
      GCAC_PLUGIN_PACKAGE_HASH: binding.packageHash,
      GCAC_PLUGIN_MANIFEST_HASH: binding.manifestHash,
      GCAC_PLUGIN_RESOURCE_HASH: binding.resourceHash,
    },
    runnerVersion: runner.runnerVersion,
    sdkVersion: runner.sdkVersion,
    capabilities: packageEntry.capabilities.map((capability) => capability.key),
    hostPermissions: permissions,
    packageHash: binding.packageHash,
    resourceHash: binding.resourceHash,
    manifestHash: binding.manifestHash,
    ...(hostApiHandler ? { hostApiHandler } : {}),
  };
}

async function resolveBuiltinPackage(
  registry: Pick<BuiltinPluginRegistry, 'refresh' | 'get'> | undefined,
  binding: PluginActionBindingV1,
): Promise<BuiltinPluginRegistryEntry> {
  if (!registry) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Plugin Action 缺少内置插件 Registry');
  await registry.refresh();
  const entry = registry.get(binding.pluginId, binding.pluginVersion);
  if (entry.packageSha256 !== binding.packageHash || entry.manifestSha256 !== binding.manifestHash || entry.resourceHash !== binding.resourceHash) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'plugin.action 固定摘要与 PluginVersion 快照不一致', {
      pluginId: binding.pluginId,
      actionId: binding.actionId,
    });
  }
  if (!entry.capabilities.some((capability) => capability.key === binding.capability)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'plugin.action Capability 不在固定 PluginVersion 中', {
      pluginId: binding.pluginId,
      capability: binding.capability,
    });
  }
  return entry;
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

function actionFailure(error: unknown, detail: Record<string, unknown>): PluginActionExecutionResult {
  return {
    success: false,
    status: 'FAILED',
    output: {},
    errorCode: errorCode(error, 'PLUGIN_ACTION_FAILED'),
    errorMessage: errorMessage(error),
    detail: { ...detail, executionStatus: 'FAILED' },
  };
}

function auditDetail(
  binding: PluginActionBindingV1,
  input: PluginActionExecutionInput,
  output?: Record<string, unknown>,
  externalReceipt?: Record<string, unknown>,
  warnings?: readonly unknown[],
  error?: unknown,
): Record<string, unknown> {
  return {
    executionMode: 'plugin_action',
    workflowVersionId: binding.workflowVersionId,
    workflowStepName: binding.workflowStepName,
    pluginVersionId: binding.pluginVersionId,
    pluginId: binding.pluginId,
    pluginVersion: binding.pluginVersion,
    capability: binding.capability,
    actionId: binding.actionId,
    actionContractVersion: binding.actionContractVersion,
    inputSchemaSha256: binding.inputSchemaSha256,
    outputSchemaSha256: binding.outputSchemaSha256,
    packageHash: binding.packageHash,
    manifestHash: binding.manifestHash,
    resourceHash: binding.resourceHash,
    planDigest: binding.planDigest,
    writeEffect: binding.writeEffect,
    grantRefs: [...input.grantRefs],
    ...(output ? { output: structuredClone(output) } : {}),
    ...(externalReceipt ? { externalReceipt: structuredClone(externalReceipt) } : {}),
    ...(warnings?.length ? { warnings: structuredClone(warnings) } : {}),
    ...(error ? { error: { code: errorCode(error, 'PLUGIN_ACTION_FAILED') } } : {}),
  };
}

function emptyDetail(binding: PluginActionBindingV1 | undefined): Record<string, unknown> {
  return binding ? { actionId: binding.actionId, pluginId: binding.pluginId } : {};
}

function isUncertainExternalWrite(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const details = error.details;
  return Boolean(details && typeof details === 'object' && !Array.isArray(details)
    && (details as Record<string, unknown>).mayBeUnknown === true);
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.errorCode : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION_FAILED', `${name} 必须是对象`);
  return structuredClone(value as Record<string, unknown>);
}

function requiredSchema(value: unknown, name: string): JsonSchema {
  const schema = requiredRecord(value, name) as JsonSchema;
  if (Object.keys(schema).length === 0) throw new AppError('VALIDATION_FAILED', `${name} 不能为空`);
  return schema;
}

function requiredLiteral(value: unknown, name: string, expected: string): typeof pluginActionBindingApiVersion {
  if (value !== expected) throw new AppError('VALIDATION_FAILED', `${name} 必须为 ${expected}`);
  return pluginActionBindingApiVersion;
}

function requiredIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw new AppError('VALIDATION_FAILED', `${name} 必须是固定标识符`);
  return value;
}

function requiredIdentifiers(value: unknown, name: string, nonEmpty: boolean): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.length > 100) throw new AppError('VALIDATION_FAILED', `${name} 必须是有界标识符数组`);
  const items = value.map((item) => requiredIdentifier(item, name));
  if (new Set(items).size !== items.length) throw new AppError('VALIDATION_FAILED', `${name} 不允许重复`);
  return items;
}

function requiredHash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new AppError('VALIDATION_FAILED', `${name} 必须是 sha256 摘要`);
  return value;
}

function requiredDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new AppError('VALIDATION_FAILED', 'planDigest 必须是 sha256 十六进制摘要');
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new AppError('VALIDATION_FAILED', `${name} 必须是布尔值`);
  return value;
}

function requiredDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) {
    throw new AppError('PLUGIN_RUNNER_TIMEOUT', `${name} 无效或已过期`);
  }
  return value;
}

function schemaHash(schema: JsonSchema): string {
  return `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`;
}
