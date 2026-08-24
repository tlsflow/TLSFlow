import { AppError } from '../../../common/errors/app-error.js';
import type {
  WorkflowDslV1,
  WorkflowExtractor,
  WorkflowStep,
  WorkflowVariableDefinition,
  WorkflowVariableType,
} from '../dto/workflow-templates.dto.js';

const rootKeys = new Set(['apiVersion', 'kind', 'metadata', 'variables', 'connections', 'steps', 'rollback']);
const metadataKeys = new Set(['name', 'displayName', 'description', 'category', 'tags', 'version', 'logoUrl', 'platforms', 'updateMethods', 'maintainer', 'homepage']);
const updateMethodValues = new Set(['ssh', 'curl']);
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const variableKeys = new Set(['type', 'configurationMode', 'required', 'default', 'enum', 'sensitive', 'description', 'artifactContract', 'source', 'lifecycle', 'bindingPolicy', 'ui']);
const stepBaseKeys = new Set(['name', 'type', 'stage', 'when', 'retry', 'extract', 'assert']);
const httpStepKeys = new Set([...stepBaseKeys, 'request']);
const sshStepKeys = new Set([...stepBaseKeys, 'ssh']);
const sftpStepKeys = new Set([...stepBaseKeys, 'sftp']);
const scpStepKeys = new Set([...stepBaseKeys, 'scp']);
const conditionStepKeys = new Set([...stepBaseKeys, 'condition', 'description']);
const transformStepKeys = new Set([...stepBaseKeys, 'transform']);
const foreachStepKeys = new Set([...stepBaseKeys, 'foreach']);
const checkpointStepKeys = new Set([...stepBaseKeys, 'checkpoint']);
const waitStepKeys = new Set([...stepBaseKeys, 'seconds']);
const manualStepKeys = new Set([...stepBaseKeys, 'instruction']);
const variableTypes = new Set<WorkflowVariableType>(['string', 'number', 'boolean', 'enum', 'object', 'file', 'credential', 'certificate']);
const stepTypes = new Set(['http', 'ssh', 'sftp', 'scp', 'condition', 'transform', 'foreach', 'checkpoint', 'wait', 'manual']);
const workflowStages = new Set(['prepare', 'backup', 'install', 'refresh', 'verify']);
const reservedRoots = new Set(['asset', 'previous', 'steps']);

export class WorkflowSchemaRegistry {
  validate(content: unknown): WorkflowDslV1 {
    if (!isRecord(content)) throw validationError('模板必须是对象');
    rejectUnknown(content, rootKeys, 'root');
    if (content.apiVersion !== 'gcac.workflow/v1') throw validationError('apiVersion 只支持 gcac.workflow/v1');
    if (content.kind !== 'CurlSshWorkflow') throw validationError('kind 只支持 CurlSshWorkflow');
    validateMetadata(content.metadata);
    validateVariables(content.variables);
    if (content.connections !== undefined) validateConnections(content.connections);
    validateSteps(content.steps, 'steps');
    if (content.rollback !== undefined) validateSteps(content.rollback, 'rollback');
    scanPlainSecrets(content, []);
    const typedContent = content as unknown as WorkflowDslV1;
    validateExplicitConfigurationContract(typedContent);
    validateVariableReferences(typedContent);
    return typedContent;
  }
}

export const workflowTemplatesSchemaRegistry = new WorkflowSchemaRegistry();

function validateMetadata(value: unknown): void {
  if (!isRecord(value)) throw validationError('metadata 必须是对象');
  rejectUnknown(value, metadataKeys, 'metadata');
  if (!isNonEmptyString(value.name)) throw validationError('metadata.name 必填');
  if (value.displayName !== undefined && typeof value.displayName !== 'string') throw validationError('metadata.displayName 必须是字符串');
  if (value.description !== undefined && typeof value.description !== 'string') throw validationError('metadata.description 必须是字符串');
  if (value.category !== undefined && typeof value.category !== 'string') throw validationError('metadata.category 必须是字符串');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every((item) => typeof item === 'string'))) throw validationError('metadata.tags 必须是字符串数组');
  if (value.version !== undefined && (!isNonEmptyString(value.version) || !semanticVersionPattern.test(value.version))) {
    throw validationError('metadata.version 必须是 SemVer 语义版本，例如 1.0.0');
  }
  if (value.logoUrl !== undefined) validateLogoUrl(value.logoUrl);
  if (value.platforms !== undefined && (!Array.isArray(value.platforms) || !value.platforms.length || !value.platforms.every(isNonEmptyString))) {
    throw validationError('metadata.platforms 必须是非空字符串数组');
  }
  if (value.updateMethods !== undefined && (!Array.isArray(value.updateMethods) || !value.updateMethods.length || !value.updateMethods.every((item) => typeof item === 'string' && updateMethodValues.has(item)))) {
    throw validationError('metadata.updateMethods 只支持 ssh 或 curl');
  }
  if (value.maintainer !== undefined && !isNonEmptyString(value.maintainer)) throw validationError('metadata.maintainer 必须是非空字符串');
  if (value.homepage !== undefined && (!isNonEmptyString(value.homepage) || !/^https?:\/\//i.test(value.homepage))) {
    throw validationError('metadata.homepage 必须是 HTTP(S) URL');
  }
}

function validateLogoUrl(value: unknown): void {
  if (!isNonEmptyString(value)) throw validationError('metadata.logoUrl 必须是非空字符串');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    throw validationError('metadata.logoUrl 只支持 HTTP(S) URL 或本地 Web 路径');
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw validationError('metadata.logoUrl 本地路径不能包含 ..');
}

function validateVariables(value: unknown): void {
  if (!isRecord(value)) throw validationError('variables 必须是对象');
  for (const [name, definition] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw validationError('变量名必须是英文标识符', { name });
    if (!isRecord(definition)) throw validationError('变量定义必须是对象', { name });
    rejectUnknown(definition, variableKeys, `variables.${name}`);
    const typed = definition as unknown as WorkflowVariableDefinition;
    if (!variableTypes.has(typed.type)) throw validationError('变量类型不支持', { name, type: typed.type });
    if (typed.required !== undefined && typeof typed.required !== 'boolean') throw validationError('required 必须是布尔值', { name });
    if (typed.sensitive !== undefined && typeof typed.sensitive !== 'boolean') throw validationError('sensitive 必须是布尔值', { name });
    if (typed.type === 'enum' && (!Array.isArray(typed.enum) || typed.enum.length === 0)) throw validationError('enum 变量必须提供枚举值', { name });
    if (typed.configurationMode !== undefined && !['required', 'advanced', 'runtime'].includes(typed.configurationMode)) throw validationError('configurationMode 不支持', { name });
    if (typed.lifecycle !== undefined && !['pre_execution', 'runtime_injected', 'step_output'].includes(typed.lifecycle)) throw validationError('lifecycle 不支持', { name });
    if (typed.bindingPolicy !== undefined && !['fixed', 'default_overridable', 'required_binding'].includes(typed.bindingPolicy)) throw validationError('bindingPolicy 不支持', { name });
    if (typed.source !== undefined) validateVariableSource(typed.source, `variables.${name}.source`);
    if (typed.ui !== undefined && !isRecord(typed.ui)) throw validationError(`variables.${name}.ui 必须是对象`);
    if (typed.configurationMode === 'runtime' && typed.lifecycle === 'pre_execution') throw validationError('runtime 变量不能使用 pre_execution 生命周期', { name });
    if (typed.configurationMode === 'advanced' && typed.bindingPolicy === 'required_binding') throw validationError('advanced 变量不能使用 required_binding', { name });
    if (typed.artifactContract !== undefined) validateArtifactContract(typed, name);
    if (typed.default !== undefined) validateVariableValue(typed, typed.default, `variables.${name}.default`);
  }
}

function validateVariableSource(source: unknown, path: string): void {
  if (!isRecord(source) || typeof source.kind !== 'string') throw validationError(`${path} 必须声明 kind`);
  if (source.kind === 'asset_ssl' && typeof source.path !== 'string') throw validationError(`${path}.path 必填`);
  if (source.kind === 'dsl' && !Object.prototype.hasOwnProperty.call(source, 'value')) throw validationError(`${path}.value 必填`);
  if (source.kind === 'derived' && !['endpoint_url', 'authority', 'binding_information'].includes(String(source.resolver))) throw validationError(`${path}.resolver 不支持`);
  if (source.kind === 'system' && typeof source.key !== 'string') throw validationError(`${path}.key 必填`);
  if (source.kind === 'credential' && source.slot !== undefined && typeof source.slot !== 'string') throw validationError(`${path}.slot 必须是字符串`);
  if (source.kind === 'step_output' && (typeof source.step !== 'string' || typeof source.output !== 'string')) throw validationError(`${path}.step/output 必填`);
  if (!['asset_ssl', 'dsl', 'derived', 'system', 'credential', 'certificate', 'step_output'].includes(source.kind)) throw validationError(`${path}.kind 不支持`);
}

function validateConnections(value: unknown): void {
  if (!isRecord(value)) throw validationError('connections 必须是对象');
  for (const [name, connection] of Object.entries(value)) {
    if (!isRecord(connection) || !['ssh', 'http'].includes(String(connection.protocol))) throw validationError('连接槽位定义无效', { name });
    for (const fieldName of ['host', 'port', 'username']) {
      const field = connection[fieldName];
      if (field === undefined && fieldName === 'username') continue;
      if (!isRecord(field) || !['required', 'advanced'].includes(String(field.configurationMode))) throw validationError(`connections.${name}.${fieldName} 必须声明 configurationMode`);
    }
    if (connection.credential !== undefined) {
      if (!isRecord(connection.credential) || typeof connection.credential.slot !== 'string' || !['required', 'advanced'].includes(String(connection.credential.configurationMode))) throw validationError(`connections.${name}.credential 定义无效`);
    }
    if (connection.hostKey !== undefined && (!isRecord(connection.hostKey) || !['required', 'advanced'].includes(String(connection.hostKey.configurationMode)))) throw validationError(`connections.${name}.hostKey 定义无效`);
  }
}

function validateExplicitConfigurationContract(content: WorkflowDslV1): void {
  const explicit = content.connections !== undefined || Object.values(content.variables).some((item) => item.configurationMode || item.source || item.lifecycle || item.bindingPolicy);
  if (!explicit) return;
  for (const [name, definition] of Object.entries(content.variables)) {
    if (!definition.configurationMode || !definition.source || !definition.lifecycle) throw validationError('新 DSL 变量必须显式声明 configurationMode/source/lifecycle', { name });
  }
}

function validateArtifactContract(definition: WorkflowVariableDefinition, name: string): void {
  if (definition.type !== 'certificate') throw validationError('artifactContract 只能用于 certificate 变量', { name });
  const contract = definition.artifactContract;
  if (!isRecord(contract)) throw validationError('artifactContract 必须是对象', { name });
  rejectUnknown(contract, new Set(['outputs']), `variables.${name}.artifactContract`);
  if (!isRecord(contract.outputs) || Object.keys(contract.outputs).length === 0) {
    throw validationError('artifactContract.outputs 必须是非空对象', { name });
  }
  for (const [outputName, output] of Object.entries(contract.outputs)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(outputName)) throw validationError('artifactContract output 名称不合法', { name, outputName });
    if (!isRecord(output)) throw validationError('artifactContract output 必须是对象', { name, outputName });
    rejectUnknown(output, new Set(['role', 'required', 'format', 'encoding', 'description']), `variables.${name}.artifactContract.outputs.${outputName}`);
    if (!isNonEmptyString(output.role)) throw validationError('artifactContract output.role 必填', { name, outputName });
    if (output.required !== undefined && typeof output.required !== 'boolean') throw validationError('artifactContract output.required 必须是布尔值', { name, outputName });
    if (output.format !== undefined && typeof output.format !== 'string') throw validationError('artifactContract output.format 必须是字符串', { name, outputName });
    if (output.encoding !== undefined && typeof output.encoding !== 'string') throw validationError('artifactContract output.encoding 必须是字符串', { name, outputName });
    if (output.description !== undefined && typeof output.description !== 'string') throw validationError('artifactContract output.description 必须是字符串', { name, outputName });
  }
}

function validateSteps(value: unknown, path: string, depth = 0): void {
  if (!Array.isArray(value) || value.length === 0) throw validationError(`${path} 必须是非空数组`);
  if (depth > 3) throw validationError('foreach 嵌套不能超过 3 层', { path });
  const names = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw validationError(`${path}.${index} 必须是对象`);
    if (!isNonEmptyString(item.name)) throw validationError(`${path}.${index}.name 必填`);
    if (names.has(item.name)) throw validationError('步骤名重复', { name: item.name, path });
    names.add(item.name);
    if (!stepTypes.has(String(item.type))) throw validationError('步骤类型不支持', { name: item.name, type: item.type });
    validateStepByType(item as unknown as WorkflowStep, `${path}.${index}`, depth);
    validateCommonStep(item, `${path}.${index}`);
  }
}

function validateStepByType(step: WorkflowStep, path: string, depth: number): void {
  if (step.type === 'http') {
    rejectUnknown(step as unknown as Record<string, unknown>, httpStepKeys, path);
    if (!isRecord(step.request)) throw validationError(`${path}.request 必须是对象`);
    rejectUnknown(step.request as unknown as Record<string, unknown>, new Set(['method', 'url', 'query', 'headers', 'headerRefs', 'bodyType', 'body', 'form', 'formCredentialRefs', 'multipart', 'auth', 'tls', 'timeoutSeconds', 'maxResponseBytes', 'successStatusCodes', 'failOnNon2xx']), `${path}.request`);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(step.request.method)) throw validationError(`${path}.request.method 不支持`);
    if (!isNonEmptyString(step.request.url)) throw validationError(`${path}.request.url 必填`);
    if (step.request.headers !== undefined && !isStringRecord(step.request.headers)) throw validationError(`${path}.request.headers 必须是字符串对象`);
    if (step.request.headerRefs !== undefined && !isSecretRefRecord(step.request.headerRefs)) throw validationError(`${path}.request.headerRefs 必须是 SecretRef 字符串对象`);
    if (step.request.query !== undefined && !isPrimitiveRecord(step.request.query)) throw validationError(`${path}.request.query 必须是字符串、数字或布尔对象`);
    if (step.request.bodyType !== undefined && !['json', 'form', 'multipart', 'raw', 'none'].includes(step.request.bodyType)) throw validationError(`${path}.request.bodyType 不支持`);
    if (step.request.form !== undefined && !isPrimitiveRecord(step.request.form)) throw validationError(`${path}.request.form 必须是字符串、数字或布尔对象`);
    if (step.request.formCredentialRefs !== undefined) validateCredentialRecord(step.request.formCredentialRefs, `${path}.request.formCredentialRefs`);
    if (step.request.multipart !== undefined) validateMultipart(step.request.multipart, `${path}.request.multipart`);
    if (step.request.auth !== undefined) validateHttpAuth(step.request.auth, `${path}.request.auth`);
    if (step.request.tls !== undefined) validateHttpTls(step.request.tls, `${path}.request.tls`);
    if (step.request.timeoutSeconds !== undefined && !isPositiveInteger(step.request.timeoutSeconds)) throw validationError(`${path}.request.timeoutSeconds 必须是正整数`);
    if (step.request.maxResponseBytes !== undefined && !isPositiveInteger(step.request.maxResponseBytes)) throw validationError(`${path}.request.maxResponseBytes 必须是正整数`);
    if (step.request.successStatusCodes !== undefined && (!Array.isArray(step.request.successStatusCodes) || !step.request.successStatusCodes.every((item) => Number.isInteger(item) && item >= 100 && item <= 599))) throw validationError(`${path}.request.successStatusCodes 必须是 HTTP 状态码数组`);
    if (step.request.failOnNon2xx !== undefined && typeof step.request.failOnNon2xx !== 'boolean') throw validationError(`${path}.request.failOnNon2xx 必须是布尔值`);
    return;
  }
  if (step.type === 'ssh') {
    rejectUnknown(step as unknown as Record<string, unknown>, sshStepKeys, path);
    if (!isRecord(step.ssh)) throw validationError(`${path}.ssh 必须是对象`);
    rejectUnknown(step.ssh as unknown as Record<string, unknown>, new Set(['mode', 'connection', 'connectionRef', 'command', 'commands', 'script', 'dialogue', 'timeoutSeconds']), `${path}.ssh`);
    if (!['command', 'script', 'interactive'].includes(step.ssh.mode)) throw validationError(`${path}.ssh.mode 不支持`);
    if (step.ssh.connectionRef) {
      if (!isNonEmptyString(step.ssh.connectionRef)) throw validationError(`${path}.ssh.connectionRef 必须是非空字符串`);
    } else {
      validateSshConnection(step.ssh.connection, `${path}.ssh.connection`);
    }
    if (step.ssh.mode === 'command' && !isNonEmptyString(step.ssh.command) && (!Array.isArray(step.ssh.commands) || step.ssh.commands.length === 0)) throw validationError(`${path}.ssh.command 或 commands 必填`);
    if (step.ssh.commands !== undefined && (!Array.isArray(step.ssh.commands) || step.ssh.commands.length === 0 || !step.ssh.commands.every(isNonEmptyString))) throw validationError(`${path}.ssh.commands 必须是非空命令数组`);
    if (step.ssh.mode === 'script' && !isNonEmptyString(step.ssh.script)) throw validationError(`${path}.ssh.script 必填`);
    if (step.ssh.mode === 'interactive' && (!Array.isArray(step.ssh.dialogue) || step.ssh.dialogue.length === 0)) throw validationError(`${path}.ssh.dialogue 必填`);
    if (step.ssh.timeoutSeconds !== undefined && !isPositiveInteger(step.ssh.timeoutSeconds)) throw validationError(`${path}.ssh.timeoutSeconds 必须是正整数`);
    return;
  }
  if (step.type === 'sftp') {
    rejectUnknown(step as unknown as Record<string, unknown>, sftpStepKeys, path);
    validateFileTransferStep(step.sftp, `${path}.sftp`);
    return;
  }
  if (step.type === 'scp') {
    rejectUnknown(step as unknown as Record<string, unknown>, scpStepKeys, path);
    validateFileTransferStep(step.scp, `${path}.scp`);
    return;
  }
  if (step.type === 'condition') {
    rejectUnknown(step as unknown as Record<string, unknown>, conditionStepKeys, path);
    validateCondition(step.condition, `${path}.condition`);
    if (step.description !== undefined && typeof step.description !== 'string') throw validationError(`${path}.description 必须是字符串`);
    return;
  }
  if (step.type === 'transform') {
    rejectUnknown(step as unknown as Record<string, unknown>, transformStepKeys, path);
    validateTransform(step.transform, `${path}.transform`);
    return;
  }
  if (step.type === 'foreach') {
    rejectUnknown(step as unknown as Record<string, unknown>, foreachStepKeys, path);
    if (!isRecord(step.foreach)) throw validationError(`${path}.foreach 必须是对象`);
    rejectUnknown(step.foreach as unknown as Record<string, unknown>, new Set(['itemsPath', 'itemVariable', 'indexVariable', 'maxItems', 'steps']), `${path}.foreach`);
    if (!isNonEmptyString(step.foreach.itemsPath)) throw validationError(`${path}.foreach.itemsPath 必填`);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(step.foreach.itemVariable)) throw validationError(`${path}.foreach.itemVariable 不合法`);
    if (step.foreach.indexVariable !== undefined && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(step.foreach.indexVariable)) throw validationError(`${path}.foreach.indexVariable 不合法`);
    if (step.foreach.maxItems !== undefined && (!isPositiveInteger(step.foreach.maxItems) || step.foreach.maxItems > 1000)) throw validationError(`${path}.foreach.maxItems 必须在 1 到 1000 之间`);
    validateSteps(step.foreach.steps, `${path}.foreach.steps`, depth + 1);
    return;
  }
  if (step.type === 'checkpoint') {
    rejectUnknown(step as unknown as Record<string, unknown>, checkpointStepKeys, path);
    if (!isRecord(step.checkpoint)) throw validationError(`${path}.checkpoint 必须是对象`);
    rejectUnknown(step.checkpoint as unknown as Record<string, unknown>, new Set(['name', 'capture', 'normalizedHash', 'requiredForRollback']), `${path}.checkpoint`);
    if (!isNonEmptyString(step.checkpoint.name)) throw validationError(`${path}.checkpoint.name 必填`);
    if (!isRecord(step.checkpoint.capture) || Object.keys(step.checkpoint.capture).length === 0) throw validationError(`${path}.checkpoint.capture 必须是非空对象`);
    for (const [name, capturePath] of Object.entries(step.checkpoint.capture)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw validationError(`${path}.checkpoint.capture 名称不合法`, { name });
      if (!isNonEmptyString(capturePath) || !/^[a-zA-Z][a-zA-Z0-9_.\[\]]*$/.test(capturePath)) throw validationError(`${path}.checkpoint.capture 路径不合法`, { name, capturePath });
    }
    if (step.checkpoint.normalizedHash !== undefined && typeof step.checkpoint.normalizedHash !== 'boolean') throw validationError(`${path}.checkpoint.normalizedHash 必须是布尔值`);
    if (typeof step.checkpoint.requiredForRollback !== 'boolean') throw validationError(`${path}.checkpoint.requiredForRollback 必须是布尔值`);
    return;
  }
  if (step.type === 'wait') {
    rejectUnknown(step as unknown as Record<string, unknown>, waitStepKeys, path);
    if (!isPositiveInteger(step.seconds)) throw validationError(`${path}.seconds 必须是正整数`);
    return;
  }
  rejectUnknown(step as unknown as Record<string, unknown>, manualStepKeys, path);
  if (!isNonEmptyString(step.instruction)) throw validationError(`${path}.instruction 必填`);
}

function validateCommonStep(step: Record<string, unknown>, path: string): void {
  if (step.stage !== undefined && !workflowStages.has(String(step.stage))) throw validationError(`${path}.stage 不支持`);
  if (step.retry !== undefined) {
    if (!isRecord(step.retry)) throw validationError(`${path}.retry 必须是对象`);
    rejectUnknown(step.retry, new Set(['count', 'intervalSeconds', 'retryOnStatus', 'retryOnNetworkError']), `${path}.retry`);
    const retryCount = step.retry.count;
    if (retryCount !== undefined && (typeof retryCount !== 'number' || !Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5)) throw validationError(`${path}.retry.count 必须在 0-5 之间`);
    if (step.retry.intervalSeconds !== undefined && !isPositiveInteger(step.retry.intervalSeconds)) throw validationError(`${path}.retry.intervalSeconds 必须是正整数`);
    if (step.retry.retryOnStatus !== undefined && (!Array.isArray(step.retry.retryOnStatus) || !step.retry.retryOnStatus.every((item) => Number.isInteger(item) && item >= 100 && item <= 599))) throw validationError(`${path}.retry.retryOnStatus 必须是 HTTP 状态码数组`);
    if (step.retry.retryOnNetworkError !== undefined && typeof step.retry.retryOnNetworkError !== 'boolean') throw validationError(`${path}.retry.retryOnNetworkError 必须是布尔值`);
  }
  if (step.when !== undefined) {
    validateCondition(step.when, `${path}.when`);
  }
  normalizeExtractors(step.extract as WorkflowStep['extract']).forEach((extractor) => validateExtractor(extractor, path));
  if (step.assert !== undefined && !Array.isArray(step.assert)) throw validationError(`${path}.assert 必须是数组`);
}

export function normalizeExtractors(value: WorkflowStep['extract']): WorkflowExtractor[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return Object.entries(value).map(([name, extractor]) => ({ name, ...extractor }));
}

function validateExtractor(extractor: WorkflowExtractor, path: string): void {
  if (!isNonEmptyString(extractor.name)) throw validationError(`${path}.extract.name 必填`);
  if (!['jsonPath', 'outputPath', 'firstOf', 'header', 'regex', 'statusCode', 'textContains'].includes(extractor.type)) throw validationError(`${path}.extract.type 不支持`);
  if (extractor.type === 'jsonPath' && !isNonEmptyString(extractor.path)) throw validationError(`${path}.extract.path 必填`);
  if (extractor.type === 'outputPath' && !isNonEmptyString(extractor.path)) throw validationError(`${path}.extract.path 必填`);
  if (extractor.type === 'firstOf' && (!Array.isArray(extractor.paths) || extractor.paths.length === 0 || !extractor.paths.every(isNonEmptyString))) throw validationError(`${path}.extract.paths 必须是非空字符串数组`);
  if (extractor.type === 'header' && !isNonEmptyString(extractor.header)) throw validationError(`${path}.extract.header 必填`);
  if (extractor.type === 'regex' && !isNonEmptyString(extractor.pattern)) throw validationError(`${path}.extract.pattern 必填`);
  if (extractor.type === 'textContains' && !isNonEmptyString(extractor.value)) throw validationError(`${path}.extract.value 必填`);
}

function validateTransform(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['engine', 'input', 'outputs', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes']), path);
  if (value.engine !== 'jsonata') throw validationError(`${path}.engine 第一版只支持 jsonata`);
  if (!isRecord(value.outputs) || Object.keys(value.outputs).length === 0) throw validationError(`${path}.outputs 必须是非空对象`);
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 1000)) throw validationError(`${path}.timeoutMs 必须在 1-1000 之间`);
  if (value.maxInputBytes !== undefined && (!Number.isInteger(value.maxInputBytes) || Number(value.maxInputBytes) < 1 || Number(value.maxInputBytes) > 1024 * 1024)) throw validationError(`${path}.maxInputBytes 必须在 1-1048576 之间`);
  if (value.maxOutputBytes !== undefined && (!Number.isInteger(value.maxOutputBytes) || Number(value.maxOutputBytes) < 1 || Number(value.maxOutputBytes) > 1024 * 1024)) throw validationError(`${path}.maxOutputBytes 必须在 1-1048576 之间`);
  for (const [name, output] of Object.entries(value.outputs)) validateTransformOutput(name, output, `${path}.outputs.${name}`);
}

function validateTransformOutput(name: string, value: unknown, path: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw validationError(`${path} 输出变量名必须是英文标识符`);
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['expression', 'format', 'sensitive', 'optional']), path);
  if (!isNonEmptyString(value.expression)) throw validationError(`${path}.expression 必填`);
  if (value.expression.length > 4096) throw validationError(`${path}.expression 不能超过 4096 字符`);
  if (/\$(eval|assert|error)\s*\(/i.test(value.expression)) throw validationError(`${path}.expression 使用了禁用函数`);
  if (value.format !== undefined && !['raw', 'jsonString'].includes(String(value.format))) throw validationError(`${path}.format 不支持`);
  if (value.sensitive !== undefined && typeof value.sensitive !== 'boolean') throw validationError(`${path}.sensitive 必须是布尔值`);
  if (value.optional !== undefined && typeof value.optional !== 'boolean') throw validationError(`${path}.optional 必须是布尔值`);
}

function validateSshConnection(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['host', 'port', 'username', 'credential', 'expectedHostKeyFingerprint', 'hostKeyPolicy']), path);
  if (!isNonEmptyString(value.host) || !isNonEmptyString(value.username)) throw validationError(`${path} host/username 必填`);
  if (!isCredentialValue(value.credential)) throw validationError(`${path}.credential 必须是凭据对象或 credential 变量引用`);
}

function validateFileTransferStep(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['direction', 'connection', 'connectionRef', 'remotePath', 'contentRef', 'contentEncoding', 'localPath', 'temporaryPath', 'expectedHash', 'expectedSize', 'verifyHash', 'mode', 'owner', 'group', 'timeoutSeconds']), path);
  if (!['upload', 'download'].includes(String(value.direction))) throw validationError(`${path}.direction 不支持`);
  if (value.connectionRef) {
    if (!isNonEmptyString(value.connectionRef)) throw validationError(`${path}.connectionRef 必须是非空字符串`);
  } else {
    validateSshConnection(value.connection, `${path}.connection`);
  }
  if (!isNonEmptyString(value.remotePath)) throw validationError(`${path}.remotePath 必填`);
  if (value.contentRef !== undefined && !isNonEmptyString(value.contentRef)) throw validationError(`${path}.contentRef 必须是非空字符串`);
  if (value.localPath !== undefined && !isNonEmptyString(value.localPath)) throw validationError(`${path}.localPath 必须是非空字符串`);
  if (value.temporaryPath !== undefined && !isNonEmptyString(value.temporaryPath)) throw validationError(`${path}.temporaryPath 必须是非空字符串`);
  if (value.contentEncoding !== undefined && !['utf8', 'base64'].includes(String(value.contentEncoding))) throw validationError(`${path}.contentEncoding 不支持`);
  if (value.expectedHash !== undefined && (!isNonEmptyString(value.expectedHash) || !/^[a-fA-F0-9]{64}$/.test(value.expectedHash))) throw validationError(`${path}.expectedHash 必须是 sha256 hex 字符串`);
  if (value.expectedSize !== undefined && !isNonNegativeInteger(value.expectedSize)) throw validationError(`${path}.expectedSize 必须是非负整数`);
  if (value.verifyHash !== undefined && typeof value.verifyHash !== 'boolean') throw validationError(`${path}.verifyHash 必须是布尔值`);
  if (value.mode !== undefined && !isNonEmptyString(value.mode)) throw validationError(`${path}.mode 必须是字符串`);
  if (value.owner !== undefined && !isNonEmptyString(value.owner)) throw validationError(`${path}.owner 必须是字符串`);
  if (value.group !== undefined && !isNonEmptyString(value.group)) throw validationError(`${path}.group 必须是字符串`);
  if (value.timeoutSeconds !== undefined && !isPositiveInteger(value.timeoutSeconds)) throw validationError(`${path}.timeoutSeconds 必须是正整数`);
  if (value.direction === 'upload' && !isNonEmptyString(value.contentRef) && !isNonEmptyString(value.localPath)) {
    throw validationError(`${path} 上传至少需要 contentRef 或 localPath`);
  }
  if (value.direction === 'download' && !isNonEmptyString(value.localPath)) {
    throw validationError(`${path} 下载必须提供 localPath`);
  }
}

function validateCondition(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['variable', 'equals', 'notEquals', 'exists']), path);
  if (!isNonEmptyString(value.variable)) throw validationError(`${path}.variable 必填`);
  const operators = [value.equals !== undefined, value.notEquals !== undefined, value.exists !== undefined].filter(Boolean).length;
  if (operators !== 1) throw validationError(`${path} 必须且只能声明一个判断操作符`);
  if (value.exists !== undefined && typeof value.exists !== 'boolean') throw validationError(`${path}.exists 必须是布尔值`);
}

function validateMultipart(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  for (const [name, part] of Object.entries(value)) {
    if (!isRecord(part)) throw validationError(`${path}.${name} 必须是对象`);
    rejectUnknown(part, new Set(['value', 'filename', 'contentType', 'secretRef']), `${path}.${name}`);
    if (part.value !== undefined && !isPrimitive(part.value)) throw validationError(`${path}.${name}.value 必须是字符串、数字或布尔值`);
    if (part.filename !== undefined && typeof part.filename !== 'string') throw validationError(`${path}.${name}.filename 必须是字符串`);
    if (part.contentType !== undefined && typeof part.contentType !== 'string') throw validationError(`${path}.${name}.contentType 必须是字符串`);
    if (part.secretRef !== undefined && !isSecretRef(part.secretRef)) throw validationError(`${path}.${name}.secretRef 必须是 SecretRef`);
  }
}

function validateCredentialRecord(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  for (const [name, credential] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(name)) throw validationError(`${path}.${name} 字段名不合法`);
    if (!isCredentialValue(credential)) throw validationError(`${path}.${name} 必须是凭据对象或 credential 变量引用`);
  }
}

function validateHttpAuth(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  if (!isNonEmptyString(value.type)) throw validationError(`${path}.type 必填`);
  if (!['none', 'basic', 'bearer', 'api_key', 'cookie', 'custom_header', 'mtls'].includes(value.type)) throw validationError(`${path}.type 不支持`);
  if (value.type === 'none') {
    rejectUnknown(value, new Set(['type']), path);
    return;
  }
  if (value.type === 'basic') {
    rejectUnknown(value, new Set(['type', 'username', 'credential']), path);
    if (!isNonEmptyString(value.username)) throw validationError(`${path}.username 必填`);
    if (!isCredentialValue(value.credential)) throw validationError(`${path}.credential 必须是凭据对象或 credential 变量引用`);
    return;
  }
  if (value.type === 'bearer') {
    rejectUnknown(value, new Set(['type', 'credential']), path);
    if (!isCredentialValue(value.credential)) throw validationError(`${path}.credential 必须是凭据对象或 credential 变量引用`);
    return;
  }
  if (value.type === 'cookie') {
    rejectUnknown(value, new Set(['type', 'secretRef', 'name']), path);
    if (!isSecretRef(value.secretRef)) throw validationError(`${path}.secretRef 必须是 SecretRef`);
    if (value.name !== undefined && typeof value.name !== 'string') throw validationError(`${path}.name 必须是字符串`);
    return;
  }
  if (value.type === 'api_key') {
    rejectUnknown(value, new Set(['type', 'credential', 'in', 'name']), path);
    if (!isCredentialValue(value.credential)) throw validationError(`${path}.credential 必须是凭据对象或 credential 变量引用`);
    if (!isNonEmptyString(value.name)) throw validationError(`${path}.name 必填`);
    if (value.in !== undefined && !['header', 'query'].includes(String(value.in))) throw validationError(`${path}.in 不支持`);
    return;
  }
  if (value.type === 'custom_header') {
    rejectUnknown(value, new Set(['type', 'secretRef', 'headerName']), path);
    if (!isSecretRef(value.secretRef)) throw validationError(`${path}.secretRef 必须是 SecretRef`);
    if (!isNonEmptyString(value.headerName)) throw validationError(`${path}.headerName 必填`);
    return;
  }
  rejectUnknown(value, new Set(['type', 'certSecretRef', 'keySecretRef']), path);
  if (!isSecretRef(value.certSecretRef) || !isSecretRef(value.keySecretRef)) throw validationError(`${path} mTLS 必须使用证书和私钥 SecretRef`);
}

function validateHttpTls(value: unknown, path: string): void {
  if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  rejectUnknown(value, new Set(['verify', 'caSecretRef', 'clientCertSecretRef', 'clientKeySecretRef', 'sni', 'allowInsecure']), path);
  if (value.verify !== undefined && typeof value.verify !== 'boolean') throw validationError(`${path}.verify 必须是布尔值`);
  if (value.allowInsecure !== undefined && typeof value.allowInsecure !== 'boolean') throw validationError(`${path}.allowInsecure 必须是布尔值`);
  if (value.caSecretRef !== undefined && !isSecretRef(value.caSecretRef)) throw validationError(`${path}.caSecretRef 必须是 SecretRef`);
  if (value.clientCertSecretRef !== undefined && !isSecretRef(value.clientCertSecretRef)) throw validationError(`${path}.clientCertSecretRef 必须是 SecretRef`);
  if (value.clientKeySecretRef !== undefined && !isSecretRef(value.clientKeySecretRef)) throw validationError(`${path}.clientKeySecretRef 必须是 SecretRef`);
  if (value.sni !== undefined && typeof value.sni !== 'string') throw validationError(`${path}.sni 必须是字符串`);
}

function validateVariableReferences(content: WorkflowDslV1): void {
  const declared = new Set([...Object.keys(content.variables), ...reservedRoots]);
  const produced = new Set<string>();
  validateStepVariableReferences([...content.steps, ...(content.rollback ?? [])], declared, produced);
}

function validateStepVariableReferences(steps: WorkflowStep[], declared: Set<string>, produced: Set<string>): void {
  for (const step of steps) {
    const stepExtracts = normalizeExtractors(step.extract).map((extractor) => extractor.name);
    const known = new Set([...declared, ...produced, ...stepExtracts]);
    const references = step.type === 'foreach'
      ? [step.foreach.itemsPath, ...collectReferences({ ...step, foreach: { ...step.foreach, steps: [] } })]
      : step.type === 'checkpoint'
        ? [...Object.values(step.checkpoint.capture), ...collectReferences({ ...step, checkpoint: { ...step.checkpoint, capture: {} } })]
        : collectReferences(step);
    for (const reference of references) {
      const root = reference.split('.')[0]!;
      if (!known.has(root)) throw validationError('变量引用不存在', { reference, step: step.name });
    }
    if (step.type === 'foreach') {
      const childDeclared = new Set([...known, step.foreach.itemVariable]);
      if (step.foreach.indexVariable) childDeclared.add(step.foreach.indexVariable);
      validateStepVariableReferences(step.foreach.steps, childDeclared, new Set(produced));
    }
    for (const outputName of [...stepExtracts, ...transformOutputNames(step)]) produced.add(outputName);
    produced.add(`steps.${step.name}`);
  }
}

function transformOutputNames(step: WorkflowStep): string[] {
  return step.type === 'transform' ? Object.keys(step.transform.outputs) : [];
}

function collectReferences(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g)) refs.push(match[1]!);
      return;
    }
    if (Array.isArray(item)) item.forEach(visit);
    if (isRecord(item)) Object.values(item).forEach(visit);
  };
  visit(value);
  return refs;
}

export function validateVariableValue(definition: WorkflowVariableDefinition, value: unknown, path: string): void {
  if (definition.type === 'string' || definition.type === 'file') {
    if (typeof value !== 'string') throw validationError(`${path} 必须是字符串`);
  } else if (definition.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) throw validationError(`${path} 必须是数字`);
  } else if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw validationError(`${path} 必须是布尔值`);
  } else if (definition.type === 'enum') {
    if (!definition.enum?.some((item) => Object.is(item, value))) throw validationError(`${path} 不在枚举范围内`);
  } else if (definition.type === 'object' || definition.type === 'certificate') {
    if (!isRecord(value)) throw validationError(`${path} 必须是对象`);
  } else if (definition.type === 'credential') {
    if (!isCredentialValue(value)) throw validationError(`${path} 必须是凭据对象或 credential 变量引用`);
  }
}

function scanPlainSecrets(value: unknown, path: string[]): void {
  if (typeof value === 'string') {
    const inTemplate = /\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}/.test(value);
    if (!inTemplate && /-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[a-z0-9._-]{10,}|password\s*[:=]\s*[^{}\s]+|token\s*[:=]\s*[^{}\s]+|api[_-]?key\s*[:=]\s*[^{}\s]+/i.test(value)) {
      throw validationError('模板包含明文 Secret 或私钥', { path: path.join('.') });
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanPlainSecrets(item, [...path, String(index)]));
  if (isRecord(value)) Object.entries(value).forEach(([key, child]) => scanPlainSecrets(child, [...path, key]));
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validationError('未知字段', { path, field: key });
  }
}

function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_FAILED', message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isSecretRefRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => isSecretRef(item));
}

function isPrimitiveRecord(value: unknown): value is Record<string, string | number | boolean> {
  return isRecord(value) && Object.values(value).every(isPrimitive);
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value);
}

function isCredentialValue(value: unknown): boolean {
  if (typeof value === 'string') return /^\s*\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}\s*$/.test(value);
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && ['username_password', 'ssh_key', 'curl_bearer', 'curl_api_key'].includes(String(value.kind))
    && ['password', 'ssh_key', 'api_token'].includes(String(value.type));
}
