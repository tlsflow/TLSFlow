import { AppError } from '../../../common/errors/app-error.js';
import { normalizeMinimumGcacVersion } from '../../../common/version.js';
import type {
  AgentDeploymentPluginManifestV1,
  AgentPluginOperation,
  AgentPluginPermissionDeclaration,
  ExecutionVariableDefinition,
} from '../dto/agent-deployment-plugins.dto.js';

const platforms = ['WINDOWS', 'LINUX'] as const;
const stages = ['prepare', 'backup', 'install', 'refresh', 'verify', 'rollback'] as const;
const operationTypes = [
  'preflight.assert',
  'file.backup',
  'file.atomic_replace',
  'file.restore',
  'file.set_permissions',
  'command.execute',
  'service.control',
  'tls.verify',
  'windows.certificate.inspect_pfx',
  'windows.certificate_store.import_pfx',
  'windows.certificate_private_key.grant',
  'windows.iis.binding.capture',
  'windows.iis.binding.update_certificate',
  'windows.iis.binding.restore_certificate',
] as const;
const variableTypes = ['string', 'number', 'boolean', 'enum', 'object', 'file', 'certificate', 'credential'] as const;
const stageOrder = new Map(stages.map((stage, index) => [stage, index]));

export function validateAgentDeploymentPluginManifest(input: unknown): AgentDeploymentPluginManifestV1 {
  const manifest = record(input, 'manifest');
  requireExact(manifest.apiVersion, 'gcac.agent-plugin/v1', 'apiVersion');
  requireExact(manifest.kind, 'AgentDeploymentPlugin', 'kind');
  const pluginId = nonEmptyString(manifest.pluginId, 'pluginId');
  const name = nonEmptyString(manifest.name, 'name');
  const publisher = nonEmptyString(manifest.publisher, 'publisher');
  const version = nonEmptyString(manifest.version, 'version');
  const compatibility = validateCompatibility(manifest.compatibility);
  const variables = validateVariables(manifest.variables);
  const artifactInputs = validateArtifacts(manifest.artifactInputs);
  const permissions = validatePermissions(manifest.permissions);
  const operations = validateOperations(manifest.operations, false);
  const rollback = manifest.rollback === undefined ? undefined : validateOperations(manifest.rollback, true);
  validateReferences(operations, rollback ?? [], variables, artifactInputs);
  validateDependencies(operations, 'operations');
  validateDependencies(rollback ?? [], 'rollback');
  validateStageOrder(operations);
  validateRollbackCoverage(operations, rollback ?? []);
  return {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId,
    name,
    publisher,
    version,
    minGcacVersion: normalizeMinimumGcacVersion(manifest.minGcacVersion),
    metadata: isRecord(manifest.metadata) ? {
      displayName: optionalString(manifest.metadata.displayName),
      description: optionalString(manifest.metadata.description),
      category: optionalString(manifest.metadata.category),
      tags: stringArray(manifest.metadata.tags, 'metadata.tags', true),
      maintainer: optionalString(manifest.metadata.maintainer),
      homepage: optionalString(manifest.metadata.homepage),
    } : undefined,
    compatibility,
    variables,
    artifactInputs,
    permissions,
    operations,
    rollback,
  };
}

export function validateAgentPluginVariableValues(
  definitions: Record<string, ExecutionVariableDefinition>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const value = values[name] ?? definition.default;
    if (value === undefined) {
      if (definition.required) throw validationError(`变量 ${name} 必填`, { field: `variableBindings.${name}` });
      continue;
    }
    validateVariableValue(name, definition, value);
    normalized[name] = value;
  }
  const unknown = Object.keys(values).filter((name) => !definitions[name]);
  if (unknown.length > 0) throw validationError('存在未声明的插件变量', { unknown });
  return normalized;
}

function validateCompatibility(input: unknown): AgentDeploymentPluginManifestV1['compatibility'] {
  const value = record(input, 'compatibility');
  const declaredPlatforms = stringArray(value.platforms, 'compatibility.platforms')
    .map((item) => item.toUpperCase());
  if (declaredPlatforms.length === 0 || declaredPlatforms.some((item) => !platforms.includes(item as typeof platforms[number]))) {
    throw validationError('compatibility.platforms 只支持 WINDOWS/LINUX');
  }
  const operationSchemaVersions = value.operationSchemaVersions === undefined
    ? undefined
    : Object.fromEntries(Object.entries(record(value.operationSchemaVersions, 'compatibility.operationSchemaVersions')).map(([key, versions]) => [key, stringArray(versions, `compatibility.operationSchemaVersions.${key}`)]));
  return {
    platforms: declaredPlatforms as AgentDeploymentPluginManifestV1['compatibility']['platforms'],
    frameworks: stringArray(value.frameworks, 'compatibility.frameworks', true).map((item) => item.toUpperCase()),
    architectures: stringArray(value.architectures, 'compatibility.architectures', true),
    requiredCapabilities: stringArray(value.requiredCapabilities, 'compatibility.requiredCapabilities', true),
    operationSchemaVersions,
  };
}

function validateVariables(input: unknown): Record<string, ExecutionVariableDefinition> {
  const variables = record(input, 'variables');
  return Object.fromEntries(Object.entries(variables).map(([name, raw]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw validationError(`变量名不合法: ${name}`);
    const value = record(raw, `variables.${name}`);
    const type = nonEmptyString(value.type, `variables.${name}.type`);
    if (!variableTypes.includes(type as typeof variableTypes[number])) throw validationError(`variables.${name}.type 不支持`);
    const definition: ExecutionVariableDefinition = {
      type: type as ExecutionVariableDefinition['type'],
      required: value.required === true,
      description: optionalString(value.description),
      default: value.default,
      enum: stringArray(value.enum, `variables.${name}.enum`, true),
      pattern: optionalString(value.pattern),
      minimum: optionalNumber(value.minimum, `variables.${name}.minimum`),
      maximum: optionalNumber(value.maximum, `variables.${name}.maximum`),
      editableScope: value.editableScope === 'EXECUTION' ? 'EXECUTION' : 'ASSET',
      sensitive: value.sensitive === true,
    };
    if (definition.type === 'enum' && (!definition.enum || definition.enum.length === 0)) throw validationError(`variables.${name}.enum 必填`);
    if (definition.default !== undefined) validateVariableValue(name, definition, definition.default);
    return [name, definition];
  }));
}

function validateArtifacts(input: unknown): AgentDeploymentPluginManifestV1['artifactInputs'] {
  const artifacts = record(input, 'artifactInputs');
  const allowed = new Set(['certificate', 'private_key', 'certificate_chain', 'bundle', 'file']);
  return Object.fromEntries(Object.entries(artifacts).map(([name, raw]) => {
    const value = record(raw, `artifactInputs.${name}`);
    const type = nonEmptyString(value.type, `artifactInputs.${name}.type`);
    if (!allowed.has(type)) throw validationError(`artifactInputs.${name}.type 不支持`);
    return [name, { type, required: value.required === true, description: optionalString(value.description) }];
  })) as AgentDeploymentPluginManifestV1['artifactInputs'];
}

function validatePermissions(input: unknown): AgentPluginPermissionDeclaration[] {
  if (!Array.isArray(input)) throw validationError('permissions 必须是数组');
  const names = new Set<string>();
  return input.map((raw, index) => {
    const value = record(raw, `permissions.${index}`);
    const name = nonEmptyString(value.name, `permissions.${index}.name`);
    if (names.has(name)) throw validationError(`permission.name 不能重复: ${name}`);
    names.add(name);
    const risk = nonEmptyString(value.risk, `permissions.${index}.risk`);
    const scope = nonEmptyString(value.scope, `permissions.${index}.scope`);
    if (!['low', 'medium', 'high'].includes(risk)) throw validationError(`permissions.${index}.risk 不支持`);
    if (!['filesystem', 'process', 'service', 'network', 'secret', 'shell', 'certificate_store', 'iis'].includes(scope)) throw validationError(`permissions.${index}.scope 不支持`);
    return {
      name,
      description: optionalString(value.description),
      risk: risk as AgentPluginPermissionDeclaration['risk'],
      scope: scope as AgentPluginPermissionDeclaration['scope'],
      values: stringArray(value.values, `permissions.${index}.values`),
    };
  });
}

function validateOperations(input: unknown, rollback: boolean): AgentPluginOperation[] {
  if (!Array.isArray(input) || (!rollback && input.length === 0)) throw validationError(`${rollback ? 'rollback' : 'operations'} 必须是非空数组`);
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const path = `${rollback ? 'rollback' : 'operations'}.${index}`;
    const value = record(raw, path);
    const id = nonEmptyString(value.id, `${path}.id`);
    if (ids.has(id)) throw validationError(`operation.id 不能重复: ${id}`);
    ids.add(id);
    const stage = nonEmptyString(value.stage, `${path}.stage`);
    const operationType = nonEmptyString(value.operationType, `${path}.operationType`);
    if (!stages.includes(stage as typeof stages[number])) throw validationError(`${path}.stage 不支持`);
    if (rollback && stage !== 'rollback') throw validationError(`${path}.stage 必须是 rollback`);
    if (!operationTypes.includes(operationType as typeof operationTypes[number])) throw validationError(`${path}.operationType 不支持`);
    requireExact(value.schemaVersion, '1.0', `${path}.schemaVersion`);
    const operation: AgentPluginOperation = {
      id,
      name: nonEmptyString(value.name, `${path}.name`),
      stage: stage as AgentPluginOperation['stage'],
      operationType: operationType as AgentPluginOperation['operationType'],
      schemaVersion: '1.0',
      timeoutSeconds: optionalPositiveNumber(value.timeoutSeconds, `${path}.timeoutSeconds`),
      continueOnError: value.continueOnError === true,
      dependsOn: stringArray(value.dependsOn, `${path}.dependsOn`, true),
      input: record(value.input, `${path}.input`),
    };
    if (['install', 'refresh', 'verify'].includes(operation.stage) && operation.continueOnError) {
      throw validationError(`${path}.continueOnError 不允许用于核心部署阶段`);
    }
    if (operation.operationType === 'command.execute') validateCommandInput(operation.input, path);
    return operation;
  });
}

function validateCommandInput(input: Record<string, unknown>, path: string): void {
  nonEmptyString(input.program, `${path}.input.program`);
  stringArray(input.args, `${path}.input.args`, true);
  if (isRecord(input.shell) && input.shell.enabled === true) {
    throw validationError(`${path}.input.shell 第一版不允许启用`);
  }
}

function validateDependencies(operations: AgentPluginOperation[], path: string): void {
  const ids = new Set(operations.map((item) => item.id));
  for (const operation of operations) {
    for (const dependency of operation.dependsOn ?? []) {
      if (!ids.has(dependency)) throw validationError(`${path}.${operation.id} 引用了不存在的依赖 ${dependency}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(operations.map((item) => [item.id, item]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw validationError(`${path} 存在循环依赖`, { operationId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const operation of operations) visit(operation.id);
}

function validateStageOrder(operations: AgentPluginOperation[]): void {
  let previous = -1;
  for (const operation of operations) {
    const current = stageOrder.get(operation.stage) ?? -1;
    if (current < previous) throw validationError('operations 阶段顺序不合法', { operationId: operation.id, stage: operation.stage });
    previous = current;
  }
}

function validateRollbackCoverage(operations: AgentPluginOperation[], rollback: AgentPluginOperation[]): void {
  const hasSideEffect = operations.some((item) => [
    'file.atomic_replace',
    'file.set_permissions',
    'command.execute',
    'service.control',
    'windows.certificate_store.import_pfx',
    'windows.certificate_private_key.grant',
    'windows.iis.binding.update_certificate',
  ].includes(item.operationType));
  if (hasSideEffect && rollback.length === 0) throw validationError('包含副作用的插件必须声明 rollback');
}

function validateReferences(
  operations: AgentPluginOperation[],
  rollback: AgentPluginOperation[],
  variables: Record<string, ExecutionVariableDefinition>,
  artifacts: AgentDeploymentPluginManifestV1['artifactInputs'],
): void {
  const variablePattern = /\$\{variables\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
  const artifactPattern = /\$\{artifacts\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
  for (const operation of [...operations, ...rollback]) {
    const serialized = JSON.stringify(operation.input);
    for (const match of serialized.matchAll(variablePattern)) {
      if (!variables[match[1]]) throw validationError(`操作 ${operation.id} 引用了不存在的变量 ${match[1]}`);
    }
    for (const match of serialized.matchAll(artifactPattern)) {
      const artifactName = match[1].split('.')[0];
      if (!artifacts[artifactName]) throw validationError(`操作 ${operation.id} 引用了不存在的 Artifact ${match[1]}`);
    }
  }
}

function validateVariableValue(name: string, definition: ExecutionVariableDefinition, value: unknown): void {
  if (definition.type === 'string' || definition.type === 'file' || definition.type === 'credential') {
    if (typeof value !== 'string' || value.trim() === '') throw validationError(`变量 ${name} 必须是非空字符串`);
    if (definition.pattern && !new RegExp(definition.pattern).test(value)) throw validationError(`变量 ${name} 不符合格式`);
  } else if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw validationError(`变量 ${name} 必须是数字`);
    if (definition.minimum !== undefined && value < definition.minimum) throw validationError(`变量 ${name} 小于最小值`);
    if (definition.maximum !== undefined && value > definition.maximum) throw validationError(`变量 ${name} 大于最大值`);
  } else if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw validationError(`变量 ${name} 必须是布尔值`);
  } else if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.enum?.includes(value)) throw validationError(`变量 ${name} 不在允许选项中`);
  } else if (!isRecord(value)) {
    throw validationError(`变量 ${name} 必须是对象`);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw validationError(`${field} 必须是对象`, { field });
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw validationError(`${field} 必须是非空字符串`, { field });
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, field: string, optional = false): string[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw validationError(`${field} 必须是字符串数组`);
  return value.map((item) => String(item).trim());
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw validationError(`${field} 必须是数字`);
  return value;
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
  const number = optionalNumber(value, field);
  if (number !== undefined && (number <= 0 || number > 3600)) throw validationError(`${field} 必须在 1 到 3600 秒之间`);
  return number;
}

function requireExact(value: unknown, expected: string, field: string): void {
  if (value !== expected) throw validationError(`${field} 不支持`, { field, expected });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('AGENT_PLUGIN_MANIFEST_INVALID', message, details);
}
