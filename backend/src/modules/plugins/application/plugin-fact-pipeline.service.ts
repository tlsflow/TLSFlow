import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { validateAgentFactEnvelope, type AgentFactEnvelopeV1 } from '../../agents/security/agent-security.contract.js';
import type { PluginRunnerExecuteResult } from '../runner/protocol/protocol.types.js';
import type { StandardDiscoveryProjectionSummary, StandardDeviceDiscoveryProjector } from '../discovery/standard-device-discovery.projector.js';
import type { StandardPluginObject } from '../schema/standard-plugin-object.schema.js';
import { StandardPluginObjectSchemaService } from '../schema/standard-plugin-object.schema.js';
import { newId } from '../../../shared/id.js';
import { canonicalPluginIds, type CanonicalPluginId } from '../canonical-plugin-id/canonical-plugin-id.registry.js';

const discoveryCapabilities = new Set(['application.discover', 'device.discover', 'cloud.service.discover']);
const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/;
const digestPattern = /^[a-f0-9]{64}$/;
export const pluginFactBindingApiVersion = 'gcac.plugin-runner-binding/v1' as const;

/**
 * Agent 事实任务中的唯一插件执行绑定。
 *
 * 租户、Agent、执行运行/步骤和幂等键由 AgentTaskEnvelope 提供，不能从这个
 * 对象或 Agent 回传结果推导。插件输入仍必须包含自己的安全合同和 Workflow
 * 输入快照，宿主只负责固定并转发，不读取插件代码。
 */
export interface PluginFactBindingV1 {
  apiVersion: typeof pluginFactBindingApiVersion;
  hostId: string;
  pluginId: string;
  pluginVersion: string;
  pluginVersionId: string;
  workflowVersionId: string;
  capability: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  planDigest: string;
  grantRefs: string[];
  hostPermissions: string[];
  deadlineAt: string;
  writeEffect: false;
  input: Record<string, unknown>;
}

export interface PluginFactPipelineExecutionInput {
  tenantId: string;
  agentId: string;
  hostId: string;
  executionId: string;
  executionStepId: string;
  pluginId: string;
  pluginVersion: string;
  pluginVersionId: string;
  workflowVersionId: string;
  capability: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  planDigest: string;
  grantRefs: string[];
  hostPermissions: string[];
  idempotencyKey: string;
  deadlineAt: string;
  factEnvelope: unknown;
  input?: Record<string, unknown>;
}

export interface PluginFactRunnerInput {
  tenantId: string;
  executionId: string;
  executionStepId: string;
  workflowVersionId: string;
  planDigest: string;
  pluginId: string;
  pluginVersionId: string;
  pluginVersion: string;
  capability: string;
  input: Record<string, unknown>;
  grantRefs: string[];
  idempotencyKey: string;
  deadlineAt: string;
  writeEffect: false;
  hostPermissions: string[];
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
}

export interface PluginFactRunner {
  execute(input: PluginFactRunnerInput): Promise<PluginRunnerExecuteResult>;
}

/**
 * 只接受任务自身的固定绑定字段，拒绝把旧快照、别名或 Agent 回传字段当作
 * 第二绑定来源。解析成功后返回深拷贝，防止调用方修改任务载荷中的对象。
 */
export function parsePluginFactBinding(value: unknown): PluginFactBindingV1 {
  if (!isRecord(value)) throw new AppError('VALIDATION_FAILED', 'pluginFactBinding 必须是对象');
  const allowedKeys = new Set([
    'apiVersion', 'hostId', 'pluginId', 'pluginVersion', 'pluginVersionId', 'workflowVersionId',
    'capability', 'packageHash', 'manifestHash', 'resourceHash', 'planDigest', 'grantRefs',
    'hostPermissions', 'deadlineAt', 'writeEffect', 'input',
  ]);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) throw new AppError('VALIDATION_FAILED', 'pluginFactBinding 包含未知字段', { unknownKeys });
  if (value.apiVersion !== pluginFactBindingApiVersion) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'pluginFactBinding 版本无效');
  if (value.writeEffect !== false) throw new AppError('PLUGIN_CONTRACT_INVALID', 'pluginFactBinding 只允许只读事实采集');
  if (!isRecord(value.input)) throw new AppError('VALIDATION_FAILED', 'pluginFactBinding.input 必须是对象');
  const binding = {
    apiVersion: value.apiVersion,
    hostId: requireIdentifierValue(value.hostId, 'hostId'),
    pluginId: requireIdentifierValue(value.pluginId, 'pluginId'),
    pluginVersion: requireIdentifierValue(value.pluginVersion, 'pluginVersion'),
    pluginVersionId: requireIdentifierValue(value.pluginVersionId, 'pluginVersionId'),
    workflowVersionId: requireIdentifierValue(value.workflowVersionId, 'workflowVersionId'),
    capability: requireIdentifierValue(value.capability, 'capability'),
    packageHash: requireHashValue(value.packageHash, 'packageHash'),
    manifestHash: requireHashValue(value.manifestHash, 'manifestHash'),
    resourceHash: requireHashValue(value.resourceHash, 'resourceHash'),
    planDigest: requirePlanDigestValue(value.planDigest),
    grantRefs: requireIdentifierArray(value.grantRefs, 'grantRefs', true),
    hostPermissions: requireIdentifierArray(value.hostPermissions, 'hostPermissions', false),
    deadlineAt: requireDeadline(value.deadlineAt),
    writeEffect: false as const,
    input: value.input,
  };
  if (!canonicalPluginIds.includes(binding.pluginId as CanonicalPluginId)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'pluginFactBinding Plugin ID 不是当前 Canonical Plugin ID', { pluginId: binding.pluginId });
  }
  if (!discoveryCapabilities.has(binding.capability)) {
    throw new AppError('CAPABILITY_MISSING', 'pluginFactBinding Capability 不属于只读事实发现', { capability: binding.capability });
  }
  return structuredClone(binding) as PluginFactBindingV1;
}

export interface AtomicPlanOperationV1 {
  operationId: string;
  operationType: string;
  input: Record<string, unknown>;
}

export interface AtomicPlanV1 {
  apiVersion: 'gcac.atomic-plan/v1';
  planId: string;
  tenantId: string;
  agentId: string;
  executionId: string;
  executionStepId: string;
  pluginId: string;
  pluginVersionId: string;
  workflowVersionId: string;
  capability: string;
  planDigest: string;
  atomicPlanDigest: string;
  grantRefs: string[];
  writeEffect: false;
  operations: AtomicPlanOperationV1[];
}

export interface PluginFactPipelineResult {
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  fact: AgentFactEnvelopeV1;
  normalizedObjects: StandardPluginObject[];
  atomicPlan?: AtomicPlanV1;
  projectionSummaries: StandardDiscoveryProjectionSummary[];
  runnerSummary: Record<string, unknown>;
  warnings: PluginRunnerExecuteResult['warnings'];
  error?: PluginRunnerExecuteResult['error'];
}

/**
 * P2 主链的唯一职责是编排事实、Runner 结果、标准对象和计划快照。
 * 产品识别由固定 PluginVersion 的 Runner 完成；宿主不读取映射、不导入 runtime、也不提供回退 detector。
 */
export class PluginFactPipelineService {
  constructor(
    private readonly runner: PluginFactRunner,
    private readonly projector?: Pick<StandardDeviceDiscoveryProjector, 'project'>,
    private readonly objectSchema = new StandardPluginObjectSchemaService(),
  ) {}

  async execute(input: PluginFactPipelineExecutionInput): Promise<PluginFactPipelineResult> {
    void this.runner;
    void this.projector;
    void this.objectSchema;
    throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', 'Fact Pipeline 不得绕过 DSL 直接调用 Plugin Runner；请将发现逻辑迁移到普通 DSL 的 plugin.action 步骤', {
      pluginId: input.pluginId,
      capability: input.capability,
      workflowVersionId: input.workflowVersionId,
    });
  }
}

function buildAtomicPlan(input: PluginFactPipelineExecutionInput, summary: Record<string, unknown>, fact: AgentFactEnvelopeV1): AtomicPlanV1 {
  if (summary.planDigest !== undefined && summary.planDigest !== input.planDigest) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '插件返回的 planDigest 与固定执行绑定不一致');
  }
  const planId = newId('atomic-plan');
  const rawOperations = Array.isArray(summary.operationResults) ? summary.operationResults : [];
  const operations = rawOperations.length > 0
    ? rawOperations.map((item, index) => normalizeOperation(item, index, input.capability))
    : [{ operationId: `${planId}:discover`, operationType: input.capability, input: { factId: fact.factId, factDigest: fact.digest } }];
  const base = {
    apiVersion: 'gcac.atomic-plan/v1' as const,
    planId,
    tenantId: input.tenantId,
    agentId: input.agentId,
    executionId: input.executionId,
    executionStepId: input.executionStepId,
    pluginId: input.pluginId,
    pluginVersionId: input.pluginVersionId,
    workflowVersionId: input.workflowVersionId,
    capability: input.capability,
    planDigest: input.planDigest,
    grantRefs: [...input.grantRefs],
    writeEffect: false as const,
    operations,
  };
  return { ...base, atomicPlanDigest: digest(base) };
}

function normalizeOperation(value: unknown, index: number, fallbackType: string): AtomicPlanOperationV1 {
  if (!isRecord(value)) throw new AppError('VALIDATION_FAILED', '插件 operationResults 必须是对象数组', { index });
  const operationId = typeof value.operationId === 'string' && identifierPattern.test(value.operationId) ? value.operationId : `operation-${index + 1}`;
  const operationType = typeof value.operationType === 'string' && identifierPattern.test(value.operationType) ? value.operationType : fallbackType;
  if (/(shell|cmd|powershell|script|download|exec)/i.test(operationType)) {
    throw new AppError('VALIDATION_FAILED', 'Atomic Plan 禁止任意命令或脚本操作', { operationType });
  }
  return { operationId, operationType, input: isRecord(value.input) ? structuredClone(value.input) : {} };
}

function validateFactInput(input: PluginFactPipelineExecutionInput): AgentFactEnvelopeV1 {
  const fact = validateAgentFactEnvelope(input.factEnvelope);
  if (fact.tenantId !== input.tenantId || fact.agentId !== input.agentId) {
    throw new AppError('TENANT_SCOPE_DENIED', 'Agent Fact 与执行租户或 Agent 不一致');
  }
  return fact;
}

function validatePipelineInput(input: PluginFactPipelineExecutionInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (['factEnvelope', 'input', 'grantRefs', 'hostPermissions'].includes(name)) continue;
    if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_FAILED', `Fact Pipeline ${name} 缺失`);
  }
  for (const [name, value] of [
    ['tenantId', input.tenantId], ['agentId', input.agentId], ['hostId', input.hostId], ['executionId', input.executionId],
    ['executionStepId', input.executionStepId], ['pluginId', input.pluginId], ['pluginVersion', input.pluginVersion],
    ['pluginVersionId', input.pluginVersionId], ['workflowVersionId', input.workflowVersionId], ['capability', input.capability],
    ['idempotencyKey', input.idempotencyKey],
  ] as const) {
    requireIdentifier(value, name);
  }
  if (!canonicalPluginIds.includes(input.pluginId as CanonicalPluginId)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Fact Pipeline Plugin ID 不是当前 Canonical Plugin ID', { pluginId: input.pluginId });
  }
  if (input.input !== undefined && !isRecord(input.input)) {
    throw new AppError('VALIDATION_FAILED', 'Fact Pipeline input 必须是对象');
  }
  for (const [name, value] of [['packageHash', input.packageHash], ['manifestHash', input.manifestHash], ['resourceHash', input.resourceHash]] as const) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `${name} 不是固定摘要`);
  }
  if (!digestPattern.test(input.planDigest)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'planDigest 不是固定摘要');
  if (!Array.isArray(input.grantRefs) || input.grantRefs.length === 0 || new Set(input.grantRefs).size !== input.grantRefs.length || input.grantRefs.some((item) => !identifierPattern.test(item))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Fact Pipeline 缺少唯一 Grant 引用');
  }
  if (!Array.isArray(input.hostPermissions) || new Set(input.hostPermissions).size !== input.hostPermissions.length || input.hostPermissions.some((item) => !identifierPattern.test(item))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Fact Pipeline Host API 权限列表无效');
  }
  if (!Number.isFinite(Date.parse(input.deadlineAt)) || Date.parse(input.deadlineAt) <= Date.now()) {
    throw new AppError('PLUGIN_RUNNER_TIMEOUT', 'Fact Pipeline 执行截止时间无效或已过期');
  }
}

function assertRunnerResultBinding(
  result: PluginRunnerExecuteResult,
  input: PluginFactPipelineExecutionInput,
): void {
  if (result.pluginVersionId !== input.pluginVersionId
    || result.executionId !== input.executionId
    || result.executionStepId !== input.executionStepId) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 结果未绑定当前 PluginVersion 或执行步骤', {
      expected: { pluginVersionId: input.pluginVersionId, executionId: input.executionId, executionStepId: input.executionStepId },
      actual: { pluginVersionId: result.pluginVersionId, executionId: result.executionId, executionStepId: result.executionStepId },
    });
  }
  if (result.tenantId !== input.tenantId) {
    throw new AppError('TENANT_SCOPE_DENIED', 'Runner 结果租户与执行租户不一致');
  }
}

function requireIdentifier(value: string, name: string): string {
  if (!identifierPattern.test(value)) throw new AppError('VALIDATION_FAILED', `${name} 不是固定标识符`);
  return value;
}

function requireIdentifierValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new AppError('VALIDATION_FAILED', `${name} 不是固定标识符`);
  }
  return value;
}

function requireHashValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', `${name} 不是固定 sha256 摘要`);
  }
  return value;
}

function requirePlanDigestValue(value: unknown): string {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'planDigest 不是固定摘要');
  }
  return value;
}

function requireIdentifierArray(value: unknown, name: string, nonEmpty: boolean): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', `${name} 缺失或为空`);
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || !identifierPattern.test(item)) {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', `${name} 包含无效标识`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) throw new AppError('PLUGIN_HOST_CALL_DENIED', `${name} 不得重复`);
  return result;
}

function requireDeadline(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) {
    throw new AppError('PLUGIN_RUNNER_TIMEOUT', 'deadlineAt 无效或已过期');
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
