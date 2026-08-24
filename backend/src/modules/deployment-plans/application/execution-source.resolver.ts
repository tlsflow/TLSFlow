import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentStrategyDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import type { WorkflowExecutionBinding } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';

export type ExecutionSourceMode = 'PLUGIN' | 'WORKFLOW_OVERRIDE' | 'WORKFLOW';
export type ResolvedExecutionSource =
  | {
      type: 'PLUGIN';
      capability: ResolvedDeploymentCapability;
      workflowVersionId?: string;
    }
  | {
      type: 'WORKFLOW';
      mode: 'WORKFLOW_OVERRIDE' | 'WORKFLOW';
      binding: WorkflowExecutionBinding;
      workflowVersionId: string;
    };

export class ExecutionSourceResolver {
  resolveMode(strategy: DeploymentStrategyDto): ExecutionSourceMode {
    if (strategy.type === 'MANAGED_TARGET') {
      const mode = strategy.managedTarget?.executionMode ?? 'PLUGIN';
      if (mode === 'PLUGIN' && strategy.managedTarget?.workflowExecutionBindingId) {
        throw new AppError('EXECUTION_SOURCE_CONFLICT', 'PLUGIN 模式不得引用 WorkflowExecutionBinding');
      }
      if (mode === 'WORKFLOW_OVERRIDE' && !strategy.managedTarget?.workflowExecutionBindingId) {
        throw new AppError('VALIDATION_FAILED', 'WORKFLOW_OVERRIDE 模式缺少 WorkflowExecutionBinding');
      }
      return mode;
    }
    if (strategy.type === 'WORKFLOW') {
      if (!strategy.workflow?.workflowExecutionBindingId && strategy.workflow?.pluginBindingId) {
        throw new AppError('EXECUTION_SOURCE_CONFLICT', '非受管工作流不得引用 PluginBinding');
      }
      return 'WORKFLOW';
    }
    throw new AppError('VALIDATION_FAILED', '未知部署执行模式');
  }

  resolvePlugin(input: {
    capability: ResolvedDeploymentCapability;
    workflowVersionId?: string;
  }): Extract<ResolvedExecutionSource, { type: 'PLUGIN' }> {
    return { type: 'PLUGIN', ...input };
  }

  resolveWorkflow(input: {
    mode: 'WORKFLOW_OVERRIDE' | 'WORKFLOW';
    binding: WorkflowExecutionBinding;
    workflowVersionId: string;
  }): Extract<ResolvedExecutionSource, { type: 'WORKFLOW' }> {
    return { type: 'WORKFLOW', ...input };
  }
}
