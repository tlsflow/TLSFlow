import { AppError } from '../../../common/errors/app-error.js';
import {
  DEPLOYMENT_INPUT_CONTRACT_API_VERSION,
  type DeploymentArtifactOutputDefinitionV1,
  type DeploymentArtifactSlotV1,
  type DeploymentBindingPolicy,
  type DeploymentConfigurationMode,
  type DeploymentConnectionDefinitionV1,
  type DeploymentConnectionFieldV1,
  type DeploymentCredentialKind,
  type DeploymentCredentialSlotV1,
  type DeploymentInputContractV1,
  type DeploymentInputLifecycle,
  type DeploymentInputUiDefinitionV1,
  type DeploymentVariableDefinitionV1,
  type DeploymentVariableSourceV1,
  type DeploymentVariableType,
} from '../dto/deployment-input-contract.dto.js';

const slotNamePattern = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const variableTypes = new Set<DeploymentVariableType>(['string', 'number', 'boolean', 'enum', 'object', 'array', 'file']);
const configurationModes = new Set<DeploymentConfigurationMode>(['required', 'advanced', 'runtime']);
const lifecycles = new Set<DeploymentInputLifecycle>(['pre_execution', 'runtime_injected', 'step_output']);
const bindingPolicies = new Set<DeploymentBindingPolicy>(['fixed', 'default_overridable', 'required_binding']);
const credentialKinds = new Set<DeploymentCredentialKind>(['USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE']);
const sourceKinds = new Set<DeploymentVariableSourceV1['kind']>(['asset', 'binding', 'default', 'derived', 'system', 'step_output']);

const rootKeys = new Set(['apiVersion', 'variables', 'connections', 'credentials', 'artifacts']);
const variableKeys = new Set(['type', 'required', 'configurationMode', 'source', 'lifecycle', 'bindingPolicy', 'default', 'enum', 'pattern', 'minimum', 'maximum', 'sensitive', 'descriptionKey', 'ui']);
const sourceKeys = {
  asset: new Set(['kind', 'path']),
  binding: new Set(['kind']),
  default: new Set(['kind']),
  derived: new Set(['kind', 'resolver']),
  system: new Set(['kind', 'key']),
  step_output: new Set(['kind', 'step', 'output']),
} satisfies Record<DeploymentVariableSourceV1['kind'], Set<string>>;
const uiKeys = new Set(['labelKey', 'group', 'order', 'helpKey']);
const connectionKeys = new Set(['transport', 'host', 'port', 'username', 'credentialSlot', 'tls', 'hostKey', 'descriptionKey', 'ui']);
const connectionFieldKeys = new Set(['type', 'required', 'configurationMode', 'source', 'lifecycle', 'bindingPolicy', 'default', 'sensitive', 'descriptionKey', 'ui']);
const tlsKeys = new Set(['verifyPeer', 'serverName']);
const hostKeyKeys = new Set(['policy', 'expectedFingerprint']);
const credentialKeys = new Set(['allowedKinds', 'required', 'configurationMode', 'lifecycle', 'descriptionKey', 'ui']);
const artifactKeys = new Set(['kind', 'required', 'configurationMode', 'lifecycle', 'artifactContract', 'descriptionKey', 'ui']);
const artifactContractKeys = new Set(['outputs']);
const artifactOutputKeys = new Set(['role', 'required', 'format', 'encoding', 'sensitive', 'descriptionKey']);

export class DeploymentInputContractSchemaRegistry {
  validate(input: unknown): DeploymentInputContractV1 {
    const contract = record(input, 'inputContract');
    rejectUnknown(contract, rootKeys, 'inputContract');
    requireExact(contract.apiVersion, DEPLOYMENT_INPUT_CONTRACT_API_VERSION, 'inputContract.apiVersion');

    const variables = validateRecord(contract.variables, 'inputContract.variables', validateVariableDefinition);
    const credentials = validateRecord(contract.credentials, 'inputContract.credentials', validateCredentialSlot);
    const connections = validateRecord(contract.connections, 'inputContract.connections', validateConnectionDefinition);
    const artifacts = validateRecord(contract.artifacts, 'inputContract.artifacts', validateArtifactSlot);

    validateConnectionCredentialReferences(connections, credentials);
    return { apiVersion: DEPLOYMENT_INPUT_CONTRACT_API_VERSION, variables, connections, credentials, artifacts };
  }
}

export const deploymentInputContractSchemaRegistry = new DeploymentInputContractSchemaRegistry();

export function validateDeploymentInputContractV1(input: unknown): DeploymentInputContractV1 {
  return deploymentInputContractSchemaRegistry.validate(input);
}

function validateVariableDefinition(input: unknown, path: string): DeploymentVariableDefinitionV1 {
  const definition = record(input, path);
  rejectUnknown(definition, variableKeys, path);
  const type = enumValue(definition.type, variableTypes, `${path}.type`);
  const required = booleanValue(definition.required, `${path}.required`);
  const configurationMode = enumValue(definition.configurationMode, configurationModes, `${path}.configurationMode`);
  const source = validateSource(definition.source, `${path}.source`);
  const lifecycle = enumValue(definition.lifecycle, lifecycles, `${path}.lifecycle`);
  const bindingPolicy = enumValue(definition.bindingPolicy, bindingPolicies, `${path}.bindingPolicy`);
  validateSourcePolicy(source, bindingPolicy, lifecycle, definition.default, path);
  validateVariableConstraints(type, definition, path);

  return {
    type,
    required,
    configurationMode,
    source,
    lifecycle,
    bindingPolicy,
    default: definition.default,
    enum: optionalArray(definition.enum, `${path}.enum`),
    pattern: optionalString(definition.pattern, `${path}.pattern`),
    minimum: optionalNumber(definition.minimum, `${path}.minimum`),
    maximum: optionalNumber(definition.maximum, `${path}.maximum`),
    sensitive: optionalBoolean(definition.sensitive, `${path}.sensitive`),
    descriptionKey: optionalString(definition.descriptionKey, `${path}.descriptionKey`),
    ui: validateUi(definition.ui, `${path}.ui`),
  };
}

function validateConnectionDefinition(input: unknown, path: string): DeploymentConnectionDefinitionV1 {
  const definition = record(input, path);
  rejectUnknown(definition, connectionKeys, path);
  const transport = enumValue(definition.transport, new Set(['http', 'ssh'] as const), `${path}.transport`);
  const host = validateConnectionField(definition.host, `${path}.host`, 'string');
  const port = validateConnectionField(definition.port, `${path}.port`, 'number');
  const username = definition.username === undefined ? undefined : validateConnectionField(definition.username, `${path}.username`, 'string');
  const credentialSlot = optionalString(definition.credentialSlot, `${path}.credentialSlot`);
  const tls = definition.tls === undefined ? undefined : validateTls(definition.tls, `${path}.tls`);
  const hostKey = definition.hostKey === undefined ? undefined : validateHostKey(definition.hostKey, `${path}.hostKey`);

  if (transport === 'http' && hostKey !== undefined) throw validationError(`${path}.hostKey 仅适用于 ssh 连接`, { path });
  if (transport === 'ssh' && tls !== undefined) throw validationError(`${path}.tls 仅适用于 http 连接`, { path });

  return {
    transport,
    host,
    port,
    username,
    credentialSlot,
    tls,
    hostKey,
    descriptionKey: optionalString(definition.descriptionKey, `${path}.descriptionKey`),
    ui: validateUi(definition.ui, `${path}.ui`),
  };
}

function validateConnectionField(input: unknown, path: string, expectedType?: DeploymentConnectionFieldV1['type']): DeploymentConnectionFieldV1 {
  const field = record(input, path);
  rejectUnknown(field, connectionFieldKeys, path);
  const type = enumValue(field.type, new Set(['string', 'number', 'boolean'] as const), `${path}.type`);
  if (expectedType !== undefined && type !== expectedType) throw validationError(`${path}.type 必须是 ${expectedType}`, { path, expectedType });
  const source = validateSource(field.source, `${path}.source`, false);
  const lifecycle = enumValue(field.lifecycle, new Set(['pre_execution', 'runtime_injected'] as const), `${path}.lifecycle`);
  const bindingPolicy = enumValue(field.bindingPolicy, bindingPolicies, `${path}.bindingPolicy`);
  validateSourcePolicy(source, bindingPolicy, lifecycle, field.default, path);
  validateScalarValue(type, field.default, `${path}.default`, true);

  return {
    type,
    required: booleanValue(field.required, `${path}.required`),
    configurationMode: enumValue(field.configurationMode, configurationModes, `${path}.configurationMode`),
    source,
    lifecycle,
    bindingPolicy,
    default: field.default as string | number | boolean | undefined,
    sensitive: optionalBoolean(field.sensitive, `${path}.sensitive`),
    descriptionKey: optionalString(field.descriptionKey, `${path}.descriptionKey`),
    ui: validateUi(field.ui, `${path}.ui`),
  };
}

function validateCredentialSlot(input: unknown, path: string): DeploymentCredentialSlotV1 {
  const slot = record(input, path);
  rejectUnknown(slot, credentialKeys, path);
  if (!Array.isArray(slot.allowedKinds) || slot.allowedKinds.length === 0) throw validationError(`${path}.allowedKinds 必须是非空数组`, { path });
  const allowedKinds = slot.allowedKinds.map((kind, index) => enumValue(kind, credentialKinds, `${path}.allowedKinds.${index}`));
  if (new Set(allowedKinds).size !== allowedKinds.length) throw validationError(`${path}.allowedKinds 不能重复`, { path });
  return {
    allowedKinds,
    required: booleanValue(slot.required, `${path}.required`),
    configurationMode: enumValue(slot.configurationMode, new Set(['required', 'advanced'] as const), `${path}.configurationMode`),
    lifecycle: enumValue(slot.lifecycle, new Set(['pre_execution', 'runtime_injected'] as const), `${path}.lifecycle`),
    descriptionKey: optionalString(slot.descriptionKey, `${path}.descriptionKey`),
    ui: validateUi(slot.ui, `${path}.ui`),
  };
}

function validateArtifactSlot(input: unknown, path: string): DeploymentArtifactSlotV1 {
  const slot = record(input, path);
  rejectUnknown(slot, artifactKeys, path);
  const contract = record(slot.artifactContract, `${path}.artifactContract`);
  rejectUnknown(contract, artifactContractKeys, `${path}.artifactContract`);
  const outputs = validateRecord(contract.outputs, `${path}.artifactContract.outputs`, validateArtifactOutput, true);
  return {
    kind: enumValue(slot.kind, new Set(['certificate', 'file'] as const), `${path}.kind`),
    required: booleanValue(slot.required, `${path}.required`),
    configurationMode: enumValue(slot.configurationMode, new Set(['required', 'advanced'] as const), `${path}.configurationMode`),
    lifecycle: enumValue(slot.lifecycle, new Set(['pre_execution', 'runtime_injected'] as const), `${path}.lifecycle`),
    artifactContract: { outputs },
    descriptionKey: optionalString(slot.descriptionKey, `${path}.descriptionKey`),
    ui: validateUi(slot.ui, `${path}.ui`),
  };
}

function validateArtifactOutput(input: unknown, path: string): DeploymentArtifactOutputDefinitionV1 {
  const output = record(input, path);
  rejectUnknown(output, artifactOutputKeys, path);
  return {
    role: nonEmptyString(output.role, `${path}.role`),
    required: booleanValue(output.required, `${path}.required`),
    format: optionalString(output.format, `${path}.format`),
    encoding: optionalString(output.encoding, `${path}.encoding`),
    sensitive: optionalBoolean(output.sensitive, `${path}.sensitive`),
    descriptionKey: optionalString(output.descriptionKey, `${path}.descriptionKey`),
  };
}

function validateSource(input: unknown, path: string): DeploymentVariableSourceV1;
function validateSource(input: unknown, path: string, allowStepOutput: false): Exclude<DeploymentVariableSourceV1, { kind: 'step_output' }>;
function validateSource(input: unknown, path: string, allowStepOutput = true): DeploymentVariableSourceV1 {
  const source = record(input, path);
  const kind = enumValue(source.kind, sourceKinds, `${path}.kind`);
  if (!allowStepOutput && kind === 'step_output') throw validationError(`${path}.kind 不支持 step_output`, { path });
  rejectUnknown(source, sourceKeys[kind], path);
  if (kind === 'asset') return { kind, path: nonEmptyString(source.path, `${path}.path`) };
  if (kind === 'derived') return { kind, resolver: nonEmptyString(source.resolver, `${path}.resolver`) };
  if (kind === 'system') return { kind, key: nonEmptyString(source.key, `${path}.key`) };
  if (kind === 'step_output') {
    return { kind, step: nonEmptyString(source.step, `${path}.step`), output: nonEmptyString(source.output, `${path}.output`) };
  }
  return { kind };
}

function validateSourcePolicy(
  source: DeploymentVariableSourceV1,
  bindingPolicy: DeploymentBindingPolicy,
  lifecycle: DeploymentInputLifecycle,
  defaultValue: unknown,
  path: string,
): void {
  const allowedPolicies: Record<DeploymentVariableSourceV1['kind'], DeploymentBindingPolicy[]> = {
    asset: ['fixed'],
    binding: ['required_binding', 'default_overridable'],
    default: ['default_overridable'],
    derived: ['fixed'],
    system: ['fixed'],
    step_output: ['fixed'],
  };
  if (!allowedPolicies[source.kind].includes(bindingPolicy)) {
    throw validationError(`${path}.source 与 bindingPolicy 组合无效`, { path, source: source.kind, bindingPolicy });
  }
  if (source.kind === 'default' && defaultValue === undefined) throw validationError(`${path}.default 必填`, { path });
  if (source.kind !== 'default' && bindingPolicy !== 'default_overridable' && defaultValue !== undefined) {
    throw validationError(`${path}.default 仅允许用于可覆盖默认值`, { path });
  }
  if (source.kind === 'step_output' && lifecycle !== 'step_output') throw validationError(`${path}.lifecycle 必须是 step_output`, { path });
  if (source.kind !== 'step_output' && lifecycle === 'step_output') throw validationError(`${path}.lifecycle 与 source 不匹配`, { path });
}

function validateVariableConstraints(type: DeploymentVariableType, definition: Record<string, unknown>, path: string): void {
  const values = optionalArray(definition.enum, `${path}.enum`);
  if (type === 'enum' && (!values || values.length === 0)) throw validationError(`${path}.enum 必须是非空数组`, { path });
  if (type !== 'enum' && values !== undefined) throw validationError(`${path}.enum 仅允许用于 enum 类型`, { path });
  if (definition.pattern !== undefined && !['string', 'file'].includes(type)) throw validationError(`${path}.pattern 仅允许用于字符串或文件类型`, { path });
  if ((definition.minimum !== undefined || definition.maximum !== undefined) && type !== 'number') throw validationError(`${path}.minimum/maximum 仅允许用于 number 类型`, { path });
  validateVariableValue(type, definition.default, `${path}.default`, true, values);
}

function validateVariableValue(type: DeploymentVariableType, value: unknown, path: string, optional: boolean, enumValues?: unknown[]): void {
  if (value === undefined && optional) return;
  if (type === 'string' || type === 'file') validateScalarValue('string', value, path);
  else if (type === 'number') validateScalarValue('number', value, path);
  else if (type === 'boolean') validateScalarValue('boolean', value, path);
  else if (type === 'enum' && !enumValues?.some((item) => Object.is(item, value))) throw validationError(`${path} 不在 enum 允许值中`, { path });
  else if (type === 'object' && !isRecord(value)) throw validationError(`${path} 必须是对象`, { path });
  else if (type === 'array' && !Array.isArray(value)) throw validationError(`${path} 必须是数组`, { path });
}

function validateScalarValue(type: 'string' | 'number' | 'boolean', value: unknown, path: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== type || (type === 'number' && !Number.isFinite(value))) throw validationError(`${path} 必须是 ${type}`, { path });
}

function validateTls(input: unknown, path: string): DeploymentConnectionDefinitionV1['tls'] {
  const tls = record(input, path);
  rejectUnknown(tls, tlsKeys, path);
  return {
    verifyPeer: validateConnectionField(tls.verifyPeer, `${path}.verifyPeer`, 'boolean'),
    serverName: tls.serverName === undefined ? undefined : validateConnectionField(tls.serverName, `${path}.serverName`, 'string'),
  };
}

function validateHostKey(input: unknown, path: string): DeploymentConnectionDefinitionV1['hostKey'] {
  const hostKey = record(input, path);
  rejectUnknown(hostKey, hostKeyKeys, path);
  return {
    policy: enumValue(hostKey.policy, new Set(['strict', 'trust_on_first_use', 'manual_approval_required'] as const), `${path}.policy`),
    expectedFingerprint: hostKey.expectedFingerprint === undefined
      ? undefined
      : validateConnectionField(hostKey.expectedFingerprint, `${path}.expectedFingerprint`, 'string'),
  };
}

function validateConnectionCredentialReferences(
  connections: Record<string, DeploymentConnectionDefinitionV1>,
  credentials: Record<string, DeploymentCredentialSlotV1>,
): void {
  for (const [name, connection] of Object.entries(connections)) {
    if (connection.credentialSlot && !credentials[connection.credentialSlot]) {
      throw validationError(`inputContract.connections.${name}.credentialSlot 引用了未声明的凭据槽位`, {
        path: `inputContract.connections.${name}.credentialSlot`,
        credentialSlot: connection.credentialSlot,
      });
    }
  }
}

function validateUi(input: unknown, path: string): DeploymentInputUiDefinitionV1 | undefined {
  if (input === undefined) return undefined;
  const ui = record(input, path);
  rejectUnknown(ui, uiKeys, path);
  return {
    labelKey: optionalString(ui.labelKey, `${path}.labelKey`),
    group: optionalString(ui.group, `${path}.group`),
    order: optionalNumber(ui.order, `${path}.order`),
    helpKey: optionalString(ui.helpKey, `${path}.helpKey`),
  };
}

function validateRecord<T>(
  input: unknown,
  path: string,
  validate: (value: unknown, itemPath: string) => T,
  requireNonEmpty = false,
): Record<string, T> {
  const value = record(input, path);
  if (requireNonEmpty && Object.keys(value).length === 0) throw validationError(`${path} 必须是非空对象`, { path });
  return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    if (!slotNamePattern.test(name)) throw validationError(`${path} 包含非法槽位名称`, { path, name });
    return [name, validate(item, `${path}.${name}`)];
  }));
}

function enumValue<T extends string>(input: unknown, allowed: Set<T>, path: string): T {
  if (typeof input !== 'string' || !allowed.has(input as T)) throw validationError(`${path} 不支持`, { path, value: input });
  return input as T;
}

function booleanValue(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') throw validationError(`${path} 必须是布尔值`, { path });
  return input;
}

function optionalBoolean(input: unknown, path: string): boolean | undefined {
  if (input === undefined) return undefined;
  return booleanValue(input, path);
}

function optionalNumber(input: unknown, path: string): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'number' || !Number.isFinite(input)) throw validationError(`${path} 必须是数字`, { path });
  return input;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) return undefined;
  return nonEmptyString(input, path);
}

function optionalArray(input: unknown, path: string): unknown[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw validationError(`${path} 必须是数组`, { path });
  return input;
}

function nonEmptyString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim() === '') throw validationError(`${path} 必须是非空字符串`, { path });
  return input.trim();
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!isRecord(input)) throw validationError(`${path} 必须是对象`, { path });
  return input;
}

function requireExact(input: unknown, expected: string, path: string): void {
  if (input !== expected) throw validationError(`${path} 不支持`, { path, expected });
}

function rejectUnknown(input: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw validationError(`${path} 包含未知字段`, { path, unknown });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function validationError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('DEPLOYMENT_INPUT_CONTRACT_INVALID', message, details);
}
