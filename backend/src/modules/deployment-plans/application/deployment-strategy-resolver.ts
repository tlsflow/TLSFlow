import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { DeploymentGatewayRouteDto } from '../dto/deployment-plans.dto.js';
import type { DeploymentStrategyDto, ServiceAssetDto, ApplicationAssetTargetSummaryDto } from '../../assets/dto/assets.dto.js';

export interface DeploymentStrategyResolutionInput {
  applicationAsset: ServiceAssetDto;
  bindingTarget?: ApplicationAssetTargetSummaryDto;
  certificateBinding?: CertificateBindingDto;
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
    const strategy = input.applicationAsset.deploymentStrategy ?? this.inferAgentStrategy(input);
    if (!strategy) {
      throw new AppError('VALIDATION_FAILED', '应用资产缺少证书部署策略', {
        code: 'DEPLOYMENT_STRATEGY_MISSING',
        applicationAssetId: input.applicationAsset.id,
      });
    }
    if (strategy.type === 'AGENT') return this.resolveAgent(input, strategy);
    if (strategy.type === 'WORKFLOW') return this.resolveWorkflow(input, strategy);
    throw new AppError('VALIDATION_FAILED', '应用资产部署策略类型不支持', { code: 'DEPLOYMENT_STRATEGY_INVALID', strategyType: (strategy as { type?: unknown }).type });
  }

  private inferAgentStrategy(input: DeploymentStrategyResolutionInput): DeploymentStrategyDto | undefined {
    const agentId = input.bindingTarget?.agentId ?? input.applicationAsset.agentId;
    if (!agentId || !input.bindingTarget?.siteAssetId || !input.bindingTarget.managedTargetId) return undefined;
    return {
      type: 'AGENT',
      agent: {
        agentId,
        siteAssetId: input.bindingTarget.siteAssetId,
        managedTargetId: input.bindingTarget.managedTargetId,
      },
    };
  }

  private resolveAgent(input: DeploymentStrategyResolutionInput, strategy: DeploymentStrategyDto): ResolvedDeploymentStrategySnapshot {
    const agent = strategy.agent;
    if (!agent?.agentId || !agent.siteAssetId || !agent.managedTargetId) {
      throw new AppError('VALIDATION_FAILED', 'AGENT 策略缺少 agentId/siteAssetId/managedTargetId', {
        code: 'DEPLOYMENT_STRATEGY_INVALID',
        applicationAssetId: input.applicationAsset.id,
      });
    }
    if (!input.certificateBinding) {
      throw new AppError('VALIDATION_FAILED', 'AGENT 策略缺少 CertificateBinding', {
        code: 'DEPLOYMENT_STRATEGY_INVALID',
        applicationAssetId: input.applicationAsset.id,
      });
    }
    return {
      strategyType: 'AGENT',
      executorType: 'AGENT',
      executionTargetId: agent.managedTargetId,
      requiredCapabilities: ['cert.install', 'cert.verify'],
      payload: {
        deploymentStrategy: strategy,
        agentId: agent.agentId,
        siteAssetId: agent.siteAssetId,
        managedTargetId: agent.managedTargetId,
        certificateBindingId: input.certificateBinding.id,
        serviceAssetId: input.applicationAsset.id,
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
        workflowRequest: {
          workflowId: workflow.workflowId,
          workflowVersionSelection: workflow.workflowVersionSelection ?? (workflow.workflowVersionId ? 'PINNED' : 'LATEST_PUBLISHED'),
          workflowVersionId: workflow.workflowVersionId,
          runner: workflow.runner,
          gatewayId: workflow.gatewayId,
          target: workflow.target,
          credentialRefs: workflow.credentialRefs ?? {},
          connectionBindings: workflow.connectionBindings ?? {},
          parameterBindings: workflow.parameterBindings ?? {},
          variableBindings: workflow.variableBindings ?? {},
          certificateArtifactBindings: workflow.certificateArtifactBindings ?? {},
          rollbackWorkflowVersionId: workflow.rollbackWorkflowVersionId,
          applicationAssetId: input.applicationAsset.id,
          certificateBindingId: input.certificateBinding?.id,
          managedTargetId: input.bindingTarget?.managedTargetId,
          siteAssetId: input.bindingTarget?.siteAssetId,
        },
      },
    };
  }
}
