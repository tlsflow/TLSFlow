import { AppError } from '../../../../common/errors/app-error.js';
import { assertJsonSchema, type JsonSchema } from '../../../../common/validation/json-schema.js';

export type HostApiRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type HostApiSecretRedaction = 'NONE' | 'METADATA_ONLY' | 'ALWAYS';

export interface HostApiMethodDefinition {
  method: string;
  requestSchema: JsonSchema;
  resultSchema: JsonSchema;
  errorSchema: JsonSchema;
  permission: string;
  requiredGrants: string[];
  riskLevel: HostApiRiskLevel;
  readOnly: boolean;
  retryable: boolean;
  idempotencyKey: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  auditFields: string[];
  secretRedaction: HostApiSecretRedaction;
}

const id: JsonSchema = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' };
const artifactRef: JsonSchema = { type: 'string', pattern: '^artifact://[A-Za-z0-9._:/#-]{1,512}$' };
const secretRef: JsonSchema = { type: 'string', pattern: '^secret://[A-Za-z0-9._:/#-]{1,512}$' };
const nonEmpty: JsonSchema = { type: 'string', minLength: 1, maxLength: 512 };
const record: JsonSchema = { type: 'object', additionalProperties: true, maxProperties: 200 };
const idArray: JsonSchema = { type: 'array', items: id, maxItems: 100 };
const errorSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'retryable', 'mayBeUnknown', 'secretRedacted'],
  properties: {
    code: nonEmpty,
    message: { type: 'string', minLength: 1, maxLength: 512 },
    retryable: { type: 'boolean' },
    mayBeUnknown: { type: 'boolean' },
    details: record,
    secretRedacted: { const: true },
  },
};
const stringMap: JsonSchema = {
  type: 'object',
  additionalProperties: { type: 'string', maxLength: 8192 },
  maxProperties: 100,
};
const genericResult: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, data: record, error: errorSchema },
};

const cloudServiceResultData = objectSchema({
  apiVersion: { const: 'gcac.cloud-service/v1' },
  kind: { const: 'CloudService' },
  cloudServiceRef: id,
  providerKey: nonEmpty,
  displayName: nonEmpty,
  accountId: nonEmpty,
  scope: record,
  metadata: record,
  status: { const: 'ACTIVE' },
  version: { type: 'integer', minimum: 1 },
}, ['apiVersion', 'kind', 'cloudServiceRef', 'providerKey', 'displayName', 'scope', 'metadata', 'status', 'version']);

const httpResponseData = objectSchema({
  statusCode: { type: 'integer', minimum: 100, maximum: 599 },
  headers: stringMap,
  body: { type: ['object', 'array', 'string', 'null'] },
  bodyText: { type: 'string', maxLength: 2 * 1024 * 1024 },
}, ['statusCode', 'headers', 'body', 'bodyText']);

function resultWithData(data: JsonSchema): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' }, data, error: errorSchema },
  };
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties };
}

function method(
  name: string,
  requestSchema: JsonSchema,
  metadata: Omit<HostApiMethodDefinition, 'method' | 'requestSchema' | 'resultSchema' | 'errorSchema'> & Partial<Pick<HostApiMethodDefinition, 'resultSchema'>>,
): HostApiMethodDefinition {
  return {
    method: name,
    requestSchema,
    resultSchema: metadata.resultSchema ?? genericResult,
    errorSchema,
    ...metadata,
  };
}

const grantReadRequest = objectSchema({ grantId: id, artifactRef }, ['grantId', 'artifactRef']);
const secretResolveRequest = objectSchema({ grantId: id, secretRef, purpose: nonEmpty }, ['grantId', 'secretRef', 'purpose']);
const cryptoSignRequest = objectSchema({
  grantId: id,
  secretRef,
  data: { type: 'string', minLength: 1, maxLength: 1024 * 1024 },
  hashAlgorithm: { enum: ['SHA-256', 'SHA-384', 'SHA-512'] },
  signatureAlgorithm: { enum: ['RS256', 'ES256'] },
}, ['grantId', 'secretRef', 'data', 'hashAlgorithm', 'signatureAlgorithm']);
const progressRequest = objectSchema({ executionId: id, executionStepId: id, sequence: { type: 'integer', minimum: 0 }, stage: nonEmpty, summary: nonEmpty }, ['executionId', 'executionStepId', 'sequence', 'stage', 'summary']);
const checkpointSaveRequest = objectSchema({ executionId: id, executionStepId: id, payload: record, digest: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['executionId', 'executionStepId', 'payload', 'digest']);
const checkpointLoadRequest = objectSchema({ checkpointRef: id }, ['checkpointRef']);
const cloudServiceGetRequest = objectSchema({ cloudServiceRef: id }, ['cloudServiceRef']);
const httpRequest = objectSchema({
  url: { type: 'string', format: 'uri', pattern: '^https://[^\\s#]+$', maxLength: 2048 },
  directoryUrl: { type: 'string', format: 'uri', pattern: '^https://[^\\s#]+$', maxLength: 2048 },
  method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
  headers: stringMap,
  body: { type: 'string', maxLength: 1024 * 1024 },
}, ['url', 'method', 'headers']);

export const hostApiRegistry: Readonly<Record<string, HostApiMethodDefinition>> = {
  'cloudService.get': method('cloudService.get', cloudServiceGetRequest, { resultSchema: resultWithData(cloudServiceResultData), permission: 'cloud.service.get', requiredGrants: ['cloud.service.get'], riskLevel: 'MEDIUM', readOnly: true, retryable: true, idempotencyKey: null, timeoutMs: 5_000, maxOutputBytes: 256 * 1024, auditFields: ['cloudServiceRef'], secretRedaction: 'ALWAYS' }),
  'artifact.grant.read': method('artifact.grant.read', grantReadRequest, { permission: 'artifact.read', requiredGrants: ['artifact.read'], riskLevel: 'HIGH', readOnly: true, retryable: false, idempotencyKey: null, timeoutMs: 10_000, maxOutputBytes: 4 * 1024 * 1024, auditFields: ['grantId', 'artifactRef'], secretRedaction: 'ALWAYS' }),
  'secret.grant.resolve': method('secret.grant.resolve', secretResolveRequest, { permission: 'secret.resolve', requiredGrants: ['secret.resolve'], riskLevel: 'CRITICAL', readOnly: true, retryable: false, idempotencyKey: 'grantId', timeoutMs: 5_000, maxOutputBytes: 256 * 1024, auditFields: ['grantId', 'secretRef', 'purpose'], secretRedaction: 'ALWAYS' }),
  'crypto.sign': method('crypto.sign', cryptoSignRequest, { permission: 'crypto.sign', requiredGrants: ['crypto.sign'], riskLevel: 'CRITICAL', readOnly: false, retryable: false, idempotencyKey: 'data', timeoutMs: 5_000, maxOutputBytes: 256 * 1024, auditFields: ['grantId', 'secretRef', 'hashAlgorithm', 'signatureAlgorithm'], secretRedaction: 'ALWAYS' }),
  // 通用 HTTPS 出口承载 Cloud 插件的签名写请求，超时或连接中断必须按外部状态未知处理。
  'http.request': method('http.request', httpRequest, { resultSchema: resultWithData(httpResponseData), permission: 'network.http', requiredGrants: ['network.http'], riskLevel: 'HIGH', readOnly: false, retryable: false, idempotencyKey: 'url', timeoutMs: 30_000, maxOutputBytes: 2 * 1024 * 1024, auditFields: ['method', 'url'], secretRedaction: 'ALWAYS' }),
  'execution.progress': method('execution.progress', progressRequest, { permission: 'execution.progress.write', requiredGrants: ['execution.progress'], riskLevel: 'LOW', readOnly: false, retryable: false, idempotencyKey: 'sequence', timeoutMs: 5_000, maxOutputBytes: 32 * 1024, auditFields: ['executionId', 'executionStepId', 'sequence'], secretRedaction: 'ALWAYS' }),
  'execution.checkpoint.save': method('execution.checkpoint.save', checkpointSaveRequest, { permission: 'execution.checkpoint.write', requiredGrants: ['execution.checkpoint'], riskLevel: 'MEDIUM', readOnly: false, retryable: false, idempotencyKey: 'digest', timeoutMs: 10_000, maxOutputBytes: 32 * 1024, auditFields: ['executionId', 'executionStepId', 'digest'], secretRedaction: 'ALWAYS' }),
  'execution.checkpoint.load': method('execution.checkpoint.load', checkpointLoadRequest, { permission: 'execution.checkpoint.read', requiredGrants: ['execution.checkpoint'], riskLevel: 'MEDIUM', readOnly: true, retryable: false, idempotencyKey: null, timeoutMs: 10_000, maxOutputBytes: 512 * 1024, auditFields: ['checkpointRef'], secretRedaction: 'ALWAYS' }),
  'execution.isCancelled': method('execution.isCancelled', objectSchema({ executionId: id, executionStepId: id }, ['executionId', 'executionStepId']), { permission: 'execution.cancel.read', requiredGrants: ['execution.cancel'], riskLevel: 'LOW', readOnly: true, retryable: true, idempotencyKey: null, timeoutMs: 2_000, maxOutputBytes: 8 * 1024, auditFields: ['executionId', 'executionStepId'], secretRedaction: 'METADATA_ONLY' }),
  'resourceLock.acquire': method('resourceLock.acquire', objectSchema({ resourceKey: nonEmpty, ownerRunId: id, ownerStepId: id, ttlSeconds: { type: 'integer', minimum: 1, maximum: 3600 } }, ['resourceKey', 'ownerRunId', 'ownerStepId', 'ttlSeconds']), { permission: 'resource.lock', requiredGrants: ['resource.lock'], riskLevel: 'HIGH', readOnly: false, retryable: false, idempotencyKey: 'ownerStepId', timeoutMs: 10_000, maxOutputBytes: 32 * 1024, auditFields: ['resourceKey', 'ownerRunId', 'ownerStepId'], secretRedaction: 'ALWAYS' }),
  'resourceLock.release': method('resourceLock.release', objectSchema({ lockId: id, ownerRunId: id, ownerStepId: id }, ['lockId', 'ownerRunId', 'ownerStepId']), { permission: 'resource.lock', requiredGrants: ['resource.lock'], riskLevel: 'HIGH', readOnly: false, retryable: false, idempotencyKey: 'lockId', timeoutMs: 10_000, maxOutputBytes: 32 * 1024, auditFields: ['lockId', 'ownerRunId', 'ownerStepId'], secretRedaction: 'ALWAYS' }),
  'audit.append': method('audit.append', objectSchema({ eventType: nonEmpty, action: nonEmpty, resourceType: nonEmpty, resourceId: id, result: { enum: ['success', 'failure', 'denied'] }, detail: record }, ['eventType', 'action', 'resourceType', 'resourceId', 'result']), { permission: 'audit.append', requiredGrants: ['audit.append'], riskLevel: 'LOW', readOnly: false, retryable: false, idempotencyKey: 'eventType', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, auditFields: ['eventType', 'action', 'resourceType', 'resourceId', 'result'], secretRedaction: 'ALWAYS' }),
};

export const forbiddenHostApiMethods = [
  'plugin.invoke',
  'database.query',
  'repository.call',
  'host.service.invoke',
  'filesystem.read',
  'filesystem.write',
  'process.spawn',
  'process.execute',
  'agent.execute',
] as const;

export function getHostApiMethod(methodName: string): HostApiMethodDefinition {
  const definition = hostApiRegistry[methodName];
  if (!definition) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 方法未注册', { method: methodName });
  return definition;
}

export function validateHostApiRequest(methodName: string, input: unknown): Record<string, unknown> {
  const definition = getHostApiMethod(methodName);
  assertJsonSchema(input, definition.requestSchema, `Host API ${methodName} request`);
  return input as Record<string, unknown>;
}

export function validateHostApiResult(methodName: string, input: unknown): Record<string, unknown> {
  const definition = getHostApiMethod(methodName);
  assertJsonSchema(input, definition.resultSchema, `Host API ${methodName} result`);
  const result = input as Record<string, unknown>;
  if (result.ok === true && result.error !== undefined) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'Host API 成功结果不得携带错误 Receipt', { method: methodName });
  }
  if (result.ok === false && result.error === undefined) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'Host API 失败结果缺少错误 Receipt', { method: methodName });
  }
  if (result.ok === false && result.data !== undefined) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'Host API 失败结果不得携带成功数据', { method: methodName });
  }
  return result;
}

export function validateHostApiError(methodName: string, input: unknown): Record<string, unknown> {
  const definition = getHostApiMethod(methodName);
  assertJsonSchema(input, definition.errorSchema, `Host API ${methodName} error`);
  return input as Record<string, unknown>;
}

export function assertHostApiGrant(methodName: string, grantedPermissions: readonly string[], grantedRefs: readonly string[]): void {
  const definition = getHostApiMethod(methodName);
  validateHostApiPermissions(grantedPermissions);
  validateGrantRefs(grantedRefs);
  const permissionSet = new Set(grantedPermissions);
  const missingPermissions = definition.requiredGrants.filter((grant) => !permissionSet.has(grant));
  if (missingPermissions.length > 0) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API Grant 权限不足', { method: methodName, missingPermissions });
  }
  if (definition.requiredGrants.length > 0 && grantedRefs.length === 0) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 调用缺少 Grant 引用', { method: methodName });
  }
}

export function validateHostApiPermissions(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((permission) => typeof permission !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(permission))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 权限格式无效');
  }
  if (new Set(value).size !== value.length) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 权限不允许重复');
  return [...value];
}

export function validateGrantRefs(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((ref) => typeof ref !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API Grant 引用格式无效');
  }
  if (new Set(value).size !== value.length) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API Grant 引用不允许重复');
  return [...value];
}

export function listHostApiMethods(): HostApiMethodDefinition[] {
  return Object.values(hostApiRegistry).map((definition) => ({
    ...definition,
    requiredGrants: [...definition.requiredGrants],
    auditFields: [...definition.auditFields],
  }));
}
