import { AppError } from '../../../common/errors/app-error.js';
import type {
  ApplicationAssetTargetSummaryDto,
  DeploymentStrategyDto,
  ManagedDeploymentIntentDto,
  ServiceAssetDto,
} from '../dto/assets.dto.js';
import type { PluginBindingV1 } from '../../plugins/dto/plugin-bindings.dto.js';
import {
  INPUT_BINDINGS_API_VERSION,
  type DeploymentConnectionBindingV1,
  type InputBindingsV1,
} from '../../deployment-inputs/dto/input-bindings.dto.js';

const deploymentStrategyKeys = new Set(['type', 'managedTarget', 'workflow', 'compatibilityMode', 'updatedAt', 'updatedBy']);
const managedTargetStrategyKeys = new Set(['managedTargetId', 'certificateFormatId', 'executionMode', 'workflowExecutionBindingId']);
const workflowStrategyKeys = new Set([
  'workflowExecutionBindingId',
  'pluginBindingId',
  'workflowId',
  'workflowVersionSelection',
  'workflowVersionId',
  'runner',
  'gatewayId',
  'target',
  'credentials',
  'inputBindings',
  'executionBranch',
  'rollbackWorkflowVersionId',
]);
const workflowTargetKeys = new Set(['frameworkType', 'siteName', 'bindingInformation', 'hostHeader', 'port', 'protocol', 'verifyUrl', 'sniName']);

export interface DeploymentStrategyContext {
  asset: Pick<ServiceAssetDto, 'id' | 'metadata'>;
  targetBinding?: Pick<ApplicationAssetTargetSummaryDto, 'managedTargetId'>;
  actorId?: string;
  now?: string;
}

export function normalizeDeploymentStrategy(input: DeploymentStrategyDto, context: DeploymentStrategyContext): DeploymentStrategyDto {
  if (!input || typeof input !== 'object') throw new AppError('VALIDATION_FAILED', 'deploymentStrategy 必须是对象');
  rejectUnknown(input as unknown as Record<string, unknown>, deploymentStrategyKeys, 'deploymentStrategy');
  const now = context.now ?? new Date().toISOString();
  if (input.type === 'MANAGED_TARGET') {
    const managedTarget = input.managedTarget;
    if (!managedTarget) throw strategyError('MANAGED_TARGET 策略必须提供 managedTarget 配置');
    rejectUnknown(managedTarget as unknown as Record<string, unknown>, managedTargetStrategyKeys, 'managedTarget');
    const managedTargetId = requireNonEmpty(managedTarget.managedTargetId, 'managedTarget.managedTargetId');
    const certificateFormatId = optionalNonEmpty(managedTarget.certificateFormatId);
    const executionMode = managedTarget.executionMode ?? 'PLUGIN';
    const workflowExecutionBindingId = optionalNonEmpty(managedTarget.workflowExecutionBindingId);
    if (executionMode !== 'PLUGIN' && executionMode !== 'WORKFLOW_OVERRIDE') throw strategyError('managedTarget.executionMode 只支持 PLUGIN/WORKFLOW_OVERRIDE');
    if (executionMode === 'PLUGIN' && workflowExecutionBindingId) throw strategyError('PLUGIN 模式不得引用 WorkflowExecutionBinding');
    if (executionMode === 'WORKFLOW_OVERRIDE' && !workflowExecutionBindingId) throw strategyError('WORKFLOW_OVERRIDE 模式必须引用 WorkflowExecutionBinding');
    return {
      type: 'MANAGED_TARGET',
      managedTarget: { managedTargetId, ...(certificateFormatId ? { certificateFormatId } : {}), executionMode, ...(workflowExecutionBindingId ? { workflowExecutionBindingId } : {}) },
      compatibilityMode: 'UNIFIED',
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }
  if (input.type === 'WORKFLOW') {
    const workflow = input.workflow;
    if (!workflow) throw strategyError('WORKFLOW 策略必须提供 workflow 配置');
    rejectUnknown(workflow as unknown as Record<string, unknown>, workflowStrategyKeys, 'workflow');
    const workflowExecutionBindingId = optionalNonEmpty(workflow.workflowExecutionBindingId);
    if (workflowExecutionBindingId && workflow.pluginBindingId) throw strategyError('WORKFLOW 策略不得同时引用 WorkflowExecutionBinding 和 PluginBinding');
    if (workflowExecutionBindingId) {
      return {
        type: 'WORKFLOW',
        workflow: { workflowExecutionBindingId },
        compatibilityMode: 'UNIFIED',
        updatedAt: now,
        updatedBy: context.actorId,
      };
    }
    const pluginBindingId = optionalNonEmpty(workflow.pluginBindingId);
    const runner = workflow.runner;
    if (runner !== 'CONTROL_PLANE' && runner !== 'GATEWAY') throw strategyError('workflow.runner 只支持 CONTROL_PLANE/GATEWAY');
    if (runner === 'GATEWAY' && !optionalNonEmpty(workflow.gatewayId)) throw strategyError('runner=GATEWAY 时 gatewayId 必填');
    const executionBranch = workflow.executionBranch ?? 'deploy';
    if (executionBranch !== 'deploy' && executionBranch !== 'rollback') throw strategyError('workflow.executionBranch 只支持 deploy/rollback');
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
        inputBindings: pluginBindingId ? undefined : normalizeInputBindingsV1(workflow.inputBindings),
        executionBranch,
        rollbackWorkflowVersionId: optionalNonEmpty(workflow.rollbackWorkflowVersionId),
      },
      compatibilityMode: 'UNIFIED',
      updatedAt: now,
      updatedBy: context.actorId,
    };
  }

  throw strategyError('deploymentStrategy.type 只支持 MANAGED_TARGET/WORKFLOW');
}

export function getDeploymentStrategyPluginBindingId(strategy: DeploymentStrategyDto): string | undefined {
  if (strategy.type === 'MANAGED_TARGET') return undefined;
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
      compatibilityMode: 'UNIFIED',
    };
  }
  return {
    ...strategy,
    workflow: {
      ...strategy.workflow!,
      inputBindings: binding.inputBindings,
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

export function normalizeManagedDeploymentIntent(strategy: DeploymentStrategyDto, context: DeploymentStrategyContext): ManagedDeploymentIntentDto | undefined {
  const normalized = normalizeDeploymentStrategy(strategy, context);
  if (normalized.type === 'MANAGED_TARGET') {
    return {
      type: 'MANAGED_TARGET',
      managedTargetId: normalized.managedTarget!.managedTargetId,
    };
  }
  return undefined;
}

function normalizeInputBindingsV1(value: unknown): InputBindingsV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError('workflow.inputBindings 必须是对象');
  rejectUnknown(value, new Set(['apiVersion', 'variables', 'connections', 'credentials', 'artifacts']), 'workflow.inputBindings');
  if (value.apiVersion !== INPUT_BINDINGS_API_VERSION) {
    return strategyError(`workflow.inputBindings.apiVersion 只支持 ${INPUT_BINDINGS_API_VERSION}`);
  }
  const variables = requireRecord(value.variables, 'workflow.inputBindings.variables');
  const connections = normalizeInputConnections(requireRecord(value.connections, 'workflow.inputBindings.connections'));
  const credentials = normalizeInputCredentials(requireRecord(value.credentials, 'workflow.inputBindings.credentials'));
  const artifacts = normalizeInputArtifacts(requireRecord(value.artifacts, 'workflow.inputBindings.artifacts'));
  return { apiVersion: INPUT_BINDINGS_API_VERSION, variables, connections, credentials, artifacts };
}

function normalizeInputConnections(value: Record<string, unknown>): Record<string, DeploymentConnectionBindingV1> {
  return Object.fromEntries(Object.entries(value).map(([name, rawBinding]) => {
    const path = `workflow.inputBindings.connections.${name}`;
    if (!isRecord(rawBinding)) return strategyError(`${path} 必须是对象`);
    rejectUnknown(rawBinding, new Set(['host', 'port', 'username', 'tls', 'hostKey']), path);
    const port = rawBinding.port === undefined ? undefined : Number(rawBinding.port);
    if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
      return strategyError(`${path}.port 必须是有效端口`);
    }
    const binding = {
      host: optionalNonEmpty(rawBinding.host),
      port,
      username: optionalNonEmpty(rawBinding.username),
      tls: normalizeConnectionTls(rawBinding.tls, `${path}.tls`),
      hostKey: normalizeConnectionHostKey(rawBinding.hostKey, `${path}.hostKey`),
    };
    return [name, Object.fromEntries(Object.entries(binding).filter(([, item]) => item !== undefined))];
  }));
}

function normalizeConnectionTls(value: unknown, path: string): DeploymentConnectionBindingV1['tls'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['verifyPeer', 'serverName']), path);
  if (value.verifyPeer !== undefined && typeof value.verifyPeer !== 'boolean') return strategyError(`${path}.verifyPeer 必须是布尔值`);
  return { verifyPeer: value.verifyPeer as boolean | undefined, serverName: optionalNonEmpty(value.serverName) };
}

function normalizeConnectionHostKey(value: unknown, path: string): DeploymentConnectionBindingV1['hostKey'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return strategyError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['expectedFingerprint']), path);
  return { expectedFingerprint: optionalNonEmpty(value.expectedFingerprint) };
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
  const managedTargetId = optionalNonEmpty(context.targetBinding?.managedTargetId);
  return managedTargetId
    ? normalizeDeploymentStrategy({ type: 'MANAGED_TARGET', managedTarget: { managedTargetId } }, context)
    : undefined;
}

export function writeDeploymentStrategyMetadata(metadata: Record<string, unknown>, strategy: DeploymentStrategyDto): Record<string, unknown> {
  return { ...metadata, deploymentStrategy: strategy };
}

export function readStoredDeploymentStrategy(metadata: Record<string, unknown>): DeploymentStrategyDto | undefined {
  const value = metadata.deploymentStrategy;
  if (!isRecord(value)) return undefined;
  return value as unknown as DeploymentStrategyDto;
}

function normalizeInputCredentials(value: Record<string, unknown>): InputBindingsV1['credentials'] {
  return Object.fromEntries(Object.entries(value).map(([slot, binding]) => {
    const path = `workflow.inputBindings.credentials.${slot}`;
    if (!isRecord(binding) || typeof binding.credentialId !== 'string' || !binding.credentialId.trim()) {
      throw strategyError(`${path}.credentialId 不能为空`);
    }
    rejectUnknown(binding, new Set(['credentialId']), path);
    return [slot, { credentialId: binding.credentialId.trim() }];
  }));
}

function normalizeInputArtifacts(value: Record<string, unknown>): InputBindingsV1['artifacts'] {
  const output: InputBindingsV1['artifacts'] = {};
  for (const [slot, binding] of Object.entries(value)) {
    const path = `workflow.inputBindings.artifacts.${slot}`;
    if (!isRecord(binding)) throw strategyError(`${path} 必须是对象`);
    rejectUnknown(binding, new Set(['certificateFormatId', 'outputBindings']), path);
    if (!isRecord(binding.outputBindings)) throw strategyError(`${path}.outputBindings 必须是对象`);
    const outputBindings: Record<string, string> = {};
    for (const [outputName, outputKey] of Object.entries(binding.outputBindings)) {
      outputBindings[outputName] = requireNonEmpty(outputKey, `${path}.outputBindings.${outputName}`);
    }
    output[slot] = {
      certificateFormatId: optionalNonEmpty(binding.certificateFormatId),
      outputBindings,
    };
  }
  return output;
}

function requireNonEmpty(value: unknown, field: string): string {
  const normalized = optionalNonEmpty(value);
  if (!normalized) throw strategyError(`${field} 必填`);
  return normalized;
}

function normalizeWorkflowTarget(value: unknown): NonNullable<DeploymentStrategyDto['workflow']>['target'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw strategyError('workflow.target 必须是对象');
  rejectUnknown(value, workflowTargetKeys, 'workflow.target');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw strategyError(`${path} 必须是对象`);
  return value;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw strategyError(`${path} 包含未知字段: ${unknown.join(', ')}`);
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
