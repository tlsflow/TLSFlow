import { TextDecoder } from 'node:util';
import { AppError } from '../../../../common/errors/app-error.js';
import { validateJsonSchema, type JsonSchemaValidationError } from '../../../../common/validation/json-schema.js';
import { validateHostApiRequest } from './host-api.registry.js';
import { ipcV2MessageSchemas } from './ipc-v1.schema.js';
import { pluginRunnerLimits, pluginRunnerMessageTypes } from './protocol.constants.js';
import type { PluginRunnerMessage, PluginRunnerMessageType } from './protocol.types.js';

export class JsonLinesDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';

  push(chunk: Buffer | string): PluginRunnerMessage[] {
    try {
      this.buffer += this.decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk, { stream: true });
    } catch (error) {
      throw protocolViolation('stdout IPC 包含无效 UTF-8', { cause: error instanceof Error ? error.message : String(error) });
    }
    return this.drainLines();
  }

  finish(): PluginRunnerMessage[] {
    try {
      this.buffer += this.decoder.decode();
    } catch (error) {
      throw protocolViolation('stdout IPC 在 EOF 时包含无效 UTF-8', { cause: error instanceof Error ? error.message : String(error) });
    }
    if (this.buffer.length > 0) {
      throw protocolViolation('stdout 在 EOF 时包含不完整 JSON 行');
    }
    return [];
  }

  private drainLines(): PluginRunnerMessage[] {
    const messages: PluginRunnerMessage[] = [];
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) {
        assertLineLength(this.buffer);
        break;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      assertLineLength(line);
      if (line.trim() === '') throw protocolViolation('stdout 不允许空行');
      messages.push(decodeJsonLine(line));
    }
    return messages;
  }
}

export function encodeJsonLine(message: unknown): string {
  const validated = validateIpcMessage(message);
  const line = JSON.stringify(validated);
  assertLineLength(line);
  return `${line}\n`;
}

export function decodeJsonLine(line: string): PluginRunnerMessage {
  assertLineLength(line);
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw protocolViolation('stdout IPC 协议包含无法解析的 JSON', { cause: error instanceof Error ? error.message : String(error) });
  }
  return validateIpcMessage(value);
}

export function validateIpcMessage(input: unknown): PluginRunnerMessage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw protocolViolation('协议消息必须是 JSON 对象');
  }
  const messageType = (input as Record<string, unknown>).messageType;
  if (typeof messageType !== 'string' || !pluginRunnerMessageTypes.includes(messageType as PluginRunnerMessageType)) {
    throw protocolViolation('未知 messageType', { messageType });
  }
  const result = validateJsonSchema(input, ipcV2MessageSchemas[messageType as PluginRunnerMessageType], {
    maxDepth: pluginRunnerLimits.maxDepth,
    maxArrayItems: pluginRunnerLimits.maxArrayItems,
    maxObjectProperties: pluginRunnerLimits.maxObjectProperties,
  });
  if (!result.valid) throw contractInvalid(messageType, result.errors);
  validateSemanticRules(input as Record<string, unknown>, messageType as PluginRunnerMessageType);
  return input as PluginRunnerMessage;
}

function validateSemanticRules(input: Record<string, unknown>, messageType: PluginRunnerMessageType): void {
  if (messageType === 'hello_result') {
    if (input.accepted === false && !input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'required', message: '拒绝握手必须包含 error' }]);
    if (input.accepted === true && input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'semantic', message: '成功握手不能包含 error' }]);
  }
  if (messageType === 'execute_result') {
    const status = input.status;
    const success = input.success;
    const validRelation = (success === true && status === 'SUCCESS') || (success === false && ['FAILED', 'UNKNOWN', 'CANCELLED'].includes(String(status)));
    if (!validRelation) throw contractInvalid(messageType, [{ path: '$.status', keyword: 'semantic', message: 'success 与 status 不匹配' }]);
    if (success === false && !input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'required', message: '失败结果必须包含 error' }]);
    if (success === true && input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'semantic', message: '成功结果不能包含 error' }]);
  }
  if (messageType === 'host_result') {
    if (input.ok === true && input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'semantic', message: '成功 Host 结果不能包含 error' }]);
    if (input.ok === false && !input.error) throw contractInvalid(messageType, [{ path: '$.error', keyword: 'required', message: '失败 Host 结果必须包含 error' }]);
  }
  if (messageType === 'host_call') {
    validateHostApiRequest(String(input.method), input.input);
    if (!Array.isArray(input.grantRefs) || new Set(input.grantRefs).size !== input.grantRefs.length) {
      throw contractInvalid(messageType, [{ path: '$.grantRefs', keyword: 'uniqueItems', message: 'Grant 引用不得重复' }]);
    }
  }
  if (messageType === 'execute') {
    assertAtomicActionInput(input.input);
  }
}

function assertAtomicActionInput(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const forbidden = new Set(['workflow', 'steps', 'rollback', 'checkpoint', 'checkpoints', 'workflowRequest', 'pluginRunnerBinding', 'pluginRuntimeCapability', 'variables']);
  const visit = (current: unknown, path: string, depth: number): void => {
    if (depth > 32 || !current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (forbidden.has(key)) {
        throw contractInvalid('execute', [{ path: `${path}.${key}`, keyword: 'forbidden', message: 'plugin.action 输入不得携带 Workflow 编排或宿主状态字段' }]);
      }
      visit(child, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, '$.input', 0);
}

function assertLineLength(line: string): void {
  if (Buffer.byteLength(line, 'utf8') > pluginRunnerLimits.maxMessageBytes) {
    throw protocolViolation('stdout JSON 行超过最大消息长度', { maxMessageBytes: pluginRunnerLimits.maxMessageBytes });
  }
}

function protocolViolation(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('PLUGIN_RUNNER_PROTOCOL_VIOLATION', message, details);
}

function contractInvalid(messageType: string, errors: JsonSchemaValidationError[]): AppError {
  return new AppError('PLUGIN_CONTRACT_INVALID', `消息 ${messageType} 不符合 IPC v2 Action 合同`, { errors: errors.slice(0, 20) });
}
