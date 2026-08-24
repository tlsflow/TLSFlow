import { AppError } from '../../../common/errors/app-error.js';
import type {
  ApplicationAssetTargetSummaryDto,
  DeploymentStrategyDto,
  ManagedDeploymentIntentDto,
  ServiceAssetDto,
} from '../dto/assets.dto.js';
import type { PluginBindingV1 } from '../../plugins/dto/plugin-bindings.dto.js';

export interface DeploymentStrategyContext {
  asset: Pick<ServiceAssetDto, 'id' | 'agentId' | 'metadata'>;
  targetBinding?: Pick<ApplicationAssetTargetSummaryDto, 'agentId' | 'siteAssetId' | 'managedTargetId'>;
  actorId?: string;
  now?: string;
}

export function normalizeDeploymentStrategy(input: DeploymentStrategyDto, context: DeploymentStrategyContext): DeploymentStrategyDto {
  if (!input || typeof input !== 'object') throw new AppError('VALIDATION_FAILED', 'deploymentStrategy 必须是对象');
  const now = context.now ?? new Date().toISOString();
  if (input.type === 'MANAGED_TARGET') {
    const managedTarget = input.managedTarget;
    if (!managedTarget) throw strategyError('MANAGED_TARGET 策略必须提供 managedTarget 配置');
    const pluginBindingId = optionalNonEmpty(managedTarget.pluginBindingId);
    return {
      type: 'MANAGED_TARGET',
      managedTarget: {
        managedTargetId: requireNonEmpty(managedTarget.managedTargetId, 'managedTarget.managedTargetId'),
        pluginBindingId,
        certificateFormatId: pluginBindingId ? undefined : optionalNonEmpty(managedTarget.certificateFormatId),
        deploymentMode: pluginBindingId ? undefined : optionalNonEmpty(managedTarget.deploymentMode),
      },
      compatibilityMode: pluginBindingId ? 'UNIFIED' : 'LEGACY',
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }
  if (input.type === 'AGENT') {
    const agent = input.agent;
    if (!agent) throw strategyError('AGENT 策略必须提供 agent 配置');
    const mode = agent.mode ?? 'NATIVE_HANDLER';
    if (mode !== 'NATIVE_HANDLER' && mode !== 'PLUGIN') throw strategyError('agent.mode 只支持 NATIVE_HANDLER/PLUGIN');
    const pluginBindingId = optionalNonEmpty(agent.pluginBindingId);
    if (mode === 'PLUGIN' && !pluginBindingId) strategyError('PLUGIN 模式必须提供 pluginBindingId');
    if (mode === 'NATIVE_HANDLER' && pluginBindingId) pluginBindingConflict('NATIVE_HANDLER 不能引用统一 PluginBinding');
    assertLegacyTargetRelation(agent, context.targetBinding);
    const normalized = {
      mode,
      pluginBindingId,
      agentId: requireNonEmpty(agent.agentId, 'agent.agentId'),
      siteAssetId: mode === 'NATIVE_HANDLER' ? requireNonEmpty(agent.siteAssetId, 'agent.siteAssetId') : optionalNonEmpty(agent.siteAssetId),
      managedTargetId: mode === 'NATIVE_HANDLER' ? requireNonEmpty(agent.managedTargetId, 'agent.managedTargetId') : optionalNonEmpty(agent.managedTargetId),
      certificateFormatId: pluginBindingId ? undefined : optionalNonEmpty(agent.certificateFormatId),
      deploymentMode: pluginBindingId ? undefined : optionalNonEmpty(agent.deploymentMode),
    };
    return {
      type: 'AGENT',
      agent: normalized,
      compatibilityMode: pluginBindingId ? 'UNIFIED' : 'LEGACY',
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }

  if (input.type === 'WORKFLOW') {
    const workflow = input.workflow;
    if (!workflow) throw strategyError('WORKFLOW 策略必须提供 workflow 配置');
    const pluginBindingId = optionalNonEmpty(workflow.pluginBindingId);
    const runner = workflow.runner;
    if (runner !== 'CONTROL_PLANE' && runner !== 'GATEWAY') throw strategyError('workflow.runner 只支持 CONTROL_PLANE/GATEWAY');
    if (runner === 'GATEWAY' && !optionalNonEmpty(workflow.gatewayId)) throw strategyError('runner=GATEWAY 时 gatewayId 必填');
    const credentialBindings = pluginBindingId ? undefined : normalizeCredentialBindings(workflow.credentialBindings);
    const workflowVersionSelection = normalizeWorkflowVersionSelection(workflow.workflowVersionSelection, workflow.workflowVersionId);
    return {
      type: 'WORKFLOW',
      workflow: {
        pluginBindingId,
        workflowId: pluginBindingId ? optionalNonEmpty(workflow.workflowId) : requireNonEmpty(workflow.workflowId, 'workflow.workflowId'),
        workflowVersionSelection,
        workflowVersionId: workflowVersionSelection === 'PINNED' && !pluginBindingId
          ? requireNonEmpty(workflow.workflowVersionId, 'workflow.workflowVersionId')
          : optionalNonEmpty(workflow.workflowVersionId),
        runner,
        gatewayId: optionalNonEmpty(workflow.gatewayId),
        target: normalizeWorkflowTarget(workflow.target),
        credentialBindings,
        connectionBindings: pluginBindingId ? undefined : normalizeWorkflowConnectionBindings(workflow.connectionBindings),
        parameterBindings: pluginBindingId ? undefined : isRecord(workflow.parameterBindings) ? workflow.parameterBindings : workflow.parameterBindings === undefined ? undefined : strategyError('workflow.parameterBindings 必须是对象'),
        certificateArtifactBindings: pluginBindingId ? undefined : normalizeCertificateArtifactBindings(workflow.certificateArtifactBindings),
        variableBindings: pluginBindingId ? undefined : isRecord(workflow.variableBindings) ? workflow.variableBindings : workflow.variableBindings === undefined ? undefined : strategyError('workflow.variableBindings 必须是对象'),
        rollbackWorkflowVersionId: optionalNonEmpty(workflow.rollbackWorkflowVersionId),
      },
      compatibilityMode: pluginBindingId ? 'UNIFIED' : 'LEGACY',
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }

  throw strategyError('deploymentStrategy.type 只支持 MANAGED_TARGET/AGENT/WORKFLOW');
}

export function getDeploymentStrategyPluginBindingId(strategy: DeploymentStrategyDto): string | undefined {
  if (strategy.type === 'AGENT') return optionalNonEmpty(strategy.agent?.pluginBindingId);
  if (strategy.type === 'MANAGED_TARGET') return optionalNonEmpty(strategy.managedTarget?.pluginBindingId);
  if (strategy.type === 'WORKFLOW') return optionalNonEmpty(strategy.workflow?.pluginBindingId);
  return undefined;
}

export function validateDeploymentStrategyPluginBinding(
  strategy: DeploymentStrategyDto,
  binding: PluginBindingV1,
): DeploymentStrategyDto {
  const pluginBindingId = getDeploymentStrategyPluginBindingId(strategy);
  if (!pluginBindingId) return strategy;
  if (binding.id !== pluginBindingId || binding.status !== 'ACTIVE') {
    pluginBindingConflict('部署策略引用的 PluginBinding 不可用', { pluginBindingId, bindingStatus: binding.status });
  }
  if (strategy.type === 'MANAGED_TARGET') {
    assertManagedTargetBindingCompatibility(strategy, binding);
    return {
      ...strategy,
      managedTarget: {
        ...strategy.managedTarget!,
        certificateFormatId: undefined,
        deploymentMode: undefined,
      },
      compatibilityMode: 'UNIFIED',
    };
  }
  if (strategy.type === 'AGENT') {
    assertAgentBindingCompatibility(strategy, binding);
    return {
      ...strategy,
      agent: {
        ...strategy.agent!,
        certificateFormatId: undefined,
        deploymentMode: undefined,
      },
      compatibilityMode: 'UNIFIED',
    };
  }
  return {
    ...strategy,
    workflow: {
      ...strategy.workflow!,
      parameterBindings: undefined,
      variableBindings: binding.variableBindings,
      credentialBindings: binding.credentialBindings,
      connectionBindings: binding.connectionBindings as NonNullable<DeploymentStrategyDto['workflow']>['connectionBindings'],
      certificateArtifactBindings: binding.certificateArtifactBindings,
    },
    compatibilityMode: 'UNIFIED',
  };
}

function assertManagedTargetBindingCompatibility(strategy: DeploymentStrategyDto, binding: PluginBindingV1): void {
  const managedTarget = strategy.managedTarget!;
  if (binding.mode !== 'MANAGED') pluginBindingConflict('MANAGED_TARGET 策略只能引用 Managed PluginBinding');
  if (binding.managedContext?.managedTargetId && binding.managedContext.managedTargetId !== managedTarget.managedTargetId) {
    pluginBindingConflict('PluginBinding 与受管目标不一致', {
      strategyManagedTargetId: managedTarget.managedTargetId,
      bindingManagedTargetId: binding.managedContext.managedTargetId,
    });
  }
}

function assertAgentBindingCompatibility(strategy: DeploymentStrategyDto, binding: PluginBindingV1): void {
  const agent = strategy.agent!;
  if ((agent.mode ?? 'NATIVE_HANDLER') !== 'PLUGIN') pluginBindingConflict('统一 PluginBinding 只能用于 Agent Plugin 模式');
  if (binding.mode !== 'MANAGED') pluginBindingConflict('Agent Plugin 策略只能引用 Managed PluginBinding');
  if (binding.managedContext?.agentId && binding.managedContext.agentId !== agent.agentId) {
    pluginBindingConflict('PluginBinding 与 Agent 不一致', { strategyAgentId: agent.agentId, bindingAgentId: binding.managedContext.agentId });
  }
}

export function normalizeManagedDeploymentIntent(strategy: DeploymentStrategyDto, context: DeploymentStrategyContext): ManagedDeploymentIntentDto | undefined {
  const normalized = normalizeDeploymentStrategy(strategy, context);
  if (normalized.type === 'MANAGED_TARGET') {
    return {
      type: 'MANAGED_TARGET',
      managedTargetId: normalized.managedTarget!.managedTargetId,
      certificateFormatId: normalized.managedTarget!.certificateFormatId,
      deploymentMode: normalized.managedTarget!.deploymentMode,
    };
  }
  if (normalized.type !== 'AGENT') return undefined;
  const managedTargetId = normalized.agent?.managedTargetId ?? context.targetBinding?.managedTargetId;
  if (!managedTargetId) throw legacyRelationError('旧 AGENT 策略无法解析 managedTargetId');
  return {
    type: 'MANAGED_TARGET',
    managedTargetId,
    certificateFormatId: normalized.agent?.certificateFormatId,
    deploymentMode: normalized.agent?.deploymentMode,
    legacyAgent: {
      agentId: normalized.agent!.agentId,
      siteAssetId: normalized.agent?.siteAssetId,
    },
  };
}

function normalizeWorkflowConnectionBindings(value: unknown): NonNullable<DeploymentStrategyDto['workflow']>['connectionBindings'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError('workflow.connectionBindings 必须是对象');
  return Object.fromEntries(Object.entries(value).map(([name, rawBinding]) => {
    if (!isRecord(rawBinding)) return strategyError(`workflow.connectionBindings.${name} 必须是对象`);
    const port = rawBinding.port === undefined ? undefined : Number(rawBinding.port);
    if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
      return strategyError(`workflow.connectionBindings.${name}.port 必须是有效端口`);
    }
    const credential = normalizeWorkflowCredentialBinding(rawBinding.credential, `workflow.connectionBindings.${name}.credential`);
    const binding = {
      host: optionalNonEmpty(rawBinding.host),
      port,
      username: optionalNonEmpty(rawBinding.username),
      credentialRef: optionalNonEmpty(rawBinding.credentialRef) ?? credential?.credentialId,
      credential,
      expectedHostKeyFingerprint: optionalNonEmpty(rawBinding.expectedHostKeyFingerprint),
    };
    return [name, Object.fromEntries(Object.entries(binding).filter(([, item]) => item !== undefined))];
  }));
}

function normalizeWorkflowCredentialBinding(value: unknown, path: string): NonNullable<NonNullable<DeploymentStrategyDto['workflow']>['connectionBindings']>[string]['credential'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError(`${path} 必须是对象`);
  const credentialId = requireNonEmpty(value.credentialId, `${path}.credentialId`);
  const kind = value.kind;
  if (!['USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE'].includes(String(kind))) return strategyError(`${path}.kind 不支持`);
  if (!isRecord(value.secretRefs)) return strategyError(`${path}.secretRefs 必须是对象`);
  const secretRefs = Object.fromEntries(Object.entries(value.secretRefs).map(([slot, secretRef]) => [slot, requireSecretRef(secretRef, `${path}.secretRefs.${slot}`)]));
  const delivery = value.delivery === undefined ? undefined : normalizeCredentialDelivery(value.delivery, `${path}.delivery`);
  return {
    credentialId,
    kind: kind as 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE',
    username: optionalNonEmpty(value.username),
    delivery,
    secretRefs,
  };
}

function normalizeCredentialDelivery(value: unknown, path: string) {
  if (!isRecord(value)) return strategyError(`${path} 必须是对象`);
  const location = value.location;
  if (location !== undefined && !['header', 'query', 'cookie'].includes(String(location))) return strategyError(`${path}.location 不支持`);
  return { location: location as 'header' | 'query' | 'cookie' | undefined, name: optionalNonEmpty(value.name) };
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

function assertLegacyTargetRelation(
  agent: NonNullable<DeploymentStrategyDto['agent']>,
  target: DeploymentStrategyContext['targetBinding'],
): void {
  if (!target) return;
  const conflicts = [
    ['agentId', optionalNonEmpty(agent.agentId), optionalNonEmpty(target.agentId)],
    ['siteAssetId', optionalNonEmpty(agent.siteAssetId), optionalNonEmpty(target.siteAssetId)],
    ['managedTargetId', optionalNonEmpty(agent.managedTargetId), optionalNonEmpty(target.managedTargetId)],
  ].filter(([, supplied, actual]) => supplied && actual && supplied !== actual);
  if (conflicts.length > 0) throw legacyRelationError('旧 AGENT 策略与受管目标关系冲突', { conflicts });
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

function normalizeCredentialBindings(value: unknown): Record<string, { credentialId: string }> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) strategyError('workflow.credentialBindings 必须是对象');
  return Object.fromEntries(Object.entries(value).map(([slot, binding]) => {
    if (!isRecord(binding) || typeof binding.credentialId !== 'string' || !binding.credentialId.trim()) {
      throw strategyError(`workflow.credentialBindings.${slot}.credentialId 不能为空`);
    }
    return [slot, { credentialId: binding.credentialId.trim() }];
  }));
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

function requireSecretRef(value: unknown, field: string): string {
  if (!isSecretRef(value)) throw strategyError(`${field} 必须是 SecretRef`);
  return value;
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

function legacyRelationError(message: string, detail: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'LEGACY_TARGET_RELATION_CONFLICT', ...detail });
}

function pluginBindingConflict(message: string, detail: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'PLUGIN_BINDING_CONFLICT', ...detail });
}
