import { createHash } from 'node:crypto';

const PLUGIN_ID = 'web.iis';
const PLUGIN_VERSION = '1.0.1';
const AGENT_SIDE_PROTOCOL = 'gcac.agent-side-plugin/v1';
const CAPABILITIES = Object.freeze([
  'application.discover',
  'certificate.deploy',
  'certificate.verify',
  'certificate.rollback',
]);
const PERMISSIONS = Object.freeze([
  'artifact.read',
  'agent.fact.collect',
  'agent.plan.validate',
  'agent.plan.execute',
  'agent.execution.receipt',
  'execution.progress',
  'execution.checkpoint',
  'execution.cancel',
  'resource.lock',
  'audit.append',
]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const ARTIFACT_REF_PATTERN = /^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const CAPABILITY_OPERATIONS = Object.freeze({
  'application.discover': 'discover',
  'certificate.deploy': 'update-binding',
  'certificate.verify': 'verify-binding',
  'certificate.rollback': 'rollback-binding',
});
const CERTIFICATE_CAPABILITIES = Object.freeze(['certificate.deploy', 'certificate.verify', 'certificate.rollback']);

/** 标准 Runner 只加载这个工厂；本文件不实现 IPC 入口，也不监听 stdin/stdout。 */
export function createPluginRunnerExecutor() {
  return {
    descriptor: {
      pluginVersionId: injected('GCAC_PLUGIN_VERSION_ID', IDENTIFIER_PATTERN),
      pluginId: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      capabilities: [...CAPABILITIES],
      permissions: [...PERMISSIONS],
      packageHash: injected('GCAC_PLUGIN_PACKAGE_HASH', HASH_PATTERN),
      resourceHash: injected('GCAC_PLUGIN_RESOURCE_HASH', HASH_PATTERN),
      manifestHash: injected('GCAC_PLUGIN_MANIFEST_HASH', HASH_PATTERN),
    },
    execute: (context, hostApi) => execute(context, hostApi),
  };
}

async function execute(context, hostApi) {
  assertContext(context);
  const operation = CAPABILITY_OPERATIONS[context.capability];
  if (!operation) fail('Capability 未绑定到 IIS P2 PluginVersion');
  const input = record(context.input, 'input');
  if (context.capability === 'application.discover' && input.discoveryMode === 'full-agent') {
    return fullAgentDiscovery(input, context);
  }
  const authorization = validateAgentAuthorization(input.agentAuthorization, context, operation);
  const response = record(input.protocolFixture, 'protocolFixture');
  assertAgentSideResponse(response, context, operation, authorization);
  await waitForFixture(response.delayMs, context.signal);

  if (response.status === 'UNKNOWN') return unknownResult(response.error?.code ?? 'AGENT_EXECUTION_UNKNOWN');
  if (response.status !== 'SUCCESS') {
    const error = new Error(response.error?.message ?? 'IIS Agent-side Plugin 执行失败');
    error.code = response.error?.code ?? 'AGENT_SIDE_PLUGIN_FAILED';
    error.writeStarted = response.writeStarted === true;
    if (context.writeEffect && error.writeStarted) return unknownResult(error.code);
    throw error;
  }

  if (context.capability === 'application.discover') {
    return successResult({ protocol: 'IIS_AGENT_SIDE', operation, requestCount: response.requestCount ?? 1 }, [normalizeDiscovery(input, response.facts, authorization)]);
  }

  if (context.capability === 'certificate.deploy') {
    requireWriteRequest(context);
    const artifact = await resolveArtifact(input, authorization, context, hostApi);
    return successResult({
      protocol: 'IIS_AGENT_SIDE',
      operation,
      target: requiredTarget(input.target),
      artifactSha256: artifact.sha256,
      previousBinding: redactBinding(response.previousBinding),
      updatedBinding: redactBinding(response.binding),
      verified: response.verified === true,
      receiptDigest: authorization.receipt.digest,
    });
  }

  if (context.capability === 'certificate.verify') {
    return successResult({
      protocol: 'IIS_AGENT_SIDE',
      operation,
      target: requiredTarget(input.target),
      binding: redactBinding(response.binding),
      verified: response.verified === true,
      receiptDigest: authorization.receipt.digest,
    });
  }

  requireWriteRequest(context);
  return successResult({
    protocol: 'IIS_AGENT_SIDE',
    operation,
    target: requiredTarget(input.target),
    restoredBinding: redactBinding(response.binding),
    verified: response.verified === true,
    receiptDigest: authorization.receipt.digest,
  });
}

function fullAgentDiscovery(input, context) {
  const factEnvelope = validateFactEnvelope(input.factEnvelope);
  const files = factEnvelope.facts
    .filter((fact) => fact.kind === 'file_content')
    .map((fact) => ({ path: fact.path, content: decodeContent(fact.contentBase64) }));
  const sites = [];
  const bindings = [];
  for (const file of files) {
    if (!/applicationhost\.config$/i.test(file.path) && !/<system\.applicationHost>|<site\b/i.test(file.content)) continue;
    for (const siteMatch of file.content.matchAll(/<site\b([^>]*?)(?:>|\/>)([\s\S]*?)<\/site>/gi)) {
      const siteAttrs = attributes(siteMatch[1] ?? '');
      const siteName = requiredName(siteAttrs.name ?? `site-${sites.length + 1}`, 'IIS site.name');
      const siteBody = siteMatch[2] ?? '';
      const siteBindings = [];
      for (const bindingMatch of siteBody.matchAll(/<binding\b([^>]*?)(?:\/>|>)/gi)) {
        const attrs = attributes(bindingMatch[1] ?? '');
        const protocol = optionalText(attrs.protocol)?.toLowerCase() ?? 'http';
        const information = optionalText(attrs.bindingInformation) ?? '*:80:';
        const parsed = parseBindingInformation(information);
        const binding = { siteName, bindingInformation: information, protocol, hostName: parsed.hostName, address: parsed.address, port: parsed.port, configPath: file.path };
        siteBindings.push(binding);
        bindings.push(binding);
      }
      const addresses = [...new Set(siteBindings.map((binding) => binding.address).filter(Boolean))];
      const primary = siteBindings.find((binding) => binding.port !== undefined);
      sites.push({ name: siteName, addresses: addresses.length ? addresses : [factEnvelope.agentId], port: primary?.port, protocol: primary?.protocol?.toUpperCase(), metadata: { applicationPool: findApplicationPool(siteBody), configPath: file.path } });
    }
  }
  const frameworkStableKey = `web.iis:${stableKey(factEnvelope.agentId)}`;
  const normalizedSites = dedupeSites(sites).map((site) => ({
    stableKey: `${frameworkStableKey}:${stableKey(site.name)}`,
    frameworkStableKey,
    siteType: 'web.site',
    displayName: site.name,
    addresses: site.addresses,
    ...(site.port ? { port: site.port } : {}),
    ...(site.protocol ? { protocol: site.protocol } : {}),
    metadata: site.metadata,
  }));
  const siteByName = new Map(normalizedSites.map((site) => [site.displayName, site]));
  const managedTargets = bindings.map((binding) => {
    const site = siteByName.get(binding.siteName);
    return {
      stableKey: `${frameworkStableKey}:${stableKey(binding.bindingInformation)}`,
      frameworkStableKey,
      ...(site ? { siteStableKey: site.stableKey } : {}),
      targetType: 'tls.binding',
      targetKey: `${PLUGIN_ID}:binding:${stableKey(`${binding.siteName}:${binding.bindingInformation}:${binding.protocol}`)}`,
      bindingKey: `${PLUGIN_ID}:binding:${stableKey(`${binding.siteName}:${binding.bindingInformation}:${binding.protocol}`)}`,
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['AGENT', 'CONTROL_PLANE'],
      metadata: { protocol: binding.protocol, hostName: binding.hostName, configPath: binding.configPath },
    };
  });
  return successResult({ pluginId: PLUGIN_ID, pluginVersion: PLUGIN_VERSION, pluginVersionId: context.pluginVersionId, discoveryMode: 'full-agent', siteCount: normalizedSites.length, bindingCount: managedTargets.length }, [{
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: `${PLUGIN_ID}:${stableKey(factEnvelope.agentId)}`, displayName: input.displayName ?? factEnvelope.agentId, productFamily: PLUGIN_ID, softwareVersion: 'unknown', managementAddress: input.deviceAddress ?? factEnvelope.agentId, metadata: { tenantId: factEnvelope.tenantId, pluginId: PLUGIN_ID, pluginVersionId: context.pluginVersionId, discoveryMode: 'full-agent' } },
    capabilities: CAPABILITIES.map((key) => ({ key, available: true })),
    frameworks: [{ stableKey: frameworkStableKey, frameworkType: PLUGIN_ID, displayName: 'IIS' }],
    sites: normalizedSites,
    managedTargets,
    certificates: [],
    certificateBindings: [],
    warnings: factEnvelope.warnings.map((message) => ({ code: 'AGENT_FACT_WARNING', messageKey: 'agents.discovery.agentFactWarning', metadata: { message: String(message).slice(0, 512), secretRedacted: true } })),
  }]);
}

function decodeContent(value) { try { return Buffer.from(value, 'base64').toString('utf8'); } catch { return ''; } }
function attributes(value) { return Object.fromEntries([...value.matchAll(/([A-Za-z][\w-]*)\s*=\s*["']([^"']*)["']/g)].map((item) => [item[1], item[2]])); }
function parseBindingInformation(value) {
  const match = /^\[?([^\]]*)\]?:(\d{1,5}):(.*)$/.exec(value);
  if (!match) return { address: '*', port: undefined, hostName: undefined };
  const port = Number(match[2]);
  return { address: match[1] || '*', port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined, hostName: optionalText(match[3]) };
}
function findApplicationPool(value) { return /applicationPool\s*=\s*["']([^"']+)["']/i.exec(value)?.[1]; }
function dedupeSites(sites) { const result = []; const seen = new Set(); for (const site of sites) { const key = `${site.name}:${site.port ?? ''}:${site.protocol ?? ''}`; if (seen.has(key)) continue; seen.add(key); result.push(site); } return result; }
function stableKey(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 32); }

async function resolveArtifact(input, authorization, context, hostApi) {
  const artifact = record(input.artifact, 'artifact');
  const artifactRef = artifact.artifactRef;
  if (typeof artifactRef !== 'string' || !ARTIFACT_REF_PATTERN.test(artifactRef)) fail('artifact.artifactRef 缺失或格式无效');
  const grantId = requiredIdentifier(artifact.grantId, 'artifact.grantId');
  if (!context.grantRefs.includes(grantId) || grantId !== authorization.grant.grantId) fail('Artifact Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('artifact.grant.read', { grantId, artifactRef }, [grantId]);
  if (!result || result.ok !== true || !result.data || typeof result.data.sha256 !== 'string' || !HASH_PATTERN.test(result.data.sha256)) {
    fail('Artifact Host API 未返回固定摘要', 'PLUGIN_HOST_CALL_DENIED');
  }
  if (!authorization.grant.artifactDigests.includes(result.data.sha256)) fail('Artifact 摘要未绑定到固定 Agent Grant', 'PLUGIN_HOST_CALL_DENIED');
  return { artifactRef, sha256: result.data.sha256 };
}

function normalizeDiscovery(input, rawFacts, authorization) {
  const facts = record(rawFacts, 'protocolFixture.facts');
  const iisVersion = requiredText(facts.iisVersion, 'facts.iisVersion');
  const sites = requiredArray(facts.sites, 'facts.sites');
  const bindings = requiredArray(facts.bindings, 'facts.bindings');
  const address = requiredText(input.deviceAddress ?? facts.machineName ?? authorization.agentId, 'deviceAddress');
  const frameworkStableKey = 'framework:iis';
  const normalizedSites = sites.map((rawSite) => {
    const site = record(rawSite, 'facts.sites[]');
    const name = requiredName(site.name, 'IIS site.name');
    return {
      raw: site,
      stableKey: `IIS:${safeKey(name)}`,
      frameworkStableKey,
      siteType: 'web.site',
      displayName: name,
      addresses: normalizeAddresses(site.addresses, address),
      ...(optionalInteger(site.port) !== undefined ? { port: optionalInteger(site.port) } : {}),
      protocol: 'HTTPS',
      metadata: { applicationPool: optionalText(site.applicationPool) },
    };
  });
  const siteByName = new Map(normalizedSites.map((site) => [String(site.raw.name), site]));
  const certificates = new Map();
  const normalizedBindings = bindings.map((rawBinding) => {
    const binding = record(rawBinding, 'facts.bindings[]');
    const siteName = requiredName(binding.siteName, 'IIS binding.siteName');
    const site = siteByName.get(siteName);
    if (!site) fail(`IIS Binding 引用了未发现的站点：${siteName}`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
    const bindingInformation = requiredName(binding.bindingInformation, 'IIS binding.bindingInformation');
    const thumbprint = requiredName(binding.certificateThumbprint, 'IIS binding.certificateThumbprint').replace(/\s+/g, '').toUpperCase();
    const certificateStableKey = `IIS-CERT:${safeKey(thumbprint)}`;
    if (!certificates.has(certificateStableKey)) {
      certificates.set(certificateStableKey, {
        stableKey: certificateStableKey,
        ...(typeof binding.sha256Fingerprint === 'string' ? { sha256Fingerprint: requiredSha256Fingerprint(binding.sha256Fingerprint) } : {}),
        ...(optionalText(binding.subject) ? { subject: optionalText(binding.subject) } : {}),
        ...(optionalText(binding.issuer) ? { issuer: optionalText(binding.issuer) } : {}),
        ...(optionalText(binding.notAfter) ? { notAfter: optionalText(binding.notAfter) } : {}),
        metadata: { thumbprint, storeName: optionalText(binding.certificateStoreName) ?? 'My' },
      });
    }
    const targetStableKey = `TARGET:${site.stableKey}:${safeKey(bindingInformation)}`;
    return {
      site,
      targetStableKey,
      bindingInformation,
      certificateStableKey,
      binding,
    };
  });
  const managedTargets = normalizedBindings.map((binding) => ({
    stableKey: binding.targetStableKey,
    frameworkStableKey,
    siteStableKey: binding.site.stableKey,
    targetType: 'tls.binding',
    targetKey: `${PLUGIN_ID}:binding:${stableKey(`${binding.site.displayName}:${binding.bindingInformation}:https`)}`,
    bindingKey: `${PLUGIN_ID}:binding:${stableKey(`${binding.site.displayName}:${binding.bindingInformation}:https`)}`,
    supportedCapabilities: [...CERTIFICATE_CAPABILITIES],
    executionLocations: ['CONTROL_PLANE', 'AGENT'],
    metadata: { protocol: 'https', hostName: optionalText(binding.binding.hostName) },
  }));
  const certificateBindings = normalizedBindings.map((binding) => ({
    stableKey: `BINDING:${binding.targetStableKey}:${binding.certificateStableKey}`,
    managedTargetStableKey: binding.targetStableKey,
    certificateStableKey: binding.certificateStableKey,
    bindingName: binding.bindingInformation,
  }));
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: `web.iis:${safeKey(address)}`, displayName: optionalText(input.displayName) ?? address, productFamily: 'web.iis', softwareVersion: iisVersion, managementAddress: address, metadata: { agentSidePlugin: true, pluginVersion: PLUGIN_VERSION } },
    capabilities: CAPABILITIES.map((key) => ({ key, available: true })),
    frameworks: [{ stableKey: frameworkStableKey, frameworkType: 'web.iis', displayName: 'IIS', version: iisVersion }],
    sites: normalizedSites.map(({ raw, ...site }) => site),
    managedTargets,
    certificates: [...certificates.values()],
    certificateBindings,
    warnings: [],
  };
}

function validateAgentAuthorization(value, context, operation) {
  const auth = record(value, 'agentAuthorization');
  for (const key of ['token', 'policyDecision', 'receipt', 'grant', 'localPolicy']) record(auth[key], `agentAuthorization.${key}`);
  const planDigest = requiredDigest(auth.planDigest, 'agentAuthorization.planDigest');
  for (const key of ['packageHash', 'manifestHash', 'resourceHash']) {
    const hash = auth[key];
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash) || hash !== process.env[`GCAC_PLUGIN_${key === 'packageHash' ? 'PACKAGE' : key === 'manifestHash' ? 'MANIFEST' : 'RESOURCE'}_HASH`]) fail(`agentAuthorization.${key} 未绑定到适配器摘要`);
  }
  const token = auth.token;
  const decision = auth.policyDecision;
  const receipt = auth.receipt;
  const grant = auth.grant;
  const localPolicy = auth.localPolicy;
  const nonce = requiredIdentifier(auth.nonce, 'agentAuthorization.nonce');
  const agentId = requiredIdentifier(auth.agentId, 'agentAuthorization.agentId');
  if (token.agentId !== agentId || decision.agentId !== agentId || grant.agentId !== agentId || receipt.agentId !== agentId || localPolicy.agentId !== agentId) fail('Agent 身份绑定不一致');
  if (token.tenantId !== context.tenantId || decision.tenantId !== context.tenantId || grant.tenantId !== context.tenantId || receipt.tenantId !== context.tenantId) fail('租户绑定不一致');
  for (const [name, item] of [['token', token], ['policyDecision', decision], ['grant', grant], ['receipt', receipt]]) {
    if (item.pluginId !== PLUGIN_ID || item.pluginVersion !== undefined && item.pluginVersion !== PLUGIN_VERSION || item.pluginVersionId !== context.pluginVersionId) fail(`${name} PluginVersion 绑定不一致`);
  }
  if (decision.allowed !== true) fail('Policy Authority Decision 未允许当前执行');
  if (token.nonce !== nonce || decision.nonce !== nonce || grant.nonce !== nonce || receipt.nonce !== nonce) fail('Nonce 未在 Token、Decision、Grant、Receipt 间一致绑定');
  if (token.planDigest !== planDigest || decision.planDigest !== planDigest || grant.planDigest !== planDigest || receipt.planDigest !== planDigest) fail('planDigest 未在安全材料间一致绑定');
  const grantId = requiredIdentifier(grant.grantId, 'agentAuthorization.grant.grantId');
  if (!context.grantRefs.includes(grantId)) fail('Agent Grant 未绑定到 Runner 执行');
  if (grant.allowedActions !== undefined) requireAction(grant.allowedActions, operation, 'Grant');
  else fail('Agent Grant 缺少固定 allowedActions');
  requireAction(token.actions, operation, 'Token');
  requireAction(decision.actions, operation, 'Decision');
  requireAction(localPolicy.allowedActions, operation, '本地策略');
  if (localPolicy.disabled === true) fail('Agent 本地策略已禁用');
  if (receipt.status !== 'PENDING' && receipt.status !== 'SUCCESS' && receipt.status !== 'UNKNOWN') fail('Agent Receipt 状态无效');
  if (operation !== 'discover' && context.writeEffect !== true) fail('IIS 写操作缺少 writeEffect=true');
  return { agentId, planDigest, token, policyDecision: decision, receipt, grant, localPolicy };
}

function assertAgentSideResponse(response, context, operation, authorization) {
  if (response.apiVersion !== AGENT_SIDE_PROTOCOL) fail('Agent-side Plugin 协议版本不匹配');
  if (response.pluginId !== PLUGIN_ID || response.pluginVersion !== PLUGIN_VERSION) fail('Agent-side Plugin 身份不匹配');
  if (response.operation !== operation) fail('Agent-side Plugin 操作未固定绑定');
  if (!['SUCCESS', 'FAILED', 'UNKNOWN'].includes(response.status)) fail('Agent-side Plugin 返回状态无效');
  if (response.receipt === undefined) fail('Agent-side Plugin 缺少 Receipt');
  const receipt = record(response.receipt, 'protocolFixture.receipt');
  if (receipt.planDigest !== authorization.planDigest || receipt.nonce !== authorization.token.nonce) fail('Agent-side Receipt 绑定不一致');
  if (context.writeEffect && response.status !== 'SUCCESS' && response.writeStarted === true && response.status !== 'UNKNOWN') fail('IIS 写操作失败后必须返回 UNKNOWN');
  if (response.status === 'SUCCESS' && operation === 'discover') record(response.facts, 'protocolFixture.facts');
  if (response.status === 'SUCCESS' && operation !== 'discover') {
    record(response.binding, 'protocolFixture.binding');
    if (response.verified !== true) fail('IIS 写入或校验未返回 verified=true');
  }
}

function assertContext(context) {
  if (!context || typeof context !== 'object') fail('Runner 上下文缺失');
  for (const key of ['pluginVersionId', 'pluginId', 'pluginVersion', 'tenantId', 'executionId', 'executionStepId', 'capability', 'idempotencyKey']) {
    if (typeof context[key] !== 'string' || !IDENTIFIER_PATTERN.test(context[key])) fail(`Runner 上下文 ${key} 无效`);
  }
  if (context.pluginId !== PLUGIN_ID || context.pluginVersion !== PLUGIN_VERSION) fail('Runner 执行上下文 PluginVersion 不匹配');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) fail('Runner 执行缺少 Grant');
  if (!(context.signal instanceof AbortSignal)) fail('Runner 执行缺少取消信号');
  if (!context.deadlineAt || Date.parse(context.deadlineAt) <= Date.now()) fail('Runner 执行超时');
}

function requireWriteRequest(context) {
  if (context.writeEffect !== true) fail('写入 Capability 必须声明 writeEffect=true');
}

function requiredTarget(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512 || /[\r\n]/.test(value)) fail('target 不是固定目标标识');
  return value;
}

function requiredName(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256 || /[\r\n]/.test(value)) fail(`${name} 不是固定名称`);
  return value;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} 缺失`);
  return value;
}

function requiredDigest(value, name) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(`${name} 缺失或格式无效`);
  return value;
}

function requiredSha256Fingerprint(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('sha256Fingerprint 格式无效');
  return value.toLowerCase();
}

function requiredIdentifier(value, name) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) fail(`${name} 不是固定标识符`);
  return value;
}

function requireAction(value, operation, name) {
  if (!Array.isArray(value) || !value.includes(operation)) fail(`${name} 未授权 IIS 操作 ${operation}`);
}

function requiredArray(value, name) {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeAddresses(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) return [fallback];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '' && !/[\r\n]/.test(item)).slice(0, 16);
}

function redactBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const binding = value;
  return {
    siteName: optionalText(binding.siteName),
    bindingInformation: optionalText(binding.bindingInformation),
    protocol: optionalText(binding.protocol),
    hostName: optionalText(binding.hostName),
    certificateThumbprint: optionalText(binding.certificateThumbprint)?.replace(/\s+/g, '').toUpperCase(),
    certificateStoreName: optionalText(binding.certificateStoreName),
  };
}

function unknownResult(code) {
  return {
    success: false,
    status: 'UNKNOWN',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: { code: 'PLUGIN_OPERATION_UNKNOWN_STATE', message: `IIS 写操作结果无法确认：${code}`, retryable: false, mayBeUnknown: true, secretRedacted: true },
  };
}

function successResult(summary, normalizedObjects = []) {
  return { success: true, status: 'SUCCESS', summary: redact(summary), normalizedObjects, warnings: [] };
}

function fail(message, code = 'PLUGIN_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value;
}

function injected(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}，Runner 必须失败关闭`);
  return value;
}

async function waitForFixture(delayMs, signal) {
  if (delayMs === undefined) return;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120_000) fail('协议 Fixture delayMs 无效');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Agent-side Fixture 执行被取消'), { code: 'PLUGIN_OPERATION_CANCELLED' })); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function safeKey(value) {
  if (IDENTIFIER_PATTERN.test(value)) return value;
  return `encoded-${Buffer.from(value, 'utf8').toString('base64url').slice(0, 220)}`;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = /password|secret|token|private|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(child);
  return result;
}
