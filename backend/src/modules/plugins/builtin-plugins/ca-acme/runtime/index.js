import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';

const PLUGIN_ID = 'ca.acme';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_VERSION_ID = 'ca.acme:1.0.0';
const WORKFLOW_VERSION = '1.0.0';
const DNS_SOLVER_PLUGIN_VERSION_ID = 'ca.acme-dns:1.0.0';
const CAPABILITIES = Object.freeze(['ca.account.manage', 'ca.order.manage', 'ca.challenge.orchestrate']);
const PERMISSIONS = Object.freeze([
  'secret.resolve', 'audit.append',
]);

const operationLedger = new Map();

export function createPluginRunnerExecutor() {
  const descriptor = createDescriptor();
  return { descriptor, async execute(context, hostApi) { return executeOperation(context, hostApi, descriptor); } };
}

async function executeOperation(context, hostApi, descriptor) {
  let security;
  let operation = 'unknown';
  try {
    assertContext(context, descriptor);
    const input = record(context.input, 'input');
    operation = text(input.operation, 'operation');
    assertWorkflow(input, context.capability);
    security = validateSecurity(input, context, descriptor);
    checkDeadline(context);
    checkCancelled(context);
    const previous = operationLedger.get(context.idempotencyKey);
    if (previous) {
      if (previous.digest !== security.operationDigest) throw failure('CA_IDEMPOTENCY_CONFLICT', '幂等键与操作摘要冲突', false, false);
      await appendAudit(context, hostApi, security, operation, previous.result.status === 'SUCCESS' ? 'success' : 'failure', 'idempotent-replay');
      return clone(previous.result);
    }
    const keyMaterial = await resolveAccountSecret(context, hostApi, security, input, operation);
    const result = await performOperation(context, input, operation, keyMaterial);
    operationLedger.set(context.idempotencyKey, { digest: security.operationDigest, result: clone(result) });
    await appendAudit(context, hostApi, security, operation, result.status === 'SUCCESS' ? 'success' : 'failure', result.summary);
    return result;
  } catch (error) {
    const normalized = normalizeError(error);
    const status = context?.writeEffect && normalized.mayBeUnknown ? 'UNKNOWN' : 'FAILED';
    if (context?.idempotencyKey && security && normalized.mayBeUnknown) {
      operationLedger.set(context.idempotencyKey, { digest: security.operationDigest, result: clone(failedResult(status, normalized)) });
    }
    if (security && context && hostApi) await appendAuditSafely(context, hostApi, security, operation, 'failure', normalized.code);
    return failedResult(status, normalized);
  }
}

async function performOperation(context, input, operation, keyMaterial) {
  if (operation === 'account.ensure') return accountEnsure(context, input, keyMaterial);
  if (operation === 'account.deactivate') return accountDeactivate(context, input, keyMaterial);
  if (operation === 'order.create') return orderCreate(context, input, keyMaterial);
  if (operation === 'order.poll') return await orderPoll(context, input, keyMaterial);
  if (operation === 'order.finalize') return await orderFinalize(context, input, keyMaterial);
  if (operation === 'challenge.prepare') return challengePrepare(context, input);
  if (operation === 'challenge.poll') return await challengePoll(context, input, keyMaterial);
  if (operation === 'certificate.renew') return certificateRenew(context, input, keyMaterial);
  if (operation === 'certificate.revoke') return await certificateRevoke(context, input, keyMaterial);
  if (operation === 'operation.recover') return recoverOperation(input);
  throw failure('ACME_OPERATION_UNSUPPORTED', 'ACME Port 不支持该生命周期操作', false, false);
}

function accountEnsure(context, input, keyMaterial) {
  const directoryUrl = directory(input.directoryUrl);
  const email = text(input.email, 'email');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw failure('ACME_CONTACT_INVALID', 'ACME 联系邮箱格式无效', false, false);
  const accountId = identifier(input.accountId ?? `account:${hash(`${directoryUrl}\u0000${email}`)}`, 'accountId');
  return successResult('account.ensure', {
    kind: 'AcmeAccount', apiVersion: 'gcac.ca-object/v1', stableKey: accountId, pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId, directoryUrl, status: 'valid', contactCount: 1,
    accountKeyFingerprintSha256: keyMaterial.publicKeyFingerprint,
  });
}

async function accountDeactivate(context, input, keyMaterial) {
  const accountUrl = url(input.accountUrl, 'accountUrl');
  const response = await acmeRequest(context, input, keyMaterial, 'POST', accountUrl, { status: 'deactivated' });
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('ACME_ACCOUNT_DEACTIVATE_FAILED', 'ACME 账户停用失败', false, false);
  return successResult('account.deactivate', { kind: 'AcmeAccount', apiVersion: 'gcac.ca-object/v1', stableKey: accountUrl, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: 'deactivated' });
}

function orderCreate(context, input, keyMaterial) {
  const directoryUrl = directory(input.directoryUrl);
  const identifiers = dnsNames(input.identifiers);
  requireDnsSolverBinding(input);
  const orderId = identifier(input.orderId ?? `order:${hash(`${directoryUrl}\u0000${identifiers.join(',')}`)}`, 'orderId');
  return successResult('order.create', {
    kind: 'AcmeOrder', apiVersion: 'gcac.ca-object/v1', stableKey: orderId, pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId, directoryUrl, identifiers, status: 'pending',
    challengeSolverPluginVersionId: DNS_SOLVER_PLUGIN_VERSION_ID, accountKeyFingerprintSha256: keyMaterial.publicKeyFingerprint,
  });
}

async function orderPoll(context, input, keyMaterial) {
  const orderUrl = url(input.orderUrl, 'orderUrl');
  const response = await acmeRequest(context, input, keyMaterial, 'GET', orderUrl);
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('ACME_ORDER_POLL_FAILED', 'ACME 订单状态查询失败', true, false);
  const body = record(response.body, 'acmeResponse');
  const status = enumValue(body.status, ['pending', 'ready', 'processing', 'valid', 'invalid'], 'order.status');
  return successResult('order.poll', { kind: 'AcmeOrder', apiVersion: 'gcac.ca-object/v1', stableKey: orderUrl, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status, identifiers: Array.isArray(body.identifiers) ? body.identifiers : [] });
}

async function orderFinalize(context, input, keyMaterial) {
  const orderUrl = url(input.orderUrl, 'orderUrl');
  const csrPem = pem(input.csrPem, 'CERTIFICATE REQUEST', 'csrPem');
  const response = await acmeRequest(context, input, keyMaterial, 'POST', `${orderUrl}/finalize`, { csr: base64url(Buffer.from(csrPem)) });
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('ACME_ORDER_FINALIZE_FAILED', 'ACME 订单签发失败', false, true);
  const body = record(response.body, 'acmeResponse');
  return successResult('order.finalize', { kind: 'AcmeOrder', apiVersion: 'gcac.ca-object/v1', stableKey: orderUrl, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: enumValue(body.status ?? 'valid', ['processing', 'valid', 'invalid'], 'order.status'), certificateUrl: typeof body.certificate === 'string' ? url(body.certificate, 'certificateUrl') : undefined });
}

function challengePrepare(context, input) {
  const challengeType = enumValue(input.challengeType, ['http-01', 'dns-01'], 'challengeType');
  const challengeUrl = url(input.challengeUrl, 'challengeUrl');
  if (challengeType === 'dns-01') requireDnsSolverBinding(input);
  const challengeId = identifier(input.challengeId ?? `challenge:${hash(challengeUrl)}`, 'challengeId');
  return successResult('challenge.prepare', {
    kind: 'AcmeChallenge', apiVersion: 'gcac.ca-object/v1', stableKey: challengeId, pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId, type: challengeType, url: challengeUrl, status: 'pending',
    ...(challengeType === 'dns-01' ? { solverPluginVersionId: DNS_SOLVER_PLUGIN_VERSION_ID } : {}),
  });
}

async function challengePoll(context, input, keyMaterial) {
  const challengeUrl = url(input.challengeUrl, 'challengeUrl');
  const response = await acmeRequest(context, input, keyMaterial, 'GET', challengeUrl);
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('ACME_CHALLENGE_POLL_FAILED', 'ACME 挑战状态查询失败', true, false);
  const body = record(response.body, 'acmeResponse');
  return successResult('challenge.poll', { kind: 'AcmeChallenge', apiVersion: 'gcac.ca-object/v1', stableKey: challengeUrl, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, type: enumValue(body.type ?? input.challengeType, ['http-01', 'dns-01'], 'challenge.type'), status: enumValue(body.status ?? 'pending', ['pending', 'processing', 'valid', 'invalid'], 'challenge.status'), url: challengeUrl });
}

function certificateRenew(context, input, keyMaterial) {
  const sourceCertificateId = identifier(input.sourceCertificateId, 'sourceCertificateId');
  const identifiers = dnsNames(input.identifiers);
  return successResult('certificate.renew', { kind: 'CertificateRequest', apiVersion: 'gcac.ca-object/v1', stableKey: `renewal:${sourceCertificateId}`, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: 'pending', renewalOf: sourceCertificateId, identifiers, accountKeyFingerprintSha256: keyMaterial.publicKeyFingerprint });
}

async function certificateRevoke(context, input, keyMaterial) {
  const certificateUrl = url(input.certificateUrl, 'certificateUrl');
  const response = await acmeRequest(context, input, keyMaterial, 'POST', certificateUrl, { reason: enumValue(input.reason ?? 'unspecified', ['unspecified', 'keyCompromise', 'cessationOfOperation'], 'reason') });
  if (response.statusCode < 200 || response.statusCode >= 300) throw failure('ACME_CERTIFICATE_REVOKE_FAILED', 'ACME 证书吊销失败', false, true);
  return successResult('certificate.revoke', { kind: 'CertificateRevocation', apiVersion: 'gcac.ca-object/v1', stableKey: `revocation:${hash(certificateUrl)}`, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: 'revoked', certificateUrl });
}

function recoverOperation(input) {
  const operationId = identifier(input.operationId, 'operationId');
  const recordValue = operationLedger.get(operationId);
  if (!recordValue) throw failure('ACME_OPERATION_UNKNOWN_STATE', '没有可验证的 ACME 检查点，不能推断外部结果', false, true);
  return { ...clone(recordValue.result), summary: { ...recordValue.result.summary, operation: 'operation.recover', operationId, recovered: true }, warnings: [{ code: 'ACME_RECOVERY_REQUIRES_RECEIPT', message: '恢复结果必须由宿主 Receipt 账本确认', secretRedacted: true }] };
}

async function resolveAccountSecret(context, hostApi, security, input, operation) {
  const secretRef = text(input.secretRef, 'secretRef');
  if (typeof input.privateKeyPem === 'string' || typeof input.accountKeyPem === 'string') {
    throw failure('ACME_SECRET_INLINE_FORBIDDEN', 'ACME 账户私钥必须通过 Secret Grant 提供，不能放入执行输入', false, false);
  }
  if (!/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(secretRef)) throw failure('ACME_SECRET_REF_INVALID', 'ACME SecretRef 格式无效', false, false);
  const result = await hostApi.call('secret.grant.resolve', { grantId: security.grantRef, secretRef, purpose: `acme.${operation}.account-key` }, context.grantRefs, 5000);
  const data = record(result.data ?? result, 'secretResult');
  const privateKeyPem = data.privateKeyPem ?? data.accountKeyPem;
  if (typeof privateKeyPem !== 'string') throw failure('ACME_ACCOUNT_KEY_MISSING', 'Secret Grant 未返回 ACME 账户私钥', false, false);
  let publicKeyFingerprint;
  try { publicKeyFingerprint = `sha256:${createHash('sha256').update(createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' })).digest('hex')}`; } catch { throw failure('ACME_ACCOUNT_KEY_INVALID', 'ACME 账户私钥材料无效', false, false); }
  return { privateKeyPem, publicKeyFingerprint };
}

async function acmeRequest(context, input, keyMaterial, method, targetUrl, payload) {
  const requestUrl = url(targetUrl, 'requestUrl');
  const directoryUrl = input.directoryUrl ? directory(input.directoryUrl) : undefined;
  if (directoryUrl && new URL(requestUrl).origin !== new URL(directoryUrl).origin) throw failure('ACME_ORIGIN_DENIED', 'ACME 请求超出固定目录 Origin', false, false);
  if (input.sandboxResponse) {
    if (input.sandboxRef !== 'sandbox://acme') throw failure('ACME_SANDBOX_BINDING_INVALID', 'Sandbox 响应缺少固定绑定', false, false);
    const sandbox = record(input.sandboxResponse, 'sandboxResponse');
    return { statusCode: boundedInteger(sandbox.statusCode, 100, 599, 'sandboxResponse.statusCode'), body: sandbox.body ?? {}, headers: sandbox.headers ?? {} };
  }
  const timeoutMs = boundedInteger(input.timeoutMs ?? 10000, 1, 120000, 'timeoutMs');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, Math.max(1, Date.parse(context.deadlineAt) - Date.now())));
  try {
    const jws = buildJws(keyMaterial.privateKeyPem, method, requestUrl, input.nonceValue ?? `nonce-${hash(requestUrl)}`, payload);
    const response = await fetch(requestUrl, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/jose+json' },
      body: method === 'GET' ? undefined : JSON.stringify(jws),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body = {};
    if (bodyText) { try { body = JSON.parse(bodyText); } catch { throw failure('ACME_RESPONSE_INVALID', 'ACME 返回不是 JSON', false, false); } }
    return { statusCode: response.status, body, headers: { location: response.headers.get('location') ?? '' } };
  } catch (error) {
    if (controller.signal.aborted) throw failure('ACME_NETWORK_TIMEOUT', 'ACME 请求超时，写操作结果可能未知', true, Boolean(context.writeEffect));
    throw error;
  } finally { clearTimeout(timer); }
}

function buildJws(privateKeyPem, method, requestUrl, nonce, payload) {
  const key = createPrivateKey(privateKeyPem);
  if (!['rsa', 'ec'].includes(key.asymmetricKeyType)) throw failure('ACME_KEY_ALGORITHM_UNSUPPORTED', 'ACME 账户密钥算法不在固定集合中', false, false);
  const alg = key.asymmetricKeyType === 'ec' ? 'ES256' : 'RS256';
  const protectedHeader = base64url(JSON.stringify({ alg, nonce, url: requestUrl }));
  const encodedPayload = base64url(JSON.stringify(payload ?? {}));
  const signer = createSign(key.asymmetricKeyType === 'ec' ? 'SHA256' : 'RSA-SHA256');
  signer.update(`${protectedHeader}.${encodedPayload}`);
  return { protected: protectedHeader, payload: encodedPayload, signature: base64url(signer.sign(key)), method };
}

function validateSecurity(input, context, descriptor) {
  const security = record(input.security, 'security');
  for (const key of ['tokenId', 'decisionId', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) identifier(security[key], `security.${key}`);
  const fixed = record(security.fixedDigests, 'security.fixedDigests');
  for (const key of ['packageHash', 'resourceHash', 'manifestHash']) if (fixed[key] !== descriptor[key]) throw failure('ACME_FIXED_DIGEST_MISMATCH', '固定 PluginVersion 摘要不匹配', false, false);
  const digest = text(security.operationDigest, 'security.operationDigest');
  if (!/^sha256:[a-f0-9]{64}$/.test(digest) || operationInputDigest(context, input) !== digest) throw failure('ACME_OPERATION_DIGEST_MISMATCH', 'ACME 操作摘要与输入快照不一致', false, false);
  if (!context.grantRefs.includes(security.grantRef)) throw failure('ACME_GRANT_NOT_BOUND', 'ACME Grant 未绑定当前执行', false, false);
  return security;
}

function assertWorkflow(input, capability) {
  if (text(input.workflowKey, 'workflowKey') !== workflowFor(capability, input.operation)) throw failure('ACME_WORKFLOW_BINDING_INVALID', 'Workflow、Capability 和操作未形成固定绑定', false, false);
  if (text(input.workflowVersion, 'workflowVersion') !== WORKFLOW_VERSION) throw failure('ACME_WORKFLOW_VERSION_INVALID', 'WorkflowVersion 未固定到首版', false, false);
}

function workflowFor(capability, operation) {
  const allowed = {
    'ca.account.manage': new Set(['account.ensure', 'account.deactivate', 'operation.recover']),
    'ca.order.manage': new Set(['order.create', 'order.poll', 'order.finalize', 'certificate.renew', 'certificate.revoke', 'operation.recover']),
    'ca.challenge.orchestrate': new Set(['challenge.prepare', 'challenge.poll', 'operation.recover']),
  }[capability];
  if (!allowed?.has(operation)) throw failure('ACME_CAPABILITY_OPERATION_MISMATCH', '操作不属于当前 ACME Capability', false, false);
  const workflow = { 'account.ensure': 'ca.account.ensure', 'account.deactivate': 'ca.account.ensure', 'order.create': 'ca.order.issue', 'order.poll': 'ca.order.issue', 'order.finalize': 'ca.order.issue', 'certificate.renew': 'ca.order.renew', 'certificate.revoke': 'ca.order.revoke', 'challenge.prepare': 'ca.challenge.solve', 'challenge.poll': 'ca.challenge.solve', 'operation.recover': 'ca.operation.recover' }[operation];
  if (!workflow) throw failure('ACME_WORKFLOW_BINDING_INVALID', 'ACME 操作缺少固定 Workflow', false, false);
  return workflow;
}

function requireDnsSolverBinding(input) {
  if (input.solverPluginId !== 'ca.acme-dns' || input.solverPluginVersionId !== DNS_SOLVER_PLUGIN_VERSION_ID) throw failure('ACME_DNS_SOLVER_BINDING_INVALID', 'ACME 必须绑定固定 ca.acme-dns PluginVersion', false, false);
}

function assertContext(context, descriptor) {
  if (!context || context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion || !CAPABILITIES.includes(context.capability)) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'PluginVersion 或 Capability 绑定不匹配', false, false);
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw failure('PLUGIN_HOST_CALL_DENIED', '执行缺少 Grant 引用', false, false);
}
function checkDeadline(context) { if (!Number.isFinite(Date.parse(context.deadlineAt)) || Date.parse(context.deadlineAt) <= Date.now()) throw failure('PLUGIN_RUNNER_TIMEOUT', '执行已超过 deadline', true, Boolean(context.writeEffect)); }
function checkCancelled(context) { if (context.signal?.aborted) throw failure('PLUGIN_OPERATION_CANCELLED', '插件执行已取消', false, Boolean(context.writeEffect)); }
function operationInputDigest(context, input) { const copy = clone(input); if (copy.security) delete copy.security.operationDigest; return `sha256:${createHash('sha256').update(canonicalJson({ capability: context.capability, input: copy })).digest('hex')}`; }

function directory(value) { const result = url(value, 'directoryUrl'); if (new URL(result).protocol !== 'https:') throw failure('ACME_DIRECTORY_UNSAFE', 'ACME Directory 必须使用 HTTPS', false, false); return result; }
function url(value, name) { const result = text(value, name); let parsed; try { parsed = new URL(result); } catch { throw failure('ACME_URL_INVALID', `${name} 不是有效 URL`, false, false); } if (!['https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw failure('ACME_URL_INVALID', `${name} 不符合固定 HTTPS URL 约束`, false, false); return parsed.toString(); }
function dnsNames(value) { if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw failure('ACME_IDENTIFIER_INVALID', 'identifiers 必须是非空数组', false, false); return value.map((item) => { const result = text(item, 'identifiers'); if (!/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/.test(result)) throw failure('ACME_IDENTIFIER_INVALID', 'ACME identifier 不是合法 DNS 名称', false, false); return result.toLowerCase(); }); }
function pem(value, label, name) { const result = text(value, name); if (!result.includes(`-----BEGIN ${label}-----`) || !result.includes(`-----END ${label}-----`)) throw failure('ACME_PEM_INVALID', `${name} PEM 格式无效`, false, false); return result; }
function identifier(value, name) { const result = text(value, name); if (!/^[A-Za-z0-9._:/#-]{1,512}$/.test(result)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 格式无效`, false, false); return result; }
function boundedInteger(value, minimum, maximum, name) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 超出固定范围`, false, false); return value; }
function enumValue(value, allowed, name) { if (typeof value !== 'string' || !allowed.includes(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 不在固定枚举中`, false, false); return value; }
function text(value, name) { if (typeof value !== 'string' || value.trim() === '') throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是非空字符串`, false, false); return value; }
function record(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是对象`, false, false); return value; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function base64url(value) { return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; }
function successResult(operation, normalizedObject) { return { success: true, status: 'SUCCESS', summary: { operation, objectCount: 1 }, normalizedObjects: [normalizedObject], warnings: [] }; }
function failedResult(status, error) { return { success: false, status, summary: {}, normalizedObjects: [], warnings: [], error }; }
function failure(code, message, retryable, mayBeUnknown) { const error = new Error(message); error.code = code; error.retryable = retryable; error.mayBeUnknown = mayBeUnknown; return error; }
function normalizeError(error) { return { code: typeof error?.code === 'string' ? error.code : 'PLUGIN_CAPABILITY_EXECUTION_FAILED', message: redact(typeof error?.message === 'string' ? error.message : 'ACME 插件执行失败').slice(0, 512), retryable: error?.retryable === true, mayBeUnknown: error?.mayBeUnknown === true, secretRedacted: true }; }
function redact(value) { return value.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[REDACTED_PEM]').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]').replace(/secret:\/\/[^\s"']+/gi, 'secret://[REDACTED]'); }
async function appendAudit(context, hostApi, security, operation, result, detail) { await hostApi.call('audit.append', { eventType: 'ca.plugin.operation', action: `${PLUGIN_ID}.${operation}`, resourceType: 'ca_operation', resourceId: context.idempotencyKey, result, detail: { pluginVersionId: context.pluginVersionId, capability: context.capability, operation, resultDetail: typeof detail === 'object' ? 'recorded' : redact(String(detail)), receiptRef: security.receiptRef, operationDigest: security.operationDigest } }, context.grantRefs, 5000); }
async function appendAuditSafely(context, hostApi, security, operation, result, detail) { try { await appendAudit(context, hostApi, security, operation, result, detail); } catch { /* 审计故障不能覆盖原始失败；宿主恢复账本继续接管。 */ } }
function createDescriptor() {
  const pluginVersionId = requiredEnvironment('GCAC_PLUGIN_VERSION_ID');
  if (pluginVersionId !== PLUGIN_VERSION_ID) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 注入的 PluginVersion 与包身份不匹配', false, false);
  return Object.freeze({
    pluginVersionId,
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: [...CAPABILITIES],
    permissions: [...PERMISSIONS],
    packageHash: requiredDigest('GCAC_PLUGIN_PACKAGE_HASH'),
    resourceHash: requiredDigest('GCAC_PLUGIN_RESOURCE_HASH'),
    manifestHash: requiredDigest('GCAC_PLUGIN_MANIFEST_HASH'),
  });
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 缺少必需环境变量 ${name}`, false, false);
  return value;
}

function requiredDigest(name) {
  const value = requiredEnvironment(name);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 环境变量 ${name} 不是有效 SHA-256 摘要`, false, false);
  return value;
}
