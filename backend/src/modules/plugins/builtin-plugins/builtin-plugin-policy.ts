import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import { canonicalPluginIds, type CanonicalPluginId } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import {
  forbiddenHostApiMethods,
  hostApiRegistry,
  validateHostApiPermissions,
} from '../runner/protocol/host-api.registry.js';

export const builtinPluginExecutionPolicy = {
  source: 'BUILTIN',
  executionMode: 'PLUGIN_RUNNER',
  ipcProtocol: 'gcac.plugin-runner/v1',
  runtimeEntrypoint: 'runtime/index.js',
} as const;

/** 这些权限代表宿主对象调用或任意代码执行，不能由包 Manifest 声明。 */
export const forbiddenBuiltinPluginPermissions = [
  ...forbiddenHostApiMethods,
  'agent.execute',
  'runtime.execute_unknown_code',
  'runtime.trusted_js',
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
  executionMode: typeof builtinPluginExecutionPolicy.executionMode;
  ipcProtocol: typeof builtinPluginExecutionPolicy.ipcProtocol;
  runtimeEntrypoint: typeof builtinPluginExecutionPolicy.runtimeEntrypoint;
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
