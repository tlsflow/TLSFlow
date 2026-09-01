import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { JsonSchema } from '../../../common/validation/json-schema.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../../agents/schema/agents.schema.js';
import {
  expandPluginActionGrantActions,
  PluginRunnerExecutorAdapter,
  type PluginActionBindingV1,
  type PluginRunnerExecutionDependencies,
} from '../../executions/application/plugin-runner-executor.adapter.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { CaPluginActionDispatcher } from './ca-provider.js';
import type { CaProviderEntity, ProviderActionBindingEntity, ProviderActionReference } from '../schema/internal-ca.schema.js';

/**
 * 将 CA Provider 的固定动作绑定转换为现有 plugin.action 执行合同。
 * CA 生命周期不再另造一条 Runner 通道，所有外部动作均进入统一 Grant、摘要和回执链。
 */
export class PluginCaActionDispatcher implements CaPluginActionDispatcher {
  private readonly executor: PluginRunnerExecutorAdapter;
  private readonly agents?: Pick<AgentsApplicationService, 'getAgentExecutionPlatform' | 'enqueueTask' | 'findTaskByIdempotencyKey'>;

  constructor(
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'getVersionForTenant' | 'listAccessibleVersions'>,
    private readonly grants: Pick<ExecutionGrantService, 'create' | 'validate'>,
    runnerDependencies: PluginRunnerExecutionDependencies = {},
    agents?: Pick<AgentsApplicationService, 'getAgentExecutionPlatform' | 'enqueueTask' | 'findTaskByIdempotencyKey'>,
  ) {
    this.executor = new PluginRunnerExecutorAdapter({
      ...runnerDependencies,
      executionGrants: { validate: (input) => this.grants.validate(input) },
    });
    this.agents = agents;
  }

  async execute(input: Parameters<CaPluginActionDispatcher['execute']>[0]): Promise<Record<string, unknown>> {
    const authorityConfiguration = input.authority?.configuration ?? {};
    const isMicrosoftAdcs = isMicrosoftAdcsProvider(input.provider, input.authority);
    // AD CS 的执行目标优先从 Authority 配置读取，Provider 只保存引用和兼容回退值。
    const configuredAgentId = isMicrosoftAdcs
      ? stringOr(authorityConfiguration.agentId, stringOr(input.provider.configuration.agentId, ''))
      : stringOr(input.provider.configuration.agentId, '');
    if (isMicrosoftAdcs && !configuredAgentId) {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', 'Microsoft AD CS Agent 尚未安装或关联，请先完成 Agent 安装并关联');
    }
    if (isMicrosoftAdcs) await this.assertAdcsAgent(input.provider.tenantId, configuredAgentId);
    const plugin = await this.resolvePluginVersion(input.provider.tenantId, input.binding.pluginVersionId);
    const action = selectAction(input.binding, input.action);
    const contract = readActionContract(plugin, action.actionId);
    const binding = createActionBinding(plugin, input.provider, input.binding, input.action, action, contract);
    // 外部 CA 的业务幂等键必须稳定，但每次控制面执行都必须拥有新的执行实例。
    // 否则重试会复用旧 executionId/stepId；新 Grant 被计入 Host API 请求摘要后，
    // 同一账本键就会被错误判定为“不同请求摘要”。
    const executionNonce = randomUUID().replaceAll('-', '');
    const executionId = `ca-exec-${executionNonce}`;
    const executionStepId = `ca-step-${executionNonce}`;
    // Runtime 的操作账本绑定 Runner 执行键；Agent/微软 CA 仍使用原业务幂等键。
    // 两者混用会让合法重试携带新 Grant 时触发固定 Runtime 的摘要冲突。
    const runnerIdempotencyKey = `${input.idempotencyKey}:attempt:${executionNonce}`;
    const secretRef = stringOr(authorityConfiguration.credentialSecretRef, input.provider.credentialSecretRef ?? '');
    const operation = operationForAction(input.action, input.payload);
    // JSON Schema 只描述 JSON 值；可选字段不能以 JavaScript `undefined`
    // 进入校验，否则“字段不存在”和“字段值类型错误”会被错误地区分。
    const payload = omitUndefined({
      ...structuredClone(input.payload),
      operation,
      workflowKey: operation,
      workflowVersion: '1.0.0',
      agentId: isMicrosoftAdcs ? configuredAgentId : configuredAgentId || input.provider.id,
      ...(isMicrosoftAdcs ? { agentRole: 'adcs_agent', agentPlatform: 'windows_adcs' } : {}),
      templateId: stringOr(authorityConfiguration.templateId, stringOr(input.provider.configuration.templateId, 'default')),
      authorityId: stringOr(input.payload.authorityId, input.provider.id),
      ...(typeof authorityConfiguration.caConfig === 'string' && authorityConfiguration.caConfig.trim()
        ? { caConfig: authorityConfiguration.caConfig.trim() }
        : typeof input.provider.configuration.caConfig === 'string' && input.provider.configuration.caConfig.trim()
          ? { caConfig: input.provider.configuration.caConfig.trim() }
        : {}),
      ...(secretRef ? { secretRef } : {}),
    });
    const planDigest = digest({ action: input.action, providerId: input.provider.id, payload });
    binding.planDigest = planDigest;
    const grantInput = {
      tenantId: input.provider.tenantId,
      planId: `ca-plan-${input.provider.id}`,
      runId: executionId,
      stepId: executionStepId,
      targetId: input.provider.id,
      workflowVersionId: binding.workflowVersionId,
      pluginVersionId: binding.pluginVersionId,
      pluginId: binding.pluginId,
      capability: binding.capability,
      actionId: binding.actionId,
      actionContractVersion: binding.actionContractVersion,
      inputSchemaSha256: binding.inputSchemaSha256,
      outputSchemaSha256: binding.outputSchemaSha256,
      planDigest,
      executorType: 'plugin.action',
      allowedSecretRefs: secretRef ? [secretRef] : [],
      allowedActions: [...new Set(['plugin.action.execute', binding.actionId, ...expandPluginActionGrantActions(binding.hostPermissions)])],
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    const grant = await this.grants.create(grantInput);
    const result = await this.executor.executeAction({
      binding,
      executionId,
      executionStepId,
      input: withSecurity(payload, binding, grant.id, planDigest),
      grantRefs: [grant.id],
      idempotencyKey: runnerIdempotencyKey,
      deadlineAt: new Date(Date.now() + 120_000).toISOString(),
      // CA Provider 动作的目标上下文不来自应用资产；这里明确声明证书请求/证书
      // 和证书机构产品族，避免 Manifest 的终端兼容性规则因缺少上下文被误判。
      compatibilityContext: {
        productFamily: 'certificate-authority',
        frameworkType: 'windows.agent_plan.adcs',
        targetType: input.action === 'revoke' || input.action === 'revocation_evidence' ? 'certificate' : 'certificate-request',
      },
    });
    if (!result.success) {
      if (result.status === 'UNKNOWN') throw new AppError('CA_PROVIDER_UNAVAILABLE', '外部 CA 写操作结果未知，等待查询恢复', { mayBeUnknown: true, detail: result.detail });
      throw new AppError('CA_PROVIDER_UNAVAILABLE', result.errorMessage ?? '外部 CA 插件动作执行失败', { detail: result.detail });
    }
    const normalized = normalizeActionOutput(
      input.action,
      result.output,
      input.action === 'issue' ? `certificate-request:${digest(input.idempotencyKey)}` : undefined,
    );
    if (!isMicrosoftAdcs || !this.agents) return normalized;
    const object = firstNormalizedObject(result.output);
    const plan = readAgentPlan(result.output, object);
    if (!plan) throw new AppError('CA_PROVIDER_RESULT_INVALID', 'Microsoft AD CS Plugin 未返回可入队的 Agent Plan', {
      outputKeys: Object.keys(result.output),
      normalizedObjectKeys: object ? Object.keys(object) : [],
      runnerDetail: result.detail,
    });
    const existing = await this.agents.findTaskByIdempotencyKey(input.provider.tenantId, configuredAgentId, input.idempotencyKey);
    if (existing?.status === 'succeeded') return normalizeAdcsTaskResult(input.action, existing);
    if (existing?.status === 'failed' || existing?.status === 'rejected') {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', 'AD CS Agent 任务已失败，请检查 Agent Receipt 和错误日志', { taskId: existing.id, status: existing.status });
    }
    const task = existing ?? await this.agents.enqueueTask(input.provider.tenantId, {
      agentId: configuredAgentId,
      executionRunId: executionId,
      executionStepId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        actionType: 'agent.plan.execute',
        actionSchemaVersion: '1.0',
        agentId: configuredAgentId,
        agentRole: 'adcs_agent',
        agentPlatform: 'windows_adcs',
        agentPlan: plan,
      },
    }, `ca-adcs:${input.action}:${input.idempotencyKey}`);
    return {
      ...normalized,
      detail: `${normalized.detail ?? 'pending-agent-execution'}; taskId=${task.id}`,
    };
  }

  /**
   * 固定绑定优先保证可复现；绑定版本被停用或退休后，只在同一插件内切换到当前启用版本。
   * 这样插件升级不需要人工改库，同时不会把一个 CA 插件静默替换成另一个插件。
   */
  private async resolvePluginVersion(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginVersionRecord> {
    const bound = await this.plugins.getVersionForTenant(tenantId, pluginVersionId);
    if (bound.status === 'ENABLED') return bound;
    const replacement = (await this.plugins.listAccessibleVersions(tenantId))
      .find((candidate) => candidate.pluginId === bound.pluginId && candidate.status === 'ENABLED');
    if (replacement) return replacement;
    throw new AppError('CA_PROVIDER_UNAVAILABLE', '固定 CA 插件版本未启用，且没有可用的同插件版本', {
      pluginVersionId: bound.id,
      pluginId: bound.pluginId,
      status: bound.status,
    });
  }

  private async assertAdcsAgent(tenantId: string, agentId: string): Promise<void> {
    if (!this.agents) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'AD CS Agent 任务队列未装配，拒绝在控制面执行 AD CS 操作');
    const platform = await this.agents.getAgentExecutionPlatform(tenantId, agentId);
    if (platform.role !== 'adcs_agent' || platform.osType.toLowerCase() !== 'windows_adcs') {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', 'Authority 关联的 Agent 不是 Windows AD CS Agent', { agentId, role: platform.role, osType: platform.osType });
    }
  }
}

function isMicrosoftAdcsProvider(
  provider: CaProviderEntity,
  authority: Parameters<CaPluginActionDispatcher['execute']>[0]['authority'],
): boolean {
  if (provider.type !== 'plugin') return false;
  const kinds = [provider.configuration.providerKind, authority?.configuration?.providerKind]
    .map((value) => stringOr(value, '').toLowerCase().replaceAll('-', '_'));
  return kinds.includes('microsoft_adcs')
    || stringOr(provider.configuration.profile, '').toLowerCase() === 'windows.agent_plan.adcs'
    || provider.runtimePlatform === 'windows';
}

interface ActionContract {
  actionId: string;
  capability: string;
  actionContractVersion: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  writeEffect: boolean;
  hostPermissions: string[];
}

function selectAction(binding: ProviderActionBindingEntity, action: 'issue' | 'query' | 'revoke' | 'revocation_evidence'): ProviderActionReference {
  const reference = action === 'issue'
    ? binding.issueAction
    : action === 'query'
      ? binding.queryAction
      : action === 'revoke'
        ? binding.revokeAction
        : binding.revocationEvidenceAction;
  if (!reference) throw new AppError('CA_PROVIDER_ACTION_UNBOUND', `外部 CA 缺少固定${action}动作绑定`);
  return reference;
}

function readActionContract(plugin: UnifiedPluginVersionRecord, actionId: string): ActionContract {
  const resourcePath = plugin.manifest.resources.actionContracts?.[actionId];
  const raw = resourcePath ? plugin.resources[resourcePath] : undefined;
  if (!raw) throw new AppError('PLUGIN_CONTRACT_INVALID', '固定 PluginVersion 缺少 CA Action Contract', { pluginVersionId: plugin.id, actionId });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AppError('PLUGIN_CONTRACT_INVALID', 'CA Action Contract 不是有效 JSON', { actionId }); }
  if (!isRecord(value) || typeof value.actionId !== 'string' || typeof value.capability !== 'string' || typeof value.actionContractVersion !== 'string' || !isRecord(value.inputSchema) || !isRecord(value.outputSchema) || typeof value.writeEffect !== 'boolean' || !Array.isArray(value.hostPermissions)) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'CA Action Contract 字段无效', { actionId });
  }
  return {
    actionId: value.actionId,
    capability: value.capability,
    actionContractVersion: value.actionContractVersion,
    inputSchema: structuredClone(value.inputSchema) as JsonSchema,
    outputSchema: structuredClone(value.outputSchema) as JsonSchema,
    writeEffect: value.writeEffect,
    hostPermissions: value.hostPermissions.filter((item): item is string => typeof item === 'string'),
  };
}

function createActionBinding(
  plugin: UnifiedPluginVersionRecord,
  provider: CaProviderEntity,
  providerBinding: ProviderActionBindingEntity,
  action: 'issue' | 'query' | 'revoke' | 'revocation_evidence',
  reference: ProviderActionReference,
  contract: ActionContract,
): PluginActionBindingV1 {
  if (providerBinding.executionLocation !== 'control_plane') throw new AppError('CA_PROVIDER_UNAVAILABLE', '当前 Provider 动作绑定到 Agent，控制面不能直接执行', { providerId: provider.id, executionLocation: providerBinding.executionLocation });
  if (contract.actionId !== reference.actionId || contract.actionContractVersion !== reference.actionVersion) throw new AppError('PLUGIN_CONTRACT_INVALID', 'Provider 动作绑定与固定 Action Contract 不一致', { action });
  const inputSchemaSha256 = schemaHash(contract.inputSchema);
  const outputSchemaSha256 = schemaHash(contract.outputSchema);
  if (reference.inputSchemaDigest && reference.inputSchemaDigest !== inputSchemaSha256) throw new AppError('PLUGIN_CONTRACT_INVALID', 'Provider 输入 Schema 摘要不匹配', { action });
  if (reference.outputSchemaDigest && reference.outputSchemaDigest !== outputSchemaSha256) throw new AppError('PLUGIN_CONTRACT_INVALID', 'Provider 输出 Schema 摘要不匹配', { action });
  const capability = plugin.manifest.capabilities.find((item) => item.key === contract.capability);
  if (!capability) throw new AppError('PLUGIN_CONTRACT_INVALID', 'PluginVersion 未声明 CA Capability', { capability: contract.capability });
  return {
    apiVersion: 'gcac.plugin-action-binding/v1',
    tenantId: provider.tenantId,
    workflowVersionId: `ca-provider-${providerBinding.id}`,
    workflowStepName: `ca-${action}`,
    pluginVersionId: plugin.id,
    pluginId: plugin.pluginId,
    pluginVersion: plugin.version,
    capability: contract.capability,
    actionId: contract.actionId,
    actionContractVersion: contract.actionContractVersion,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    inputSchemaSha256,
    outputSchemaSha256,
    packageHash: plugin.packageSha256,
    manifestHash: plugin.manifestSha256,
    resourceHash: canonicalResourceHash(plugin.resourceSha256),
    planDigest: '0'.repeat(64),
    writeEffect: contract.writeEffect,
    hostPermissions: [...contract.hostPermissions],
  };
}

function withSecurity(payload: Record<string, unknown>, binding: PluginActionBindingV1, grantId: string, planDigest: string): Record<string, unknown> {
  const security: Record<string, unknown> = {
    tokenId: `ca-token-${digest(grantId).slice(0, 20)}`,
    decisionId: `ca-decision-${digest(binding.actionId).slice(0, 20)}`,
    nonce: `ca-nonce-${digest(`${grantId}:${binding.actionId}`).slice(0, 20)}`,
    receiptRef: `receipt://ca/${grantId}`,
    localPolicyRef: `policy://ca/${binding.pluginVersionId}`,
    grantRef: grantId,
    fixedDigests: { packageHash: binding.packageHash, resourceHash: binding.resourceHash, manifestHash: binding.manifestHash },
  };
  // 先计算没有 operationDigest 的快照。若把 undefined 键算入摘要，Runner
  // JSON 序列化时会丢弃该键，控制面与插件两端就会得到不同摘要。
  const input = { ...payload, security: { ...security } };
  // AD CS Runtime 使用 Object.keys(...).sort()，这里必须复刻其 UTF-16
  // 默认排序；通用 canonicalize 使用 localeCompare，不能混用。
  security.operationDigest = `sha256:${digestAdcsOperation({ capability: binding.capability, input })}`;
  return { ...payload, security };
}

function normalizeActionOutput(action: string, output: Record<string, unknown>, fallbackProviderRequestId?: string): Record<string, unknown> {
  const object = Array.isArray(output.normalizedObjects) && isRecord(output.normalizedObjects[0]) ? output.normalizedObjects[0] : output;
  const status = typeof object.status === 'string' ? object.status : undefined;
  if (status === 'pending-agent-execution') {
    const providerRequestId = typeof object.providerRequestId === 'string'
      ? object.providerRequestId
      : typeof object.stableKey === 'string'
        ? object.stableKey
        : fallbackProviderRequestId;
    return {
      status: 'pending',
      ...(providerRequestId ? { providerRequestId } : {}),
      detail: 'pending-agent-execution',
    };
  }
  if (action === 'issue' || action === 'query') {
    const providerRequestId = typeof object.providerRequestId === 'string'
      ? object.providerRequestId
      : typeof object.stableKey === 'string'
        ? object.stableKey
        : fallbackProviderRequestId;
    if (!providerRequestId) throw new AppError('CA_PROVIDER_RESULT_INVALID', '外部 CA 插件结果缺少 providerRequestId');
    if (status === 'issued' && typeof object.certificatePem === 'string') return object;
    return { status: status === 'unknown' ? 'unknown' : 'pending', providerRequestId, detail: status ?? 'pending-agent-execution' };
  }
  if (action === 'revoke') {
    if (status === 'revoked' && typeof object.revokedAt === 'string') return { revokedAt: object.revokedAt };
    throw new AppError('CA_PROVIDER_UNAVAILABLE', '外部 CA 吊销尚未收到 Agent/CA 回执', { mayBeUnknown: true, status });
  }
  if (status !== 'published' && status !== 'revoked') throw new AppError('CA_CRL_PUBLICATION_FAILED', '外部 CA 未返回可验证撤销传播证据', { status });
  return object;
}

function operationForAction(action: string, payload: Record<string, unknown>): string {
  if (typeof payload.operation === 'string' && payload.operation.trim()) {
    const operation = payload.operation.trim();
    const aliases: Record<string, string> = {
      issue: 'ca.certificate.issue',
      query: 'ca.certificate.query',
      renew: 'ca.certificate.renew',
      revoke: 'ca.certificate.revoke',
      revocation_evidence: 'ca.revocation.evidence',
    };
    return aliases[operation] ?? operation;
  }
  return action === 'issue' ? 'ca.certificate.issue' : action === 'query' ? 'ca.certificate.query' : action === 'revoke' ? 'ca.certificate.revoke' : 'ca.revocation.evidence';
}

function schemaHash(schema: JsonSchema): string { return `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`; }
function digest(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value), 'utf8').digest('hex'); }
function digestAdcsOperation(value: unknown): string {
  return createHash('sha256').update(canonicalizeAdcs(value), 'utf8').digest('hex');
}
function canonicalizeAdcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeAdcs(item)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort();
  return `{${entries.map((key) => `${JSON.stringify(key)}:${canonicalizeAdcs((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function stringOr(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? value : fallback; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function firstNormalizedObject(output: Record<string, unknown>): Record<string, unknown> | undefined {
  return Array.isArray(output.normalizedObjects) && isRecord(output.normalizedObjects[0]) ? output.normalizedObjects[0] : output;
}

/** 兼容 Runner 标准结果的 data 包装，只接受具备计划摘要和动作列表的对象。 */
function readAgentPlan(output: Record<string, unknown>, object?: Record<string, unknown>): Record<string, unknown> | undefined {
  const visit = (value: unknown, depth: number): Record<string, unknown> | undefined => {
    if (depth > 4 || !isRecord(value)) return undefined;
    if (typeof value.planDigest === 'string' && Array.isArray(value.actions)) return value;
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(object, 0) ?? visit(output, 0);
}

function normalizeAdcsTaskResult(action: 'issue' | 'query' | 'revoke' | 'revocation_evidence', task: AgentTaskEnvelope): Record<string, unknown> {
  const result = readRecord(task.result);
  if (result?.success !== true) {
    throw new AppError('CA_PROVIDER_UNAVAILABLE', 'AD CS Agent 任务结果未确认成功', { taskId: task.id, status: result?.status });
  }
  const detail = readRecord(result.detail) ?? {};
  // Agent v2 的真实操作结果位于 Receipt 内；旧版 Agent/Runner 仍可能把
  // operationResults 放在 detail 顶层，因此按新结构优先、旧结构回退读取。
  const receipt = readRecord(detail.receipt);
  const operationResults = (Array.isArray(receipt?.operationResults)
    ? receipt.operationResults
    : Array.isArray(detail.operationResults)
      ? detail.operationResults
      : []).filter(isRecord);
  const operation = operationResults.at(-1) ?? receipt ?? detail;
  if (action === 'issue' || action === 'query') {
    if (typeof operation.providerRequestId !== 'string' || typeof operation.status !== 'string') {
      throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS Agent Receipt 缺少签发结果');
    }
    return operation;
  }
  if (action === 'revoke') {
    if (typeof operation.revokedAt !== 'string') throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS Agent Receipt 缺少 revokedAt');
    return operation;
  }
  if (typeof operation.status !== 'string') throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS Agent Receipt 缺少 CRL/撤销证据状态');
  return operation;
}
