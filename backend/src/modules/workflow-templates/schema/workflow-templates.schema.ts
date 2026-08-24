import { AppError } from '../../../common/errors/app-error.js';
import { validateDeploymentInputContractV1 } from '../../deployment-inputs/schema/deployment-input-contract.schema.js';
import type {
  WorkflowDslV1,
  WorkflowExtractor,
  WorkflowStep,
} from '../dto/workflow-templates.dto.js';
import { SSH_ALLOWED_PROGRAMS, SSH_ARGUMENT_TEMPLATES } from '../../executors/ssh/ssh.types.js';

const rootKeys = new Set(['apiVersion', 'kind', 'metadata', 'inputContract', 'steps', 'rollback']);
const metadataKeys = new Set(['name', 'displayName', 'description', 'category', 'tags', 'version', 'logoUrl', 'platforms', 'updateMethods', 'maintainer', 'homepage']);
const updateMethodValues = new Set(['ssh', 'curl']);
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const stepBaseKeys = new Set(['name', 'type', 'stage', 'when', 'retry', 'extract', 'assert']);
const httpStepKeys = new Set([...stepBaseKeys, 'request']);
const sshStepKeys = new Set([...stepBaseKeys, 'ssh']);
const browserStepKeys = new Set([...stepBaseKeys, 'browser']);
const sftpStepKeys = new Set([...stepBaseKeys, 'sftp']);
const scpStepKeys = new Set([...stepBaseKeys, 'scp']);
const conditionStepKeys = new Set([...stepBaseKeys, 'condition', 'description']);
const transformStepKeys = new Set([...stepBaseKeys, 'transform']);
const foreachStepKeys = new Set([...stepBaseKeys, 'foreach']);
const checkpointStepKeys = new Set([...stepBaseKeys, 'checkpoint']);
const checkpointVerifyStepKeys = new Set([...stepBaseKeys, 'checkpointVerify']);
const waitStepKeys = new Set([...stepBaseKeys, 'seconds']);
const manualStepKeys = new Set([...stepBaseKeys, 'instruction']);
const pluginActionStepKeys = new Set([...stepBaseKeys, 'pluginId', 'capability', 'actionId', 'actionContractVersion', 'input', 'inputSchemaSha256', 'outputSchemaSha256', 'timeoutSeconds', 'writeEffect', 'idempotencyKeyRef']);
const stepTypes = new Set(['http', 'ssh', 'sftp', 'scp', 'browser', 'condition', 'transform', 'foreach', 'checkpoint', 'checkpoint_verify', 'wait', 'manual', 'plugin.action']);
const workflowStages = new Set(['prepare', 'backup', 'install', 'refresh', 'verify']);
const reservedRoots = new Set(['asset', 'variables', 'connections', 'credentials', 'artifacts', 'steps', 'system']);
const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

export class WorkflowSchemaRegistry {
  validate(content: unknown): WorkflowDslV1 {
    if (!isRecord(content)) throw validationError('模板必须是对象');
    rejectUnknown(content, rootKeys, 'root');
    if (content.apiVersion !== 'gcac.workflow/v1') throw validationError('apiVersion 只支持 gcac.workflow/v1');
    if (content.kind !== 'CurlSshWorkflow') throw validationError('kind 只支持 CurlSshWorkflow');
    validateMetadata(content.metadata);
    if (content.inputContract === undefined) throw validationError('inputContract 必填');
    const inputContract = validateDeploymentInputContractV1(content.inputContract);
    validateSteps(content.steps, 'steps');
    if (content.rollback !== undefined) validateSteps(content.rollback, 'rollback');
    scanPlainSecrets(content, []);
    const typedContent = {
      ...content,
      inputContract,
    } as unknown as WorkflowDslV1;
    validateConnectionReferences(typedContent);
    validateVariableReferences(typedContent);
    return typedContent;
  }
}

function validateConnectionReferences(content: WorkflowDslV1): void {
  const visit = (step: WorkflowStep, path: string): void => {
    const reference = step.type === 'http' ? step.request.connectionRef
      : step.type === 'ssh' ? step.ssh.connectionRef
        : step.type === 'sftp' ? step.sftp.connectionRef
          : step.type === 'scp' ? step.scp.connectionRef
            : undefined;
    if (reference) {
      const connection = content.inputContract.connections[reference];
      if (!connection) throw validationError(`${path} 引用了未声明的连接槽位`, { path, connectionRef: reference });
      const expectedTransport = step.type === 'http' ? 'http' : 'ssh';
      if (connection.transport !== expectedTransport) {
        throw validationError(`${path} 引用的连接类型不匹配`, { path, connectionRef: reference, expectedTransport, actualTransport: connection.transport });
      }
    }
    if (step.type === 'foreach') step.foreach.steps.forEach((child, index) => visit(child, `${path}.foreach.steps.${index}`));
  };
  content.steps.forEach((step, index) => visit(step, `steps.${index}`));
  content.rollback?.forEach((step, index) => visit(step, `rollback.${index}`));
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
    rejectUnknown(step.request as unknown as Record<string, unknown>, new Set(['method', 'url', 'connectionRef', 'query', 'headers', 'headerRefs', 'bodyType', 'body', 'form', 'formCredentialRefs', 'multipart', 'auth', 'tls', 'timeoutSeconds', 'maxResponseBytes', 'successStatusCodes', 'failOnNon2xx']), `${path}.request`);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(step.request.method)) throw validationError(`${path}.request.method 不支持`);
    if (!isNonEmptyString(step.request.url)) throw validationError(`${path}.request.url 必填`);
    if (!isNonEmptyString(step.request.connectionRef)) throw validationError(`${path}.request.connectionRef 必须是非空字符串`);
    if (step.request.headers !== undefined && !isStringRecord(step.request.headers)) throw validationError(`${path}.request.headers 必须是字符串对象`);
    if (step.request.headerRefs !== undefined && !isSecretRefOrVariableRecord(step.request.headerRefs)) throw validationError(`${path}.request.headerRefs 必须是 SecretRef 或 credential 变量引用对象`);
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
    rejectUnknown(step.ssh as unknown as Record<string, unknown>, new Set(['connectionRef', 'program', 'args', 'argumentTemplate', 'timeoutSeconds']), `${path}.ssh`);
    if (!isNonEmptyString(step.ssh.connectionRef)) throw validationError(`${path}.ssh.connectionRef 必须是非空字符串`);
    if (!SSH_ALLOWED_PROGRAMS.includes(step.ssh.program)) throw validationError(`${path}.ssh.program 不在 SSH 远端程序白名单中`);
    if (!Array.isArray(step.ssh.args) || !step.ssh.args.every(isNonEmptyString)) throw validationError(`${path}.ssh.args 必须是字符串数组`);
    if (!Object.prototype.hasOwnProperty.call(SSH_ARGUMENT_TEMPLATES, step.ssh.argumentTemplate)) throw validationError(`${path}.ssh.argumentTemplate 不在白名单中`);
    const template = SSH_ARGUMENT_TEMPLATES[step.ssh.argumentTemplate as keyof typeof SSH_ARGUMENT_TEMPLATES];
    if (template.program !== step.ssh.program || template.valueCount !== step.ssh.args.length) throw validationError(`${path}.ssh 的 program、args 和 argumentTemplate 不匹配`);
    for (const arg of step.ssh.args) validateSshArgument(arg, `${path}.ssh.args`);
    if (step.ssh.timeoutSeconds !== undefined && !isPositiveInteger(step.ssh.timeoutSeconds)) throw validationError(`${path}.ssh.timeoutSeconds 必须是正整数`);
    return;
  }
  if (step.type === 'browser') {
    rejectUnknown(step as unknown as Record<string, unknown>, browserStepKeys, path);
    if (!isRecord(step.browser)) throw validationError(`${path}.browser 必须是对象`);
    rejectUnknown(step.browser as unknown as Record<string, unknown>, new Set(['action', 'url', 'extractions', 'verification']), `${path}.browser`);
    if (!['navigate', 'extract', 'verify'].includes(String(step.browser.action))) throw validationError(`${path}.browser.action 不支持`);
    if (step.browser.url !== undefined && !isNonEmptyString(step.browser.url)) throw validationError(`${path}.browser.url 必须是非空字符串`);
    if (step.browser.extractions !== undefined) {
      if (!Array.isArray(step.browser.extractions) || step.browser.extractions.length === 0) throw validationError(`${path}.browser.extractions 必须是非空数组`);
      for (const [index, extraction] of step.browser.extractions.entries()) {
        if (!isRecord(extraction)) throw validationError(`${path}.browser.extractions.${index} 必须是对象`);
        rejectUnknown(extraction, new Set(['name', 'source', 'key', 'optional', 'sensitive']), `${path}.browser.extractions.${index}`);
        if (!isNonEmptyString(extraction.name) || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(extraction.name)) throw validationError(`${path}.browser.extractions.${index}.name 不合法`);
        if (!['cookie', 'header', 'local_storage', 'session_storage', 'url', 'text'].includes(String(extraction.source))) throw validationError(`${path}.browser.extractions.${index}.source 不支持`);
        if (['cookie', 'header', 'local_storage', 'session_storage'].includes(String(extraction.source)) && !isNonEmptyString(extraction.key)) throw validationError(`${path}.browser.extractions.${index}.key 必填`);
        if (extraction.optional !== undefined && typeof extraction.optional !== 'boolean') throw validationError(`${path}.browser.extractions.${index}.optional 必须是布尔值`);
        if (extraction.sensitive !== undefined && typeof extraction.sensitive !== 'boolean') throw validationError(`${path}.browser.extractions.${index}.sensitive 必须是布尔值`);
      }
    }
    if (step.browser.verification !== undefined) {
      if (!isRecord(step.browser.verification)) throw validationError(`${path}.browser.verification 必须是对象`);
      rejectUnknown(step.browser.verification, new Set(['url', 'statusCode', 'textContains']), `${path}.browser.verification`);
      if (step.browser.verification.url !== undefined && !isNonEmptyString(step.browser.verification.url)) throw validationError(`${path}.browser.verification.url 必须是非空字符串`);
      if (step.browser.verification.statusCode !== undefined && (!Number.isInteger(step.browser.verification.statusCode) || step.browser.verification.statusCode < 100 || step.browser.verification.statusCode > 599)) throw validationError(`${path}.browser.verification.statusCode 必须是 HTTP 状态码`);
      if (step.browser.verification.textContains !== undefined && !isNonEmptyString(step.browser.verification.textContains)) throw validationError(`${path}.browser.verification.textContains 必须是非空字符串`);
    }
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
    rejectUnknown(step.foreach as unknown as Record<string, unknown>, new Set(['itemsPath', 'itemVariable', 'indexVariable', 'maxItems', 'continueOnError', 'steps']), `${path}.foreach`);
    if (!isNonEmptyString(step.foreach.itemsPath)) throw validationError(`${path}.foreach.itemsPath 必填`);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(step.foreach.itemVariable)) throw validationError(`${path}.foreach.itemVariable 不合法`);
    if (step.foreach.indexVariable !== undefined && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(step.foreach.indexVariable)) throw validationError(`${path}.foreach.indexVariable 不合法`);
    if (step.foreach.maxItems !== undefined && (!isPositiveInteger(step.foreach.maxItems) || step.foreach.maxItems > 1000)) throw validationError(`${path}.foreach.maxItems 必须在 1 到 1000 之间`);
    if (step.foreach.continueOnError !== undefined && typeof step.foreach.continueOnError !== 'boolean') throw validationError(`${path}.foreach.continueOnError 必须是布尔值`);
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
  if (step.type === 'checkpoint_verify') {
    rejectUnknown(step as unknown as Record<string, unknown>, checkpointVerifyStepKeys, path);
    if (!isRecord(step.checkpointVerify)) throw validationError(`${path}.checkpointVerify 必须是对象`);
    rejectUnknown(step.checkpointVerify, new Set(['valuePath', 'expectedHash']), `${path}.checkpointVerify`);
    if (!isNonEmptyString(step.checkpointVerify.valuePath) || !/^[a-zA-Z][a-zA-Z0-9_.\[\]]*$/.test(step.checkpointVerify.valuePath)) throw validationError(`${path}.checkpointVerify.valuePath 不合法`);
    if (!isNonEmptyString(step.checkpointVerify.expectedHash)) throw validationError(`${path}.checkpointVerify.expectedHash 必填`);
    return;
  }
  if (step.type === 'plugin.action') {
    rejectUnknown(step as unknown as Record<string, unknown>, pluginActionStepKeys, path);
    if (!isNonEmptyString(step.pluginId) || !identifierPattern.test(step.pluginId)) throw validationError(`${path}.pluginId 必须是固定标识符`);
    if (!isNonEmptyString(step.capability) || !identifierPattern.test(step.capability)) throw validationError(`${path}.capability 必须是固定标识符`);
    if (!isNonEmptyString(step.actionId) || !identifierPattern.test(step.actionId)) throw validationError(`${path}.actionId 必须是固定标识符`);
    if (!isNonEmptyString(step.actionContractVersion) || !identifierPattern.test(step.actionContractVersion)) throw validationError(`${path}.actionContractVersion 必须是固定标识符`);
    if (!isRecord(step.input)) throw validationError(`${path}.input 必须是对象`);
    if (!isNonEmptyString(step.inputSchemaSha256) || !sha256Pattern.test(step.inputSchemaSha256)) throw validationError(`${path}.inputSchemaSha256 必须是 sha256 摘要`);
    if (!isNonEmptyString(step.outputSchemaSha256) || !sha256Pattern.test(step.outputSchemaSha256)) throw validationError(`${path}.outputSchemaSha256 必须是 sha256 摘要`);
    if (!isPositiveInteger(step.timeoutSeconds) || step.timeoutSeconds > 3600) throw validationError(`${path}.timeoutSeconds 必须在 1-3600 之间`);
    if (typeof step.writeEffect !== 'boolean') throw validationError(`${path}.writeEffect 必须是布尔值`);
    if (!isNonEmptyString(step.idempotencyKeyRef) || !/^\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}$/.test(step.idempotencyKeyRef)) {
      throw validationError(`${path}.idempotencyKeyRef 必须是变量引用`);
    }
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
  if (!['jsonPath', 'outputPath', 'firstOf', 'header', 'regex', 'statusCode', 'textContains', 'literal'].includes(extractor.type)) throw validationError(`${path}.extract.type 不支持`);
  if (extractor.type === 'jsonPath' && !isNonEmptyString(extractor.path)) throw validationError(`${path}.extract.path 必填`);
  if (extractor.type === 'outputPath' && !isNonEmptyString(extractor.path)) throw validationError(`${path}.extract.path 必填`);
  if (extractor.type === 'firstOf' && (!Array.isArray(extractor.paths) || extractor.paths.length === 0 || !extractor.paths.every(isNonEmptyString))) throw validationError(`${path}.extract.paths 必须是非空字符串数组`);
  if (extractor.type === 'header' && !isNonEmptyString(extractor.header)) throw validationError(`${path}.extract.header 必填`);
  if (extractor.type === 'regex' && !isNonEmptyString(extractor.pattern)) throw validationError(`${path}.extract.pattern 必填`);
  if (extractor.type === 'textContains' && !isNonEmptyString(extractor.value)) throw validationError(`${path}.extract.value 必填`);
  if (extractor.type === 'literal' && !Object.prototype.hasOwnProperty.call(extractor, 'value')) throw validationError(`${path}.extract.value 必填`);
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
  rejectUnknown(value, new Set(['direction', 'connectionRef', 'remotePath', 'contentRef', 'contentEncoding', 'localPath', 'temporaryPath', 'expectedHash', 'expectedSize', 'verifyHash', 'mode', 'owner', 'group', 'timeoutSeconds']), path);
  if (!['upload', 'download'].includes(String(value.direction))) throw validationError(`${path}.direction 不支持`);
  if (!isNonEmptyString(value.connectionRef)) throw validationError(`${path}.connectionRef 必须是非空字符串`);
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
    if (!isCredentialValue(credential)) throw validationError(`${path}.${name} 必须引用 Credential Slot`);
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
  if (value.verify !== undefined && typeof value.verify !== 'boolean' && !isTemplateExpression(value.verify)) {
    throw validationError(`${path}.verify 必须是布尔值或单一变量表达式`);
  }
  if (value.allowInsecure !== undefined && typeof value.allowInsecure !== 'boolean') throw validationError(`${path}.allowInsecure 必须是布尔值`);
  if (value.caSecretRef !== undefined && !isSecretRef(value.caSecretRef)) throw validationError(`${path}.caSecretRef 必须是 SecretRef`);
  if (value.clientCertSecretRef !== undefined && !isSecretRef(value.clientCertSecretRef)) throw validationError(`${path}.clientCertSecretRef 必须是 SecretRef`);
  if (value.clientKeySecretRef !== undefined && !isSecretRef(value.clientKeySecretRef)) throw validationError(`${path}.clientKeySecretRef 必须是 SecretRef`);
  if (value.sni !== undefined && typeof value.sni !== 'string') throw validationError(`${path}.sni 必须是字符串`);
}

function validateVariableReferences(content: WorkflowDslV1): void {
  const declared = new Set(reservedRoots);
  const produced = new Set<string>();
  validateStepVariableReferences([...content.steps, ...(content.rollback ?? [])], declared, produced, content);
}

function isTemplateExpression(value: unknown): value is string {
  return typeof value === 'string' && /^\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}$/.test(value);
}

function validateStepVariableReferences(steps: WorkflowStep[], declared: Set<string>, produced: Set<string>, content: WorkflowDslV1): void {
  for (const step of steps) {
    const stepExtracts = normalizeExtractors(step.extract).map((extractor) => extractor.name);
    const known = new Set([...declared, ...produced, ...stepExtracts, `steps.${step.name}`]);
    const references = step.type === 'foreach'
      ? [step.foreach.itemsPath, ...collectReferences({ ...step, foreach: { ...step.foreach, steps: [] } })]
      : step.type === 'checkpoint'
        ? [...Object.values(step.checkpoint.capture), ...collectReferences({ ...step, checkpoint: { ...step.checkpoint, capture: {} } })]
        : collectReferences(step);
    for (const reference of references) {
      if (!isDeclaredReference(reference, known, produced, content)) {
        throw validationError(`变量引用不存在：${reference}`, { reference, step: step.name });
      }
    }
    if (step.type === 'foreach') {
      const childDeclared = new Set([...known, step.foreach.itemVariable]);
      if (step.foreach.indexVariable) childDeclared.add(step.foreach.indexVariable);
      validateStepVariableReferences(step.foreach.steps, childDeclared, new Set(produced), content);
    }
    for (const outputName of [...stepExtracts, ...transformOutputNames(step)]) produced.add(outputName);
    produced.add(`steps.${step.name}`);
  }
}

function isDeclaredReference(reference: string, declared: Set<string>, produced: Set<string>, content: WorkflowDslV1): boolean {
  const [root, slot] = reference.split('.');
  if (!root) return false;
  if (root === 'asset' || root === 'system') return true;
  if (root === 'variables') return Boolean(slot && content.inputContract.variables[slot]);
  if (root === 'connections') return Boolean(slot && content.inputContract.connections[slot]);
  if (root === 'credentials') return Boolean(slot && content.inputContract.credentials[slot]);
  if (root === 'artifacts') return Boolean(slot && content.inputContract.artifacts[slot]);
  if (root === 'steps') return Boolean(slot && (declared.has(`steps.${slot}`) || produced.has(`steps.${slot}`)));
  return declared.has(root) || produced.has(root);
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
  return typeof value === 'string' && /^\s*\{\{credentials\.[A-Za-z][A-Za-z0-9_.-]*\}\}\s*$/.test(value);
}

function validateSshArgument(value: string, path: string): void {
  if (/^\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}$/.test(value)) return;
  if (/[\0\r\n;&|`$()<>*?{}[\]\\!]/.test(value)) throw validationError(`${path} 包含 shell 元字符或控制字符`);
  if (/^(?:sh|bash|dash|zsh|fish|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|python|python3|perl|ruby|node|wscript|cscript)(?:\.exe)?$/i.test(value)) throw validationError(`${path} 不得调用解释器`);
}

function isSecretRefOrVariableRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => isSecretRef(item) || (
    typeof item === 'string' && /^\s*\{\{\s*[a-zA-Z][a-zA-Z0-9_.]*\s*\}\}\s*$/.test(item)
  ));
}
