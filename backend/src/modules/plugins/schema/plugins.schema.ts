import { AppError } from '../../../common/errors/app-error.js';
import type {
  PluginActionDeclaration,
  PluginPackageManifest,
  PluginPermissionDeclaration,
  PluginRuntimeDescriptor,
  PluginRuntimeType,
} from '../dto/plugins.dto.js';

export const pluginRuntimeTypes = ['process', 'container', 'wasm', 'http'] as const satisfies readonly PluginRuntimeType[];
export const pluginPermissionRisks = ['low', 'medium', 'high'] as const;
export const pluginSignatureStatuses = ['trusted', 'untrusted', 'missing', 'invalid'] as const;
export const pluginInstallStatuses = [
  'uploaded',
  'metadata_validated',
  'pending_approval',
  'installed_disabled',
  'enabled',
  'disabled',
  'quarantined',
] as const;

export const pluginsSchemaBoundary = {
  module: 'plugins',
  status: 'IMPLEMENTED_MOCK_SAFE',
  runtimeTypes: pluginRuntimeTypes,
} as const;

export function validatePluginManifest(input: unknown): PluginPackageManifest {
  if (!isRecord(input)) {
    throw metadataError('manifest 必须是对象');
  }

  requireString(input, 'apiVersion');
  requireString(input, 'kind');
  requireString(input, 'pluginId');
  requireString(input, 'name');
  requireString(input, 'publisher');
  requireString(input, 'version');

  if (input.apiVersion !== 'gcac.plugin/v1') {
    throw metadataError('apiVersion 不支持', { field: 'apiVersion', expected: 'gcac.plugin/v1' });
  }
  if (input.kind !== 'Plugin') {
    throw metadataError('kind 不支持', { field: 'kind', expected: 'Plugin' });
  }

  const runtime = validateRuntimeDescriptor(input.runtime);
  const actions = validateActions(input.actions);
  const permissions = validatePermissions(input.permissions);
  const capabilities = validateCapabilities(input.capabilities);

  return {
    apiVersion: 'gcac.plugin/v1',
    kind: 'Plugin',
    pluginId: String(input.pluginId),
    name: String(input.name),
    publisher: String(input.publisher),
    version: String(input.version),
    runtime,
    actions,
    permissions,
    capabilities,
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
  };
}

export function validateRuntimeDescriptor(input: unknown): PluginRuntimeDescriptor {
  if (!isRecord(input)) {
    throw metadataError('runtime 必须是对象', { field: 'runtime' });
  }
  requireString(input, 'type');
  requireString(input, 'entry');
  requireNumber(input, 'timeoutSeconds');

  if (!pluginRuntimeTypes.includes(input.type as PluginRuntimeType)) {
    throw metadataError('runtime.type 不支持', { field: 'runtime.type', allowedValues: pluginRuntimeTypes });
  }
  if (Number(input.timeoutSeconds) <= 0 || Number(input.timeoutSeconds) > 3600) {
    throw metadataError('runtime.timeoutSeconds 必须在 1 到 3600 秒之间', { field: 'runtime.timeoutSeconds' });
  }

  const runtime: PluginRuntimeDescriptor = {
    type: input.type as PluginRuntimeType,
    entry: String(input.entry),
    timeoutSeconds: Number(input.timeoutSeconds),
  };

  if (input.allowedCommands !== undefined) {
    runtime.allowedCommands = requireStringArray(input.allowedCommands, 'runtime.allowedCommands');
  }

  if (runtime.type === 'container') {
    if (!isRecord(input.container) || typeof input.container.image !== 'string') {
      throw metadataError('container runtime 必须声明 image', { field: 'runtime.container.image' });
    }
    runtime.container = { image: input.container.image, readonlyRootFs: Boolean(input.container.readonlyRootFs) };
  }
  if (runtime.type === 'wasm') {
    if (!isRecord(input.wasm) || typeof input.wasm.module !== 'string') {
      throw metadataError('wasm runtime 必须声明 module', { field: 'runtime.wasm.module' });
    }
    runtime.wasm = { module: input.wasm.module };
  }
  if (runtime.type === 'http') {
    if (!isRecord(input.http) || typeof input.http.endpoint !== 'string') {
      throw metadataError('http runtime 必须声明 endpoint', { field: 'runtime.http.endpoint' });
    }
    runtime.http = { endpoint: input.http.endpoint, method: input.http.method === 'GET' ? 'GET' : 'POST' };
  }

  return runtime;
}

function validateActions(input: unknown): PluginActionDeclaration[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw metadataError('actions 至少声明一个动作', { field: 'actions' });
  }
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!isRecord(item)) {
      throw metadataError('action 必须是对象', { field: `actions.${index}` });
    }
    requireString(item, 'name', `actions.${index}.name`);
    const name = String(item.name);
    if (seen.has(name)) {
      throw metadataError('action.name 不能重复', { field: `actions.${index}.name`, name });
    }
    seen.add(name);
    return {
      name,
      command: typeof item.command === 'string' ? item.command : undefined,
      requiredPermissions: item.requiredPermissions === undefined
        ? []
        : requireStringArray(item.requiredPermissions, `actions.${index}.requiredPermissions`),
      requiredSecretScopes: item.requiredSecretScopes === undefined
        ? []
        : requireStringArray(item.requiredSecretScopes, `actions.${index}.requiredSecretScopes`),
      inputSchema: isRecord(item.inputSchema) ? item.inputSchema : undefined,
      outputSchema: isRecord(item.outputSchema) ? item.outputSchema : undefined,
    };
  });
}

function validatePermissions(input: unknown): PluginPermissionDeclaration[] {
  if (!Array.isArray(input)) {
    throw metadataError('permissions 必须是数组', { field: 'permissions' });
  }
  return input.map((item, index) => {
    if (!isRecord(item)) {
      throw metadataError('permission 必须是对象', { field: `permissions.${index}` });
    }
    requireString(item, 'name', `permissions.${index}.name`);
    requireString(item, 'risk', `permissions.${index}.risk`);
    requireString(item, 'scope', `permissions.${index}.scope`);
    if (!pluginPermissionRisks.includes(item.risk as 'low' | 'medium' | 'high')) {
      throw metadataError('permission.risk 不支持', { field: `permissions.${index}.risk`, allowedValues: pluginPermissionRisks });
    }
    return {
      name: String(item.name),
      description: typeof item.description === 'string' ? item.description : undefined,
      risk: item.risk as PluginPermissionDeclaration['risk'],
      scope: item.scope as PluginPermissionDeclaration['scope'],
      values: item.values === undefined ? [] : requireStringArray(item.values, `permissions.${index}.values`),
    };
  });
}

function validateCapabilities(input: unknown): PluginPackageManifest['capabilities'] {
  if (!Array.isArray(input)) {
    throw metadataError('capabilities 必须是数组', { field: 'capabilities' });
  }
  return input.map((item, index) => {
    if (!isRecord(item)) {
      throw metadataError('capability 必须是对象', { field: `capabilities.${index}` });
    }
    const key = typeof item.key === 'string' ? item.key : typeof item.type === 'string' ? item.type : undefined;
    if (!key) {
      throw metadataError('capability 必须声明 key 或 type', { field: `capabilities.${index}.key` });
    }
    return {
      key,
      type: typeof item.type === 'string' ? item.type : undefined,
      level: typeof item.level === 'string' ? item.level : 'L1',
      riskLevel: pluginPermissionRisks.includes(item.riskLevel as 'low' | 'medium' | 'high')
        ? item.riskLevel as 'low' | 'medium' | 'high'
        : undefined,
      requires: item.requires === undefined ? [] : requireStringArray(item.requires, `capabilities.${index}.requires`),
      os: item.os === undefined ? [] : requireStringArray(item.os, `capabilities.${index}.os`),
    };
  });
}

function requireString(record: Record<string, unknown>, key: string, field = key): void {
  if (typeof record[key] !== 'string' || record[key] === '') {
    throw metadataError('字段必须是非空字符串', { field });
  }
}

function requireNumber(record: Record<string, unknown>, key: string, field = key): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) {
    throw metadataError('字段必须是数字', { field });
  }
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw metadataError('字段必须是字符串数组', { field });
  }
  return value.map(String);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

function metadataError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('VALIDATION_FAILED', `插件 metadata 无效：${message}`, details);
}
