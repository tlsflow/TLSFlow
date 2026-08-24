import { createHash } from 'node:crypto';

const PLUGIN_ID = 'ca.acme-dns';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_VERSION_ID = 'ca.acme-dns:1.0.0';
const WORKFLOW_VERSION = '1.0.0';
const RECOVERY_WORKFLOW = 'ca.operation.recover';
const CAPABILITY = 'ca.challenge.dns-solver';
const PERMISSIONS = Object.freeze(['secret.resolve', 'audit.append']);
const operationLedger = new Map();

// DNS Solver 只处理 TXT 记录；账户、订单和挑战编排均由 ca.acme 负责。
export function createPluginRunnerExecutor() {
  const descriptor = createDescriptor();
  return Object.freeze({
    descriptor,
    async execute(context, hostApi) {
      return executeOperation(context, hostApi, descriptor);
    },
  });
}

async function executeOperation(context, hostApi, descriptor) {
  let security;
  let operation = 'unknown';
  try {
    assertContext(context, descriptor);
    const input = record(context.input, 'input');
    operation = text(input.operation, 'operation');
    assertWorkflow(input, operation);
    security = validateSecurity(input, context, descriptor);
    checkDeadline(context);
    checkCancelled(context);

    const previous = operationLedger.get(context.idempotencyKey);
    if (previous) {
      if (previous.digest !== security.operationDigest) throw failure('DNS_IDEMPOTENCY_CONFLICT', '同一幂等键绑定了不同的 DNS 操作摘要', false, false);
      await appendAudit(context, hostApi, security, operation, 'success', 'idempotent-replay');
      return clone(previous.result);
    }

    const keyMaterial = operation === 'operation.recover'
      ? undefined
      : await resolveProviderSecret(context, hostApi, security, input, operation);
    const result = await performOperation(context, input, operation, keyMaterial);
    operationLedger.set(context.idempotencyKey, { digest: security.operationDigest, result: clone(result) });
    await appendAudit(context, hostApi, security, operation, result.status === 'SUCCESS' ? 'success' : 'failure', result.summary);
    return result;
  } catch (error) {
    const normalized = normalizeError(error);
    const status = context?.writeEffect && normalized.mayBeUnknown ? 'UNKNOWN' : 'FAILED';
    const result = failedResult(status, normalized);
    if (context?.idempotencyKey && security && normalized.mayBeUnknown) {
      operationLedger.set(context.idempotencyKey, { digest: security.operationDigest, result: clone(result) });
    }
    if (security && context && hostApi) await appendAuditSafely(context, hostApi, security, operation, 'failure', normalized.code);
    return result;
  }
}

async function performOperation(context, input, operation, keyMaterial) {
  if (operation === 'record.present') return changeRecord(context, input, keyMaterial, 'present');
  if (operation === 'record.cleanup') return changeRecord(context, input, keyMaterial, 'cleanup');
  if (operation === 'record.propagation-check') return propagationCheck(context, input, keyMaterial);
  if (operation === 'operation.recover') return recoverOperation(input);
  throw failure('DNS_OPERATION_UNSUPPORTED', 'DNS Solver 不支持该生命周期操作', false, false);
}

async function changeRecord(context, input, keyMaterial, action) {
  const recordName = dnsRecordName(input.recordName);
  const recordValue = dnsTxtValue(input.recordValue);
  const zoneId = identifier(input.zoneId, 'zoneId');
  const provider = identifier(input.provider, 'provider');
  const ttl = boundedInteger(input.ttl ?? 60, 30, 86400, 'ttl');
  if (input.accountId !== undefined || input.orderId !== undefined || input.challengeUrl !== undefined) {
    throw failure('DNS_SOLVER_OWNERSHIP_VIOLATION', 'DNS Solver 不得接收账户、订单或挑战编排字段', false, false);
  }
  const response = await providerRequest(context, input, keyMaterial, action === 'present' ? 'PUT' : 'DELETE', {
    provider,
    zoneId,
    recordName,
    recordType: 'TXT',
    recordValue,
    ttl,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw failure('DNS_PROVIDER_CHANGE_FAILED', 'DNS Provider 记录变更失败', action === 'cleanup', action === 'cleanup');
  }
  return successResult(`record.${action}`, {
    kind: 'DnsChallengeRecord',
    apiVersion: 'gcac.ca-object/v1',
    stableKey: `dns-txt:${provider}:${zoneId}:${recordName}:${hash(recordValue)}`,
    pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId,
    provider,
    zoneId,
    recordName,
    recordType: 'TXT',
    recordValueDigest: `sha256:${hash(recordValue)}`,
    ttl,
    status: action === 'present' ? 'presented' : 'cleaned',
  });
}

async function propagationCheck(context, input, keyMaterial) {
  const recordName = dnsRecordName(input.recordName);
  const recordValue = dnsTxtValue(input.recordValue);
  const provider = identifier(input.provider, 'provider');
  const zoneId = identifier(input.zoneId, 'zoneId');
  const response = await providerRequest(context, input, keyMaterial, 'GET', {
    provider,
    zoneId,
    recordName,
    recordType: 'TXT',
    recordValue,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('DNS_PROPAGATION_CHECK_FAILED', 'DNS 传播查询失败', true, false);
  const propagated = response.body.propagated === true;
  if (!propagated) throw failure('DNS_PROPAGATION_PENDING', 'DNS TXT 记录尚未传播完成', true, false);
  return successResult('record.propagation-check', {
    kind: 'DnsChallengeRecord',
    apiVersion: 'gcac.ca-object/v1',
    stableKey: `dns-txt:${provider}:${zoneId}:${recordName}:${hash(recordValue)}`,
    pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId,
    provider,
    zoneId,
    recordName,
    recordType: 'TXT',
    recordValueDigest: `sha256:${hash(recordValue)}`,
    status: 'propagated',
  });
}

async function providerRequest(context, input, keyMaterial, method, payload) {
  if (input.failureMode === 'timeout' || input.failureMode === 'unknown') {
    throw failure('DNS_PROVIDER_OPERATION_UNKNOWN_STATE', 'DNS Provider 写操作结果不可确认', true, true);
  }
  if (input.sandboxResponse !== undefined) {
    if (input.sandboxRef !== 'sandbox://dns') throw failure('DNS_SANDBOX_BINDING_INVALID', 'DNS Sandbox 缺少固定绑定', false, false);
    const sandbox = record(input.sandboxResponse, 'sandboxResponse');
    return {
      statusCode: boundedInteger(sandbox.statusCode ?? 200, 100, 599, 'sandboxResponse.statusCode'),
      body: record(sandbox.body ?? {}, 'sandboxResponse.body'),
    };
  }
  const endpoint = httpsUrl(input.endpointUrl, 'endpointUrl');
  const timeoutMs = boundedInteger(input.timeoutMs ?? 10000, 1, 120000, 'timeoutMs');
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, Math.max(1, remaining)));
  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${keyMaterial.apiToken}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body = {};
    if (bodyText) {
      try { body = JSON.parse(bodyText); } catch { throw failure('DNS_PROVIDER_RESPONSE_INVALID', 'DNS Provider 返回不是 JSON', false, false); }
    }
    return { statusCode: response.status, body: record(body, 'providerResponse') };
  } catch (error) {
    if (controller.signal.aborted) throw failure('DNS_PROVIDER_TIMEOUT', 'DNS Provider 请求超时，写操作结果可能未知', true, Boolean(context.writeEffect));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveProviderSecret(context, hostApi, security, input, operation) {
  const secretRef = text(input.secretRef, 'secretRef');
  if (!/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(secretRef)) throw failure('DNS_SECRET_REF_INVALID', 'DNS SecretRef 格式无效', false, false);
  if (typeof input.apiToken === 'string') throw failure('DNS_SECRET_INLINE_FORBIDDEN', 'DNS Provider Token 必须通过 Secret Grant 提供', false, false);
  const result = await hostApi.call('secret.grant.resolve', {
    grantId: security.grantRef,
    secretRef,
    purpose: `dns-solver.${operation}.provider-token`,
  }, context.grantRefs, 5000);
  const data = record(result.data ?? result, 'secretResult');
  const apiToken = data.apiToken ?? data.token;
  if (typeof apiToken !== 'string' || apiToken.length < 8) throw failure('DNS_PROVIDER_TOKEN_MISSING', 'Secret Grant 未返回有效 DNS Provider Token', false, false);
  return { apiToken };
}

function recoverOperation(input) {
  const operationId = identifier(input.operationId, 'operationId');
  const recordValue = operationLedger.get(operationId);
  if (!recordValue) throw failure('DNS_OPERATION_UNKNOWN_STATE', '没有可验证的 DNS 检查点，不能推断外部结果', false, true);
  return {
    ...clone(recordValue.result),
    summary: { ...recordValue.result.summary, operation: 'operation.recover', operationId, recovered: true },
    warnings: [{ code: 'DNS_RECOVERY_REQUIRES_RECEIPT', message: '恢复结果必须由宿主 Receipt 账本确认', secretRedacted: true }],
  };
}

function validateSecurity(input, context, descriptor) {
  const security = record(input.security, 'security');
  for (const key of ['tokenId', 'decisionId', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) identifier(security[key], `security.${key}`);
  const fixed = record(security.fixedDigests, 'security.fixedDigests');
  for (const key of ['packageHash', 'resourceHash', 'manifestHash']) if (fixed[key] !== descriptor[key]) throw failure('DNS_FIXED_DIGEST_MISMATCH', '固定 PluginVersion 摘要不匹配', false, false);
  const operationDigest = text(security.operationDigest, 'security.operationDigest');
  if (!/^sha256:[a-f0-9]{64}$/.test(operationDigest) || operationInputDigest(context, input) !== operationDigest) throw failure('DNS_OPERATION_DIGEST_MISMATCH', 'DNS 操作摘要与输入快照不一致', false, false);
  if (!context.grantRefs.includes(security.grantRef)) throw failure('DNS_GRANT_NOT_BOUND', 'DNS Grant 未绑定当前执行', false, false);
  return security;
}

function assertWorkflow(input, operation) {
  const expected = operation === 'operation.recover' ? RECOVERY_WORKFLOW : 'ca.challenge.dns-solver';
  if (text(input.workflowKey, 'workflowKey') !== expected) throw failure('DNS_WORKFLOW_BINDING_INVALID', 'DNS Workflow 绑定不匹配', false, false);
  if (text(input.workflowVersion, 'workflowVersion') !== WORKFLOW_VERSION) throw failure('DNS_WORKFLOW_VERSION_INVALID', 'DNS WorkflowVersion 未固定到首版', false, false);
}

function assertContext(context, descriptor) {
  if (!context || context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion || context.capability !== CAPABILITY) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'DNS PluginVersion 或 Capability 绑定不匹配', false, false);
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw failure('PLUGIN_HOST_CALL_DENIED', 'DNS 执行缺少 Grant 引用', false, false);
}

function checkDeadline(context) { if (!Number.isFinite(Date.parse(context.deadlineAt)) || Date.parse(context.deadlineAt) <= Date.now()) throw failure('PLUGIN_RUNNER_TIMEOUT', 'DNS 执行已超过 deadline', true, Boolean(context.writeEffect)); }
function checkCancelled(context) { if (context.signal?.aborted) throw failure('PLUGIN_OPERATION_CANCELLED', 'DNS 插件执行已取消', false, Boolean(context.writeEffect)); }
function operationInputDigest(context, input) { const copy = clone(input); if (copy.security) delete copy.security.operationDigest; return `sha256:${createHash('sha256').update(canonicalJson({ capability: context.capability, input: copy })).digest('hex')}`; }
function successResult(operation, normalizedObject) { return { success: true, status: 'SUCCESS', summary: { operation, objectCount: 1 }, normalizedObjects: [normalizedObject], warnings: [] }; }
function failedResult(status, error) { return { success: false, status, summary: {}, normalizedObjects: [], warnings: [], error }; }
function failure(code, message, retryable, mayBeUnknown) { const error = new Error(message); error.code = code; error.retryable = retryable; error.mayBeUnknown = mayBeUnknown; return error; }
function normalizeError(error) { return { code: typeof error?.code === 'string' ? error.code : 'PLUGIN_CAPABILITY_EXECUTION_FAILED', message: redact(typeof error?.message === 'string' ? error.message : 'DNS Solver 执行失败').slice(0, 512), retryable: error?.retryable === true, mayBeUnknown: error?.mayBeUnknown === true, secretRedacted: true }; }
function redact(value) { return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]').replace(/secret:\/\/[^\s"']+/gi, 'secret://[REDACTED]'); }
function appendAudit(context, hostApi, security, operation, result, detail) { return hostApi.call('audit.append', { eventType: 'ca.plugin.operation', action: `${PLUGIN_ID}.${operation}`, resourceType: 'ca_operation', resourceId: context.idempotencyKey, result, detail: { pluginVersionId: context.pluginVersionId, capability: context.capability, operation, detail: typeof detail === 'object' ? 'recorded' : redact(String(detail)), receiptRef: security.receiptRef, operationDigest: security.operationDigest } }, context.grantRefs, 5000); }
async function appendAuditSafely(context, hostApi, security, operation, result, detail) { try { await appendAudit(context, hostApi, security, operation, result, detail); } catch { /* 审计故障由宿主恢复账本接管。 */ } }
function createDescriptor() { const pluginVersionId = requiredEnvironment('GCAC_PLUGIN_VERSION_ID'); if (pluginVersionId !== PLUGIN_VERSION_ID) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 注入的 PluginVersion 与包身份不匹配', false, false); return Object.freeze({ pluginVersionId, pluginId: PLUGIN_ID, pluginVersion: PLUGIN_VERSION, capabilities: [CAPABILITY], permissions: [...PERMISSIONS], packageHash: requiredDigest('GCAC_PLUGIN_PACKAGE_HASH'), resourceHash: requiredDigest('GCAC_PLUGIN_RESOURCE_HASH'), manifestHash: requiredDigest('GCAC_PLUGIN_MANIFEST_HASH') }); }
function requiredEnvironment(name) { const value = process.env[name]?.trim(); if (!value) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 缺少必需环境变量 ${name}`, false, false); return value; }
function requiredDigest(name) { const value = requiredEnvironment(name); if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 环境变量 ${name} 不是有效 SHA-256 摘要`, false, false); return value; }
function record(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是对象`, false, false); return value; }
function text(value, name) { if (typeof value !== 'string' || value.trim() === '') throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是非空字符串`, false, false); return value; }
function identifier(value, name) { const result = text(value, name); if (!/^[A-Za-z0-9._:/#-]{1,512}$/.test(result)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 格式无效`, false, false); return result; }
function boundedInteger(value, minimum, maximum, name) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 超出固定范围`, false, false); return value; }
function dnsRecordName(value) { const result = text(value, 'recordName').toLowerCase(); if (!/^_acme-challenge\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/.test(result)) throw failure('DNS_RECORD_NAME_INVALID', 'DNS Solver 只接受固定 ACME TXT 记录名', false, false); return result; }
function dnsTxtValue(value) { const result = text(value, 'recordValue'); if (result.length > 512 || /[\r\n]/.test(result)) throw failure('DNS_RECORD_VALUE_INVALID', 'DNS TXT 值格式无效', false, false); return result; }
function httpsUrl(value, name) { const result = text(value, name); let parsed; try { parsed = new URL(result); } catch { throw failure('DNS_URL_INVALID', `${name} 不是有效 URL`, false, false); } if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw failure('DNS_URL_INVALID', `${name} 必须是无凭据 HTTPS URL`, false, false); return parsed.toString(); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; }
