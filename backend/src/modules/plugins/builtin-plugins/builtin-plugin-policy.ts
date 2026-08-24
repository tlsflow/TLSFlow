import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import {
  canonicalPluginIds,
  certificateUpdatePluginIds,
  type CanonicalPluginId,
  type CertificateUpdatePluginId,
} from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import {
  forbiddenHostApiMethods,
  hostApiRegistry,
  validateHostApiPermissions,
} from '../runner/protocol/host-api.registry.js';

export const builtinPluginExecutionPolicy = {
  source: 'BUILTIN',
  executionMode: 'DSL_STEP_ACTION',
  ipcProtocol: 'gcac.plugin-runner/v2',
  runtimeEntrypoint: 'runtime/index.js',
} as const;

export const certificateUpdatePluginExecutionPolicy = {
  source: 'BUILTIN',
  executionMode: 'AGENT_PLAN',
  ipcProtocol: undefined,
  runtimeEntrypoint: undefined,
} as const;

/** 这些权限代表宿主对象调用或任意代码执行，不能由包 Manifest 声明。 */
export const forbiddenBuiltinPluginPermissions = [
  ...forbiddenHostApiMethods,
  'agent.execute',
  'runtime.execute_unknown_code',
] as const;

/**
 * 内置包权限的正式注册边界。
 *
 * Host API 权限从 Host API Registry 派生；Agent/设备权限是协议层能力，
 * 也必须在这里显式登记。未知权限默认拒绝，避免把历史 P2 Grant 或任意
 * 宿主对象调用悄悄带回 Manifest。
 */
export const builtinPluginPermissionAllowlist = Object.freeze([
    ...new Set([
    ...Object.values(hostApiRegistry).flatMap((definition) => [definition.permission, ...definition.requiredGrants]),
    'device.write',
    'agent.fact.collect',
    'agent.plan.validate',
    'agent.plan.execute',
    'agent.execution.receipt',
  ]),
]);

export interface BuiltinPluginPolicyDecision {
  pluginId: CanonicalPluginId;
  source: typeof builtinPluginExecutionPolicy.source;
  executionMode: typeof builtinPluginExecutionPolicy.executionMode | typeof certificateUpdatePluginExecutionPolicy.executionMode;
  ipcProtocol?: typeof builtinPluginExecutionPolicy.ipcProtocol;
  runtimeEntrypoint?: typeof builtinPluginExecutionPolicy.runtimeEntrypoint;
}

export function validateBuiltinPluginPolicy(manifest: UnifiedPluginManifestV1): BuiltinPluginPolicyDecision {
  if (manifest.source !== builtinPluginExecutionPolicy.source) {
    throw new AppError('VALIDATION_FAILED', '内置插件 Manifest.source 必须是 BUILTIN', { pluginId: manifest.pluginId });
  }
  if (manifest.trust !== 'OFFICIAL_SIGNED' || manifest.support !== 'OFFICIAL') {
    throw new AppError('VALIDATION_FAILED', '内置插件必须使用官方信任和支持等级', {
      pluginId: manifest.pluginId,
      trust: manifest.trust,
      support: manifest.support,
    });
  }
  if (!canonicalPluginIds.includes(manifest.pluginId as CanonicalPluginId)) {
    throw new AppError('VALIDATION_FAILED', '内置插件身份不是当前 Canonical Plugin ID', { pluginId: manifest.pluginId });
  }
  if (certificateUpdatePluginIds.includes(manifest.pluginId as CertificateUpdatePluginId)) {
    return validateCertificateUpdatePluginPolicy(manifest);
  }
  if (manifest.resources.runtimeEntrypoint !== builtinPluginExecutionPolicy.runtimeEntrypoint) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '内置插件 Runner 入口必须固定为 runtime/index.js', {
      pluginId: manifest.pluginId,
      runtimeEntrypoint: manifest.resources.runtimeEntrypoint,
    });
  }
  try {
    validateHostApiPermissions(manifest.permissions);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '内置插件 Manifest 权限格式无效', { pluginId: manifest.pluginId });
  }
  const forbidden = manifest.permissions.filter((permission) => forbiddenBuiltinPluginPermissions.includes(permission as typeof forbiddenBuiltinPluginPermissions[number]));
  if (forbidden.length > 0) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '内置插件 Manifest 声明了禁止权限', { pluginId: manifest.pluginId, forbidden });
  }
  const unknown = manifest.permissions.filter((permission) => !builtinPluginPermissionAllowlist.includes(permission));
  if (unknown.length > 0) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '内置插件 Manifest 声明了未登记权限', {
      pluginId: manifest.pluginId,
      unknown,
    });
  }
  return {
    pluginId: manifest.pluginId as CanonicalPluginId,
    ...builtinPluginExecutionPolicy,
  };
}

function validateCertificateUpdatePluginPolicy(manifest: UnifiedPluginManifestV1): BuiltinPluginPolicyDecision {
  if (manifest.runtime !== 'WORKFLOW_DSL') {
    throw new AppError('VALIDATION_FAILED', '证书更新插件必须使用普通 WORKFLOW_DSL', { pluginId: manifest.pluginId });
  }
  if (manifest.resources.runtimeEntrypoint !== undefined) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '证书更新插件不得声明 Runner 入口', { pluginId: manifest.pluginId });
  }
  const forbiddenCapabilities = manifest.capabilities.filter((capability) => [
    'application.discover',
    'plugin.action',
    'certificate.discover',
  ].includes(capability.key));
  if (forbiddenCapabilities.length > 0) {
    throw new AppError('VALIDATION_FAILED', '证书更新插件不得声明发现或 plugin.action 能力', {
      pluginId: manifest.pluginId,
      capabilities: forbiddenCapabilities.map((capability) => capability.key),
    });
  }
  const capabilityKeys = new Set(manifest.capabilities.map((capability) => capability.key));
  for (const required of ['certificate.deploy', 'certificate.verify', 'certificate.rollback']) {
    if (!capabilityKeys.has(required)) {
      throw new AppError('VALIDATION_FAILED', '证书更新插件缺少固定证书能力', { pluginId: manifest.pluginId, capability: required });
    }
  }
  const workflows = manifest.resources.workflows ?? {};
  for (const required of ['certificate.deploy', 'certificate.rollback']) {
    if (!workflows[required]) {
      throw new AppError('VALIDATION_FAILED', '证书更新插件缺少普通 V1 Workflow', { pluginId: manifest.pluginId, workflow: required });
    }
  }
  const inputContracts = manifest.resources.inputContracts ?? {};
  for (const required of ['certificate.deploy', 'certificate.verify', 'certificate.rollback']) {
    if (!inputContracts[required]) {
      throw new AppError('VALIDATION_FAILED', '证书更新插件缺少独立输入合同资源', { pluginId: manifest.pluginId, capability: required });
    }
  }
  if (manifest.resources.discoveryMappings && Object.keys(manifest.resources.discoveryMappings).length > 0) {
    throw new AppError('VALIDATION_FAILED', '证书更新插件不得声明 Discovery Profile', { pluginId: manifest.pluginId });
  }
  if (manifest.resources.agentDiscoveryMappings && Object.keys(manifest.resources.agentDiscoveryMappings).length > 0) {
    throw new AppError('VALIDATION_FAILED', '证书更新插件不得声明 Agent Discovery Profile', { pluginId: manifest.pluginId });
  }
  const unknownPermissions = manifest.permissions.filter((permission) => !builtinPluginPermissionAllowlist.includes(permission));
  if (unknownPermissions.length > 0 || manifest.permissions.some((permission) => ['agent.fact.collect', 'device.write'].includes(permission))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '证书更新插件声明了发现或宿主写入权限', { pluginId: manifest.pluginId, permissions: manifest.permissions });
  }
  const agentPlans = manifest.resources.agentPlans ?? {};
  for (const required of ['certificate.deploy', 'certificate.verify', 'certificate.rollback']) {
    if (!agentPlans[required]) throw new AppError('VALIDATION_FAILED', '证书更新插件缺少 Agent Plan 模板', { pluginId: manifest.pluginId, capability: required });
  }
  return {
    pluginId: manifest.pluginId as CanonicalPluginId,
    ...certificateUpdatePluginExecutionPolicy,
  };
}
