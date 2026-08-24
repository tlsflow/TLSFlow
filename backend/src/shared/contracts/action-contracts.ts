import type { CapabilityConstraint } from './capability-contracts.js';

export const ACTION_CONTRACT_SCHEMA_VERSION = 'gcac.action/v1' as const;

export const AgentProductLines = [
  'windows-modern',
  'windows-compatibility',
  'linux-modern',
  'linux-compatibility',
  'gateway',
] as const;

export type AgentProductLine = (typeof AgentProductLines)[number];

export const ActionErrorCodes = [
  'ACTION_CONTRACT_INVALID',
  'ACTION_HANDLER_NOT_REGISTERED',
  'ACTION_SCHEMA_UNSUPPORTED',
  'ACTION_ALIAS_CONFLICT',
  'ACTION_ALIAS_DEPRECATED',
  'CAPABILITY_SNAPSHOT_REQUIRED',
  'CAPABILITY_REQUIREMENT_UNSATISFIED',
  'ACTION_PERMISSION_DENIED',
  'ACTION_IDEMPOTENCY_CONFLICT',
  'ACTION_TIMEOUT',
  'ACTION_CANCELLED',
  'OPERATION_RESULT_UNKNOWN',
  'VERIFICATION_REQUIRED',
  'RECOVERY_REQUIRED',
  'INTERNAL_ERROR',
] as const;

export type ActionErrorCode = (typeof ActionErrorCodes)[number];
export type ActionResultStatus = 'completed' | 'failed' | 'cancelled' | 'recovery_required';
export type ActionProgressStatus = 'accepted' | 'running' | 'retrying' | 'recovering' | 'verifying';
export type RecoveryState = 'available' | 'in_progress' | 'completed' | 'failed' | 'manual_required';

export interface AgentProductIdentity {
  productLine: AgentProductLine;
  productVersion: string;
  runtimeName: string;
  runtimeVersion: string;
}

export interface CapabilitySnapshotReference {
  snapshotId: string;
  snapshotVersion: string;
  capturedAt: string;
}

export interface ActionTarget {
  targetType: string;
  targetId: string;
}

export interface ActionAuditContext {
  tenantId: string;
  requestId: string;
  correlationId: string;
  executionRunId?: string;
  executionStepId?: string;
  initiatedBy?: string;
}

export interface ActionRecoveryReference {
  ledgerId: string;
  state: RecoveryState;
  rollbackAvailable: boolean;
  resumeToken?: string;
  lastCheckpoint?: string;
}

export interface ActionExecutionEvidence {
  evidenceType: string;
  summary: string;
  observedAt: string;
  reference?: string;
  details?: Record<string, unknown>;
}

export interface ActionError {
  code: ActionErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ActionRequest<TInput = Record<string, unknown>> {
  schemaVersion: typeof ACTION_CONTRACT_SCHEMA_VERSION;
  actionType: string;
  actionSchemaVersion: string;
  requestId: string;
  idempotencyKey: string;
  agentProduct: AgentProductIdentity;
  capabilitySnapshotRef: CapabilitySnapshotReference;
  target: ActionTarget;
  input: TInput;
  requiredCapabilities: CapabilityConstraint[];
  dryRun: boolean;
  audit: ActionAuditContext;
  recovery?: ActionRecoveryReference;
}

export interface ActionProgress<TDetail = Record<string, unknown>> {
  schemaVersion: typeof ACTION_CONTRACT_SCHEMA_VERSION;
  actionType: string;
  actionSchemaVersion: string;
  requestId: string;
  sequence: number;
  status: ActionProgressStatus;
  progressPercent: number;
  messageCode: string;
  agentProduct: AgentProductIdentity;
  capabilitySnapshotRef: CapabilitySnapshotReference;
  audit: ActionAuditContext;
  detail?: TDetail;
  evidence: ActionExecutionEvidence[];
  recovery?: ActionRecoveryReference;
}

export interface ActionResult<TDetail = Record<string, unknown>> {
  schemaVersion: typeof ACTION_CONTRACT_SCHEMA_VERSION;
  actionType: string;
  actionSchemaVersion: string;
  requestId: string;
  success: boolean;
  status: ActionResultStatus;
  agentProduct: AgentProductIdentity;
  capabilitySnapshotRef: CapabilitySnapshotReference;
  audit: ActionAuditContext;
  detail?: TDetail;
  evidence: ActionExecutionEvidence[];
  error?: ActionError;
  recovery?: ActionRecoveryReference;
}

export type ActionAliasStatus = 'active' | 'deprecated';

export interface ActionAliasDefinition {
  legacyActionType: string;
  legacySchemaVersions: string[];
  canonicalActionType: string;
  canonicalSchemaVersion: string;
  status: ActionAliasStatus;
  deprecatedAt?: string;
  removeAfter?: string;
}

export interface ResolvedActionAlias {
  requestedActionType: string;
  requestedSchemaVersion: string;
  actionType: string;
  actionSchemaVersion: string;
  aliased: boolean;
  deprecated: boolean;
}

export class ActionContractError extends Error {
  constructor(
    public readonly errorCode: ActionErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ActionContractError';
  }
}

/**
 * 旧任务名只在注册表中迁移，执行器和 Agent 主循环不得各自维护别名分支。
 */
export class ActionAliasRegistry {
  private readonly aliases = new Map<string, ActionAliasDefinition>();

  constructor(definitions: ActionAliasDefinition[]) {
    for (const definition of definitions) this.register(definition);
  }

  resolve(actionType: string, actionSchemaVersion: string): ResolvedActionAlias {
    const alias = this.aliases.get(normalizeActionType(actionType));
    if (!alias) {
      return {
        requestedActionType: actionType,
        requestedSchemaVersion: actionSchemaVersion,
        actionType,
        actionSchemaVersion,
        aliased: false,
        deprecated: false,
      };
    }
    if (!alias.legacySchemaVersions.includes(actionSchemaVersion)) {
      throw new ActionContractError('ACTION_SCHEMA_UNSUPPORTED', '旧任务版本不在别名兼容范围内', {
        actionType,
        actionSchemaVersion,
        supportedVersions: alias.legacySchemaVersions,
      });
    }
    return {
      requestedActionType: actionType,
      requestedSchemaVersion: actionSchemaVersion,
      actionType: alias.canonicalActionType,
      actionSchemaVersion: alias.canonicalSchemaVersion,
      aliased: true,
      deprecated: alias.status === 'deprecated',
    };
  }

  list(): ActionAliasDefinition[] {
    return [...this.aliases.values()]
      .map((item) => ({ ...item, legacySchemaVersions: [...item.legacySchemaVersions] }))
      .sort((left, right) => left.legacyActionType.localeCompare(right.legacyActionType));
  }

  private register(definition: ActionAliasDefinition): void {
    validateActionAliasDefinition(definition);
    const key = normalizeActionType(definition.legacyActionType);
    const existing = this.aliases.get(key);
    if (existing) {
      throw new ActionContractError('ACTION_ALIAS_CONFLICT', '旧任务别名重复注册', {
        legacyActionType: definition.legacyActionType,
        existingCanonicalActionType: existing.canonicalActionType,
        conflictingCanonicalActionType: definition.canonicalActionType,
      });
    }
    this.aliases.set(key, {
      ...definition,
      legacyActionType: key,
      legacySchemaVersions: [...new Set(definition.legacySchemaVersions)].sort(),
    });
  }
}

export function parseActionRequest(input: unknown): ActionRequest {
  const value = requireRecord(input, 'ActionRequest');
  validateEnvelope(value);
  requireString(value, 'idempotencyKey');
  requireRecord(value.input, 'input');
  requireBoolean(value, 'dryRun');
  if (!Array.isArray(value.requiredCapabilities)) invalid('requiredCapabilities 必须是数组');
  return value as unknown as ActionRequest;
}

export function parseActionProgress(input: unknown): ActionProgress {
  const value = requireRecord(input, 'ActionProgress');
  validateEnvelope(value);
  requireInteger(value, 'sequence', 0);
  requireNumber(value, 'progressPercent', 0, 100);
  requireEnum(value, 'status', ['accepted', 'running', 'retrying', 'recovering', 'verifying']);
  requireString(value, 'messageCode');
  validateEvidence(value.evidence);
  if (value.recovery !== undefined) validateRecovery(value.recovery);
  return value as unknown as ActionProgress;
}

export function parseActionResult(input: unknown): ActionResult {
  const value = requireRecord(input, 'ActionResult');
  validateEnvelope(value);
  requireBoolean(value, 'success');
  requireEnum(value, 'status', ['completed', 'failed', 'cancelled', 'recovery_required']);
  validateEvidence(value.evidence);
  if (value.error !== undefined) validateActionError(value.error);
  if (value.recovery !== undefined) validateRecovery(value.recovery);
  if (value.status === 'completed' && value.success !== true) invalid('completed 结果必须 success=true');
  if (value.status !== 'completed' && value.success !== false) invalid('非 completed 结果必须 success=false');
  if (value.status === 'failed' && value.error === undefined) invalid('failed 结果必须包含标准错误');
  if (value.status === 'recovery_required' && value.recovery === undefined) invalid('recovery_required 结果必须包含恢复信息');
  return value as unknown as ActionResult;
}

function validateEnvelope(value: Record<string, unknown>): void {
  if (value.schemaVersion !== ACTION_CONTRACT_SCHEMA_VERSION) {
    throw new ActionContractError('ACTION_SCHEMA_UNSUPPORTED', '不支持的 Action Contract Schema Version', {
      received: value.schemaVersion,
      supported: [ACTION_CONTRACT_SCHEMA_VERSION],
    });
  }
  const actionType = requireString(value, 'actionType');
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(actionType)) invalid('actionType 格式无效');
  const actionSchemaVersion = requireString(value, 'actionSchemaVersion');
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(actionSchemaVersion)) invalid('actionSchemaVersion 必须使用数字版本');
  requireString(value, 'requestId');
  validateAgentProduct(value.agentProduct);
  validateCapabilitySnapshotReference(value.capabilitySnapshotRef);
  validateAuditContext(value.audit);
}

function validateAgentProduct(input: unknown): void {
  const value = requireRecord(input, 'agentProduct');
  requireEnum(value, 'productLine', AgentProductLines);
  requireString(value, 'productVersion');
  requireString(value, 'runtimeName');
  requireString(value, 'runtimeVersion');
}

function validateCapabilitySnapshotReference(input: unknown): void {
  const value = requireRecord(input, 'capabilitySnapshotRef');
  requireString(value, 'snapshotId');
  requireString(value, 'snapshotVersion');
  requireIsoDate(value, 'capturedAt');
}

function validateAuditContext(input: unknown): void {
  const value = requireRecord(input, 'audit');
  requireString(value, 'tenantId');
  requireString(value, 'requestId');
  requireString(value, 'correlationId');
}

function validateRecovery(input: unknown): void {
  const value = requireRecord(input, 'recovery');
  requireString(value, 'ledgerId');
  requireEnum(value, 'state', ['available', 'in_progress', 'completed', 'failed', 'manual_required']);
  requireBoolean(value, 'rollbackAvailable');
}

function validateEvidence(input: unknown): void {
  if (!Array.isArray(input)) invalid('evidence 必须是数组');
  for (const item of input) {
    const value = requireRecord(item, 'evidence item');
    requireString(value, 'evidenceType');
    requireString(value, 'summary');
    requireIsoDate(value, 'observedAt');
  }
}

function validateActionError(input: unknown): void {
  const value = requireRecord(input, 'error');
  requireEnum(value, 'code', ActionErrorCodes);
  requireString(value, 'message');
  requireBoolean(value, 'retryable');
}

function validateActionAliasDefinition(definition: ActionAliasDefinition): void {
  if (!definition.legacyActionType || !definition.canonicalActionType) invalid('别名动作名称不能为空');
  if (normalizeActionType(definition.legacyActionType) === normalizeActionType(definition.canonicalActionType)) {
    invalid('旧任务别名不能指向自身');
  }
  if (definition.legacySchemaVersions.length === 0) invalid('旧任务别名必须声明兼容版本');
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(definition.canonicalSchemaVersion)) invalid('别名目标版本格式无效');
  if (definition.status === 'deprecated' && !definition.deprecatedAt) invalid('deprecated 别名必须声明 deprecatedAt');
  if (definition.deprecatedAt) requireIsoDate({ deprecatedAt: definition.deprecatedAt }, 'deprecatedAt');
  if (definition.removeAfter) requireIsoDate({ removeAfter: definition.removeAfter }, 'removeAfter');
}

function normalizeActionType(value: string): string {
  return value.trim().toLowerCase();
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`${field} 必须是对象`);
  return input as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} 必须是非空字符串`);
  return value;
}

function requireBoolean(input: Record<string, unknown>, field: string): boolean {
  const value = input[field];
  if (typeof value !== 'boolean') invalid(`${field} 必须是布尔值`);
  return value;
}

function requireInteger(input: Record<string, unknown>, field: string, minimum: number): number {
  const value = input[field];
  if (!Number.isInteger(value) || (value as number) < minimum) invalid(`${field} 必须是不小于 ${minimum} 的整数`);
  return value as number;
}

function requireNumber(input: Record<string, unknown>, field: string, minimum: number, maximum: number): number {
  const value = input[field];
  if (typeof value !== 'number' || value < minimum || value > maximum) invalid(`${field} 必须位于 ${minimum}-${maximum}`);
  return value;
}

function requireEnum<T extends string>(input: Record<string, unknown>, field: string, values: readonly T[]): T {
  const value = input[field];
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(`${field} 不在允许范围内`);
  return value as T;
}

function requireIsoDate(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (Number.isNaN(Date.parse(value))) invalid(`${field} 必须是有效时间`);
  return value;
}

function invalid(message: string): never {
  throw new ActionContractError('ACTION_CONTRACT_INVALID', message);
}
