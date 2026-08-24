import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { JsonSchema } from '../../../common/validation/json-schema.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { WorkflowDslV1, WorkflowStep } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { PluginActionBindingV1 } from './plugin-runner-executor.adapter.js';

interface PluginActionContractV1 {
  apiVersion: 'gcac.plugin-action-contract/v1';
  actionId: string;
  capability: string;
  actionContractVersion: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  writeEffect: boolean;
  hostPermissions: string[];
}

/**
 * 证书部署生命周期属于普通 DSL 的控制流，不得借由步骤级 Action 再次进入插件进程。
 * 插件 Action 只保留设备/服务识别等 DSL 无法表达的只读原子能力。
 */
const forbiddenCertificateActionCapabilities = new Set([
  'certificate.deploy',
  'certificate.verify',
  'certificate.rollback',
]);

export function buildPluginActionBindings(input: {
  tenantId: string;
  workflowVersionId: string;
  content: WorkflowDslV1;
  plugin: UnifiedPluginVersionRecord;
  planDigest: string;
}): Record<string, PluginActionBindingV1> {
  if (!/^[a-f0-9]{64}$/.test(input.planDigest)) {
    throw new AppError('VALIDATION_FAILED', 'plugin.action Binding 缺少固定计划摘要');
  }
  const bindings: Record<string, PluginActionBindingV1> = {};
  for (const step of collectPluginActionSteps(input.content.steps, input.content.rollback ?? [])) {
    if (bindings[step.name]) {
      throw new AppError('VALIDATION_FAILED', 'plugin.action 步骤名称必须在部署与回滚分支中唯一', {
        workflowVersionId: input.workflowVersionId,
        workflowStepName: step.name,
      });
    }
    bindings[step.name] = createBinding(input, step);
  }
  return bindings;
}

function createBinding(
  input: {
    tenantId: string;
    workflowVersionId: string;
    plugin: UnifiedPluginVersionRecord;
    planDigest: string;
  },
  step: Extract<WorkflowStep, { type: 'plugin.action' }>,
): PluginActionBindingV1 {
  if (forbiddenCertificateActionCapabilities.has(step.capability)) {
    throw new AppError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '证书部署、验证和回滚必须由普通 DSL 执行，禁止绑定到 Plugin Runner', {
      workflowVersionId: input.workflowVersionId,
      workflowStepName: step.name,
      capability: step.capability,
    });
  }
  if (step.pluginId !== input.plugin.pluginId) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'plugin.action 不能引用当前 WorkflowVersion 之外的 Plugin ID', {
      workflowVersionId: input.workflowVersionId,
      workflowStepName: step.name,
      expectedPluginId: input.plugin.pluginId,
      actualPluginId: step.pluginId,
    });
  }
  const resourcePath = input.plugin.manifest.resources.actionContracts?.[step.actionId];
  if (!resourcePath) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action 未在固定 PluginVersion 中声明 Action Contract', {
      pluginVersionId: input.plugin.id,
      actionId: step.actionId,
    });
  }
  const resource = input.plugin.resources[resourcePath];
  if (!resource) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action Action Contract 资源不存在', {
      pluginVersionId: input.plugin.id,
      actionId: step.actionId,
      resourcePath,
    });
  }
  const contract = parseContract(resource, resourcePath);
  if (contract.actionId !== step.actionId
    || contract.capability !== step.capability
    || contract.actionContractVersion !== step.actionContractVersion
    || contract.writeEffect !== step.writeEffect) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action 与固定 Action Contract 不一致', {
      pluginVersionId: input.plugin.id,
      workflowStepName: step.name,
      actionId: step.actionId,
    });
  }
  const inputSchemaSha256 = schemaHash(contract.inputSchema);
  const outputSchemaSha256 = schemaHash(contract.outputSchema);
  if (step.inputSchemaSha256 !== inputSchemaSha256 || step.outputSchemaSha256 !== outputSchemaSha256) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action DSL Schema 摘要与固定 Action Contract 不一致', {
      pluginVersionId: input.plugin.id,
      workflowStepName: step.name,
      actionId: step.actionId,
    });
  }
  const permissionSet = new Set(input.plugin.manifest.permissions);
  if (contract.hostPermissions.some((permission) => !permissionSet.has(permission))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'plugin.action Action Contract 请求了未由 PluginVersion 声明的 Host API 权限', {
      pluginVersionId: input.plugin.id,
      actionId: step.actionId,
    });
  }
  return {
    apiVersion: 'gcac.plugin-action-binding/v1',
    tenantId: input.tenantId,
    workflowVersionId: input.workflowVersionId,
    workflowStepName: step.name,
    pluginVersionId: input.plugin.id,
    pluginId: input.plugin.pluginId,
    pluginVersion: input.plugin.version,
    capability: step.capability,
    actionId: step.actionId,
    actionContractVersion: step.actionContractVersion,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    inputSchemaSha256,
    outputSchemaSha256,
    packageHash: input.plugin.packageSha256,
    manifestHash: input.plugin.manifestSha256,
    resourceHash: canonicalResourceHash(input.plugin.resourceSha256),
    planDigest: input.planDigest,
    writeEffect: step.writeEffect,
    hostPermissions: contract.hostPermissions,
  };
}

function collectPluginActionSteps(...branches: WorkflowStep[][]): Array<Extract<WorkflowStep, { type: 'plugin.action' }>> {
  const actions: Array<Extract<WorkflowStep, { type: 'plugin.action' }>> = [];
  const visit = (steps: WorkflowStep[]): void => {
    for (const step of steps) {
      if (step.type === 'plugin.action') actions.push(step);
      if (step.type === 'foreach') visit(step.foreach.steps);
    }
  };
  branches.forEach(visit);
  return actions;
}

function parseContract(resource: string, resourcePath: string): PluginActionContractV1 {
  let value: unknown;
  try {
    value = JSON.parse(resource);
  } catch (error) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action Action Contract 资源不是有效 JSON', {
      resourcePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(value)) throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action Action Contract 必须是对象', { resourcePath });
  const allowed = new Set(['apiVersion', 'actionId', 'capability', 'actionContractVersion', 'inputSchema', 'outputSchema', 'writeEffect', 'hostPermissions']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action Action Contract 包含未知字段', { resourcePath, unknown });
  if (value.apiVersion !== 'gcac.plugin-action-contract/v1'
    || !isIdentifier(value.actionId)
    || !isIdentifier(value.capability)
    || !isIdentifier(value.actionContractVersion)
    || !isSchema(value.inputSchema)
    || !isSchema(value.outputSchema)
    || typeof value.writeEffect !== 'boolean'
    || !isIdentifierArray(value.hostPermissions)) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'plugin.action Action Contract 字段无效', { resourcePath });
  }
  return {
    apiVersion: 'gcac.plugin-action-contract/v1',
    actionId: value.actionId,
    capability: value.capability,
    actionContractVersion: value.actionContractVersion,
    inputSchema: structuredClone(value.inputSchema) as JsonSchema,
    outputSchema: structuredClone(value.outputSchema) as JsonSchema,
    writeEffect: value.writeEffect,
    hostPermissions: [...value.hostPermissions],
  };
}

function schemaHash(schema: JsonSchema): string {
  return `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSchema(value: unknown): value is JsonSchema {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 200 && value.every(isIdentifier) && new Set(value).size === value.length;
}
