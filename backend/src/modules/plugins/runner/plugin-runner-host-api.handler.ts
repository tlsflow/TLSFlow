import { AppError } from '../../../common/errors/app-error.js';
import { createHash, createHmac, createPrivateKey, createPublicKey, sign as signData } from 'node:crypto';
import type { OutboundHttpClient, OutboundHttpRequest, OutboundHttpResponse } from '../../../common/http/outbound-http-client.js';
import type { WriteAuditInput } from '../../audits/audit.service.js';
import type { CertificateArtifactStore } from '../../certificates/artifacts/certificate-artifact-store.js';
import type { ExecutionsRepository } from '../../executions/repository/executions.repository.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { CloudAccountAssetsApplicationService } from '../../providers/application/cloud-account-assets.application-service.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import { assertHostApiGrant, getHostApiMethod, validateHostApiRequest, validateHostApiResult, type HostApiMethodDefinition } from './protocol/host-api.registry.js';
import { PluginRunnerHostApiRequestGate, type HostApiRequestAdmission, type HostApiRequestBinding, type HostApiRequestOutcome } from './host-api.request-gate.js';
import type { PluginRunnerHostApiHandler, PluginRunnerHostCallContext } from './plugin-runner-client.js';
import type { CookieSessionStore } from '../../executors/curl/cookie-session.js';

export interface PluginRunnerHostApiDependencies {
  security: Pick<SecurityServices, 'audit' | 'grants' | 'secrets'>;
  artifacts: Pick<CertificateArtifactStore, 'get'>;
  executions: Pick<ExecutionsRepository, 'getRunOrThrow' | 'getStepOrThrow'>;
  /** 生产必须注入数据库支持的原子消费账本；缺失时所有 Host API 请求失败关闭。 */
  requestGate?: PluginRunnerHostApiRequestGate;
  /** 生产必须注入租户隔离的 Cloud Service 查询端口。 */
  cloudServices?: Pick<CloudAccountAssetsApplicationService, 'get' | 'list'>;
  /** 标准插件资产查询端口；新云资源链路优先使用该端口。 */
  serviceAssets?: Pick<AssetsApplicationService, 'getServiceAsset' | 'listServiceAssets'>;
  /** 生产必须注入不跟随重定向的通用 HTTPS 客户端。 */
  httpClient?: Pick<OutboundHttpClient, 'request'>;
  cookieSessionStore?: CookieSessionStore;
}

/**
 * Plugin Runner 只能通过这组登记的宿主能力访问控制面。
 * 调用上下文由固定的 Runner 执行绑定派生，插件消息不能自行覆盖。
 */
export function createPluginRunnerHostApiHandler(dependencies: PluginRunnerHostApiDependencies): PluginRunnerHostApiHandler {
  return async (context) => {
    let definition: HostApiMethodDefinition | undefined;
    let input = context.input;
    let admission: HostApiRequestAdmission | undefined;
    let dispatchPromise: Promise<Record<string, unknown>> | undefined;
    let requestAcquired = false;
    let completionCommitted = false;
    try {
      definition = getHostApiMethod(context.method);
      if (!dependencies.requestGate) {
        throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 未装配持久化幂等消费门禁，生产请求已失败关闭');
      }
      input = validateHostApiRequest(context.method, context.input);
      assertContextBinding(context);
      assertHostApiGrant(context.method, context.hostPermissions, context.grantRefs);
      const grants = await validateBoundGrants(dependencies, context, definition);
      assertInputGrantBinding(context, input);
      admission = dependencies.requestGate.createAdmission(toRequestBinding(context, input), definition);
      const claimed = await dependencies.requestGate.claim(admission);
      if (claimed.status === 'COMPLETED') {
        return replayOutcome(claimed.outcome);
      }
      if (claimed.status === 'UNKNOWN') {
        throw unknownHostApiError('Host API 请求已经收敛为 UNKNOWN，禁止重新执行', { method: context.method });
      }
      if (claimed.status === 'IN_FLIGHT') {
        throw unknownHostApiError('Host API 请求仍在消费中，禁止并发重放', { method: context.method });
      }
      if (claimed.status === 'CONFLICT') {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Host API 幂等键对应了不同请求摘要', { method: context.method });
      }
      if (claimed.status === 'EXPIRED') {
        throw unknownHostApiError('Host API 请求已过期，禁止执行', { method: context.method });
      }

      requestAcquired = true;
      dispatchPromise = dispatchHostApiCall(dependencies, context, definition, input, grants);
      const remainingMs = Date.parse(context.deadlineAt) - Date.now();
      const output = validateHostApiResult(context.method, await withTimeout(dispatchPromise, Math.min(context.timeoutMs, definition.timeoutMs, Math.max(1, remainingMs))));
      const completion = await dependencies.requestGate.complete(admission, { ok: true, output });
      if (completion !== 'COMMITTED') {
        throw unknownHostApiError('Host API 结果到达时请求已经过期，结果已丢弃', { method: context.method });
      }
      completionCommitted = true;
      await writeHostCallAudit(dependencies, context, definition, input, 'success');
      return output;
    } catch (error) {
      if (admission && dispatchPromise && requestAcquired && !completionCommitted && isHostApiTimeout(error)) {
        const unknown = unknownHostApiError('Host API 超时，结果必须通过恢复账本确认', { method: context.method });
        const unknownResult = hostApiErrorPayload(unknown, definition!);
        await expireHostApiRequest(dependencies.requestGate!, admission, unknownResult);
        observeLateHostApiResult(dependencies, context, definition!, input, admission, dispatchPromise);
        error = unknown;
      } else if (admission && dispatchPromise && requestAcquired && !completionCommitted && isUncertainFailure(error)) {
        const unknown = error instanceof AppError
          ? error
          : unknownHostApiError('Host API 结果状态未知，禁止重放', { method: context.method });
        await expireHostApiRequest(dependencies.requestGate!, admission, hostApiErrorPayload(unknown, definition!));
        error = unknown;
      } else if (admission && dispatchPromise && requestAcquired && !completionCommitted && isAcquiredFailure(error)) {
        const outcome = { ok: false, error: hostApiErrorPayload(error, definition!) } satisfies HostApiRequestOutcome;
        const completion = await dependencies.requestGate!.complete(admission, outcome);
        if (completion !== 'COMMITTED') {
          error = unknownHostApiError('Host API 失败结果到达时请求已经过期，结果已收敛为 UNKNOWN', { method: context.method });
        } else {
          completionCommitted = true;
        }
      }
      if (definition) {
        await writeHostCallAudit(dependencies, context, definition, input, error instanceof AppError && error.errorCode === 'PLUGIN_HOST_CALL_DENIED' ? 'denied' : 'failure', error);
      }
      throw error;
    }
  };
}

function toRequestBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): HostApiRequestBinding {
  return {
    requestId: context.requestId,
    method: context.method,
    input,
    timeoutMs: context.timeoutMs,
    idempotencyKey: context.idempotencyKey,
    deadlineAt: context.deadlineAt,
    tenantId: context.tenantId,
    executionId: context.executionId,
    executionStepId: context.executionStepId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    pluginVersion: context.pluginVersion,
    capability: context.capability,
    actionId: context.actionId,
    actionContractVersion: context.actionContractVersion,
    inputSchemaSha256: context.inputSchemaSha256,
    outputSchemaSha256: context.outputSchemaSha256,
    packageHash: context.packageHash,
    manifestHash: context.manifestHash,
    resourceHash: context.resourceHash,
    grantRefs: context.grantRefs,
    workflowVersionId: context.workflowVersionId,
    planDigest: context.planDigest,
    hostPermissions: context.hostPermissions,
  };
}

function replayOutcome(outcome: HostApiRequestOutcome): Record<string, unknown> {
  if (!outcome) throw unknownHostApiError('Host API Receipt 缺失，禁止重放', { replayed: true });
  if (outcome.ok) return outcome.output ?? {};
  const error = outcome.error;
  if (!error) throw unknownHostApiError('Host API 失败 Receipt 缺失，禁止重放', { replayed: true });
  throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 已记录失败结果，禁止重新执行', { code: error?.code, replayed: true });
}

function unknownHostApiError(message: string, details: Record<string, unknown>): AppError {
  return new AppError('PLUGIN_OPERATION_UNKNOWN_STATE', message, details);
}

function hostApiErrorPayload(error: unknown, definition: HostApiMethodDefinition) {
  return {
    code: error instanceof AppError ? error.errorCode : 'PLUGIN_HOST_CALL_DENIED',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
    retryable: definition.retryable,
    mayBeUnknown: !definition.readOnly || error instanceof AppError && error.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE',
    secretRedacted: true as const,
  };
}

function isHostApiTimeout(error: unknown): boolean {
  return error instanceof HostApiTimeout;
}

function isUncertainFailure(error: unknown): boolean {
  return error instanceof AppError && error.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE';
}

function isAcquiredFailure(error: unknown): boolean {
  // 消费权一旦取得，任何确定性失败都必须写入终态；否则记录会永久停在 IN_FLIGHT。
  return !(error instanceof AppError && error.errorCode === 'IDEMPOTENCY_CONFLICT');
}

async function expireHostApiRequest(
  requestGate: PluginRunnerHostApiRequestGate,
  admission: HostApiRequestAdmission,
  error: ReturnType<typeof hostApiErrorPayload>,
): Promise<void> {
  try {
    const result = await requestGate.expire(admission, error);
    if (result === 'CONFLICT') throw unknownHostApiError('Host API UNKNOWN 收敛发生账本冲突', { method: admission.method });
  } catch (error) {
    if (error instanceof AppError && error.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE') throw error;
    throw unknownHostApiError('Host API UNKNOWN 收敛失败，禁止继续执行', { method: admission.method });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new HostApiTimeout()), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class HostApiTimeout extends Error {}

function observeLateHostApiResult(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  admission: HostApiRequestAdmission,
  dispatchPromise: Promise<Record<string, unknown>>,
): void {
  void dispatchPromise.then(
    async (output) => {
      const result = await dependencies.requestGate!.complete(admission, { ok: true, output });
      if (result !== 'COMMITTED') await writeHostCallAudit(dependencies, context, definition, input, 'failure', new AppError('PLUGIN_OPERATION_UNKNOWN_STATE', 'Host API 迟到成功结果已丢弃'));
    },
    async (error: unknown) => {
      const result = await dependencies.requestGate!.complete(admission, { ok: false, error: hostApiErrorPayload(error, definition) });
      if (result !== 'COMMITTED') await writeHostCallAudit(dependencies, context, definition, input, 'failure', new AppError('PLUGIN_OPERATION_UNKNOWN_STATE', 'Host API 迟到失败结果已丢弃'));
    },
  ).catch(() => undefined);
}

async function validateBoundGrants(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
) {
  const grants = await Promise.all(context.grantRefs.map((grantId) => dependencies.security.grants.validate({
    grantId,
    tenantId: context.tenantId,
    runId: context.executionId,
    stepId: context.executionStepId,
    workflowVersionId: context.workflowVersionId,
      pluginVersionId: context.pluginVersionId,
      pluginId: context.pluginId,
      capability: context.capability,
      actionId: context.actionId,
      actionContractVersion: context.actionContractVersion,
      inputSchemaSha256: context.inputSchemaSha256,
      outputSchemaSha256: context.outputSchemaSha256,
      planDigest: context.planDigest,
      executorType: 'plugin.action',
  })));
  if (!grants.some((grant) => definition.requiredGrants.every((requiredGrant) => grant.allowedActions.includes(requiredGrant)))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API Grant 未覆盖注册权限', { method: context.method });
  }
  return grants;
}

async function dispatchHostApiCall(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  switch (context.method) {
    case 'artifact.grant.read':
      return await readArtifact(dependencies, context, input, grants);
    case 'secret.grant.resolve':
      return await resolveSecret(dependencies, context, input, grants);
    case 'crypto.sign':
      return await signCrypto(dependencies, context, input, grants);
    case 'crypto.hmac':
      return await hmacCrypto(dependencies, context, input, grants);
    case 'cloudService.get':
      return await readCloudService(dependencies, context, input);
    case 'http.request':
      return await requestHttp(dependencies, context, definition, input, grants);
    case 'execution.isCancelled':
      return await readCancellation(dependencies, context);
    case 'audit.append':
      return await appendPluginAudit(dependencies, context, input);
    default:
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 方法未注册生产处理器', { method: definition.method });
  }
}

async function readCloudService(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cloudServiceRef = stringValue(input.cloudServiceRef, 'cloudServiceRef');
  const standard = await dependencies.serviceAssets?.getServiceAsset(context.tenantId, cloudServiceRef);
  const legacy = !standard ? await dependencies.cloudServices?.get(context.tenantId, cloudServiceRef) : undefined;
  const service = standard ?? legacy;
  if (!service || service.tenantId !== context.tenantId || service.status !== 'ACTIVE'
    || ('providerKey' in service ? service.providerKey : service.metadata.pluginId) !== context.pluginId) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Cloud Service 不属于当前插件、当前租户或不是 ACTIVE 标准对象', { cloudServiceRef });
  }
  const endpoint = resolveCloudServiceEndpoint(service);
  if (endpoint !== undefined) assertHttpsUrl(endpoint, 'Cloud Service endpoint');
  const providerKey = 'providerKey' in service ? service.providerKey : String(service.metadata.pluginId ?? context.pluginId);
  const displayName = 'displayName' in service ? service.displayName : service.displayName ?? providerKey;
  const metadata = service.metadata ?? {};
  const scope = 'scope' in service ? service.scope : { metadata };
  return {
    ok: true,
    data: {
      apiVersion: 'gcac.cloud-service/v1',
      kind: 'CloudService',
      cloudServiceRef: service.id,
      providerKey,
      displayName,
      ...('accountId' in service && service.accountId ? { accountId: service.accountId } : {}),
      scope: { ...scope, ...(endpoint ? { endpoint } : {}) },
      metadata,
      status: service.status,
      version: service.version,
    },
  };
}

async function requestHttp(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  if (!dependencies.httpClient) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP Host API 未装配');
  const url = stringValue(input.url, 'url');
  assertHttpsUrl(url, 'HTTP URL');
  const directoryUrl = input.directoryUrl === undefined ? undefined : stringValue(input.directoryUrl, 'directoryUrl');
  if (directoryUrl && new URL(url).origin !== new URL(directoryUrl).origin) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP URL 不属于 ACME Directory Origin');
  }
  await assertRegisteredCloudEndpoint(dependencies, context, url, grants);
  const method = stringValue(input.method, 'method');
  const headers = stringRecordValue(input.headers, 'headers');
  assertHttpHeaders(url, headers);
  const cookieSessionRef = input.cookieSessionRef === undefined ? undefined : stringValue(input.cookieSessionRef, 'cookieSessionRef');
  if (cookieSessionRef && !hasGrantAction(grants, 'http.cookie.session')) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API Grant 未覆盖 http.cookie.session');
  const cookieJar = cookieSessionRef
    ? dependencies.cookieSessionStore?.getOrCreate({
        tenantId: context.tenantId,
        runId: context.executionId,
        workflowVersionId: context.workflowVersionId,
        cookieSessionRef,
    })
    : undefined;
  if (cookieSessionRef && !cookieJar) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'CookieSession Host API 未装配');
  if (cookieSessionRef && Object.keys(headers).some((name) => name.toLowerCase() === 'cookie')) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'CookieSession 不得与显式 Cookie Header 同时使用');
  }
  if (cookieJar) {
    const cookie = cookieJar.getCookieHeader(url);
    if (cookie) headers.Cookie = cookie;
  }
  const body = input.body === undefined
    ? undefined
    : typeof input.body === 'string'
      ? input.body
      : stringValue(input.body, 'body');
  if (body !== undefined && Buffer.byteLength(body, 'utf8') > 1024 * 1024) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP 请求体超过大小上限');
  }
  const request: OutboundHttpRequest = {
    url,
    method: method as OutboundHttpRequest['method'],
    headers,
    ...(body !== undefined ? { body } : {}),
    timeoutMs: Math.min(context.timeoutMs, definition.timeoutMs),
    maxResponseBytes: definition.maxOutputBytes,
  };
  const response = await dependencies.httpClient.request(request);
  const cookieRedactionValues = cookieJar ? collectCookieHeaderValues(response.setCookie) : [];
  if (cookieJar && response.setCookie?.length) cookieJar.setCookies(response.setCookie, url);
  if (cookieJar) cookieRedactionValues.push(...cookieJar.getRedactionValues(url));
  return { ok: true, data: normalizeHttpResponse(response, definition.maxOutputBytes, cookieRedactionValues) };
}

function normalizeHttpResponse(response: OutboundHttpResponse, maxResponseBytes: number, cookieRedactionValues: string[] = []): Record<string, unknown> {
  if (!response || !Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    throw new AppError('PLUGIN_CONTRACT_INVALID', 'HTTP Host API 返回无效状态码');
  }
  const bodyText = typeof response.bodyText === 'string' ? maskCookieText(response.bodyText, cookieRedactionValues) : '';
  if (Buffer.byteLength(bodyText, 'utf8') > maxResponseBytes) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP 响应超过大小上限');
  const headers = Object.fromEntries(
    Object.entries(stringRecordValue(response.headers, 'response.headers'))
      .filter(([key]) => !/^(?:set-)?cookie$/i.test(key)),
  );
  assertResponseHeaders(headers);
  const body = response.body === undefined ? bodyText : maskCookieUnknown(response.body, cookieRedactionValues);
  return { statusCode: response.statusCode, headers, body, bodyText };
}

function hasGrantAction(grants: Array<{ allowedActions: string[] }>, action: string): boolean {
  return grants.some((grant) => grant.allowedActions.includes(action));
}

function collectCookieHeaderValues(headers: readonly string[] | undefined): string[] {
  return (headers ?? []).flatMap((header) => {
    const pair = header.split(';', 1)[0]?.trim() ?? '';
    const separator = pair.indexOf('=');
    return separator > 0 ? [pair, pair.slice(separator + 1)] : [pair];
  }).filter(Boolean);
}

function maskCookieText(value: string, redactionValues: readonly string[]): string {
  return redactionValues.reduce((result, secret) => secret ? result.split(secret).join('[REDACTED]') : result, value);
}

function maskCookieUnknown(value: unknown, redactionValues: readonly string[]): unknown {
  if (typeof value === 'string') return maskCookieText(value, redactionValues);
  if (Array.isArray(value)) return value.map((item) => maskCookieUnknown(item, redactionValues));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      /^(?:set-)?cookie$/i.test(key) ? '[REDACTED]' : maskCookieUnknown(child, redactionValues),
    ]));
  }
  return value;
}

async function assertRegisteredCloudEndpoint(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  urlValue: string,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<void> {
  const requestOrigin = new URL(urlValue).origin;
  const standardServices = dependencies.serviceAssets
    ? (await dependencies.serviceAssets.listServiceAssets(context.tenantId, { page: 1, pageSize: 500, filter: {}, sort: undefined })).items
    : [];
  const legacyServices = dependencies.cloudServices ? (await dependencies.cloudServices.list(context.tenantId)).items : [];
  const allowed = [...standardServices, ...legacyServices].some((service) => {
    const providerKey = 'providerKey' in service ? service.providerKey : service.metadata.pluginId;
    if (service.tenantId !== context.tenantId || service.status !== 'ACTIVE' || providerKey !== context.pluginId) return false;
    return resolveCloudServiceEndpoints(service).some((endpoint) => {
      try {
        return new URL(endpoint).origin === requestOrigin;
      } catch {
        return false;
      }
    });
  });
  if (!allowed) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP URL 未绑定到当前插件的 ACTIVE Cloud Service', { url: urlValue });
  }
}

/** 中文说明：云账号创建不要求用户手填厂商公共 API 地址；缺省地址由 Provider
 * 标准定义统一补齐，HTTP 出口登记与 cloudService.get 使用同一解析结果。 */
function resolveCloudServiceEndpoint(service: { providerKey?: string; scope?: { endpoint?: string }; metadata?: Record<string, unknown> }): string | undefined {
  if (typeof service.scope?.endpoint === 'string' && service.scope.endpoint.trim() !== '') return service.scope.endpoint;
  const endpoints = resolveCloudServiceEndpoints(service);
  return endpoints[0];
}

/** 中文说明：HTTP 出口必须登记完整的 Provider 标准端点集合；账号未自定义端点时，
 * 阿里云云账号同时允许 CDN 与 ECS 只读 API，避免发现可用区域时被误判为未绑定服务。 */
function resolveCloudServiceEndpoints(service: { providerKey?: string; scope?: { endpoint?: string }; metadata?: Record<string, unknown> }): string[] {
  if (typeof service.scope?.endpoint === 'string' && service.scope.endpoint.trim() !== '') return [service.scope.endpoint];
  const declared = service.metadata?.serviceEndpoints;
  if (Array.isArray(declared)) return declared.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim());
  const endpoint = service.metadata?.endpoint;
  return typeof endpoint === 'string' && endpoint.trim() !== '' ? [endpoint.trim()] : [];
}


function assertHttpsUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', `${name} 不是有效 URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', `${name} 必须是无凭据、无 Fragment 的 HTTPS URL`);
  }
}

function stringRecordValue(value: unknown, name: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 超过字段上限`);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (typeof item !== 'string' || item.length > 8192) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 包含无效字符串字段`);
    result[key] = item;
  }
  return result;
}

function assertHttpHeaders(urlValue: string, headers: Record<string, string>): void {
  const url = new URL(urlValue);
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP 请求头名称或值无效');
    }
    const lowerName = name.toLowerCase();
    if (['connection', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'].includes(lowerName)) {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP 请求包含禁止的 Hop-by-hop 请求头');
    }
    if (lowerName === 'cookie' || lowerName === 'set-cookie') {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP 请求不得手写 Cookie 或 Set-Cookie，必须使用 CookieSession');
    }
    if (lowerName === 'host' && value.toLowerCase() !== url.host.toLowerCase()) {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HTTP Host 请求头必须匹配 URL 主机');
    }
  }
}

function assertResponseHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) throw new AppError('PLUGIN_CONTRACT_INVALID', 'HTTP 响应头包含非法换行');
  }
}

async function readArtifact(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const artifactRef = stringValue(input.artifactRef, 'artifactRef');
  assertSelectedGrant(context, grants, grantId, 'artifact.read');
  await dependencies.security.grants.validate({
    grantId,
    tenantId: context.tenantId,
    runId: context.executionId,
    stepId: context.executionStepId,
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    actionId: context.actionId,
    actionContractVersion: context.actionContractVersion,
    inputSchemaSha256: context.inputSchemaSha256,
    outputSchemaSha256: context.outputSchemaSha256,
    planDigest: context.planDigest,
    executorType: 'plugin.action',
    artifactRef,
    action: 'artifact.read',
  });
  const artifact = await dependencies.artifacts.get(artifactRef, context.tenantId);
  if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '授权制品不存在或不属于当前租户', { artifactRef });
  return {
    ok: true,
    data: {
      artifactRef: artifact.artifactRef,
      contentBase64: artifact.content.toString('base64'),
      contentType: artifact.contentType,
      // 历史制品记录可能只保存短指纹；Runner 合同要求完整 SHA-256 摘要。
      sha256: `sha256:${createHash('sha256').update(artifact.content).digest('hex')}`,
      ...(artifact.expiresAt ? { expiresAt: artifact.expiresAt } : {}),
    },
  };
}

async function resolveSecret(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const secretRef = stringValue(input.secretRef, 'secretRef');
  const purpose = stringValue(input.purpose, 'purpose');
  assertSelectedGrant(context, grants, grantId, 'secret.resolve');
  const resolved = await dependencies.security.secrets.resolveForExecution({
    grantId,
    secretRef,
    purpose,
    runId: context.executionId,
    stepId: context.executionStepId,
    executorType: 'plugin.action',
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    grantAction: 'secret.resolve',
    actorId: context.pluginId,
    context: { tenantId: context.tenantId },
    // purpose 仅用于 Secret 使用审计；Grant 校验必须使用 Host API 注册权限，
    // 否则诸如 adcs.ca.certificate.issue.credential 这类用途会被误当作动作。
    markUsed: false,
  });
  let publicKeyJwk: Record<string, unknown> | undefined;
  try {
    publicKeyJwk = createPublicKey(createPrivateKey(resolved.plainText)).export({ format: 'jwk' }) as Record<string, unknown>;
  } catch {
    // 非密钥 Secret 仍保持旧的脱敏返回；crypto.sign 会拒绝它。
  }
  return {
    ok: true,
    data: {
      secretRef: resolved.secretRef,
      versionId: resolved.versionId,
      fingerprint: resolved.fingerprint,
      // SecretService 的历史 fingerprint 仅用于短展示；AD CS Agent 需要
      // 可复算的完整 SHA-256 凭据摘要，且绝不返回明文。
      credentialFingerprint: `sha256:${createHash('sha256').update(resolved.plainText, 'utf8').digest('hex')}`,
      value: '[REDACTED]',
      ...(publicKeyJwk ? {
        publicKeyJwk,
        publicKeyFingerprintSha256: createHash('sha256').update(createPublicKey(createPrivateKey(resolved.plainText)).export({ type: 'spki', format: 'der' })).digest('hex'),
      } : {}),
    },
  };
}

async function signCrypto(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const secretRef = stringValue(input.secretRef, 'secretRef');
  const data = stringValue(input.data, 'data');
  const signatureAlgorithm = stringValue(input.signatureAlgorithm, 'signatureAlgorithm');
  assertSelectedGrant(context, grants, grantId, 'crypto.sign');
  const resolved = await dependencies.security.secrets.resolveForExecution({
    grantId,
    secretRef,
    purpose: 'crypto.sign',
    runId: context.executionId,
    stepId: context.executionStepId,
    executorType: 'plugin.action',
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    grantAction: 'crypto.sign',
    actorId: context.pluginId,
    context: { tenantId: context.tenantId },
    markUsed: false,
  });
  const privateKey = createPrivateKey(resolved.plainText);
  const publicKey = createPublicKey(privateKey);
  assertSignatureAlgorithmForKey(signatureAlgorithm, publicKey);
  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const der = signData(input.hashAlgorithm === 'SHA-256' ? 'sha256' : input.hashAlgorithm === 'SHA-384' ? 'sha384' : 'sha512', Buffer.from(data), privateKey);
  const signature = signatureAlgorithm === 'ES256' ? derToJose(der, 32) : der.toString('base64url');
  return {
    ok: true,
    data: {
      signatureBase64Url: signature,
      publicKeyJwk,
      publicKeyFingerprintSha256: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
    },
  };
}

async function hmacCrypto(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  input: Record<string, unknown>,
  grants: Array<{ id: string; allowedActions: string[] }>,
): Promise<Record<string, unknown>> {
  const grantId = stringValue(input.grantId, 'grantId');
  const secretRef = stringValue(input.secretRef, 'secretRef');
  const publicValueRef = stringValue(input.publicValueRef, 'publicValueRef');
  const publicValuePlaceholder = stringValue(input.publicValuePlaceholder, 'publicValuePlaceholder');
  const data = stringValue(input.data, 'data');
  const hashAlgorithm = stringValue(input.hashAlgorithm, 'hashAlgorithm');
  const keySuffix = input.keySuffix === undefined ? '' : stringValue(input.keySuffix, 'keySuffix');
  if (secretRef === publicValueRef || !data.includes(publicValuePlaceholder)) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HMAC 请求必须分离密钥引用和公开标识引用，并包含占位符');
  }
  assertSelectedGrant(context, grants, grantId, 'crypto.hmac');
  const common = {
    grantId,
    runId: context.executionId,
    stepId: context.executionStepId,
    executorType: 'plugin.action',
    workflowVersionId: context.workflowVersionId,
    pluginVersionId: context.pluginVersionId,
    pluginId: context.pluginId,
    capability: context.capability,
    planDigest: context.planDigest,
    actorId: context.pluginId,
    context: { tenantId: context.tenantId },
    markUsed: false,
  } as const;
  const [key, publicValue] = await Promise.all([
    dependencies.security.secrets.resolveForExecution({ ...common, secretRef, purpose: 'crypto.hmac', grantAction: 'crypto.hmac' }),
    dependencies.security.secrets.resolveForExecution({ ...common, secretRef: publicValueRef, purpose: 'crypto.hmac.public-identifier', grantAction: 'crypto.hmac' }),
  ]);
  const algorithm = hmacAlgorithm(hashAlgorithm);
  const resolvedData = data.split(publicValuePlaceholder).join(publicValue.plainText);
  const signatureBase64 = createHmac(algorithm, `${key.plainText}${keySuffix}`).update(resolvedData, 'utf8').digest('base64');
  return { ok: true, data: { signatureBase64, publicValue: publicValue.plainText } };
}

function hmacAlgorithm(value: string): 'sha1' | 'sha256' | 'sha384' | 'sha512' {
  switch (value) {
    case 'SHA-1': return 'sha1';
    case 'SHA-256': return 'sha256';
    case 'SHA-384': return 'sha384';
    case 'SHA-512': return 'sha512';
    default: throw new AppError('PLUGIN_HOST_CALL_DENIED', 'HMAC 哈希算法不在固定集合');
  }
}

function assertSignatureAlgorithmForKey(signatureAlgorithm: string, publicKey: ReturnType<typeof createPublicKey>): void {
  const type = publicKey.asymmetricKeyType;
  const namedCurve = publicKey.asymmetricKeyDetails?.namedCurve;
  if (signatureAlgorithm === 'ES256' && type === 'ec' && namedCurve === 'prime256v1') return;
  if (signatureAlgorithm === 'ES384' && type === 'ec' && namedCurve === 'secp384r1') return;
  if (signatureAlgorithm === 'RS256' && (type === 'rsa' || type === 'rsa-pss')) return;
  throw new AppError('PLUGIN_HOST_CALL_DENIED', '签名算法与账户私钥类型不匹配', { signatureAlgorithm, asymmetricKeyType: type, namedCurve });
}

function derToJose(signature: Buffer, size: number): string {
  if (signature[0] !== 0x30) throw new AppError('PLUGIN_CONTRACT_INVALID', 'ES256 签名不是 DER 序列');
  let offset = 2;
  if (signature[1]! & 0x80) offset += signature[1]! & 0x7f;
  if (signature[offset] !== 0x02) throw new AppError('PLUGIN_CONTRACT_INVALID', 'ES256 签名缺少 r');
  const rLength = signature[offset + 1]!;
  const r = signature.subarray(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new AppError('PLUGIN_CONTRACT_INVALID', 'ES256 签名缺少 s');
  const sLength = signature[offset + 1]!;
  const s = signature.subarray(offset + 2, offset + 2 + sLength);
  const normalize = (value: Buffer) => {
    let result = value;
    while (result.length > size && result[0] === 0) result = result.subarray(1);
    if (result.length > size) throw new AppError('PLUGIN_CONTRACT_INVALID', 'ES256 签名整数超出长度');
    return Buffer.concat([Buffer.alloc(size - result.length), result]);
  };
  return Buffer.concat([normalize(r), normalize(s)]).toString('base64url');
}

async function readCancellation(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext): Promise<Record<string, unknown>> {
  const [run, step] = await Promise.all([
    dependencies.executions.getRunOrThrow(context.executionId, context.tenantId),
    dependencies.executions.getStepOrThrow(context.executionStepId, context.tenantId),
  ]);
  if (step.executionRunId !== context.executionId) throw new AppError('PLUGIN_HOST_CALL_DENIED', '执行步骤不属于当前运行');
  return { ok: true, data: { cancelled: run.status === 'CANCELLED' } };
}

async function appendPluginAudit(dependencies: PluginRunnerHostApiDependencies, context: PluginRunnerHostCallContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await dependencies.security.audit.write({
    eventType: stringValue(input.eventType, 'eventType'),
    actorType: 'system',
    actorId: context.pluginId,
    action: stringValue(input.action, 'action'),
    resourceType: stringValue(input.resourceType, 'resourceType'),
    resourceId: stringValue(input.resourceId, 'resourceId'),
    result: input.result as WriteAuditInput['result'],
    riskLevel: 'medium',
    context: { tenantId: context.tenantId },
    detail: recordValue(input.detail ?? {}, 'detail'),
    failClosed: true,
  });
  return { ok: true };
}

function assertContextBinding(context: PluginRunnerHostCallContext): void {
  if (!context.requestId || !context.idempotencyKey || !context.deadlineAt || !context.tenantId || !context.executionId || !context.executionStepId || !context.workflowVersionId || !context.pluginVersionId || !context.pluginId || !context.capability || !context.actionId || !context.actionContractVersion) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API 缺少固定执行绑定');
  }
  if (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 1) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API 缺少有效超时预算');
  const deadline = Date.parse(context.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API 截止时间无效或已过期');
  if (!/^[a-f0-9]{64}$/.test(context.planDigest)) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API planDigest 无效');
  for (const [name, value] of [
    ['inputSchemaSha256', context.inputSchemaSha256],
    ['outputSchemaSha256', context.outputSchemaSha256],
    ['packageHash', context.packageHash],
    ['manifestHash', context.manifestHash],
    ['resourceHash', context.resourceHash],
  ] as const) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Runner Host API ${name} 无效`);
  }
}

function assertInputGrantBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): void {
  if (!('grantId' in input)) return;
  const grantId = stringValue(input.grantId, 'grantId');
  if (!context.grantRefs.includes(grantId)) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入 Grant 未绑定到当前执行');
}

function assertSelectedGrant(context: PluginRunnerHostCallContext, grants: Array<{ id: string; allowedActions: string[] }>, grantId: string, action: string): void {
  const grant = grants.find((item) => item.id === grantId);
  if (!grant || !context.grantRefs.includes(grantId) || !grant.allowedActions.includes(action)) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入 Grant 无权执行请求动作', { grantId, action });
  }
}

function assertExecutionInputBinding(context: PluginRunnerHostCallContext, input: Record<string, unknown>): void {
  if (stringValue(input.executionId, 'executionId') !== context.executionId || stringValue(input.executionStepId, 'executionStepId') !== context.executionStepId) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 输入执行绑定不匹配');
  }
}

async function writeHostCallAudit(
  dependencies: PluginRunnerHostApiDependencies,
  context: PluginRunnerHostCallContext,
  definition: HostApiMethodDefinition,
  input: Record<string, unknown>,
  result: WriteAuditInput['result'],
  error?: unknown,
): Promise<void> {
  const auditedInput = Object.fromEntries(definition.auditFields
    .filter((field) => input[field] !== undefined)
    .map((field) => [field, field === 'url' && context.method === 'http.request' ? redactHttpAuditUrl(input[field]) : input[field]]));
  await dependencies.security.audit.write({
    eventType: 'plugin.host_api.call',
    actorType: 'system',
    actorId: context.pluginId,
    action: context.method,
    resourceType: 'executionStep',
    resourceId: context.executionStepId,
    result,
    riskLevel: definition.riskLevel === 'CRITICAL' ? 'critical' : definition.riskLevel === 'HIGH' ? 'high' : definition.riskLevel === 'MEDIUM' ? 'medium' : 'low',
    context: { tenantId: context.tenantId },
    detail: {
      pluginVersionId: context.pluginVersionId,
      workflowVersionId: context.workflowVersionId,
      capability: context.capability,
      actionId: context.actionId,
      actionContractVersion: context.actionContractVersion,
      inputSchemaSha256: context.inputSchemaSha256,
      outputSchemaSha256: context.outputSchemaSha256,
      planDigest: context.planDigest,
      grantRefs: context.grantRefs,
      input: auditedInput,
      ...(error ? { errorCode: error instanceof AppError ? error.errorCode : 'PLUGIN_HOST_CALL_DENIED' } : {}),
    },
    failClosed: true,
  });
}

function redactHttpAuditUrl(value: unknown): string {
  if (typeof value !== 'string') return '[REDACTED]';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[REDACTED]';
  }
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value;
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value;
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('PLUGIN_HOST_CALL_DENIED', `Host API ${name} 无效`);
  return value as Record<string, unknown>;
}
