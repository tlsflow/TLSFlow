import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { DeploymentGatewayRouteDto } from '../dto/deployment-plans.dto.js';
import type { DeploymentStrategyDto, ServiceAssetDto, ApplicationAssetTargetSummaryDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { RuntimeExecutionRequest } from './plugin-runtime-adapter.registry.js';
import { emptyInputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export interface DeploymentStrategyResolutionInput {
  applicationAsset: ServiceAssetDto;
  bindingTarget?: ApplicationAssetTargetSummaryDto;
  certificateBinding?: CertificateBindingDto;
  managedTargetContext?: ResolvedManagedTargetContext;
  managedTargetRuntime?: RuntimeExecutionRequest;
}

export interface ResolvedDeploymentStrategySnapshot {
  strategyType: DeploymentStrategyDto['type'];
  executorType: ExecutionTargetKind | 'WORKFLOW';
  executionTargetId?: string;
  requiredCapabilities: string[];
  gatewayRoute?: DeploymentGatewayRouteDto;
  payload: Record<string, unknown>;
}

export class DeploymentStrategyResolver {
  resolve(input: DeploymentStrategyResolutionInput): ResolvedDeploymentStrategySnapshot {
    const strategy = input.applicationAsset.deploymentStrategy;
    if (!strategy) {
      throw new AppError('VALIDATION_FAILED', '应用资产缺少证书部署策略', {
        code: 'DEPLOYMENT_STRATEGY_MISSING',
        applicationAssetId: input.applicationAsset.id,
      });
    }
    if (strategy.type === 'MANAGED_TARGET') return this.resolveManagedTarget(input, strategy);
    if (strategy.type === 'WORKFLOW') return this.resolveWorkflow(input, strategy);
    throw new AppError('VALIDATION_FAILED', '应用资产部署策略类型不支持', { code: 'DEPLOYMENT_STRATEGY_INVALID', strategyType: (strategy as { type?: unknown }).type });
  }

  private resolveManagedTarget(input: DeploymentStrategyResolutionInput, strategy: DeploymentStrategyDto): ResolvedDeploymentStrategySnapshot {
    const managedTargetId = strategy.managedTarget?.managedTargetId;
    if (!managedTargetId || !input.managedTargetContext || input.managedTargetContext.managedTarget.id !== managedTargetId) {
      throw new AppError('VALIDATION_FAILED', 'MANAGED_TARGET 策略缺少可信目标上下文', {
        code: 'MANAGED_TARGET_CONTEXT_REQUIRED', applicationAssetId: input.applicationAsset.id, managedTargetId,
      });
    }
    const context = input.managedTargetContext;
    const runtime = input.managedTargetRuntime;
    if (!runtime) {
      throw new AppError('CAPABILITY_MISSING', 'MANAGED_TARGET 策略缺少 Capability Resolution 执行结果', {
        code: 'MANAGED_TARGET_CAPABILITY_RESOLUTION_REQUIRED',
        applicationAssetId: input.applicationAsset.id,
        managedTargetId,
      });
    }
    return {
      strategyType: 'MANAGED_TARGET',
      executorType: runtime.executorType,
      executionTargetId: runtime.executionTargetId,
      requiredCapabilities: runtime.requiredCapabilities,
      gatewayRoute: runtime.gatewayRoute,
      payload: {
        deploymentStrategy: strategy,
        managedTargetId,
        applicationAssetId: input.applicationAsset.id,
        certificateBindingId: input.certificateBinding?.id,
        targetSnapshot: {
          managedTarget: context.managedTarget,
          host: context.host,
          siteAsset: context.siteAsset,
          frameworkInstance: context.serviceInstance,
        },
        ...runtime.payload,
      },
    };
  }

  private resolveWorkflow(input: DeploymentStrategyResolutionInput, strategy: DeploymentStrategyDto): ResolvedDeploymentStrategySnapshot {
    const workflow = strategy.workflow;
    if (!workflow?.workflowId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少 workflowId', {
        code: 'DEPLOYMENT_STRATEGY_INVALID',
        applicationAssetId: input.applicationAsset.id,
      });
    }
    const gatewayRoute = workflow.runner === 'GATEWAY'
      ? {
          gatewayId: workflow.gatewayId,
          adapter: 'ssh' as const,
          delegatedTargetId: input.bindingTarget?.managedTargetId ?? input.applicationAsset.id,
          blockedReason: workflow.gatewayId ? undefined : 'runner=GATEWAY 但未配置 gatewayId',
        }
      : undefined;
    if (workflow.runner === 'GATEWAY' && !workflow.gatewayId) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 工作流策略缺少 gatewayId', {
        code: 'WORKFLOW_RUNNER_UNAVAILABLE',
        applicationAssetId: input.applicationAsset.id,
        workflowVersionId: workflow.workflowVersionId,
      });
    }
    return {
      strategyType: 'WORKFLOW',
      executorType: 'WORKFLOW',
      executionTargetId: input.bindingTarget?.managedTargetId ?? input.applicationAsset.id,
      requiredCapabilities: workflow.runner === 'GATEWAY' ? ['workflow.run', 'gateway.dispatch'] : ['workflow.run'],
      gatewayRoute,
      payload: {
        deploymentStrategy: strategy,
        certificateVerification: workflowCertificateVerification(input),
        workflowRequest: {
          workflowId: workflow.workflowId,
          workflowVersionSelection: workflow.workflowVersionSelection ?? (workflow.workflowVersionId ? 'PINNED' : 'LATEST_PUBLISHED'),
          workflowVersionId: workflow.workflowVersionId,
          runner: workflow.runner,
          gatewayId: workflow.gatewayId,
          target: workflow.target,
          inputBindings: workflow.inputBindings ?? emptyInputBindingsV1(),
          credentials: workflow.credentials ?? {},
          rollbackWorkflowVersionId: workflow.rollbackWorkflowVersionId,
          applicationAssetId: input.applicationAsset.id,
          certificateBindingId: input.certificateBinding?.id,
          managedTargetId: input.bindingTarget?.managedTargetId,
          siteAssetId: input.managedTargetContext?.siteAsset?.id,
        },
      },
    };
  }
}

function workflowCertificateVerification(input: DeploymentStrategyResolutionInput): Record<string, unknown> {
  const connectHost = input.managedTargetContext?.host.primaryIp ?? input.applicationAsset.address;
  const serverName = input.applicationAsset.sniName ?? input.applicationAsset.address;
  const port = input.applicationAsset.port;
  if (!connectHost || !serverName || !port) {
    throw new AppError('VALIDATION_FAILED', 'WORKFLOW 部署策略缺少证书验证目标', {
      applicationAssetId: input.applicationAsset.id,
      connectHost,
      serverName,
      port,
    });
  }
  return {
    capabilityKey: 'certificate.verify',
    schemaVersion: '1.0',
    connectHost,
    serverName,
    port,
    expectedDomains: [serverName],
    source: input.managedTargetContext ? 'MANAGED_HOST' : 'APPLICATION_ASSET',
  };
}
