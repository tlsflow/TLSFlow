import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../dto/input-bindings.dto.js';

/**
 * 将历史插件版本的持久化 Binding 投影到当前输入契约。
 *
 * 设备和受管目标层可以跨插件版本继承仍然声明在新契约中的字段；
 * 应用资产层不应调用此函数，因为它代表用户对具体插件版本的显式覆盖。
 */
export function migrateInputBindingsToContract(contract: DeploymentInputContractV1, input: InputBindingsV1): InputBindingsV1 {
  const output = emptyInputBindingsV1();
  for (const [slot, value] of Object.entries(input.variables)) {
    const definition = contract.variables[slot];
    if (definition && definition.bindingPolicy !== 'fixed' && definition.configurationMode !== 'runtime') {
      output.variables[slot] = structuredClone(value);
    }
  }
  for (const [slot, value] of Object.entries(input.connections)) {
    const definition = contract.connections[slot];
    if (!definition) continue;
    const migrated: Record<string, unknown> = {};
    for (const [path, fieldValue] of connectionEntries(value)) {
      const field = connectionDefinitionField(definition, path);
      if (field && field.bindingPolicy !== 'fixed' && field.configurationMode !== 'runtime') {
        setPath(migrated, path, fieldValue);
      }
    }
    if (Object.keys(migrated).length > 0) output.connections[slot] = migrated as InputBindingsV1['connections'][string];
  }
  for (const [slot, value] of Object.entries(input.credentials)) {
    if (contract.credentials[slot]) output.credentials[slot] = structuredClone(value);
  }
  for (const [slot, value] of Object.entries(input.artifacts)) {
    if (contract.artifacts[slot]) output.artifacts[slot] = structuredClone(value);
  }
  return output;
}

function connectionEntries(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [[prefix, value]] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child)
      ? connectionEntries(child, path)
      : [[path, child]];
  });
}

function connectionDefinitionField(
  definition: DeploymentInputContractV1['connections'][string],
  path: string,
) {
  if (path === 'host') return definition.host;
  if (path === 'port') return definition.port;
  if (path === 'username') return definition.username;
  if (path === 'tls.verifyPeer') return definition.tls?.verifyPeer;
  if (path === 'tls.serverName') return definition.tls?.serverName;
  if (path === 'hostKey.expectedFingerprint') return definition.hostKey?.expectedFingerprint;
  return undefined;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] = current[part] && typeof current[part] === 'object' && !Array.isArray(current[part])
      ? current[part]
      : {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = structuredClone(value);
}
