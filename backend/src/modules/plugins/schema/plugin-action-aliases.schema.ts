import { AppError } from '../../../common/errors/app-error.js';
import type { PluginActionAliasesV1, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

export function validatePluginActionAliases(input: unknown, manifest: UnifiedPluginManifestV1): PluginActionAliasesV1 {
  const resource = requireRecord(input, 'actionAliases');
  assertKeys(resource, ['apiVersion', 'kind', 'aliases'], 'actionAliases');
  if (resource.apiVersion !== 'gcac.plugin-action-aliases/v1') fail('actionAliases.apiVersion', '仅支持 gcac.plugin-action-aliases/v1');
  if (resource.kind !== 'PluginActionAliases') fail('actionAliases.kind', '仅支持 PluginActionAliases');
  if (manifest.runtime !== 'AGENT_ATOMIC') fail('actionAliases', '只有 AGENT_ATOMIC 插件可声明历史 Action 别名');
  if (!Array.isArray(resource.aliases) || resource.aliases.length === 0) fail('actionAliases.aliases', '必须声明至少一个历史 Action');
  const seen = new Set<string>();
  const aliases = resource.aliases.map((value, index) => {
    const item = requireRecord(value, `actionAliases.aliases.${index}`);
    assertKeys(item, ['actionType', 'capabilityKey', 'inputContract'], `actionAliases.aliases.${index}`);
    const actionType = requireString(item.actionType, `actionAliases.aliases.${index}.actionType`).toLowerCase();
    if (actionType === 'agent.atomic_plan.execute') fail(`actionAliases.aliases.${index}.actionType`, '标准 Atomic Plan Action 不能声明为历史别名');
    if (seen.has(actionType)) fail(`actionAliases.aliases.${index}.actionType`, '同一资源内 Action 别名重复');
    seen.add(actionType);
    const capabilityKey = requireString(item.capabilityKey, `actionAliases.aliases.${index}.capabilityKey`);
    const inputContract = requireString(item.inputContract, `actionAliases.aliases.${index}.inputContract`);
    const capability = manifest.capabilities.find((candidate) => candidate.key === capabilityKey);
    if (!capability || !capability.executionLocations.includes('AGENT')) fail(`actionAliases.aliases.${index}.capabilityKey`, '别名必须引用插件声明的 Agent 能力');
    if (capability.actionContractId !== inputContract) fail(`actionAliases.aliases.${index}.inputContract`, '输入 Contract 与插件能力声明不一致');
    return { actionType, capabilityKey, inputContract };
  });
  return { apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases', aliases };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, '必须是非空字符串');
  return value.trim();
}

function assertKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(path, '包含未知字段', { unknown });
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `插件历史 Action 别名资源无效：${message}`, { path, ...details });
}
