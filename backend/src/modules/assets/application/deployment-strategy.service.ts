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
        certificateFormatId: optionalNonEmpty(managedTarget.certificateFormatId),
        deploymentMode: optionalNonEmpty(managedTarget.deploymentMode),
      },
      compatibilityMode: resolveCompatibilityMode(pluginBindingId, Boolean(
        optionalNonEmpty(managedTarget.certificateFormatId) || optionalNonEmpty(managedTarget.deploymentMode),
      )),
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
    const plugin = mode === 'PLUGIN' && agent.plugin ? normalizeAgentPluginBinding(agent.plugin) : undefined;
    if (mode === 'PLUGIN' && !plugin && !pluginBindingId) strategyError('PLUGIN 模式必须提供 pluginBindingId 或历史 agent.plugin 配置');
    if (mode === 'NATIVE_HANDLER' && pluginBindingId) pluginBindingConflict('NATIVE_HANDLER 不能引用统一 PluginBinding');
    assertLegacyTargetRelation(agent, context.targetBinding);
    const normalized = {
      mode,
      pluginBindingId,
      agentId: requireNonEmpty(agent.agentId, 'agent.agentId'),
      siteAssetId: mode === 'NATIVE_HANDLER' ? requireNonEmpty(agent.siteAssetId, 'agent.siteAssetId') : optionalNonEmpty(agent.siteAssetId),
      managedTargetId: mode === 'NATIVE_HANDLER' ? requireNonEmpty(agent.managedTargetId, 'agent.managedTargetId') : optionalNonEmpty(agent.managedTargetId),
      certificateFormatId: optionalNonEmpty(agent.certificateFormatId),
      deploymentMode: optionalNonEmpty(agent.deploymentMode),
      plugin,
    };
    return {
      type: 'AGENT',
      agent: normalized,
      compatibilityMode: resolveCompatibilityMode(pluginBindingId, Boolean(plugin)),
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
    const credentialRefs = normalizeSecretRefRecord(workflow.credentialRefs, 'workflow.credentialRefs');
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
        credentialRefs,
        connectionBindings: normalizeWorkflowConnectionBindings(workflow.connectionBindings),
        parameterBindings: isRecord(workflow.parameterBindings) ? workflow.parameterBindings : workflow.parameterBindings === undefined ? undefined : strategyError('workflow.parameterBindings 必须是对象'),
        certificateArtifactBindings: normalizeCertificateArtifactBindings(workflow.certificateArtifactBindings),
        variableBindings: isRecord(workflow.variableBindings) ? workflow.variableBindings : workflow.variableBindings === undefined ? undefined : strategyError('workflow.variableBindings 必须是对象'),
        rollbackWorkflowVersionId: optionalNonEmpty(workflow.rollbackWorkflowVersionId),
      },
      compatibilityMode: resolveCompatibilityMode(pluginBindingId, true),
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
  if (strategy.type === 'MANAGED_TARGET') assertManagedTargetBindingCompatibility(strategy, binding);
  if (strategy.type === 'AGENT') assertAgentBindingCompatibility(strategy, binding);
  if (strategy.type === 'WORKFLOW') assertWorkflowBindingCompatibility(strategy, binding);
  return strategy;
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
  if (managedTarget.certificateFormatId) {
    const formatIds = [...new Set(Object.values(binding.certificateArtifactBindings).map((item) => item.certificateFormatId))];
    if (formatIds.length !== 1 || formatIds[0] !== managedTarget.certificateFormatId) {
      certificateArtifactBindingConflict('历史 certificateFormatId 与统一证书产物绑定不一致', {
        legacyCertificateFormatId: managedTarget.certificateFormatId,
        bindingCertificateFormatIds: formatIds,
      });
    }
  }
}

function assertAgentBindingCompatibility(strategy: DeploymentStrategyDto, binding: PluginBindingV1): void {
  const agent = strategy.agent!;
  if ((agent.mode ?? 'NATIVE_HANDLER') !== 'PLUGIN') pluginBindingConflict('统一 PluginBinding 只能用于 Agent Plugin 模式');
  if (binding.mode !== 'MANAGED') pluginBindingConflict('Agent Plugin 策略只能引用 Managed PluginBinding');
  if (binding.managedContext?.agentId && binding.managedContext.agentId !== agent.agentId) {
    pluginBindingConflict('PluginBinding 与 Agent 不一致', { strategyAgentId: agent.agentId, bindingAgentId: binding.managedContext.agentId });
  }
  if (!agent.plugin) return;
  if (agent.plugin.pluginVersionId !== binding.pluginVersionId) {
    pluginBindingConflict('历史 Agent Plugin 版本与统一 PluginBinding 不一致', {
      legacyPluginVersionId: agent.plugin.pluginVersionId,
      bindingPluginVersionId: binding.pluginVersionId,
    });
  }
  assertRecordCompatibility('agent.plugin.variableBindings', agent.plugin.variableBindings, binding.variableBindings);
  assertRecordCompatibility('agent.plugin.secretBindings', agent.plugin.secretBindings, binding.secretBindings);
  assertArtifactBindingsCompatibility(agent.plugin.certificateArtifactBindings, binding.certificateArtifactBindings);
}

function assertWorkflowBindingCompatibility(strategy: DeploymentStrategyDto, binding: PluginBindingV1): void {
  const workflow = strategy.workflow!;
  assertRecordCompatibility('workflow.variableBindings', workflow.variableBindings, binding.variableBindings);
  assertRecordCompatibility('workflow.parameterBindings', workflow.parameterBindings, binding.variableBindings);
  assertRecordCompatibility('workflow.credentialRefs', workflow.credentialRefs, binding.secretBindings);
  assertRecordCompatibility('workflow.connectionBindings', workflow.connectionBindings, binding.connectionBindings);
  if (workflow.certificateArtifactBindings) {
    assertArtifactBindingsCompatibility(workflow.certificateArtifactBindings, binding.certificateArtifactBindings);
  }
}

function assertRecordCompatibility(path: string, legacy: Record<string, unknown> | undefined, unified: Record<string, unknown>): void {
  if (legacy === undefined) return;
  if (stableStringify(legacy) !== stableStringify(unified)) {
    pluginBindingConflict(`${path} 与统一 PluginBinding 不一致`, { path });
  }
}

function assertArtifactBindingsCompatibility(
  legacy: NonNullable<DeploymentStrategyDto['workflow']>['certificateArtifactBindings'],
  unified: PluginBindingV1['certificateArtifactBindings'],
): void {
  if (stableStringify(legacy ?? {}) !== stableStringify(unified)) {
    certificateArtifactBindingConflict('历史证书产物绑定与统一 PluginBinding 不一致');
  }
}

function resolveCompatibilityMode(pluginBindingId: string | undefined, hasLegacyConfiguration: boolean): NonNullable<DeploymentStrategyDto['compatibilityMode']> {
  if (!pluginBindingId) return 'LEGACY';
  return hasLegacyConfiguration ? 'LEGACY_ADAPTED' : 'UNIFIED';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

function normalizeAgentPluginBinding(value: unknown): NonNullable<NonNullable<DeploymentStrategyDto['agent']>['plugin']> {
  if (!isRecord(value)) return strategyError('agent.plugin 必须是对象');
  const variableBindings = isRecord(value.variableBindings) ? value.variableBindings : value.variableBindings === undefined ? {} : strategyError('agent.plugin.variableBindings 必须是对象');
  const secretBindings = normalizeSecretRefRecord(value.secretBindings, 'agent.plugin.secretBindings') ?? {};
  const certificateArtifactBindings = normalizeCertificateArtifactBindings(value.certificateArtifactBindings) ?? {};
  return {
    mountId: optionalNonEmpty(value.mountId),
    pluginPackageId: requireNonEmpty(value.pluginPackageId, 'agent.plugin.pluginPackageId'),
    pluginVersionId: requireNonEmpty(value.pluginVersionId, 'agent.plugin.pluginVersionId'),
    variableBindings,
    secretBindings,
    certificateArtifactBindings,
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
      credentialRef: optionalNonEmpty(rawBinding.credentialRef) ?? credential?.id,
      credential,
      expectedHostKeyFingerprint: optionalNonEmpty(rawBinding.expectedHostKeyFingerprint),
    };
    return [name, Object.fromEntries(Object.entries(binding).filter(([, item]) => item !== undefined))];
  }));
}

function normalizeWorkflowCredentialBinding(value: unknown, path: string): NonNullable<NonNullable<DeploymentStrategyDto['workflow']>['connectionBindings']>[string]['credential'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError(`${path} 必须是对象`);
  const id = requireNonEmpty(value.id, `${path}.id`);
  const kind = value.kind;
  const type = value.type;
  if (!['username_password', 'ssh_key', 'curl_bearer', 'curl_api_key'].includes(String(kind))) return strategyError(`${path}.kind 不支持`);
  if (!['password', 'ssh_key', 'api_token'].includes(String(type))) return strategyError(`${path}.type 不支持`);
  const apiKeyIn = value.apiKeyIn;
  if (apiKeyIn !== undefined && apiKeyIn !== 'header' && apiKeyIn !== 'query') return strategyError(`${path}.apiKeyIn 不支持`);
  return {
    id,
    kind: kind as 'username_password' | 'ssh_key' | 'curl_bearer' | 'curl_api_key',
    type: type as 'password' | 'ssh_key' | 'api_token',
    username: optionalNonEmpty(value.username),
    apiKeyName: optionalNonEmpty(value.apiKeyName),
    apiKeyIn,
  };
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

function legacyRelationError(message: string, detail: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'LEGACY_TARGET_RELATION_CONFLICT', ...detail });
}

function pluginBindingConflict(message: string, detail: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'PLUGIN_BINDING_CONFLICT', ...detail });
}

function certificateArtifactBindingConflict(message: string, detail: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', message, { code: 'CERTIFICATE_ARTIFACT_BINDING_CONFLICT', ...detail });
}
