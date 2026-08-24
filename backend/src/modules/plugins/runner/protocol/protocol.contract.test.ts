import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJsonSchema } from '../../../../common/validation/json-schema.js';
import { decodeJsonLine, encodeJsonLine, JsonLinesDecoder, validateIpcMessage } from './protocol.codec.js';
import { ipcV1Schema, ipcV1MessageSchemas } from './ipc-v1.schema.js';
import { pluginRunnerLimits, pluginRunnerMessageTypes, requestResponsePairs } from './protocol.constants.js';
import { hostApiRegistry } from './host-api.registry.js';

const fixtureRoot = resolve(process.cwd(), 'src/modules/plugins/runner/protocol/fixtures');
const schemaRoot = resolve(process.cwd(), 'src/modules/plugins/runner/protocol/schemas');

test('IPC v2 每种消息都有 TypeScript Schema、JSON Schema 和正例', () => {
  const jsonSchema = readJson(resolve(schemaRoot, 'ipc-v1.schema.json'));
  const valid = readJson(resolve(fixtureRoot, 'ipc-v1.valid.json')) as { messages: unknown[] };
  assert.deepEqual(Object.keys(ipcV1MessageSchemas).sort(), [...pluginRunnerMessageTypes].sort());
  assert.deepEqual(Object.keys(jsonSchema.$defs).filter((key) => pluginRunnerMessageTypes.includes(key as never)).sort(), [...pluginRunnerMessageTypes].sort());
  assert.deepEqual(new Set((valid.messages as Array<Record<string, unknown>>).map((message) => message.messageType)).size, pluginRunnerMessageTypes.length);
  for (const message of valid.messages) {
    assert.equal(validateJsonSchema(message, jsonSchema).valid, true, JSON.stringify(message));
    assert.doesNotThrow(() => validateIpcMessage(message));
  }
});

test('IPC v2 每种消息至少有一个负例 Fixture，未知字段和协议版本失败关闭', () => {
  const jsonSchema = readJson(resolve(schemaRoot, 'ipc-v1.schema.json'));
  const invalid = readJson(resolve(fixtureRoot, 'ipc-v1.invalid.json')) as { messages: Array<{ name: string; message: unknown }> };
  const types = new Set(invalid.messages.map((item) => (item.message as Record<string, unknown>).messageType));
  assert.deepEqual(types, new Set(pluginRunnerMessageTypes));
  for (const item of invalid.messages) {
    const schemaResult = validateJsonSchema(item.message, jsonSchema);
    assert.equal(!schemaResult.valid || item.name.includes('status-mismatch') || item.name.includes('rejected-without-error') || item.name.includes('without-error'), true, item.name);
    assert.throws(() => validateIpcMessage(item.message), item.name);
  }
});

test('JSON Lines 编解码保证一行一条消息并支持拆分输入', () => {
  const valid = readJson(resolve(fixtureRoot, 'ipc-v1.valid.json')) as { messages: unknown[] };
  const line = encodeJsonLine(valid.messages[0]);
  assert.equal(line.endsWith('\n'), true);
  assert.deepEqual(decodeJsonLine(line.trim()), valid.messages[0]);
  const decoder = new JsonLinesDecoder();
  const split = decoder.push(line.slice(0, 12));
  assert.deepEqual(split, []);
  assert.deepEqual(decoder.push(line.slice(12)), [valid.messages[0]]);
  assert.deepEqual(decoder.finish(), []);
});

test('JSON Lines 拒绝部分 JSON、超长行和非协议 stdout 内容', () => {
  const decoder = new JsonLinesDecoder();
  assert.throws(() => decoder.push('{"messageType":"hello"}\n'), /协议|合同/);
  assert.throws(() => new JsonLinesDecoder().push('not-json\n'), /协议/);
  assert.throws(() => new JsonLinesDecoder().push(`${'x'.repeat(pluginRunnerLimits.maxMessageBytes + 1)}\n`), /最大消息长度/);
  const partial = new JsonLinesDecoder();
  partial.push('{"protocolVersion":"gcac.plugin-runner/v1"}');
  assert.throws(() => partial.finish(), /不完整/);
  assert.throws(() => new JsonLinesDecoder().push(Buffer.from([0xc3, 0x28, 0x0a])), /UTF-8|协议/);
});

test('request/response 关联和重试规则保持单一合同', () => {
  assert.deepEqual(requestResponsePairs, {
    hello: 'hello_result', execute: 'execute_result', host_call: 'host_result', cancel: 'cancel_result', ping: 'pong', shutdown: 'shutdown_result',
  });
  assert.equal(hostApiRegistry['artifact.grant.read']?.retryable, false);
  assert.equal(hostApiRegistry['crypto.sign']?.retryable, false);
});

test('IPC host_call 合同允许已注册的 crypto.sign 调用', () => {
  const message = {
    protocolVersion: 'gcac.plugin-runner/v2', messageType: 'host_call', requestId: 'host-crypto-sign-1', sentAt: '2026-08-12T00:00:00.000Z',
    pluginVersionId: 'test-version-v1', tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', workflowVersionId: 'workflow-1',
    pluginId: 'cloud.example', capability: 'ca.account.manage', actionId: 'certificate.sign.v1', actionContractVersion: 'v1',
    inputSchemaSha256: `sha256:${'a'.repeat(64)}`, outputSchemaSha256: `sha256:${'b'.repeat(64)}`, packageHash: `sha256:${'c'.repeat(64)}`,
    manifestHash: `sha256:${'d'.repeat(64)}`, resourceHash: `sha256:${'e'.repeat(64)}`, planDigest: 'f'.repeat(64), writeEffect: false,
    method: 'crypto.sign', input: { grantId: 'grant-1', secretRef: 'secret://ca/acme/account', data: 'header.payload', hashAlgorithm: 'SHA-256', signatureAlgorithm: 'RS256' },
    grantRefs: ['grant-1'], idempotencyKey: 'crypto-sign-1', deadlineAt: '2026-08-12T00:00:05.000Z', timeoutMs: 5_000,
  };
  assert.equal(validateJsonSchema(message, ipcV1Schema).valid, true);
  assert.doesNotThrow(() => validateIpcMessage(message));
});

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
