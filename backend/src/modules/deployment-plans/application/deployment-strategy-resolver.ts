import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { DeploymentGatewayRouteDto } from '../dto/deployment-plans.dto.js';
import type { DeploymentStrategyDto, ServiceAssetDto, ApplicationAssetTargetSummaryDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { RuntimeExecutionRequest } from './plugin-runtime-adapter.registry.js';
import { emptyInputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import { buildCertificateVerificationTarget } from './certificate-verification-target.js';

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
    if (workflow.workflowVersionSelection !== 'FIXED' || !workflow.workflowVersionId) {
      throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略必须引用 FIXED WorkflowVersion', {
        code: 'WORKFLOW_VERSION_REQUIRED',
        applicationAssetId: input.applicationAsset.id,
        workflowId: workflow.workflowId,
        workflowVersionId: workflow.workflowVersionId,
      });
    }
    if (workflow.runner === 'GATEWAY') {
      throw new AppError('VALIDATION_FAILED', 'Gateway 仅支持鉴权后的 TCP Relay，不能作为 Workflow 或业务插件执行位置', {
        code: 'GATEWAY_RELAY_ONLY',
        applicationAssetId: input.applicationAsset.id,
        workflowVersionId: workflow.workflowVersionId,
      });
    }
    const managedTargetId = input.bindingTarget?.managedTargetId;
    const gatewayRoute = undefined;
    const target = workflow.target ?? readWorkflowTarget(input.applicationAsset.metadata);
    return {
      strategyType: 'WORKFLOW',
      executorType: 'WORKFLOW',
      executionTargetId: managedTargetId ?? input.applicationAsset.id,
      requiredCapabilities: ['workflow.run'],
      gatewayRoute,
      payload: {
        deploymentStrategy: strategy,
        certificateVerification: workflowCertificateVerification(input),
        workflowRequest: {
          workflowId: workflow.workflowId,
          workflowVersionSelection: 'FIXED',
          workflowVersionId: workflow.workflowVersionId,
          pluginVersionId: workflow.pluginVersionId,
          capabilityKey: workflow.capabilityKey,
          runner: workflow.runner,
          gatewayId: workflow.gatewayId,
          target,
          inputBindings: workflow.inputBindings ?? emptyInputBindingsV1(),
          credentials: workflow.credentials ?? {},
          executionBranch: workflow.executionBranch ?? 'deploy',
          rollbackWorkflowVersionId: workflow.rollbackWorkflowVersionId,
          applicationAssetId: input.applicationAsset.id,
          certificateBindingId: input.certificateBinding?.id,
          managedTargetId,
          // 新计划显式固定 Standalone 资源锁身份，避免执行时依赖插件自定义字段。
          ...(managedTargetId ? {} : { standaloneStableKey: input.applicationAsset.id }),
          siteAssetId: input.managedTargetContext?.siteAsset?.id,
        },
      },
    };
  }
}

function readWorkflowTarget(metadata: Record<string, unknown>): NonNullable<NonNullable<DeploymentStrategyDto['workflow']>['target']> | undefined {
  const value = metadata.workflowTarget;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const target = {
    frameworkType: readOptionalString(record.frameworkType),
    siteName: readOptionalString(record.siteName),
    bindingInformation: readOptionalString(record.bindingInformation),
    hostHeader: readOptionalString(record.hostHeader),
    port: readOptionalPort(record.port),
    protocol: readOptionalString(record.protocol),
    verifyUrl: readOptionalString(record.verifyUrl),
    sniName: readOptionalString(record.sniName),
  };
  return Object.values(target).some((item) => item !== undefined) ? target : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function readOptionalPort(value: unknown): number | undefined {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined;
  return Number.isInteger(port) && port! > 0 && port! <= 65535 ? port : undefined;
}

function workflowCertificateVerification(input: DeploymentStrategyResolutionInput): Record<string, unknown> {
  return buildCertificateVerificationTarget({
    applicationAsset: input.applicationAsset,
    managedTargetContext: input.managedTargetContext,
    sourceLabel: 'MANAGED_HOST',
  });
}
