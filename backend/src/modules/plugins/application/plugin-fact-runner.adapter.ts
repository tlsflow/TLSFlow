import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import {
  PluginRunnerSupervisor,
  type PluginRunnerExecutionInput,
  type PluginRunnerHostApiHandler,
  type PluginRunnerLaunchSpec,
} from '../runner/index.js';
import type { ProductionPluginRunnerConfig } from '../runner/production-runner-config.js';
import type { PluginRunnerExecuteResult } from '../runner/protocol/protocol.types.js';
import { BuiltinPluginRegistry, type BuiltinPluginRegistryEntry } from '../builtin-plugins/builtin-plugin-registry.js';
import type { PluginFactRunner, PluginFactRunnerInput } from './plugin-fact-pipeline.service.js';

export interface PluginFactRunnerAdapterDependencies {
  supervisor: Pick<PluginRunnerSupervisor, 'start'>;
  runner: ProductionPluginRunnerConfig;
  builtinRegistry: Pick<BuiltinPluginRegistry, 'refresh' | 'get'>;
  hostApiHandler?: PluginRunnerHostApiHandler;
  executionGrants?: Pick<ExecutionGrantService, 'validate'>;
}

/**
 * Fact Pipeline 的真实 Runner 适配器。
 *
 * 适配器只把固定 PluginVersion 解析成 Runner 启动规格，runtime 仍由独立
 * Runner 子进程装载。Fact Pipeline 不得直接依赖 Loader，也不能在宿主进程
 * import、require 或实例化插件执行器。
 */
export class PluginFactRunnerAdapter implements PluginFactRunner {
  constructor(private readonly dependencies: PluginFactRunnerAdapterDependencies) {}

  async execute(input: PluginFactRunnerInput): Promise<PluginRunnerExecuteResult> {
    if (input.writeEffect !== false) {
      throw new AppError('PLUGIN_CONTRACT_INVALID', 'Fact Runner 只允许只读事实发现');
    }
    const entry = await this.resolvePackage(input);
    if (!entry.capabilities.some((capability) => capability.key === input.capability)) {
      throw new AppError('CAPABILITY_MISSING', '固定 PluginVersion 未声明 Fact Pipeline Capability', {
        pluginId: input.pluginId,
        capability: input.capability,
      });
    }
    await this.validateGrants(input);

    const spec = buildLaunchSpec(this.dependencies.runner, input, entry, this.dependencies.hostApiHandler);
    const request: PluginRunnerExecutionInput = {
      tenantId: input.tenantId,
      executionId: input.executionId,
      executionStepId: input.executionStepId,
      workflowVersionId: input.workflowVersionId,
      planDigest: input.planDigest,
      capability: input.capability,
      input: structuredClone(input.input),
      grantRefs: [...input.grantRefs],
      idempotencyKey: input.idempotencyKey,
      deadlineAt: input.deadlineAt,
      writeEffect: false,
    };
    try {
      const client = await this.dependencies.supervisor.start(spec);
      return await client.execute(request);
    } catch (error) {
      return unknownResult(input, error);
    }
  }

  private async resolvePackage(input: PluginFactRunnerInput): Promise<BuiltinPluginRegistryEntry> {
    await this.dependencies.builtinRegistry.refresh();
    const entry = this.dependencies.builtinRegistry.get(input.pluginId, input.pluginVersion);
    if (entry.packageSha256 !== input.packageHash
      || entry.manifestSha256 !== input.manifestHash
      || entry.resourceHash !== input.resourceHash) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Fact Runner 执行绑定摘要与固定插件包不一致', {
        pluginId: input.pluginId,
        pluginVersion: input.pluginVersion,
      });
    }
    return entry;
  }

  private async validateGrants(input: PluginFactRunnerInput): Promise<void> {
    if (!this.dependencies.executionGrants) return;
    await Promise.all(input.grantRefs.map((grantId) => this.dependencies.executionGrants!.validate({
      grantId,
      tenantId: input.tenantId,
      runId: input.executionId,
      stepId: input.executionStepId,
      workflowVersionId: input.workflowVersionId,
      pluginVersionId: input.pluginVersionId,
      pluginId: input.pluginId,
      capability: input.capability,
      planDigest: input.planDigest,
      executorType: 'PLUGIN_RUNNER',
    })));
  }
}

function buildLaunchSpec(
  runner: ProductionPluginRunnerConfig,
  input: PluginFactRunnerInput,
  entry: BuiltinPluginRegistryEntry,
  hostApiHandler: PluginRunnerHostApiHandler | undefined,
): PluginRunnerLaunchSpec {
  return {
    pluginVersionId: input.pluginVersionId,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    tenantId: input.tenantId,
    executablePath: runner.executablePath,
    args: replaceExecutorModule(runner.args, entry.runtimeEntrypointPath),
    workingDirectory: runner.workingDirectory,
    environment: {
      GCAC_PLUGIN_VERSION_ID: input.pluginVersionId,
      GCAC_PLUGIN_ID: input.pluginId,
      GCAC_PLUGIN_VERSION: input.pluginVersion,
      GCAC_PLUGIN_PACKAGE_HASH: input.packageHash,
      GCAC_PLUGIN_MANIFEST_HASH: input.manifestHash,
      GCAC_PLUGIN_RESOURCE_HASH: input.resourceHash,
    },
    runnerVersion: runner.runnerVersion,
    sdkVersion: runner.sdkVersion,
    capabilities: [input.capability],
    hostPermissions: [...input.hostPermissions],
    packageHash: input.packageHash,
    resourceHash: input.resourceHash,
    manifestHash: input.manifestHash,
    ...(hostApiHandler ? { hostApiHandler } : {}),
  };
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

function unknownResult(input: PluginFactRunnerInput, error: unknown): PluginRunnerExecuteResult {
  const cause = error instanceof AppError ? error.errorCode : 'PLUGIN_RUNNER_CRASHED';
  return {
    protocolVersion: 'gcac.plugin-runner/v1',
    messageType: 'execute_result',
    requestId: `fact-runner:${input.executionId}:${input.executionStepId}`,
    sentAt: new Date().toISOString(),
    pluginVersionId: input.pluginVersionId,
    tenantId: input.tenantId,
    executionId: input.executionId,
    executionStepId: input.executionStepId,
    success: false,
    status: 'UNKNOWN',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: {
      code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      message: 'Fact Runner 崩溃、超时或迟到导致事实结果不明，必须进入恢复流程',
      retryable: false,
      mayBeUnknown: true,
      details: { cause },
      secretRedacted: true,
    },
  };
}
