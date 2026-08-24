import { createHash } from 'node:crypto';

const PLUGIN_ID = 'ca.microsoft-adcs';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_VERSION_ID = 'ca.microsoft-adcs:1.0.0';
const CAPABILITIES = Object.freeze(['ca.certificate.issue', 'ca.certificate.renew', 'ca.certificate.revoke']);

// Agent-side 进程只接受 Agent Core 提供的类型化结果，不接受脚本、命令或下载内容。
export function createPluginRunnerExecutor() {
  const descriptor = createDescriptor();
  return Object.freeze({
    descriptor,
    async execute(context) {
      return executeAgentSide(context, descriptor);
    },
  });
}

function executeAgentSide(context, descriptor) {
  let operation = 'unknown';
  try {
    assertContext(context, descriptor);
    const input = record(context.input, 'input');
    operation = text(input.operation, 'operation');
    if (!CAPABILITIES.includes(context.capability)) throw failure('ADCS_AGENT_CAPABILITY_INVALID', 'Agent-side Capability 未绑定', false, false);
    const plan = validatePlan(input.agentPlan, context, descriptor, operation);
    if (input.agentCoreResult === undefined) throw failure('ADCS_AGENT_CORE_RESULT_MISSING', '缺少 Agent Core 窄接口返回，不能伪造本机 API 成功', false, false);
    const coreResult = validateAgentCoreResult(input.agentCoreResult, plan, context);
    if (coreResult.status === 'UNKNOWN') throw failure('ADCS_AGENT_OPERATION_UNKNOWN_STATE', 'Agent Core 未确认本机 API 写操作结果', true, true);
    return successResult(operation, plan, coreResult);
  } catch (error) {
    const normalized = normalizeError(error);
    return failedResult(context?.writeEffect && normalized.mayBeUnknown ? 'UNKNOWN' : 'FAILED', normalized);
  }
}

function validatePlan(input, context, descriptor, operation) {
  const plan = record(input, 'agentPlan');
  if (plan.apiVersion !== 'gcac.agent-plan/v1' || plan.kind !== 'AgentPlanV1') throw failure('ADCS_AGENT_PLAN_INVALID', 'Agent Plan 类型不匹配', false, false);
  if (plan.pluginId !== descriptor.pluginId || plan.pluginVersionId !== descriptor.pluginVersionId || plan.capability !== context.capability || plan.tenantId !== context.tenantId || plan.executionId !== context.executionId || plan.executionStepId !== context.executionStepId || plan.operation !== operation) throw failure('ADCS_AGENT_PLAN_BINDING_INVALID', 'Agent Plan 未绑定当前执行上下文', false, false);
  for (const key of ['agentId', 'tokenId', 'decisionId', 'nonce', 'receiptRef', 'grantRef', 'localPolicyRef', 'credentialFingerprint']) identifier(plan[key], `agentPlan.${key}`);
  for (const key of ['packageHash', 'resourceHash', 'manifestHash']) if (plan[key] !== descriptor[key]) throw failure('ADCS_AGENT_PLAN_DIGEST_INVALID', 'Agent Plan 固定摘要不匹配', false, false);
  if (!/^sha256:[a-f0-9]{64}$/.test(plan.planDigest) || digest(stripPlanDigest(plan)) !== plan.planDigest) throw failure('ADCS_AGENT_PLAN_DIGEST_INVALID', 'Agent Plan 摘要无效', false, false);
  if (!Array.isArray(plan.actions) || plan.actions.length !== 1) throw failure('ADCS_AGENT_PLAN_ACTION_INVALID', 'Agent Plan 必须包含一个类型化动作', false, false);
  rejectExecutableFields(plan);
  rejectExecutableFields(plan.actions[0]);
  return plan;
}

function validateAgentCoreResult(input, plan, context) {
  const result = record(input, 'agentCoreResult');
  if (result.apiVersion !== 'gcac.agent-core/v1' || result.kind !== 'AgentCoreOperationResultV1') throw failure('ADCS_AGENT_CORE_RESULT_INVALID', 'Agent Core 返回类型不匹配', false, false);
  for (const key of ['agentId', 'tenantId', 'executionId', 'executionStepId', 'pluginVersionId', 'planDigest', 'nonce', 'tokenId', 'decisionId', 'receiptRef', 'localPolicyRef']) identifier(result[key], `agentCoreResult.${key}`);
  if (!['SUCCESS', 'UNKNOWN'].includes(result.status)) throw failure('ADCS_AGENT_CORE_RESULT_STATUS_INVALID', 'Agent Core 状态不在固定集合中', false, false);
  if (result.agentId !== plan.agentId || result.tenantId !== context.tenantId || result.executionId !== context.executionId || result.executionStepId !== context.executionStepId || result.pluginVersionId !== plan.pluginVersionId || result.planDigest !== plan.planDigest || result.nonce !== plan.nonce || result.tokenId !== plan.tokenId || result.decisionId !== plan.decisionId || result.receiptRef !== plan.receiptRef || result.localPolicyRef !== plan.localPolicyRef) throw failure('ADCS_AGENT_CORE_RESULT_BINDING_INVALID', 'Agent Core 返回未绑定 Agent Plan', false, false);
  if (result.status === 'SUCCESS' && result.receiptStatus !== 'SUCCESS') throw failure('ADCS_AGENT_RECEIPT_INVALID', 'Agent Core 未返回成功 Receipt 状态', false, false);
  if (result.status === 'SUCCESS') {
    if (typeof result.receiptNonce !== 'string' || result.receiptNonce !== plan.nonce) throw failure('ADCS_AGENT_RECEIPT_NONCE_INVALID', 'Agent Receipt Nonce 不匹配', false, false);
    if (result.operation === undefined || result.operation !== plan.operation) throw failure('ADCS_AGENT_CORE_RESULT_OPERATION_INVALID', 'Agent Core 操作不匹配', false, false);
  }
  return result;
}

function successResult(operation, plan, coreResult) {
  const receipt = {
    kind: 'AgentExecutionReceiptV1',
    apiVersion: 'gcac.agent-receipt/v1',
    status: 'SUCCESS',
    agentId: plan.agentId,
    tenantId: plan.tenantId,
    executionId: plan.executionId,
    executionStepId: plan.executionStepId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    operation,
    planDigest: plan.planDigest,
    tokenId: plan.tokenId,
    decisionId: plan.decisionId,
    nonce: plan.nonce,
    receiptRef: plan.receiptRef,
    localPolicyRef: plan.localPolicyRef,
    auditEventType: 'ca.agent-side.operation',
    ...(typeof coreResult.certificatePem === 'string' ? { certificatePem: coreResult.certificatePem } : {}),
    ...(typeof coreResult.serialNumber === 'string' ? { serialNumber: coreResult.serialNumber } : {}),
  };
  return { success: true, status: 'SUCCESS', summary: { operation, receiptRef: plan.receiptRef, objectCount: 1 }, normalizedObjects: [receipt], warnings: [] };
}

function assertContext(context, descriptor) {
  if (!context || context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion || !CAPABILITIES.includes(context.capability)) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Agent-side PluginVersion 绑定不匹配', false, false);
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw failure('PLUGIN_HOST_CALL_DENIED', 'Agent-side 执行缺少 Grant 引用', false, false);
}

function createDescriptor() {
  const pluginVersionId = requiredEnvironment('GCAC_PLUGIN_VERSION_ID');
  if (pluginVersionId !== PLUGIN_VERSION_ID) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 注入的 PluginVersion 与包身份不匹配', false, false);
  return Object.freeze({
    pluginVersionId,
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: [...CAPABILITIES],
    permissions: [],
    packageHash: requiredDigest('GCAC_PLUGIN_PACKAGE_HASH'),
    resourceHash: requiredDigest('GCAC_PLUGIN_RESOURCE_HASH'),
    manifestHash: requiredDigest('GCAC_PLUGIN_MANIFEST_HASH'),
  });
}

function requiredEnvironment(name) { const value = process.env[name]?.trim(); if (!value) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 缺少必需环境变量 ${name}`, false, false); return value; }
function requiredDigest(name) { const value = requiredEnvironment(name); if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 环境变量 ${name} 不是有效 SHA-256 摘要`, false, false); return value; }
function stripPlanDigest(plan) { const copy = clone(plan); delete copy.planDigest; return copy; }
function rejectExecutableFields(value) { const forbidden = new Set(['command', 'script', 'shell', 'powershell', 'download', 'executable', 'arguments']); if (Object.keys(value).some((key) => forbidden.has(key.toLowerCase()))) throw failure('ADCS_AGENT_EXECUTION_FIELD_FORBIDDEN', 'Agent-side Plan 不得携带脚本或任意执行字段', false, false); }
function record(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是对象`, false, false); return value; }
function text(value, name) { if (typeof value !== 'string' || value.trim() === '') throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是非空字符串`, false, false); return value; }
function identifier(value, name) { const result = text(value, name); if (!/^[A-Za-z0-9._:/#-]{1,512}$/.test(result)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 格式无效`, false, false); return result; }
function digest(value) { return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; }
function failedResult(status, error) { return { success: false, status, summary: {}, normalizedObjects: [], warnings: [], error }; }
function failure(code, message, retryable, mayBeUnknown) { const error = new Error(message); error.code = code; error.retryable = retryable; error.mayBeUnknown = mayBeUnknown; return error; }
function normalizeError(error) { return { code: typeof error?.code === 'string' ? error.code : 'PLUGIN_CAPABILITY_EXECUTION_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'Agent-side 插件执行失败', retryable: error?.retryable === true, mayBeUnknown: error?.mayBeUnknown === true, secretRedacted: true }; }
