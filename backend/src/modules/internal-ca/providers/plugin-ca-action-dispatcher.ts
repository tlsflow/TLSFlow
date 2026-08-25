import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { JsonSchema } from '../../../common/validation/json-schema.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
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

  constructor(
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'getVersionForTenant'>,
    private readonly grants: Pick<ExecutionGrantService, 'create' | 'validate'>,
    runnerDependencies: PluginRunnerExecutionDependencies = {},
  ) {
    this.executor = new PluginRunnerExecutorAdapter({
      ...runnerDependencies,
      executionGrants: { validate: (input) => this.grants.validate(input) },
    });
  }

  async execute(input: Parameters<CaPluginActionDispatcher['execute']>[0]): Promise<Record<string, unknown>> {
    const plugin = await this.plugins.getVersionForTenant(input.provider.tenantId, input.binding.pluginVersionId);
    if (plugin.status !== 'ENABLED') {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', '固定 CA 插件版本未启用', {
        pluginVersionId: plugin.id,
        status: plugin.status,
      });
    }
    const action = selectAction(input.binding, input.action);
    const contract = readActionContract(plugin, action.actionId);
    const binding = createActionBinding(plugin, input.provider, input.binding, input.action, action, contract);
    const executionId = `ca-exec-${digest(input.idempotencyKey).slice(0, 24)}`;
    const executionStepId = `ca-step-${digest(`${input.action}:${input.idempotencyKey}`).slice(0, 24)}`;
    const secretRef = input.provider.credentialSecretRef;
    const payload = {
      ...structuredClone(input.payload),
      operation: operationForAction(input.action, input.payload),
      agentId: stringOr(input.provider.configuration.agentId, input.provider.id),
      templateId: stringOr(input.provider.configuration.templateId, 'default'),
      authorityId: stringOr(input.payload.authorityId, input.provider.id),
      ...(typeof input.provider.configuration.caConfig === 'string' && input.provider.configuration.caConfig.trim()
        ? { caConfig: input.provider.configuration.caConfig.trim() }
        : {}),
      ...(secretRef ? { secretRef } : {}),
    };
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
      idempotencyKey: input.idempotencyKey,
      deadlineAt: new Date(Date.now() + 120_000).toISOString(),
    });
    if (!result.success) {
      if (result.status === 'UNKNOWN') throw new AppError('CA_PROVIDER_UNAVAILABLE', '外部 CA 写操作结果未知，等待查询恢复', { mayBeUnknown: true, detail: result.detail });
      throw new AppError('CA_PROVIDER_UNAVAILABLE', result.errorMessage ?? '外部 CA 插件动作执行失败', { detail: result.detail });
    }
    return normalizeActionOutput(input.action, result.output);
  }
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
  const input = { ...payload, security };
  security.operationDigest = digest({ capability: binding.capability, input });
  return input;
}

function normalizeActionOutput(action: string, output: Record<string, unknown>): Record<string, unknown> {
  const object = Array.isArray(output.normalizedObjects) && isRecord(output.normalizedObjects[0]) ? output.normalizedObjects[0] : output;
  const status = typeof object.status === 'string' ? object.status : undefined;
  if (action === 'issue' || action === 'query') {
    const providerRequestId = typeof object.providerRequestId === 'string' ? object.providerRequestId : typeof object.stableKey === 'string' ? object.stableKey : undefined;
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
  if (typeof payload.operation === 'string' && payload.operation.trim()) return payload.operation;
  return action === 'issue' ? 'ca.certificate.issue' : action === 'query' ? 'ca.certificate.query' : action === 'revoke' ? 'ca.certificate.revoke' : 'ca.revocation.evidence';
}

function schemaHash(schema: JsonSchema): string { return `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`; }
function digest(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value), 'utf8').digest('hex'); }
function stringOr(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? value : fallback; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
