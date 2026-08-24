import { AppError } from '../../../common/errors/app-error.js';
import type { WriteAuditInput } from '../../audits/audit.service.js';
import type { CertificateArtifactStore } from '../../certificates/artifacts/certificate-artifact-store.js';
import { ExecutionDetailStreamService } from '../../executions/application/execution-detail-stream.service.js';
import { PluginResourceLockService } from '../../executions/application/plugin-resource-lock.service.js';
import { WorkflowRecoveryLedgerService } from '../../executions/application/workflow-recovery-ledger.service.js';
import type { ExecutionsRepository } from '../../executions/repository/executions.repository.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { AgentTaskLogEntry } from '../../agents/schema/agents.schema.js';
import { assertHostApiGrant, getHostApiMethod, validateHostApiRequest, type HostApiMethodDefinition } from './protocol/host-api.registry.js';
import type { PluginRunnerHostApiHandler, PluginRunnerHostCallContext } from './plugin-runner-client.js';

export interface PluginRunnerHostApiDependencies {
  security: Pick<SecurityServices, 'audit' | 'grants' | 'secrets'>;
  artifacts: Pick<CertificateArtifactStore, 'get'>;
  resourceLocks: Pick<PluginResourceLockService, 'acquire' | 'release'>;
  workflowRecovery: Pick<WorkflowRecoveryLedgerService, 'begin' | 'recordCheckpoint' | 'get' | 'getCheckpoint'>;
  executionDetails: Pick<ExecutionDetailStreamService, 'publishLog'>;
  executions: Pick<ExecutionsRepository, 'getRunOrThrow' | 'getStepOrThrow'>;
}

/**
 * Plugin Runner 只能通过这组登记的宿主能力访问控制面。
 * 调用上下文由固定的 Runner 执行绑定派生，插件消息不能自行覆盖。
 */
export function createPluginRunnerHostApiHandler(dependencies: PluginRunnerHostApiDependencies): PluginRunnerHostApiHandler {
  return async (context) => {
    const definition = getHostApiMethod(context.method);
    let input = context.input;
    try {
      input = validateHostApiRequest(context.method, context.input);
      assertContextBinding(context);
      assertHostApiGrant(context.method, context.hostPermissions, context.grantRefs);
      const grants = await validateBoundGrants(dependencies, context, definition);
      assertInputGrantBinding(context, input);
      const output = await dispatchHostApiCall(dependencies, context, definition, input, grants);
      await writeHostCallAudit(dependencies, context, definition, input, 'success');
      return output;
    } catch (error) {
      await writeHostCallAudit(dependencies, context, definition, input, error instanceof AppError && error.errorCode === 'PLUGIN_HOST_CALL_DENIED' ? 'denied' : 'failure', error);
      throw error;
    }
  };
}

async function validateBoundGrants(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
) {
  const grants = await Promise.all(context.grantRefs.map((grantId) => dependencies.security.grants.validate({
    grantId,
    tenantId: context.tenantId,
    runId: context.executionId,
    stepId: context.executionStepId,
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    executorType: 'PLUGIN_RUNNER',
  })));
  if (!grants.some((grant) => definition.requiredGrants.every((requiredGrant) => grant.allowedActions.includes(requiredGrant)))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API Grant 未覆盖注册权限', { method: context.method });
  }
  return grants;
}

async function dispatchHostApiCall(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  switch (context.method) {
    case 'artifact.grant.read':
      return await readArtifact(dependencies, context, input, grants);
    case 'secret.grant.resolve':
      return await resolveSecret(dependencies, context, input, grants);
    case 'execution.progress':
      return publishProgress(dependencies, context, input);
    case 'execution.checkpoint.save':
      return await saveCheckpoint(dependencies, context, input);
    case 'execution.checkpoint.load':
      return await loadCheckpoint(dependencies, context, input);
    case 'execution.isCancelled':
      return await readCancellation(dependencies, context);
    case 'resourceLock.acquire':
      return await acquireResourceLock(dependencies, context, input);
    case 'resourceLock.release':
      return await releaseResourceLock(dependencies, context, input);
    case 'audit.append':
      return await appendPluginAudit(dependencies, context, input);
    default:
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 方法未注册生产处理器', { method: definition.method });
  }
}

async function readArtifact(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const artifactRef = stringValue(input.artifactRef, 'artifactRef');
  assertSelectedGrant(context, grants, grantId, 'artifact.read');
  await dependencies.security.grants.validate({
    grantId,
    tenantId: context.tenantId,
    runId: context.executionId,
    stepId: context.executionStepId,
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    executorType: 'PLUGIN_RUNNER',
    artifactRef,
    action: 'artifact.read',
  });
  const artifact = await dependencies.artifacts.get(artifactRef, context.tenantId);
  if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '授权制品不存在或不属于当前租户', { artifactRef });
  return {
    ok: true,
    data: {
      artifactRef: artifact.artifactRef,
      contentBase64: artifact.content.toString('base64'),
      contentType: artifact.contentType,
      sha256: artifact.sha256,
      ...(artifact.expiresAt ? { expiresAt: artifact.expiresAt } : {}),
    },
  };
}

async function resolveSecret(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const secretRef = stringValue(input.secretRef, 'secretRef');
  const purpose = stringValue(input.purpose, 'purpose');
  assertSelectedGrant(context, grants, grantId, 'secret.resolve');
  const resolved = await dependencies.security.secrets.resolveForExecution({
    grantId,
    secretRef,
    purpose,
    runId: context.executionId,
    stepId: context.executionStepId,
    executorType: 'PLUGIN_RUNNER',
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    actorId: context.pluginId,
    context: { tenantId: context.tenantId },
  });
  // IPC 结果只返回可审计的句柄，绝不把 Secret 明文带入 Runner 日志或结果。
  return { ok: true, data: { secretRef: resolved.secretRef, versionId: resolved.versionId, fingerprint: resolved.fingerprint, value: '[REDACTED]' } };
}

function publishProgress(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
): Record<string, unknown> {
  assertExecutionInputBinding(context, input);
  const sequence = numberValue(input.sequence, 'sequence');
  const entry: AgentTaskLogEntry = {
    id: `plugin-runner-progress:${context.executionId}:${context.executionStepId}:${sequence}`,
    tenantId: context.tenantId,
    agentId: `plugin-runner:${context.pluginVersionId}`,
    taskId: context.executionStepId,
    sequence,
    level: 'info',
    message: stringValue(input.summary, 'summary'),
    redacted: true,
    emittedAt: new Date().toISOString(),
    requestId: `plugin-runner:${context.executionId}:${context.executionStepId}`,
  };
  dependencies.executionDetails.publishLog(context.executionId, context.tenantId, entry);
  return { ok: true, data: { accepted: true, sequence, stage: stringValue(input.stage, 'stage') } };
}

async function saveCheckpoint(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertExecutionInputBinding(context, input);
  const ledger = await beginRecoveryLedger(dependencies, context);
  const digest = stringValue(input.digest, 'digest');
  const checkpoint = await dependencies.workflowRecovery.recordCheckpoint({
    tenantId: context.tenantId,
    ledgerId: ledger.id,
    checkpointName: `plugin-runner:${digest}`,
    workflowStepName: context.executionStepId,
    capture: recordValue(input.payload, 'payload'),
    captureHash: digest,
    requiredForRollback: false,
  });
  return { ok: true, data: { checkpointRef: checkpoint.id, digest: checkpoint.captureHash } };
}

async function loadCheckpoint(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ledger = await beginRecoveryLedger(dependencies, context);
  const checkpoint = await dependencies.workflowRecovery.getCheckpoint(context.tenantId, stringValue(input.checkpointRef, 'checkpointRef'));
  if (checkpoint.ledgerId !== ledger.id) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'checkpoint 不属于当前 Runner 执行绑定');
  return { ok: true, data: { checkpointRef: checkpoint.id, payload: checkpoint.capture, digest: checkpoint.captureHash } };
}

async function readCancellation(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext): Promise<Record<string, unknown>> {
  const [run, step] = await Promise.all([
    dependencies.executions.getRunOrThrow(context.executionId, context.tenantId),
    dependencies.executions.getStepOrThrow(context.executionStepId, context.tenantId),
  ]);
  if (step.executionRunId !== context.executionId) throw new AppError('PLUGIN_HOST_CALL_DENIED', '执行步骤不属于当前运行');
  return { ok: true, data: { cancelled: run.status === 'CANCELLED' } };
}

async function acquireResourceLock(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertLockOwnerBinding(context, input);
  const record = await dependencies.resourceLocks.acquire({
    tenantId: context.tenantId,
    resourceKey: normalizePluginLockKey(context.tenantId, stringValue(input.resourceKey, 'resourceKey')),
    mode: 'WRITE',
    ownerRunId: context.executionId,
    ownerStepId: context.executionStepId,
    ttlSeconds: numberValue(input.ttlSeconds, 'ttlSeconds'),
  });
  return { ok: true, data: { lockId: record.id } };
}

async function releaseResourceLock(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertLockOwnerBinding(context, input);
  await dependencies.resourceLocks.release({
    tenantId: context.tenantId,
    lockId: stringValue(input.lockId, 'lockId'),
    ownerRunId: context.executionId,
    ownerStepId: context.executionStepId,
  });
  return { ok: true };
}

async function appendPluginAudit(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await dependencies.security.audit.write({
    eventType: stringValue(input.eventType, 'eventType'),
    actorType: 'system',
    actorId: context.pluginId,
    action: stringValue(input.action, 'action'),
    resourceType: stringValue(input.resourceType, 'resourceType'),
    resourceId: stringValue(input.resourceId, 'resourceId'),
    result: input.result as WriteAuditInput['result'],
    riskLevel: 'medium',
    context: { tenantId: context.tenantId },
    detail: recordValue(input.detail ?? {}, 'detail'),
    failClosed: true,
  });
  return { ok: true };
}

async function beginRecoveryLedger(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext) {
  return await dependencies.workflowRecovery.begin({
    tenantId: context.tenantId,
    executionRunId: context.executionId,
    executionStepId: context.executionStepId,
    pluginVersionId: context.pluginVersionId,
    workflowVersionId: context.workflowVersionId,
    capabilityKey: context.capability,
    target: {},
    plan: { planDigest: context.planDigest },
    runtimeInput: {},
  });
}

function assertContextBinding(context: PluginRunnerHostCallContext): void {
  if (!context.tenantId || !context.executionId || !context.executionStepId || !context.workflowVersionId || !context.pluginVersionId || !context.pluginId || !context.capability) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API 缺少固定执行绑定');
  }
  if (!/^[a-f0-9]{64}$/.test(context.planDigest)) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API planDigest 无效');
}

function assertInputGrantBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): void {
  if (!('grantId' in input)) return;
  const grantId = stringValue(input.grantId, 'grantId');
  if (!context.grantRefs.includes(grantId)) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入 Grant 未绑定到当前执行');
}

function assertSelectedGrant(context: PluginRunnerHostCallContext, grants: Array<{ id: string; allowedActions: string[] }>, grantId: string, action: string): void {
  const grant = grants.find((item) => item.id === grantId);
  if (!grant || !context.grantRefs.includes(grantId) || !grant.allowedActions.includes(action)) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入 Grant 无权执行请求动作', { grantId, action });
  }
}

function assertExecutionInputBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): void {
  if (stringValue(input.executionId, 'executionId') !== context.executionId || stringValue(input.executionStepId, 'executionStepId') !== context.executionStepId) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入执行绑定不匹配');
  }
}

function assertLockOwnerBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): void {
  if (stringValue(input.ownerRunId, 'ownerRunId') !== context.executionId || stringValue(input.ownerStepId, 'ownerStepId') !== context.executionStepId) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '资源锁所有者必须等于当前执行步骤');
  }
}

async function writeHostCallAudit(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  result: WriteAuditInput['result'],
  error?: unknown,
): Promise<void> {
  const auditedInput = Object.fromEntries(definition.auditFields
    .filter((field) => input[field] !== undefined)
    .map((field) => [field, input[field]]));
  await dependencies.security.audit.write({
    eventType: 'plugin.host_api.call',
    actorType: 'system',
    actorId: context.pluginId,
    action: context.method,
    resourceType: 'executionStep',
    resourceId: context.executionStepId,
    result,
    riskLevel: definition.riskLevel === 'CRITICAL' ? 'critical' : definition.riskLevel === 'HIGH' ? 'high' : definition.riskLevel === 'MEDIUM' ? 'medium' : 'low',
    context: { tenantId: context.tenantId },
    detail: {
      pluginVersionId: context.pluginVersionId,
      workflowVersionId: context.workflowVersionId,
      capability: context.capability,
      planDigest: context.planDigest,
      grantRefs: context.grantRefs,
      input: auditedInput,
      ...(error ? { errorCode: error instanceof AppError ? error.errorCode : 'PLUGIN_HOST_CALL_DENIED' } : {}),
    },
    failClosed: true,
  });
}

function normalizePluginLockKey(tenantId: string, resourceKey: string): string {
  const normalized = resourceKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return `tenant:${tenantId}:standalone:${normalized || 'plugin_resource'}`;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value;
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value;
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value as Record<string, unknown>;
}
