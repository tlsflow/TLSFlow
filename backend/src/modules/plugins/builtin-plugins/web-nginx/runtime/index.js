import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const PLUGIN_ID = manifest.pluginId;
const PLUGIN_VERSION = manifest.version;
const CAPABILITIES = Object.freeze([...(manifest.capabilities ?? []).map((item) => item.key)]);
const PERMISSIONS = Object.freeze([...(manifest.permissions ?? [])]);
const DISCOVERY_CAPABILITIES = Object.freeze(['application.discover']);
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const PLAN_DIGEST = /^[a-f0-9]{64}$/;

/**
 * Nginx 发现包只执行只读的 application.discover 原子 Action。
 * Windows/Linux 的 serviceName、programPath 和 configFingerprint 均由 Agent
 * 标准发现链投影到 ManagedTarget；本 Runner 不生成默认路径或伪造事实。
 */
export function createPluginRunnerExecutor() {
  const resourceHash = requiredDescriptorEnv('GCAC_PLUGIN_RESOURCE_HASH', HASH);
  const descriptor = Object.freeze({
    pluginVersionId: requiredDescriptorEnv('GCAC_PLUGIN_VERSION_ID', IDENTIFIER),
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: Object.freeze([...CAPABILITIES]),
    actions: actionDescriptors(resourceHash),
    permissions: Object.freeze([...PERMISSIONS]),
    packageHash: requiredDescriptorEnv('GCAC_PLUGIN_PACKAGE_HASH', HASH),
    resourceHash,
    manifestHash: requiredDescriptorEnv('GCAC_PLUGIN_MANIFEST_HASH', HASH),
  });
  return Object.freeze({
    descriptor,
    execute: (context) => execute(context, descriptor),
  });
}

async function execute(context, descriptor) {
  assertContext(context, descriptor);
  const summary = {
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    pluginVersionId: descriptor.pluginVersionId,
    discoveryMode: 'agent-standard-facts',
  };
  return {
    success: true,
    status: 'SUCCESS',
    output: { summary, normalizedObjects: [] },
    warnings: [{
      code: 'DISCOVERY_PROJECTED_BY_HOST',
      message: 'Nginx 运行时事实由 Agent 标准发现链投影',
      details: { factSource: 'agent.standard-discovery', secretRedacted: true },
      secretRedacted: true,
    }],
  };
}

function actionDescriptors(resourceHash) {
  const contracts = manifest.resources?.actionContracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    fail('Nginx 发现包缺少 Action Contract 资源声明', 'PLUGIN_RUNNER_START_FAILED');
  }
  const actions = Object.entries(contracts).flatMap(([actionId, resourcePath]) => {
    let contract;
    try {
      contract = JSON.parse(readPackageResource(String(resourcePath)));
    } catch {
      fail(`Nginx Action Contract 资源无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    if (!validActionContract(contract, actionId)) {
      fail(`Nginx Action Contract 内容无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    return [Object.freeze({
      actionId,
      capability: contract.capability,
      actionContractVersion: contract.actionContractVersion,
      inputSchemaSha256: schemaHash(contract.inputSchema),
      outputSchemaSha256: schemaHash(contract.outputSchema),
      resourceHash,
    })];
  });
  if (actions.length === 0) fail('Nginx 发现包没有可执行 Action Contract', 'PLUGIN_RUNNER_START_FAILED');
  return Object.freeze(actions);
}

function validActionContract(contract, actionId) {
  return Boolean(contract)
    && typeof contract === 'object'
    && !Array.isArray(contract)
    && contract.apiVersion === 'gcac.plugin-action-contract/v1'
    && contract.actionId === actionId
    && DISCOVERY_CAPABILITIES.includes(contract.capability)
    && CAPABILITIES.includes(contract.capability)
    && contract.actionContractVersion === 'v1'
    && manifest.capabilities.some((capability) => capability.actionContractId === actionId
      && capability.key === contract.capability
      && capability.contractVersion === contract.actionContractVersion)
    && record(contract.inputSchema)
    && record(contract.outputSchema)
    && contract.writeEffect === false
    && Array.isArray(contract.hostPermissions)
    && new Set(contract.hostPermissions).size === contract.hostPermissions.length
    && contract.hostPermissions.every((permission) => identifier(permission) && PERMISSIONS.includes(permission));
}

function readPackageResource(resourcePath) {
  const normalized = String(resourcePath).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized
    || normalized.startsWith('/')
    || normalized.includes(String.fromCharCode(0))
    || relativePath === '..'
    || relativePath.startsWith('../')) {
    throw new Error('插件包资源路径越界');
  }
  return readFileSync(join(packageDirectory, relativePath), 'utf8');
}

function assertContext(context, descriptor) {
  if (!record(context)) fail('Runner 执行上下文无效');
  for (const key of ['pluginVersionId', 'pluginId', 'pluginVersion', 'tenantId', 'executionId', 'executionStepId', 'workflowVersionId', 'capability', 'actionId', 'actionContractVersion', 'idempotencyKey']) {
    if (!identifier(context[key])) fail(`Runner 上下文 ${key} 无效`);
  }
  if (typeof context.planDigest !== 'string' || !PLAN_DIGEST.test(context.planDigest)) fail('Runner 上下文 planDigest 无效');
  if (context.pluginVersionId !== descriptor.pluginVersionId
    || context.pluginId !== PLUGIN_ID
    || context.pluginVersion !== PLUGIN_VERSION) {
    fail('Runner 上下文未绑定当前 PluginVersion', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  }
  const action = descriptor.actions.find((item) => item.actionId === context.actionId);
  if (!action
    || action.capability !== context.capability
    || action.actionContractVersion !== context.actionContractVersion
    || action.inputSchemaSha256 !== context.inputSchemaSha256
    || action.outputSchemaSha256 !== context.outputSchemaSha256
    || action.resourceHash !== context.resourceHash) {
    fail('Runner Action Contract 未绑定到固定 PluginVersion', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  }
  if (context.packageHash !== descriptor.packageHash || context.manifestHash !== descriptor.manifestHash) {
    fail('Runner 执行上下文 PluginVersion 摘要不匹配', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  }
  if (context.capability !== 'application.discover' || context.writeEffect !== false) {
    fail('Nginx 发现包只接受 application.discover 只读调用', 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
  }
  if (!Array.isArray(context.grantRefs)
    || context.grantRefs.length === 0
    || context.grantRefs.length > 100
    || new Set(context.grantRefs).size !== context.grantRefs.length
    || context.grantRefs.some((grantRef) => !identifier(grantRef))) {
    fail('Runner 执行缺少有效 Grant', 'PLUGIN_HOST_CALL_DENIED');
  }
  if (!record(context.input)) fail('Runner Action 输入无效');
  if (!(context.signal instanceof AbortSignal)) fail('Runner 执行缺少取消信号');
  if (!context.deadlineAt || !Number.isFinite(Date.parse(context.deadlineAt)) || Date.parse(context.deadlineAt) <= Date.now()) {
    fail('Runner 执行超时', 'PLUGIN_RUNNER_TIMEOUT');
  }
}

function requiredDescriptorEnv(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}，Runner 必须失败关闭`);
  return value;
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function schemaHash(schema) {
  return `sha256:${createHash('sha256').update(stableJson(schema), 'utf8').digest('hex')}`;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`,
  ).join(',')}}`;
}

function fail(message, code = 'PLUGIN_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
