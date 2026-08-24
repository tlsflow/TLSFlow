import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import type { BuiltinPluginRegistry } from '../builtin-plugins/builtin-plugin-registry.js';
import type { PluginRunnerSupervisor, PluginRunnerHostApiHandler } from '../runner/index.js';
import type { ProductionPluginRunnerConfig } from '../runner/production-runner-config.js';
import type { PluginRunnerExecuteResult } from '../runner/protocol/protocol.types.js';
import type { PluginFactRunner, PluginFactRunnerInput } from './plugin-fact-pipeline.service.js';

export interface PluginFactRunnerAdapterDependencies {
  supervisor: Pick<PluginRunnerSupervisor, 'start'>;
  runner: ProductionPluginRunnerConfig;
  builtinRegistry: Pick<BuiltinPluginRegistry, 'refresh' | 'get'>;
  hostApiHandler?: PluginRunnerHostApiHandler;
  executionGrants?: Pick<ExecutionGrantService, 'validate'>;
}

export class PluginFactRunnerAdapter implements PluginFactRunner {
  constructor(private readonly dependencies: PluginFactRunnerAdapterDependencies) {}

  async execute(input: PluginFactRunnerInput): Promise<PluginRunnerExecuteResult> {
    void this.dependencies;
    throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', 'Fact Pipeline 不得绕过 DSL 直接调用 Plugin Runner；请在普通 DSL 中使用 plugin.action', {
      pluginId: input.pluginId,
      capability: input.capability,
      workflowVersionId: input.workflowVersionId,
    });
  }
}
