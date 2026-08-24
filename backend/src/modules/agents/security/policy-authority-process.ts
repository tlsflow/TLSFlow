import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError } from '../../../common/errors/app-error.js';
import { assertJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import {
  agentSecurityContractVersion,
  validateAgentCapabilityToken,
  validatePolicyAuthorityDecision,
  type AgentCapabilityTokenV1,
  type PolicyAuthorityDecisionV1,
} from './agent-security.contract.js';
import {
  createProductionPolicyAuthorityServicesV1,
  type PolicyAuthorityAuthorizationRequestV1,
  type PolicyAuthorityAuthorizationResultV1,
  type ProductionPolicyAuthorityServicesV1,
} from './policy-authority.service.js';

export const policyAuthorityIpcVersion = 'gcac.policy-authority-ipc/v1' as const;
export const policyAuthorityIpcStartupTimeoutMs = 5_000;
export const policyAuthorityIpcRequestTimeoutMs = 30_000;
const maximumIpcLineBytes = 64 * 1024;

type PolicyAuthorityIpcMethod = 'hello' | 'health' | 'issueAuthorization' | 'revokeToken' | 'revokeDecision' | 'revokeKey' | 'refreshKeySet' | 'shutdown';

interface PolicyAuthorityIpcRequestV1 {
  protocolVersion: typeof policyAuthorityIpcVersion;
  requestId: string;
  method: PolicyAuthorityIpcMethod;
  payload?: unknown;
}

interface PolicyAuthorityIpcResponseV1 {
  protocolVersion: typeof policyAuthorityIpcVersion;
  requestId: string;
  method: PolicyAuthorityIpcMethod;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    mayBeUnknown: boolean;
    secretRedacted: true;
  };
}

export interface ProductionPolicyAuthorityProcessConfig {
  executablePath: string;
  workingDirectory: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface PolicyAuthorityProcessHealthV1 {
  serviceVersion: typeof agentSecurityContractVersion;
  authorityId: string;
  activeKeyId: string;
  keySetIssuedAt: string;
}

const ipcRequestSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['protocolVersion', 'requestId', 'method'],
  properties: {
    protocolVersion: { const: policyAuthorityIpcVersion },
    requestId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
    method: { enum: ['hello', 'health', 'issueAuthorization', 'revokeToken', 'revokeDecision', 'revokeKey', 'refreshKeySet', 'shutdown'] },
    payload: { type: 'object', additionalProperties: true, maxProperties: 200 },
  },
};

const ipcResponseSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['protocolVersion', 'requestId', 'method', 'ok'],
  properties: {
    protocolVersion: { const: policyAuthorityIpcVersion },
    requestId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' },
    method: { enum: ['hello', 'health', 'issueAuthorization', 'revokeToken', 'revokeDecision', 'revokeKey', 'refreshKeySet', 'shutdown'] },
    ok: { type: 'boolean' },
    result: { type: 'object', additionalProperties: true, maxProperties: 200 },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'retryable', 'mayBeUnknown', 'secretRedacted'],
      properties: {
        code: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
        message: { type: 'string', minLength: 1, maxLength: 512 },
        retryable: { type: 'boolean' },
        mayBeUnknown: { type: 'boolean' },
        secretRedacted: { const: true },
      },
    },
  },
};

const authorityEnvironmentKeys = [
  'GCAC_POLICY_AUTHORITY_ROOT_KEY_ID',
  'GCAC_POLICY_AUTHORITY_ID',
  'GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256',
  'GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON',
  'GCAC_POLICY_AUTHORITY_KEYSET_JSON',
  'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON',
  'GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON',
  'GCAC_POLICY_AUTHORITY_STATE_FILE',
] as const;

const forbiddenProcessArguments = new Set([
  '-e', '--eval', '--import', '--loader', '--require', '-r', '--inspect', '--inspect-brk', '--inspect-port',
]);

/**
 * 解析宿主启动独立 Policy Authority 所需的固定进程规格。
 * 生产宿主只向子进程传递策略权威的显式信任材料，不把普通宿主环境整体继承给安全进程。
 */
export function resolveProductionPolicyAuthorityProcessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionPolicyAuthorityProcessConfig {
  if (environment.NODE_ENV !== 'production') {
    throw unavailable('Policy Authority IPC 客户端只能在 production 装配');
  }
  const executablePath = required(environment.GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH, 'GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH');
  const workingDirectory = required(environment.GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY, 'GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY');
  const args = parseArguments(required(environment.GCAC_POLICY_AUTHORITY_ARGS_JSON, 'GCAC_POLICY_AUTHORITY_ARGS_JSON'));
  if (!isAbsolute(executablePath) || !isAbsolute(workingDirectory)) {
    throw unavailable('Policy Authority 可执行文件和工作目录必须是绝对路径');
  }
  assertPath(executablePath, false);
  assertPath(workingDirectory, true);

  const childEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'standalone',
  };
  for (const key of authorityEnvironmentKeys) childEnvironment[key] = required(environment[key], key);
  return Object.freeze({
    executablePath,
    workingDirectory,
    args: Object.freeze(args),
    environment: Object.freeze(childEnvironment),
    startupTimeoutMs: policyAuthorityIpcStartupTimeoutMs,
    requestTimeoutMs: policyAuthorityIpcRequestTimeoutMs,
  });
}

export function createProductionPolicyAuthorityProcessClientV1(
  environment: NodeJS.ProcessEnv = process.env,
): PolicyAuthorityProcessClientV1 {
  return new PolicyAuthorityProcessClientV1(resolveProductionPolicyAuthorityProcessConfig(environment));
}

/** 生产宿主使用的独立 Policy Authority 客户端；签发私钥不会进入本对象。 */
export class PolicyAuthorityProcessClientV1 {
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<void> | undefined;
  private ready = false;
  private sequence = 0;
  private inputBuffer = '';
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly config: ProductionPolicyAuthorityProcessConfig) {
    assertConfig(config);
  }

  assertReady(): void {
    assertConfig(this.config);
  }

  async health(): Promise<PolicyAuthorityProcessHealthV1> {
    try {
      const result = await this.request('health');
      return validateHealthResult(result, this.config.environment.GCAC_POLICY_AUTHORITY_ID);
    } catch (error) {
      const failure = error instanceof AppError ? error : unavailable('Policy Authority health 响应无效', error);
      this.failProcess(failure);
      throw failure;
    }
  }

  async issueAuthorization(request: PolicyAuthorityAuthorizationRequestV1): Promise<PolicyAuthorityAuthorizationResultV1> {
    try {
      const result = await this.request('issueAuthorization', request);
      if (!result.decision) throw unavailable('Policy Authority 未返回 Decision');
      const decision = validatePolicyAuthorityDecision(result.decision);
      if (!decision.allowed) return { decision };
      if (!result.token) throw unavailable('Policy Authority 允许结果缺少 Token');
      const token = validateAgentCapabilityToken(result.token);
      return { decision, token };
    } catch (error) {
      const failure = error instanceof AppError ? error : unavailable('Policy Authority 授权响应无效', error);
      if (failure.errorCode === 'VALIDATION_FAILED') this.failProcess(failure);
      throw failure;
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await this.sendRaw('shutdown', undefined, 2_000);
    } catch {
      // 子进程已经失败时，关闭本身不能阻塞宿主退出。
    }
    if (!child.killed) child.kill();
    this.child = undefined;
    this.ready = false;
  }

  private async request(method: Exclude<PolicyAuthorityIpcMethod, 'hello' | 'shutdown'>, payload?: unknown): Promise<Record<string, unknown>> {
    await this.ensureStarted();
    const response = await this.sendRaw(method, payload, this.config.requestTimeoutMs);
    if (!response.ok) throw remoteError(response.error);
    if (!response.result) throw unavailable(`Policy Authority ${method} 响应缺少 result`);
    return response.result;
  }

  private async ensureStarted(): Promise<void> {
    this.assertReady();
    if (this.ready && this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async startProcess(): Promise<void> {
    this.inputBuffer = '';
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.config.executablePath, [...this.config.args], {
        cwd: this.config.workingDirectory,
        env: { ...this.config.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw unavailable('Policy Authority 进程启动失败', error);
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleOutput(child, chunk));
    child.stderr.on('data', (chunk: string) => {
      if (this.child !== child) return;
      if (Buffer.byteLength(chunk, 'utf8') > maximumIpcLineBytes) this.failProcess(unavailable('Policy Authority stderr 超过上限'));
    });
    child.on('error', (error) => {
      if (this.child !== child) return;
      this.failProcess(unavailable('Policy Authority 进程启动失败', error));
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
        this.ready = false;
        this.failPending(unavailable(`Policy Authority 进程异常退出（${code ?? 'null'}/${signal ?? 'null'}）`));
      }
    });
    try {
      const response = await this.sendRaw('hello', undefined, this.config.startupTimeoutMs);
      if (!response.ok) throw remoteError(response.error);
      validateHealthResult(response.result, this.config.environment.GCAC_POLICY_AUTHORITY_ID);
      this.ready = true;
    } catch (error) {
      const failure = error instanceof AppError ? error : unavailable('Policy Authority 握手失败', error);
      if (this.child === child) this.failProcess(failure);
      throw failure;
    }
  }

  private sendRaw(method: PolicyAuthorityIpcMethod, payload: unknown, timeoutMs: number): Promise<PolicyAuthorityIpcResponseV1> {
    const child = this.child;
    if (!child?.stdin || child.stdin.destroyed) return Promise.reject(unavailable('Policy Authority IPC stdin 不可用'));
    const requestId = `pa-${++this.sequence}`;
    const request: PolicyAuthorityIpcRequestV1 = {
      protocolVersion: policyAuthorityIpcVersion,
      requestId,
      method,
      ...(payload === undefined ? {} : { payload }),
    };
    try {
      assertJsonSchema(request, ipcRequestSchema, 'Policy Authority IPC request');
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const error = unavailable(`Policy Authority IPC ${method} 超时`);
        if (this.child === child) this.failProcess(error);
        reject(error);
      }, timeoutMs);
      this.pending.set(requestId, { method, resolve: resolveResponse, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        const failure = unavailable('Policy Authority IPC 写入失败', error);
        if (this.child === child) this.failProcess(failure);
        reject(failure);
      }
    });
  }

  private handleOutput(sourceChild: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== sourceChild) return;
    this.inputBuffer += chunk;
    if (Buffer.byteLength(this.inputBuffer, 'utf8') > maximumIpcLineBytes) {
      this.failProcess(unavailable('Policy Authority stdout 超过单行上限'));
      return;
    }
    let separator = this.inputBuffer.indexOf('\n');
    while (separator >= 0) {
      const line = this.inputBuffer.slice(0, separator).replace(/\r$/, '');
      this.inputBuffer = this.inputBuffer.slice(separator + 1);
      if (!line.trim()) {
        this.failProcess(unavailable('Policy Authority stdout 不允许空行'));
        return;
      }
      try {
        const parsed = JSON.parse(line) as unknown;
        assertJsonSchema(parsed, ipcResponseSchema, 'Policy Authority IPC response');
        const response = parsed as PolicyAuthorityIpcResponseV1;
        const pending = this.pending.get(response.requestId);
        if (!pending) {
          this.failProcess(unavailable('Policy Authority IPC response requestId 未知'));
          return;
        }
        if (response.method !== pending.method) {
          this.failProcess(unavailable('Policy Authority IPC response method 不匹配'));
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(response.requestId);
        pending.resolve(response);
      } catch (error) {
        this.failProcess(unavailable('Policy Authority IPC response 无效', error));
        return;
      }
      separator = this.inputBuffer.indexOf('\n');
    }
  }

  private failProcess(error: AppError): void {
    this.ready = false;
    this.inputBuffer = '';
    this.failPending(error);
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill();
  }

  private failPending(error: AppError): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }
}

interface PendingRequest {
  method: PolicyAuthorityIpcMethod;
  resolve: (response: PolicyAuthorityIpcResponseV1) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

function validateHealthResult(
  result: Record<string, unknown> | undefined,
  expectedAuthorityId?: string,
): PolicyAuthorityProcessHealthV1 {
  if (!result
    || result.serviceVersion !== agentSecurityContractVersion
    || typeof result.authorityId !== 'string'
    || result.authorityId.trim() === ''
    || (expectedAuthorityId !== undefined && result.authorityId !== expectedAuthorityId)
    || typeof result.activeKeyId !== 'string'
    || result.activeKeyId.trim() === ''
    || typeof result.keySetIssuedAt !== 'string'
    || result.keySetIssuedAt.trim() === ''
    || Number.isNaN(Date.parse(result.keySetIssuedAt))) {
    throw unavailable('Policy Authority health 响应字段不完整或身份不匹配');
  }
  return {
    serviceVersion: agentSecurityContractVersion,
    authorityId: result.authorityId,
    activeKeyId: result.activeKeyId,
    keySetIssuedAt: result.keySetIssuedAt,
  };
}

/** 独立 Policy Authority 进程入口；只在直接执行该文件时运行。 */
export async function runPolicyAuthorityProcessV1(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const services = createProductionPolicyAuthorityServicesV1(environment);
  let inputBuffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    inputBuffer += chunk;
    if (Buffer.byteLength(inputBuffer, 'utf8') > maximumIpcLineBytes) {
      writeError('unknown', 'hello', 'UNKNOWN', 'Policy Authority request 超过大小上限');
      process.exitCode = 1;
      return;
    }
    let separator = inputBuffer.indexOf('\n');
    while (separator >= 0) {
      const line = inputBuffer.slice(0, separator).replace(/\r$/, '');
      inputBuffer = inputBuffer.slice(separator + 1);
      void handleProcessLine(line, services);
      separator = inputBuffer.indexOf('\n');
    }
  });
  await new Promise<void>((resolveEnd) => process.stdin.on('end', resolveEnd));
}

async function handleProcessLine(line: string, services: ProductionPolicyAuthorityServicesV1): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
    assertJsonSchema(parsed, ipcRequestSchema, 'Policy Authority IPC request');
  } catch (error) {
    writeError('unknown', 'hello', 'VALIDATION_FAILED', 'Policy Authority request 无效', error);
    return;
  }
  const request = parsed as PolicyAuthorityIpcRequestV1;
  try {
    if (request.method === 'hello' || request.method === 'health') {
      const root = services.trustRoot.getTrustRoot();
      const keySet = services.service.getTrustedKeySet();
      writeSuccess(request, {
        serviceVersion: agentSecurityContractVersion,
        authorityId: root.authorityId,
        activeKeyId: keySet.activeKeyId,
        keySetIssuedAt: keySet.issuedAt,
      });
      return;
    }
    if (request.method === 'issueAuthorization') {
      writeSuccess(request, services.service.issueAuthorization(request.payload as PolicyAuthorityAuthorizationRequestV1) as unknown as Record<string, unknown>);
      return;
    }
    if (request.method === 'revokeToken') {
      const payload = requiredPayload(request.payload, ['token', 'reason']);
      writeSuccess(request, services.service.revokeToken(payload.token, payload.reason as string) as unknown as Record<string, unknown>);
      return;
    }
    if (request.method === 'revokeDecision') {
      const payload = requiredPayload(request.payload, ['decision', 'reason']);
      writeSuccess(request, services.service.revokeDecision(payload.decision, payload.reason as string) as unknown as Record<string, unknown>);
      return;
    }
    if (request.method === 'revokeKey') {
      const payload = requiredPayload(request.payload, ['authorityKeyId']);
      services.service.revokeKey(payload.authorityKeyId as string);
      writeSuccess(request, {});
      return;
    }
    if (request.method === 'refreshKeySet') {
      services.service.refreshKeySet(services.keySet);
      writeSuccess(request, {});
      return;
    }
    if (request.method === 'shutdown') {
      writeSuccess(request, {});
      setImmediate(() => process.exit(0));
      return;
    }
    writeError(request.requestId, request.method, 'VALIDATION_FAILED', 'Policy Authority method 未实现');
  } catch (error) {
    const appError = error instanceof AppError ? error : undefined;
    writeError(request.requestId, request.method, appError?.errorCode ?? 'AGENT_AUTHORIZATION_UNAVAILABLE', appError?.message ?? 'Policy Authority 请求失败', error);
  }
}

function writeSuccess(request: PolicyAuthorityIpcRequestV1, result: Record<string, unknown>): void {
  writeResponse({ protocolVersion: policyAuthorityIpcVersion, requestId: request.requestId, method: request.method, ok: true, result });
}

function writeError(requestId: string, method: PolicyAuthorityIpcMethod, code: string, message: string, _details?: unknown): void {
  writeResponse({
    protocolVersion: policyAuthorityIpcVersion,
    requestId,
    method,
    ok: false,
    error: { code: safeCode(code), message: message.slice(0, 512), retryable: false, mayBeUnknown: false, secretRedacted: true },
  });
}

function writeResponse(response: PolicyAuthorityIpcResponseV1): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function requiredPayload(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION_FAILED', 'Policy Authority IPC payload 必须是对象');
  const payload = value as Record<string, unknown>;
  for (const key of keys) if (!(key in payload)) throw new AppError('VALIDATION_FAILED', `Policy Authority IPC payload 缺少 ${key}`);
  return payload;
}

function remoteError(error: PolicyAuthorityIpcResponseV1['error']): AppError {
  return unavailable(error?.message ?? 'Policy Authority 拒绝请求', { code: error?.code, retryable: error?.retryable });
}

function unavailable(message: string, cause?: unknown): AppError {
  return new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `Policy Authority 已失败关闭：${message}`, {
    fallback: false,
    ...(cause instanceof Error ? { cause: cause.message } : {}),
  });
}

function safeCode(value: string): string {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : 'AGENT_AUTHORIZATION_UNAVAILABLE';
}

function assertConfig(config: ProductionPolicyAuthorityProcessConfig): void {
  if (!config || !isAbsolute(config.executablePath) || !isAbsolute(config.workingDirectory)
    || !Array.isArray(config.args) || !config.environment || config.startupTimeoutMs <= 0 || config.requestTimeoutMs <= 0) {
    throw unavailable('Policy Authority 进程规格无效');
  }
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw unavailable(`缺少生产配置 ${name}`);
  return value;
}

function parseArguments(value: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw unavailable('Policy Authority 参数不是有效 JSON'); }
  if (!Array.isArray(parsed) || parsed.length > 64 || parsed.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 4096)) {
    throw unavailable('Policy Authority 参数必须是固定字符串数组');
  }
  if (parsed.some((item) => forbiddenProcessArguments.has(item) || [...forbiddenProcessArguments].some((flag) => item.startsWith(`${flag}=`)))) {
    throw unavailable('Policy Authority 参数禁止动态代码或调试注入');
  }
  return [...parsed] as string[];
}

function assertPath(path: string, directory: boolean): void {
  try {
    const stat = statSync(path);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('路径类型不匹配');
  } catch (error) {
    throw unavailable(`Policy Authority 路径不存在：${path}`, error);
  }
}

const invokedFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentFilePath = fileURLToPath(import.meta.url);
if (invokedFilePath.toLowerCase() === currentFilePath.toLowerCase()) {
  void runPolicyAuthorityProcessV1().catch((error: unknown) => {
    process.stderr.write(`Policy Authority 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
