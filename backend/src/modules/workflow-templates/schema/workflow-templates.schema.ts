import { AppError } from '../../../common/errors/app-error.js';
import type {
  WorkflowDslV1,
  WorkflowExtractor,
  WorkflowStep,
  WorkflowVariableDefinition,
  WorkflowVariableType,
} from '../dto/workflow-templates.dto.js';

const rootKeys = new Set(['apiVersion', 'kind', 'metadata', 'variables', 'steps', 'rollback']);
const metadataKeys = new Set(['name', 'displayName', 'category', 'tags']);
const variableKeys = new Set(['type', 'required', 'default', 'enum', 'sensitive', 'description']);
const stepBaseKeys = new Set(['name', 'type', 'when', 'retry', 'extract', 'assert']);
const httpStepKeys = new Set([...stepBaseKeys, 'request']);
const sshStepKeys = new Set([...stepBaseKeys, 'ssh']);
const waitStepKeys = new Set([...stepBaseKeys, 'seconds']);
const manualStepKeys = new Set([...stepBaseKeys, 'instruction']);
const variableTypes = new Set<WorkflowVariableType>(['string', 'number', 'boolean', 'enum', 'object', 'file', 'secret', 'certificate']);
const stepTypes = new Set(['http', 'ssh', 'wait', 'manual']);
const reservedRoots = new Set(['asset', 'steps']);

export class WorkflowSchemaRegistry {
  validate(content: unknown): WorkflowDslV1 {
    if (!isRecord(content)) throw validationError('模板必须是对象');
    rejectUnknown(content, rootKeys, 'root');
    if (content.apiVersion !== 'gcac.workflow/v1') throw validationError('apiVersion 只支持 gcac.workflow/v1');
    if (content.kind !== 'CurlSshWorkflow') throw validationError('kind 只支持 CurlSshWorkflow');
    validateMetadata(content.metadata);
    validateVariables(content.variables);
    validateSteps(content.steps, 'steps');
    if (content.rollback !== undefined) validateSteps(content.rollback, 'rollback');
    scanPlainSecrets(content, []);
    const typedContent = content as unknown as WorkflowDslV1;
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
  if (value.category !== undefined && typeof value.category !== 'string') throw validationError('metadata.category 必须是字符串');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every((item) => typeof item === 'string'))) throw validationError('metadata.tags 必须是字符串数组');
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
    if (typed.type === 'secret' && typed.default !== undefined) throw validationError('secret 变量不能提供默认值', { name });
    if (typed.default !== undefined) validateVariableValue(typed, typed.default, `variables.${name}.default`);
  }
}

function validateSteps(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0) throw validationError(`${path} 必须是非空数组`);
  const names = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw validationError(`${path}.${index} 必须是对象`);
    if (!isNonEmptyString(item.name)) throw validationError(`${path}.${index}.name 必填`);
    if (names.has(item.name)) throw validationError('步骤名重复', { name: item.name, path });
    names.add(item.name);
    if (!stepTypes.has(String(item.type))) throw validationError('步骤类型不支持', { name: item.name, type: item.type });
    validateStepByType(item as unknown as WorkflowStep, `${path}.${index}`);
    validateCommonStep(item, `${path}.${index}`);
  }
}

function validateStepByType(step: WorkflowStep, path: string): void {
  if (step.type === 'http') {
    rejectUnknown(step as unknown as Record<string, unknown>, httpStepKeys, path);
    if (!isRecord(step.request)) throw validationError(`${path}.request 必须是对象`);
    rejectUnknown(step.request as unknown as Record<string, unknown>, new Set(['method', 'url', 'headers', 'body', 'timeoutSeconds']), `${path}.request`);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(step.request.method)) throw validationError(`${path}.request.method 不支持`);
    if (!isNonEmptyString(step.request.url)) throw validationError(`${path}.request.url 必填`);
    if (step.request.headers !== undefined && !isStringRecord(step.request.headers)) throw validationError(`${path}.request.headers 必须是字符串对象`);
    if (step.request.timeoutSeconds !== undefined && !isPositiveInteger(step.request.timeoutSeconds)) throw validationError(`${path}.request.timeoutSeconds 必须是正整数`);
    return;
  }
  if (step.type === 'ssh') {
    rejectUnknown(step as unknown as Record<string, unknown>, sshStepKeys, path);
    if (!isRecord(step.ssh)) throw validationError(`${path}.ssh 必须是对象`);
    rejectUnknown(step.ssh as unknown as Record<string, unknown>, new Set(['mode', 'connection', 'command', 'script', 'dialogue', 'timeoutSeconds']), `${path}.ssh`);
    if (!['command', 'script', 'interactive'].includes(step.ssh.mode)) throw validationError(`${path}.ssh.mode 不支持`);
    if (!isRecord(step.ssh.connection)) throw validationError(`${path}.ssh.connection 必须是对象`);
    rejectUnknown(step.ssh.connection as unknown as Record<string, unknown>, new Set(['host', 'port', 'username', 'credentialSecretRef', 'expectedHostKeyFingerprint', 'hostKeyPolicy']), `${path}.ssh.connection`);
    if (!isNonEmptyString(step.ssh.connection.host) || !isNonEmptyString(step.ssh.connection.username)) throw validationError(`${path}.ssh.connection host/username 必填`);
    if (!isSecretRef(step.ssh.connection.credentialSecretRef)) throw validationError(`${path}.ssh.connection.credentialSecretRef 必须是 SecretRef`);
    if (step.ssh.mode === 'command' && !isNonEmptyString(step.ssh.command)) throw validationError(`${path}.ssh.command 必填`);
    if (step.ssh.mode === 'script' && !isNonEmptyString(step.ssh.script)) throw validationError(`${path}.ssh.script 必填`);
    if (step.ssh.mode === 'interactive' && (!Array.isArray(step.ssh.dialogue) || step.ssh.dialogue.length === 0)) throw validationError(`${path}.ssh.dialogue 必填`);
    if (step.ssh.timeoutSeconds !== undefined && !isPositiveInteger(step.ssh.timeoutSeconds)) throw validationError(`${path}.ssh.timeoutSeconds 必须是正整数`);
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
  if (step.retry !== undefined) {
    if (!isRecord(step.retry)) throw validationError(`${path}.retry 必须是对象`);
    rejectUnknown(step.retry, new Set(['count', 'intervalSeconds']), `${path}.retry`);
    const retryCount = step.retry.count;
    if (retryCount !== undefined && (typeof retryCount !== 'number' || !Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5)) throw validationError(`${path}.retry.count 必须在 0-5 之间`);
    if (step.retry.intervalSeconds !== undefined && !isPositiveInteger(step.retry.intervalSeconds)) throw validationError(`${path}.retry.intervalSeconds 必须是正整数`);
  }
  if (step.when !== undefined) {
    if (!isRecord(step.when)) throw validationError(`${path}.when 必须是对象`);
    rejectUnknown(step.when, new Set(['variable', 'equals', 'notEquals', 'exists']), `${path}.when`);
    if (!isNonEmptyString(step.when.variable)) throw validationError(`${path}.when.variable 必填`);
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
  if (!['jsonPath', 'header', 'regex', 'statusCode', 'textContains'].includes(extractor.type)) throw validationError(`${path}.extract.type 不支持`);
  if (extractor.type === 'jsonPath' && !isNonEmptyString(extractor.path)) throw validationError(`${path}.extract.path 必填`);
  if (extractor.type === 'header' && !isNonEmptyString(extractor.header)) throw validationError(`${path}.extract.header 必填`);
  if (extractor.type === 'regex' && !isNonEmptyString(extractor.pattern)) throw validationError(`${path}.extract.pattern 必填`);
  if (extractor.type === 'textContains' && !isNonEmptyString(extractor.value)) throw validationError(`${path}.extract.value 必填`);
}

function validateVariableReferences(content: WorkflowDslV1): void {
  const declared = new Set([...Object.keys(content.variables), ...reservedRoots]);
  const produced = new Set<string>();
  for (const step of [...content.steps, ...(content.rollback ?? [])]) {
    const stepExtracts = normalizeExtractors(step.extract).map((extractor) => extractor.name);
    const known = new Set([...declared, ...produced, ...stepExtracts]);
    for (const reference of collectReferences(step)) {
      const root = reference.split('.')[0]!;
      if (!known.has(root)) throw validationError('变量引用不存在', { reference, step: step.name });
    }
    for (const extractor of stepExtracts) produced.add(extractor);
    produced.add(`steps.${step.name}`);
  }
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
  } else if (definition.type === 'secret') {
    if (!isSecretRef(value) && !isRecord(value)) throw validationError(`${path} 必须是 SecretRef 或授权后的 Secret 对象`);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value);
}
