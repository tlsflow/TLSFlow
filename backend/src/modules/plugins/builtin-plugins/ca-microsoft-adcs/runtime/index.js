import { createHash } from 'node:crypto';

const PLUGIN_ID = 'ca.microsoft-adcs';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_VERSION_ID = 'ca.microsoft-adcs:1.0.0';
const WORKFLOW_VERSION = '1.0.0';
const RECOVERY_WORKFLOW = 'ca.operation.recover';
const CAPABILITIES = Object.freeze(['ca.certificate.issue', 'ca.certificate.renew', 'ca.certificate.revoke']);
const PERMISSIONS = Object.freeze(['secret.resolve', 'audit.append']);
const operationLedger = new Map();

// 控制面只生成带完整授权绑定的 Agent Plan，不接触 Windows 本机 API。
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
    assertWorkflow(input, context.capability, operation);
    security = validateSecurity(input, context, descriptor);
    checkDeadline(context);
    checkCancelled(context);

    const previous = operationLedger.get(context.idempotencyKey);
    if (previous) {
      if (previous.digest !== security.operationDigest) throw failure('ADCS_IDEMPOTENCY_CONFLICT', '同一幂等键绑定了不同的 ADCS 操作摘要', false, false);
      await appendAudit(context, hostApi, security, operation, 'success', 'idempotent-replay');
      return clone(previous.result);
    }

    if (operation === 'operation.recover') {
      const result = recoverOperation(input);
      await appendAudit(context, hostApi, security, operation, result.status === 'SUCCESS' ? 'success' : 'failure', result.summary);
      return result;
    }

    const credential = await resolveCredential(context, hostApi, security, input, operation);
    const result = executeCaPort(context, input, operation, security, credential);
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

function executeCaPort(context, input, operation, security, credential) {
  if (input.failureMode === 'timeout' || input.failureMode === 'unknown' || input.failureMode === 'async-failure') {
    throw failure('ADCS_AGENT_OPERATION_UNKNOWN_STATE', 'ADCS Agent-side Plugin 写操作结果不可确认', true, true);
  }
  const plan = buildAgentPlan(context, input, operation, security, credential.credentialFingerprint);
  const receipt = input.agentReceipt === undefined ? undefined : validateReceipt(input.agentReceipt, plan);
  if (receipt) return receiptResult(context, operation, receipt);

  if (operation === 'create') {
    return successResult('create', {
      kind: 'CertificateAuthority',
      apiVersion: 'gcac.ca-object/v1',
      stableKey: `ca:${identifier(input.authorityId, 'authorityId')}`,
      pluginId: PLUGIN_ID,
      pluginVersionId: context.pluginVersionId,
      profile: profile(input.profile),
      templateId: identifier(input.templateId, 'templateId'),
      agentPlan: plan,
      status: 'pending-agent-execution',
    });
  }
  if (operation === 'ca.certificate.issue') {
    return successResult('issue', certificateRequest(context, input, plan, 'issued'));
  }
  if (operation === 'ca.certificate.renew') {
    return successResult('renew', certificateRequest(context, input, plan, 'renewal-pending'));
  }
  if (operation === 'ca.certificate.revoke') {
    return successResult('revoke', {
      kind: 'CertificateRevocation',
      apiVersion: 'gcac.ca-object/v1',
      stableKey: `revocation:${text(input.serialNumber, 'serialNumber').toUpperCase()}`,
      pluginId: PLUGIN_ID,
      pluginVersionId: context.pluginVersionId,
      serialNumber: text(input.serialNumber, 'serialNumber').toUpperCase(),
      reason: revocationReason(input.reason),
      agentPlan: plan,
      status: 'pending-agent-execution',
    });
  }
  throw failure('ADCS_OPERATION_UNSUPPORTED', 'ADCS CA Port 不支持该生命周期操作', false, false);
}

function certificateRequest(context, input, plan, status) {
  const sourceCertificateId = input.sourceCertificateId === undefined ? undefined : identifier(input.sourceCertificateId, 'sourceCertificateId');
  const subject = text(input.subject, 'subject');
  const sans = dnsNames(input.sans);
  return {
    kind: 'CertificateRequest',
    apiVersion: 'gcac.ca-object/v1',
    stableKey: `certificate-request:${hash(plan.planDigest)}`,
    pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId,
    subject,
    sans,
    ...(sourceCertificateId ? { sourceCertificateId } : {}),
    agentPlan: plan,
    status,
  };
}

function buildAgentPlan(context, input, operation, security, credentialFingerprint) {
  const plan = {
    apiVersion: 'gcac.agent-plan/v1',
    kind: 'AgentPlanV1',
    pluginId: PLUGIN_ID,
    pluginVersionId: context.pluginVersionId,
    packageHash: security.fixedDigests.packageHash,
    resourceHash: security.fixedDigests.resourceHash,
    manifestHash: security.fixedDigests.manifestHash,
    capability: context.capability,
    operation,
    agentId: identifier(input.agentId, 'agentId'),
    tenantId: context.tenantId,
    executionId: context.executionId,
    executionStepId: context.executionStepId,
    tokenId: security.tokenId,
    decisionId: security.decisionId,
    nonce: security.nonce,
    receiptRef: security.receiptRef,
    grantRef: security.grantRef,
    localPolicyRef: security.localPolicyRef,
    credentialFingerprint,
    actions: [{
      kind: 'certificate.authority.operation',
      operation,
      templateId: identifier(input.templateId, 'templateId'),
      ...(input.authorityId === undefined ? {} : { authorityId: identifier(input.authorityId, 'authorityId') }),
      ...(input.serialNumber === undefined ? {} : { serialNumber: text(input.serialNumber, 'serialNumber').toUpperCase() }),
      ...(input.reason === undefined ? {} : { reason: revocationReason(input.reason) }),
    }],
  };
  return { ...plan, planDigest: digest(plan) };
}

function validateReceipt(input, plan) {
  const receipt = record(input, 'agentReceipt');
  for (const key of ['apiVersion', 'kind', 'agentId', 'tenantId', 'executionId', 'executionStepId', 'pluginVersionId', 'planDigest', 'nonce', 'tokenId', 'decisionId', 'receiptRef', 'localPolicyRef']) text(receipt[key], `agentReceipt.${key}`);
  if (receipt.apiVersion !== 'gcac.agent-receipt/v1' || receipt.kind !== 'AgentExecutionReceiptV1') throw failure('ADCS_RECEIPT_INVALID', 'Agent Receipt 类型不匹配', false, false);
  if (receipt.status === 'UNKNOWN') throw failure('ADCS_RECEIPT_UNKNOWN', 'Agent Receipt 仍处于 UNKNOWN，必须恢复', true, true);
  if (receipt.status !== 'SUCCESS') throw failure('ADCS_RECEIPT_FAILED', 'Agent Receipt 未确认成功', false, false);
  if (receipt.pluginVersionId !== plan.pluginVersionId || receipt.tenantId !== plan.tenantId || receipt.executionId !== plan.executionId || receipt.executionStepId !== plan.executionStepId || receipt.planDigest !== plan.planDigest || receipt.nonce !== plan.nonce || receipt.tokenId !== plan.tokenId || receipt.decisionId !== plan.decisionId || receipt.receiptRef !== plan.receiptRef || receipt.localPolicyRef !== plan.localPolicyRef || receipt.agentId !== plan.agentId) {
    throw failure('ADCS_RECEIPT_BINDING_INVALID', 'Agent Receipt 未绑定固定计划和授权材料', false, false);
  }
  return receipt;
}

function receiptResult(context, operation, receipt) {
  const certificatePem = receipt.certificatePem;
  if (operation === 'ca.certificate.revoke') return successResult('revoke', { kind: 'CertificateRevocation', apiVersion: 'gcac.ca-object/v1', stableKey: `revocation:${text(receipt.serialNumber, 'agentReceipt.serialNumber')}`, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: 'revoked', serialNumber: text(receipt.serialNumber, 'agentReceipt.serialNumber'), receiptRef: receipt.receiptRef });
  if (typeof certificatePem !== 'string' || !certificatePem.includes('-----BEGIN CERTIFICATE-----')) throw failure('ADCS_RECEIPT_ARTIFACT_MISSING', 'Agent Receipt 缺少证书产物', false, false);
  return successResult(operation === 'ca.certificate.renew' ? 'renew' : 'issue', { kind: 'Certificate', apiVersion: 'gcac.ca-object/v1', stableKey: `certificate:${hash(certificatePem)}`, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, status: 'issued', certificatePem, receiptRef: receipt.receiptRef });
}

async function resolveCredential(context, hostApi, security, input, operation) {
  const secretRef = text(input.secretRef, 'secretRef');
  if (!/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(secretRef)) throw failure('ADCS_SECRET_REF_INVALID', 'ADCS SecretRef 格式无效', false, false);
  if (typeof input.credential !== 'undefined') throw failure('ADCS_SECRET_INLINE_FORBIDDEN', 'ADCS 凭据必须通过 Secret Grant 提供', false, false);
  const result = await hostApi.call('secret.grant.resolve', { grantId: security.grantRef, secretRef, purpose: `adcs.${operation}.credential` }, context.grantRefs, 5000);
  const data = record(result.data ?? result, 'secretResult');
  const credentialFingerprint = data.credentialFingerprint;
  if (typeof credentialFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(credentialFingerprint)) throw failure('ADCS_CREDENTIAL_MISSING', 'Secret Grant 未返回固定凭据摘要', false, false);
  return { credentialFingerprint };
}

function recoverOperation(input) {
  const operationId = identifier(input.operationId, 'operationId');
  const recordValue = operationLedger.get(operationId);
  if (!recordValue) throw failure('ADCS_OPERATION_UNKNOWN_STATE', '没有可验证的 ADCS 检查点，不能推断外部结果', false, true);
  return { ...clone(recordValue.result), summary: { ...recordValue.result.summary, operation: 'operation.recover', operationId, recovered: true }, warnings: [{ code: 'ADCS_RECOVERY_REQUIRES_RECEIPT', message: '恢复结果必须由宿主 Receipt 账本确认', secretRedacted: true }] };
}

function validateSecurity(input, context, descriptor) {
  const security = record(input.security, 'security');
  for (const key of ['tokenId', 'decisionId', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) identifier(security[key], `security.${key}`);
  const fixed = record(security.fixedDigests, 'security.fixedDigests');
  for (const key of ['packageHash', 'resourceHash', 'manifestHash']) if (fixed[key] !== descriptor[key]) throw failure('ADCS_FIXED_DIGEST_MISMATCH', '固定 PluginVersion 摘要不匹配', false, false);
  const operationDigest = text(security.operationDigest, 'security.operationDigest');
  if (!/^sha256:[a-f0-9]{64}$/.test(operationDigest) || operationInputDigest(context, input) !== operationDigest) throw failure('ADCS_OPERATION_DIGEST_MISMATCH', 'ADCS 操作摘要与输入快照不一致', false, false);
  if (!context.grantRefs.includes(security.grantRef)) throw failure('ADCS_GRANT_NOT_BOUND', 'ADCS Grant 未绑定当前执行', false, false);
  return security;
}

function assertWorkflow(input, capability, operation) {
  const expected = operation === 'operation.recover' ? RECOVERY_WORKFLOW : capability === 'ca.certificate.renew' ? 'ca.certificate.renew' : capability === 'ca.certificate.revoke' ? 'ca.certificate.revoke' : 'ca.certificate.issue';
  if (text(input.workflowKey, 'workflowKey') !== expected) throw failure('ADCS_WORKFLOW_BINDING_INVALID', 'ADCS Workflow 绑定不匹配', false, false);
  if (text(input.workflowVersion, 'workflowVersion') !== WORKFLOW_VERSION) throw failure('ADCS_WORKFLOW_VERSION_INVALID', 'ADCS WorkflowVersion 未固定到首版', false, false);
}

function assertContext(context, descriptor) {
  if (!context || context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion || !CAPABILITIES.includes(context.capability)) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'ADCS PluginVersion 或 Capability 绑定不匹配', false, false);
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw failure('PLUGIN_HOST_CALL_DENIED', 'ADCS 执行缺少 Grant 引用', false, false);
}

async function appendAudit(context, hostApi, security, operation, result, detail) { await hostApi.call('audit.append', { eventType: 'ca.plugin.operation', action: `${PLUGIN_ID}.${operation}`, resourceType: 'ca_operation', resourceId: context.idempotencyKey, result, detail: { pluginVersionId: context.pluginVersionId, capability: context.capability, operation, detail: typeof detail === 'object' ? 'recorded' : redact(String(detail)), receiptRef: security.receiptRef, operationDigest: security.operationDigest } }, context.grantRefs, 5000); }
async function appendAuditSafely(context, hostApi, security, operation, result, detail) { try { await appendAudit(context, hostApi, security, operation, result, detail); } catch { /* 审计故障由宿主恢复账本接管。 */ } }
function createDescriptor() { const pluginVersionId = requiredEnvironment('GCAC_PLUGIN_VERSION_ID'); if (pluginVersionId !== PLUGIN_VERSION_ID) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 注入的 PluginVersion 与包身份不匹配', false, false); return Object.freeze({ pluginVersionId, pluginId: PLUGIN_ID, pluginVersion: PLUGIN_VERSION, capabilities: [...CAPABILITIES], permissions: [...PERMISSIONS], packageHash: requiredDigest('GCAC_PLUGIN_PACKAGE_HASH'), resourceHash: requiredDigest('GCAC_PLUGIN_RESOURCE_HASH'), manifestHash: requiredDigest('GCAC_PLUGIN_MANIFEST_HASH') }); }
function requiredEnvironment(name) { const value = process.env[name]?.trim(); if (!value) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 缺少必需环境变量 ${name}`, false, false); return value; }
function requiredDigest(name) { const value = requiredEnvironment(name); if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 环境变量 ${name} 不是有效 SHA-256 摘要`, false, false); return value; }
function checkDeadline(context) { if (!Number.isFinite(Date.parse(context.deadlineAt)) || Date.parse(context.deadlineAt) <= Date.now()) throw failure('PLUGIN_RUNNER_TIMEOUT', 'ADCS 执行已超过 deadline', true, Boolean(context.writeEffect)); }
function checkCancelled(context) { if (context.signal?.aborted) throw failure('PLUGIN_OPERATION_CANCELLED', 'ADCS 插件执行已取消', false, Boolean(context.writeEffect)); }
function operationInputDigest(context, input) { const copy = clone(input); if (copy.security) delete copy.security.operationDigest; return `sha256:${createHash('sha256').update(canonicalJson({ capability: context.capability, input: copy })).digest('hex')}`; }
function successResult(operation, normalizedObject) { return { success: true, status: 'SUCCESS', summary: { operation, objectCount: 1 }, normalizedObjects: [normalizedObject], warnings: [] }; }
function failedResult(status, error) { return { success: false, status, summary: {}, normalizedObjects: [], warnings: [], error }; }
function failure(code, message, retryable, mayBeUnknown) { const error = new Error(message); error.code = code; error.retryable = retryable; error.mayBeUnknown = mayBeUnknown; return error; }
function normalizeError(error) { return { code: typeof error?.code === 'string' ? error.code : 'PLUGIN_CAPABILITY_EXECUTION_FAILED', message: redact(typeof error?.message === 'string' ? error.message : 'ADCS 插件执行失败').slice(0, 512), retryable: error?.retryable === true, mayBeUnknown: error?.mayBeUnknown === true, secretRedacted: true }; }
function redact(value) { return value.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[REDACTED_PEM]').replace(/secret:\/\/[^\s"']+/gi, 'secret://[REDACTED]'); }
function record(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是对象`, false, false); return value; }
function text(value, name) { if (typeof value !== 'string' || value.trim() === '') throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是非空字符串`, false, false); return value; }
function identifier(value, name) { const result = text(value, name); if (!/^[A-Za-z0-9._:/#-]{1,512}$/.test(result)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 格式无效`, false, false); return result; }
function profile(value) { const result = text(value, 'profile'); if (result !== 'windows.agent_plan.adcs') throw failure('ADCS_PROFILE_UNSUPPORTED', 'ADCS 只接受固定 Windows Agent Plan Profile', false, false); return result; }
function revocationReason(value) { return enumValue(value, ['unspecified', 'keyCompromise', 'caCompromise', 'affiliationChanged', 'superseded', 'cessationOfOperation'], 'reason'); }
function enumValue(value, values, name) { if (typeof value !== 'string' || !values.includes(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 不在固定集合中`, false, false); return value; }
function dnsNames(value) { if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw failure('ADCS_SAN_INVALID', 'sans 必须是非空数组', false, false); return value.map((item) => { const result = text(item, 'sans').toLowerCase(); if (!/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/.test(result)) throw failure('ADCS_SAN_INVALID', 'SAN 不是合法 DNS 名称', false, false); return result; }); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function digest(value) { return `sha256:${hash(canonicalJson(value))}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; }
