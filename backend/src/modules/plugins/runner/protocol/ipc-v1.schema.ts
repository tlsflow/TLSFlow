import type { JsonSchema } from '../../../../common/validation/json-schema.js';
import type { PluginRunnerMessageType } from './protocol.types.js';

const nonEmptyString: JsonSchema = { type: 'string', minLength: 1, maxLength: 512 };
const identifier: JsonSchema = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' };
const dateTime: JsonSchema = { type: 'string', format: 'date-time', maxLength: 64 };
const artifactHash: JsonSchema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const planDigest: JsonSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const record: JsonSchema = { type: 'object', additionalProperties: true, maxProperties: 200 };
const stringArray: JsonSchema = { type: 'array', items: nonEmptyString, maxItems: 200 };
const grantRefs: JsonSchema = { type: 'array', items: identifier, maxItems: 100 };
const hostGrantRefs: JsonSchema = { ...grantRefs, minItems: 1 };
const protocolError: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['code', 'message', 'retryable', 'mayBeUnknown', 'secretRedacted'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 128 }, message: { type: 'string', minLength: 1, maxLength: 512 },
    retryable: { type: 'boolean' }, mayBeUnknown: { type: 'boolean' }, details: record, secretRedacted: { const: true },
  },
};
const warning: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'message', 'secretRedacted'],
  properties: { code: { type: 'string', minLength: 1, maxLength: 128 }, message: { type: 'string', minLength: 1, maxLength: 512 }, details: record, secretRedacted: { const: true } },
};

const baseProperties: Record<string, JsonSchema> = {
  protocolVersion: { const: 'gcac.plugin-runner/v2' },
  messageType: identifier,
  requestId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
  sentAt: dateTime,
  pluginVersionId: identifier,
  tenantId: identifier,
  executionId: identifier,
  executionStepId: identifier,
};

const actionBindingProperties: Record<string, JsonSchema> = {
  workflowVersionId: identifier,
  pluginId: identifier,
  capability: identifier,
  actionId: identifier,
  actionContractVersion: identifier,
  inputSchemaSha256: artifactHash,
  outputSchemaSha256: artifactHash,
  packageHash: artifactHash,
  manifestHash: artifactHash,
  resourceHash: artifactHash,
  planDigest,
  writeEffect: { type: 'boolean' },
};
const actionBindingRequired = Object.keys(actionBindingProperties);

function messageSchema(messageType: PluginRunnerMessageType, properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return {
    type: 'object', additionalProperties: false,
    required: ['protocolVersion', 'messageType', 'requestId', 'sentAt', ...required],
    properties: { ...baseProperties, messageType: { const: messageType }, ...properties },
  };
}

const messageSchemas: Record<PluginRunnerMessageType, JsonSchema> = {
  hello: messageSchema('hello', {
    pluginVersionId: identifier, pluginId: identifier, pluginVersion: identifier,
    runner: { type: 'object', additionalProperties: false, required: ['pid', 'sdkVersion', 'runnerVersion'], properties: { pid: { type: 'integer', minimum: 1 }, sdkVersion: identifier, runnerVersion: identifier } },
    capabilities: stringArray, permissions: stringArray, packageHash: artifactHash, resourceHash: artifactHash, manifestHash: artifactHash,
  }, ['pluginVersionId', 'pluginId', 'pluginVersion', 'runner', 'capabilities', 'permissions', 'packageHash', 'resourceHash', 'manifestHash']),
  hello_result: messageSchema('hello_result', {
    pluginVersionId: identifier, accepted: { type: 'boolean' }, pluginId: identifier, pluginVersion: identifier,
    runnerVersion: identifier, sdkVersion: identifier, capabilities: stringArray, permissions: stringArray,
    packageHash: artifactHash, resourceHash: artifactHash, manifestHash: artifactHash, error: protocolError,
  }, ['pluginVersionId', 'accepted', 'pluginId', 'pluginVersion', 'runnerVersion', 'sdkVersion', 'capabilities', 'permissions', 'packageHash', 'resourceHash', 'manifestHash']),
  execute: messageSchema('execute', {
    ...actionBindingProperties, pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier,
    grantRefs, idempotencyKey: identifier, input: record, deadlineAt: dateTime,
  }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', ...actionBindingRequired, 'grantRefs', 'idempotencyKey', 'input', 'deadlineAt']),
  execute_result: messageSchema('execute_result', {
    ...actionBindingProperties, pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier,
    success: { type: 'boolean' }, status: { enum: ['SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'] }, output: record,
    externalReceipt: record, warnings: { type: 'array', items: warning, maxItems: 100 }, error: protocolError,
  }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', ...actionBindingRequired, 'success', 'status', 'output', 'warnings']),
  host_call: messageSchema('host_call', {
    ...actionBindingProperties, pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier,
    method: { enum: ['cloudService.get', 'artifact.grant.read', 'secret.grant.resolve', 'crypto.sign', 'http.request', 'execution.isCancelled', 'audit.append'] },
    input: record, grantRefs: hostGrantRefs, idempotencyKey: identifier, deadlineAt: dateTime, timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
  }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', ...actionBindingRequired, 'method', 'input', 'grantRefs', 'idempotencyKey', 'deadlineAt', 'timeoutMs']),
  host_result: messageSchema('host_result', {
    ...actionBindingProperties, pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier,
    ok: { type: 'boolean' }, output: record, error: protocolError,
  }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', ...actionBindingRequired, 'ok']),
  cancel: messageSchema('cancel', { pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier, targetRequestId: identifier, reason: { type: 'string', minLength: 1, maxLength: 512 } }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', 'targetRequestId', 'reason']),
  cancel_result: messageSchema('cancel_result', { pluginVersionId: identifier, tenantId: identifier, executionId: identifier, executionStepId: identifier, targetRequestId: identifier, accepted: { type: 'boolean' }, status: { enum: ['ACCEPTED', 'ALREADY_COMPLETED', 'UNKNOWN'] } }, ['pluginVersionId', 'tenantId', 'executionId', 'executionStepId', 'targetRequestId', 'accepted', 'status']),
  ping: messageSchema('ping', { pluginVersionId: identifier, nonce: identifier }, ['pluginVersionId', 'nonce']),
  pong: messageSchema('pong', { pluginVersionId: identifier, nonce: identifier }, ['pluginVersionId', 'nonce']),
  shutdown: messageSchema('shutdown', { pluginVersionId: identifier, reason: { enum: ['DRAIN', 'HOST_EXIT', 'VERSION_SWITCH', 'DOCKER_STOP'] }, graceMs: { type: 'integer', minimum: 0, maximum: 120000 } }, ['pluginVersionId', 'reason', 'graceMs']),
  shutdown_result: messageSchema('shutdown_result', { pluginVersionId: identifier, accepted: { type: 'boolean' }, status: { enum: ['DRAINING', 'SHUTDOWN'] } }, ['pluginVersionId', 'accepted', 'status']),
};

/** 文件名保留以避免导入路径漂移，导出的正式合同是 v2。 */
export const ipcV2Schema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'gcac://plugin-runner/ipc/v2', title: 'GCAC Plugin Runner Action IPC v2',
  oneOf: Object.keys(messageSchemas).map((messageType) => ({ $ref: `#/$defs/${messageType}` })),
  $defs: { ...messageSchemas, standardError: protocolError, warning },
};

export const ipcV2MessageSchemas = messageSchemas;
/** @deprecated 仅保留 TypeScript 导入稳定性；其值已经是 Action IPC v2。 */
export const ipcV1Schema = ipcV2Schema;
/** @deprecated 仅保留 TypeScript 导入稳定性；其值已经是 Action IPC v2。 */
export const ipcV1MessageSchemas = ipcV2MessageSchemas;
