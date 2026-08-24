import { AppError } from '../../../common/errors/app-error.js';
import type {
  ApplicationAssetTargetSummaryDto,
  DeploymentStrategyDto,
  ServiceAssetDto,
} from '../dto/assets.dto.js';

export interface DeploymentStrategyContext {
  asset: Pick<ServiceAssetDto, 'id' | 'agentId' | 'metadata'>;
  targetBinding?: Pick<ApplicationAssetTargetSummaryDto, 'agentId' | 'siteAssetId' | 'managedTargetId'>;
  actorId?: string;
  now?: string;
}

export function normalizeDeploymentStrategy(input: DeploymentStrategyDto, context: DeploymentStrategyContext): DeploymentStrategyDto {
  if (!input || typeof input !== 'object') throw new AppError('VALIDATION_FAILED', 'deploymentStrategy 必须是对象');
  const now = context.now ?? new Date().toISOString();
  if (input.type === 'AGENT') {
    const agent = input.agent;
    if (!agent) throw strategyError('AGENT 策略必须提供 agent 配置');
    const normalized = {
      agentId: requireNonEmpty(agent.agentId, 'agent.agentId'),
      siteAssetId: requireNonEmpty(agent.siteAssetId, 'agent.siteAssetId'),
      managedTargetId: requireNonEmpty(agent.managedTargetId, 'agent.managedTargetId'),
      certificateFormatId: optionalNonEmpty(agent.certificateFormatId),
      deploymentMode: optionalNonEmpty(agent.deploymentMode),
    };
    return { type: 'AGENT', agent: normalized, updatedAt: now, updatedBy: context.actorId };
  }

  if (input.type === 'WORKFLOW') {
    const workflow = input.workflow;
    if (!workflow) throw strategyError('WORKFLOW 策略必须提供 workflow 配置');
    const runner = workflow.runner;
    if (runner !== 'CONTROL_PLANE' && runner !== 'GATEWAY') throw strategyError('workflow.runner 只支持 CONTROL_PLANE/GATEWAY');
    if (runner === 'GATEWAY' && !optionalNonEmpty(workflow.gatewayId)) throw strategyError('runner=GATEWAY 时 gatewayId 必填');
    const credentialRefs = normalizeSecretRefRecord(workflow.credentialRefs, 'workflow.credentialRefs');
    const workflowVersionSelection = normalizeWorkflowVersionSelection(workflow.workflowVersionSelection, workflow.workflowVersionId);
    return {
      type: 'WORKFLOW',
      workflow: {
        workflowId: requireNonEmpty(workflow.workflowId, 'workflow.workflowId'),
        workflowVersionSelection,
        workflowVersionId: workflowVersionSelection === 'PINNED'
          ? requireNonEmpty(workflow.workflowVersionId, 'workflow.workflowVersionId')
          : undefined,
        runner,
        gatewayId: optionalNonEmpty(workflow.gatewayId),
        target: normalizeWorkflowTarget(workflow.target),
        credentialRefs,
        certificateArtifactBindings: normalizeCertificateArtifactBindings(workflow.certificateArtifactBindings),
        variableBindings: isRecord(workflow.variableBindings) ? workflow.variableBindings : workflow.variableBindings === undefined ? undefined : strategyError('workflow.variableBindings 必须是对象'),
        rollbackWorkflowVersionId: optionalNonEmpty(workflow.rollbackWorkflowVersionId),
      },
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }

  throw strategyError('deploymentStrategy.type 只支持 AGENT/WORKFLOW');
}

function normalizeWorkflowVersionSelection(value: unknown, workflowVersionId: unknown): 'PINNED' | 'LATEST_PUBLISHED' {
  if (value === undefined || value === null || value === '') {
    return optionalNonEmpty(workflowVersionId) ? 'PINNED' : 'LATEST_PUBLISHED';
  }
  if (value === 'PINNED' || value === 'LATEST_PUBLISHED') return value;
  throw strategyError('workflow.workflowVersionSelection 只支持 PINNED/LATEST_PUBLISHED');
}

export function resolveDeploymentStrategy(context: DeploymentStrategyContext): DeploymentStrategyDto | undefined {
  const stored = readStoredDeploymentStrategy(context.asset.metadata);
  if (stored) return normalizeDeploymentStrategy(stored, context);
  return inferAgentDeploymentStrategy(context);
}

export function writeDeploymentStrategyMetadata(metadata: Record<string, unknown>, strategy: DeploymentStrategyDto): Record<string, unknown> {
  return { ...metadata, deploymentStrategy: strategy };
}

export function readStoredDeploymentStrategy(metadata: Record<string, unknown>): DeploymentStrategyDto | undefined {
  const value = metadata.deploymentStrategy;
  if (!isRecord(value)) return undefined;
  return value as unknown as DeploymentStrategyDto;
}

function inferAgentDeploymentStrategy(context: DeploymentStrategyContext): DeploymentStrategyDto | undefined {
  const agentId = optionalNonEmpty(context.targetBinding?.agentId) ?? optionalNonEmpty(context.asset.agentId);
  const siteAssetId = optionalNonEmpty(context.targetBinding?.siteAssetId);
  const managedTargetId = optionalNonEmpty(context.targetBinding?.managedTargetId);
  if (!agentId || !siteAssetId || !managedTargetId) return undefined;
  return {
    type: 'AGENT',
    agent: { agentId, siteAssetId, managedTargetId },
    updatedAt: context.now ?? new Date().toISOString(),
    updatedBy: context.actorId,
  };
}

function normalizeSecretRefRecord(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw strategyError(`${path} 必须是对象`);
  const output: Record<string, string> = {};
  for (const [key, ref] of Object.entries(value)) {
    if (!isSecretRef(ref)) throw strategyError(`${path}.${key} 必须是 SecretRef`);
    output[key] = ref;
  }
  return output;
}

function normalizeCertificateArtifactBindings(value: unknown): NonNullable<DeploymentStrategyDto['workflow']>['certificateArtifactBindings'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw strategyError('workflow.certificateArtifactBindings 必须是对象');
  const output: NonNullable<DeploymentStrategyDto['workflow']>['certificateArtifactBindings'] = {};
  for (const [variableName, binding] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(variableName)) throw strategyError(`workflow.certificateArtifactBindings.${variableName} 变量名不合法`);
    if (!isRecord(binding)) throw strategyError(`workflow.certificateArtifactBindings.${variableName} 必须是对象`);
    const certificateFormatId = requireNonEmpty(binding.certificateFormatId, `workflow.certificateArtifactBindings.${variableName}.certificateFormatId`);
    if (!isRecord(binding.outputBindings)) throw strategyError(`workflow.certificateArtifactBindings.${variableName}.outputBindings 必须是对象`);
    const outputBindings: Record<string, string> = {};
    for (const [slotName, outputKey] of Object.entries(binding.outputBindings)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(slotName)) throw strategyError(`workflow.certificateArtifactBindings.${variableName}.outputBindings.${slotName} 名称不合法`);
      outputBindings[slotName] = requireNonEmpty(outputKey, `workflow.certificateArtifactBindings.${variableName}.outputBindings.${slotName}`);
    }
    output[variableName] = { certificateFormatId, outputBindings };
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function requireNonEmpty(value: unknown, field: string): string {
  const normalized = optionalNonEmpty(value);
  if (!normalized) throw strategyError(`${field} 必填`);
  return normalized;
}

function normalizeWorkflowTarget(value: unknown): NonNullable<DeploymentStrategyDto['workflow']>['target'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw strategyError('workflow.target 必须是对象');
  const port = typeof value.port === 'number'
    ? value.port
    : typeof value.port === 'string'
      ? Number(value.port)
      : undefined;
  const target = {
    frameworkType: optionalNonEmpty(value.frameworkType)?.toUpperCase(),
    siteName: optionalNonEmpty(value.siteName),
    bindingInformation: optionalNonEmpty(value.bindingInformation),
    hostHeader: optionalNonEmpty(value.hostHeader),
    port: Number.isInteger(port) && port! > 0 && port! <= 65535 ? port : undefined,
    protocol: optionalNonEmpty(value.protocol)?.toUpperCase(),
    verifyUrl: optionalNonEmpty(value.verifyUrl),
    sniName: optionalNonEmpty(value.sniName),
  };
  return Object.values(target).some((item) => item !== undefined) ? target : undefined;
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strategyError(message: string): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'DEPLOYMENT_STRATEGY_INVALID' });
}
