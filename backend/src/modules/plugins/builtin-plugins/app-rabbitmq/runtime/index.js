import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'app.rabbitmq';
const PLUGIN_VERSION = '1.0.0';
const CAPABILITIES = ['application.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback'];
const WRITE_CAPABILITIES = new Set(['certificate.deploy', 'certificate.rollback']);
const SECURITY_VERSION = 'gcac.agent-security/v1';
const BINDING_VERSION = 'gcac.plugin-runner-binding/v1';
const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');

export function createPluginRunnerExecutor() {
  const manifest = readJson(join(packageDirectory, 'manifest.json'));
  assertManifest(manifest);
  const fixed = readFixedBinding();
  const resources = readDeclaredResources(manifest);
  const profiles = readDiscoveryProfiles(manifest, resources);
  return {
    descriptor: {
      pluginVersionId: fixed.pluginVersionId,
      pluginId: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      capabilities: manifest.capabilities.map((item) => item.key),
      permissions: [...manifest.permissions],
      packageHash: fixed.packageHash,
      resourceHash: fixed.resourceHash,
      manifestHash: fixed.manifestHash,
    },
    async execute(context, hostApi) {
      return executePlugin({ manifest, resources, profiles, fixed }, context, hostApi);
    },
  };
}

async function executePlugin(bundle, context, hostApi) {
  assertContext(context, bundle.fixed);
  const input = record(context.input, 'input');
  const factEnvelope = validateFactEnvelope(input.factEnvelope);
  const profile = selectProfile(bundle.profiles, input.profile, factEnvelope.source);
  const target = resolveTarget(input.target, profile, factEnvelope.facts);
  assertProfileEvidence(profile, target, factEnvelope.facts);
  const binding = validateExecutionBinding(input.executionBinding, context, bundle, profile);
  const security = validateSecurityShell(input.security);
  const plan = buildPlan(context, input, factEnvelope, profile, target, security, bundle.fixed.pluginVersionId);
  validateSecurity(input.security, security, plan, factEnvelope, context, binding, target, bundle);
  let artifactAccessed = false;
  if (context.capability === 'certificate.deploy' || context.capability === 'certificate.verify') {
    const artifact = validateArtifact(input.artifact);
    if (!context.grantRefs.includes(artifact.grantId)) fail('artifact.grantId', 'Artifact Grant 不在当前执行绑定范围');
    if (typeof hostApi?.call !== 'function') fail('hostApi', '缺少受控 Artifact Host API');
    await hostApi.call('artifact.grant.read', {
      grantId: artifact.grantId,
      artifactRef: artifact.artifactRef,
    }, context.grantRefs);
    artifactAccessed = true;
  }
  const objects = projectStandardObjects(factEnvelope, profile, target, bundle);
  return {
    success: true,
    status: 'SUCCESS',
    summary: {
      pluginId: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      pluginVersionId: bundle.fixed.pluginVersionId,
      profile: profile.id,
      workflowVersion: binding.workflowVersion,
      workflowVersionId: binding.workflowVersionId,
      planDigest: plan.planDigest,
      factDigest: factEnvelope.digest,
      artifactAccessed,
      operationResults: plan.operations.map((operation) => ({
        operationId: operation.operationId,
        operationType: operation.operationType,
        status: 'planned',
      })),
    },
    normalizedObjects: objects,
    warnings: factEnvelope.warnings.map((message) => ({
      code: 'AGENT_FACT_WARNING',
      message: String(message).slice(0, 512),
      secretRedacted: true,
    })),
  };
}

function readFixedBinding() {
  const names = [
    'GCAC_PLUGIN_VERSION_ID',
    'GCAC_PLUGIN_PACKAGE_HASH',
    'GCAC_PLUGIN_MANIFEST_HASH',
    'GCAC_PLUGIN_RESOURCE_HASH',
  ];
  const values = Object.fromEntries(names.map((name) => [name, process.env[name]?.trim()]));
  if (names.some((name) => !values[name])) fail('descriptor', '缺少主适配器注入的固定 PluginVersion 摘要');
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(values.GCAC_PLUGIN_VERSION_ID)) fail('descriptor.pluginVersionId', 'PluginVersion ID 无效');
  for (const name of ['GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH']) {
    if (!/^sha256:[a-f0-9]{64}$/.test(values[name])) fail('descriptor.' + name, '摘要格式无效');
  }
  return {
    pluginVersionId: values.GCAC_PLUGIN_VERSION_ID,
    packageHash: values.GCAC_PLUGIN_PACKAGE_HASH,
    manifestHash: values.GCAC_PLUGIN_MANIFEST_HASH,
    resourceHash: values.GCAC_PLUGIN_RESOURCE_HASH,
  };
}

function readDiscoveryProfiles(manifest, resources) {
  const path = manifest.resources?.discoveryMappings?.profiles;
  if (typeof path !== 'string' || typeof resources[path] !== 'string') fail('discoveryMappings', '缺少固定 Discovery Profile');
  const document = parseJson(resources[path], path);
  if (document.apiVersion !== 'gcac.plugin-discovery/v1'
    || document.kind !== 'AgentFactProfileSet'
    || document.pluginId !== PLUGIN_ID
    || document.version !== PLUGIN_VERSION
    || !Array.isArray(document.profiles)
    || document.profiles.length === 0) {
    fail('discovery', 'Discovery Profile 合同无效');
  }
  return document.profiles;
}

function readDeclaredResources(manifest) {
  const paths = [...new Set(collectStrings(manifest.resources))].sort();
  if (paths.length === 0) fail('resources', '插件没有声明资源');
  const resources = {};
  for (const path of paths) resources[path] = readResource(path);
  return resources;
}

function collectStrings(value, result = []) {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const nested of Object.values(value)) collectStrings(nested, result);
  return result;
}

function readResource(path) {
  const normalized = String(path).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(String.fromCharCode(0))
    || relativePath === '..' || relativePath.startsWith('../')) {
    fail('resources', '资源路径越出插件包');
  }
  return readFileSync(absolute, 'utf8');
}

function assertManifest(manifest) {
  if (!record(manifest, 'manifest')
    || manifest.apiVersion !== 'gcac.plugin-manifest/v1'
    || manifest.kind !== 'GcacPlugin'
    || manifest.pluginId !== PLUGIN_ID
    || manifest.version !== PLUGIN_VERSION
    || manifest.runtime !== 'WORKFLOW_DSL'
    || manifest.resources?.runtimeEntrypoint !== 'runtime/index.js'
    || !Array.isArray(manifest.permissions)
    || !Array.isArray(manifest.capabilities)
    || manifest.capabilities.length !== CAPABILITIES.length
    || manifest.capabilities.some((item, index) => item?.key !== CAPABILITIES[index])) {
    fail('manifest', 'Manifest 身份、Runtime 或 Capability 未固定');
  }
  const workflows = manifest.resources?.workflows;
  if (!record(workflows, 'resources.workflows')) fail('resources.workflows', '缺少固定 Workflow 映射');
  for (const capability of CAPABILITIES) {
    if (typeof workflows[capability] !== 'string') fail('resources.workflows', '缺少 ' + capability + ' Workflow');
  }
}

function assertContext(context, fixed) {
  if (!record(context, 'context')) fail('context', 'Runner 执行上下文无效');
  for (const [name, value] of [
    ['pluginVersionId', context.pluginVersionId],
    ['pluginId', context.pluginId],
    ['pluginVersion', context.pluginVersion],
    ['tenantId', context.tenantId],
    ['executionId', context.executionId],
    ['executionStepId', context.executionStepId],
    ['capability', context.capability],
    ['idempotencyKey', context.idempotencyKey],
    ['deadlineAt', context.deadlineAt],
  ]) identifier(value, name);
  if (context.pluginVersionId !== fixed.pluginVersionId || context.pluginId !== PLUGIN_ID || context.pluginVersion !== PLUGIN_VERSION) {
    fail('context', '执行上下文未绑定当前 Canonical PluginVersion');
  }
  if (!CAPABILITIES.includes(context.capability)) fail('capability', 'Capability 未绑定当前插件');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) fail('grantRefs', '执行缺少 Grant');
  if (context.grantRefs.some((ref) => !/^[A-Za-z0-9._:-]{1,256}$/.test(ref)) || new Set(context.grantRefs).size !== context.grantRefs.length) {
    fail('grantRefs', 'Grant 引用格式无效');
  }
  if (typeof context.writeEffect !== 'boolean') fail('writeEffect', '写操作标记无效');
  if (WRITE_CAPABILITIES.has(context.capability) !== context.writeEffect) {
    fail('writeEffect', 'Capability 与写操作标记不一致');
  }
  if (!Number.isFinite(Date.parse(context.deadlineAt)) || Date.parse(context.deadlineAt) <= Date.now()) {
    fail('deadlineAt', '执行截止时间无效或已过期');
  }
}

function validateFactEnvelope(value) {
  const envelope = record(value, 'factEnvelope');
  exactKeys(envelope, ['contractVersion', 'factId', 'agentId', 'tenantId', 'collectedAt', 'ttlSeconds', 'source', 'facts', 'digest', 'warnings'], 'factEnvelope');
  if (envelope.contractVersion !== SECURITY_VERSION) fail('factEnvelope.contractVersion', 'Agent 事实合同版本无效');
  for (const [name, item] of [['factId', envelope.factId], ['agentId', envelope.agentId], ['tenantId', envelope.tenantId]]) identifier(item, 'factEnvelope.' + name);
  dateTime(envelope.collectedAt, 'factEnvelope.collectedAt');
  if (!Number.isInteger(envelope.ttlSeconds) || envelope.ttlSeconds < 1 || envelope.ttlSeconds > 86400) fail('factEnvelope.ttlSeconds', '事实 TTL 无效');
  if (!['windows', 'linux', 'compatibility'].includes(envelope.source)) fail('factEnvelope.source', '事实来源无效');
  if (!Array.isArray(envelope.facts) || envelope.facts.length === 0 || envelope.facts.length > 1000) fail('factEnvelope.facts', '事实不能为空');
  const facts = envelope.facts.map((fact, index) => validateFact(fact, 'factEnvelope.facts.' + index));
  if (!Array.isArray(envelope.warnings) || envelope.warnings.some((item) => typeof item !== 'string')) fail('factEnvelope.warnings', '事实警告无效');
  rawDigest(envelope.digest, 'factEnvelope.digest');
  const { digest: _digest, ...payload } = { ...envelope, facts };
  if (sha256Digest(payload) !== envelope.digest) fail('factEnvelope.digest', '事实摘要与内容不匹配');
  return { ...envelope, facts };
}

function validateFact(value, path) {
  const fact = record(value, path);
  if (Object.keys(fact).some((key) => /product|framework|provider|detected|recognition|deploymentSemantic/i.test(key))) {
    fail(path, '原始事实包含产品判断字段');
  }
  if (fact.kind === 'process') {
    exactKeys(fact, ['kind', 'pid', 'parentPid', 'executablePath', 'executableSha256', 'commandLine', 'startedAt'], path);
    positiveInteger(fact.pid, path + '.pid');
    absolutePath(fact.executablePath, path + '.executablePath');
    if (fact.parentPid !== undefined) positiveInteger(fact.parentPid, path + '.parentPid');
    if (fact.executableSha256 !== undefined) rawDigest(fact.executableSha256, path + '.executableSha256');
    if (fact.commandLine !== undefined && (typeof fact.commandLine !== 'string' || fact.commandLine.length > 4096
      || /(?:password|passwd|token|secret|private[_-]?key)\\s*[:=]/i.test(fact.commandLine))) {
      fail(path, '进程命令行不符合脱敏合同');
    }
    if (fact.startedAt !== undefined) dateTime(fact.startedAt, path + '.startedAt');
    return { ...fact, executablePath: normalizePath(fact.executablePath) };
  }
  if (fact.kind === 'service') {
    exactKeys(fact, ['kind', 'name', 'status', 'executablePath', 'startType'], path);
    identifier(fact.name, path + '.name');
    if (!['running', 'stopped', 'paused', 'unknown'].includes(fact.status)) fail(path, '服务状态无效');
    if (fact.executablePath !== undefined) fact.executablePath = normalizePath(fact.executablePath);
    if (fact.startType !== undefined && !['automatic', 'manual', 'disabled', 'unknown'].includes(fact.startType)) fail(path, '服务启动类型无效');
    return fact;
  }
  if (fact.kind === 'listening_port') {
    exactKeys(fact, ['kind', 'address', 'port', 'protocol', 'pid'], path);
    if (typeof fact.address !== 'string' || fact.address.length === 0) fail(path, '监听地址无效');
    if (!Number.isInteger(fact.port) || fact.port < 1 || fact.port > 65535) fail(path, '监听端口无效');
    if (!['tcp', 'udp'].includes(fact.protocol)) fail(path, '监听协议无效');
    if (fact.pid !== undefined) positiveInteger(fact.pid, path + '.pid');
    return fact;
  }
  if (fact.kind === 'file_stat') {
    exactKeys(fact, ['kind', 'path', 'exists', 'sizeBytes', 'sha256', 'modifiedAt', 'mode'], path);
    const normalized = normalizePath(fact.path);
    if (typeof fact.exists !== 'boolean' || !Number.isInteger(fact.sizeBytes) || fact.sizeBytes < 0) fail(path, '文件事实无效');
    if (fact.sha256 !== undefined) rawDigest(fact.sha256, path + '.sha256');
    if (fact.modifiedAt !== undefined) dateTime(fact.modifiedAt, path + '.modifiedAt');
    return { ...fact, path: normalized };
  }
  if (fact.kind === 'file_content') {
    exactKeys(fact, ['kind', 'path', 'contentBase64', 'bytesRead', 'truncated', 'sha256'], path);
    const normalized = normalizePath(fact.path);
    if (typeof fact.contentBase64 !== 'string' || fact.contentBase64.length === 0
      || !Number.isInteger(fact.bytesRead) || fact.bytesRead < 0 || typeof fact.truncated !== 'boolean') fail(path, '文件内容事实无效');
    rawDigest(fact.sha256, path + '.sha256');
    try { Buffer.from(fact.contentBase64, 'base64'); } catch { fail(path, '文件内容 Base64 无效'); }
    return { ...fact, path: normalized };
  }
  if (fact.kind === 'certificate_store') {
    exactKeys(fact, ['kind', 'store', 'subject', 'thumbprint', 'notAfter', 'hasPrivateKey'], path);
    identifier(fact.store, path + '.store');
    if (typeof fact.subject !== 'string' || fact.subject.length === 0 || typeof fact.thumbprint !== 'string'
      || fact.thumbprint.length === 0 || typeof fact.hasPrivateKey !== 'boolean') fail(path, '证书存储事实无效');
    if (fact.notAfter !== undefined) dateTime(fact.notAfter, path + '.notAfter');
    return fact;
  }
  if (fact.kind === 'privilege') {
    exactKeys(fact, ['kind', 'principal', 'elevated', 'groups'], path);
    if (typeof fact.principal !== 'string' || fact.principal.length === 0 || typeof fact.elevated !== 'boolean'
      || !Array.isArray(fact.groups)) fail(path, '权限事实无效');
    return fact;
  }
  fail(path, '未知 Agent 原始事实类型');
}

function selectProfile(profiles, profileId, source) {
  identifier(profileId, 'profile');
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) fail('profile', '未找到显式平台 Profile');
  if (!Array.isArray(profile.sources) || !profile.sources.includes(source)) fail('profile', 'Profile 不支持当前 Agent 事实来源');
  if (profile.pluginId !== PLUGIN_ID || profile.version !== PLUGIN_VERSION) fail('profile', 'Profile 未绑定当前插件版本');
  return profile;
}

function resolveTarget(value, profile, facts) {
  const target = record(value, 'target');
  exactKeys(target, ['path', 'serviceName', 'port', 'displayName', 'address', 'softwareVersion', 'backupRef'], 'target');
  const path = normalizePath(target.path);
  const fileFact = facts.find((fact) => (fact.kind === 'file_stat' || fact.kind === 'file_content') && samePath(fact.path, path));
  if (!fileFact || (fileFact.kind === 'file_stat' && fileFact.exists !== true)) fail('target.path', '目标路径必须来自 Agent 文件事实且存在');
  if (profile.pathMode === 'explicit' && (!Array.isArray(profile.targetPaths) || !profile.targetPaths.some((item) => samePath(item, path)))) {
    fail('target.path', '目标路径不在当前 Profile 的显式范围');
  }
  if (profile.pathMode === 'fact-selected' && profile.pathSuffix && !path.toLowerCase().endsWith(profile.pathSuffix.toLowerCase())) {
    fail('target.path', '目标路径不符合当前 Profile 的类型约束');
  }
  if (target.serviceName !== undefined) identifier(target.serviceName, 'target.serviceName');
  if (target.port !== undefined && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) fail('target.port', '目标端口无效');
  if (target.displayName !== undefined) identifier(target.displayName, 'target.displayName');
  if (target.address !== undefined && (typeof target.address !== 'string' || target.address.length === 0)) fail('target.address', '目标地址无效');
  if (target.softwareVersion !== undefined) identifier(target.softwareVersion, 'target.softwareVersion');
  if (target.backupRef !== undefined) identifier(target.backupRef, 'target.backupRef');
  return { ...target, path };
}

function assertProfileEvidence(profile, target, facts) {
  const processFacts = facts.filter((fact) => fact.kind === 'process');
  const serviceFacts = facts.filter((fact) => fact.kind === 'service');
  const portFacts = facts.filter((fact) => fact.kind === 'listening_port');
  if (profile.processExecutables?.length > 0
    && !processFacts.some((fact) => profile.processExecutables.some((path) => samePath(fact.executablePath, path)))) {
    fail('discovery', '进程事实未满足 Profile');
  }
  if (profile.serviceNames?.length > 0
    && !serviceFacts.some((fact) => profile.serviceNames.includes(fact.name))) {
    fail('discovery', '服务事实未满足 Profile');
  }
  if (profile.listeningPorts?.length > 0
    && !portFacts.some((fact) => profile.listeningPorts.includes(fact.port) && fact.protocol === 'tcp')) {
    fail('discovery', '端口事实未满足 Profile');
  }
  for (const path of profile.configPaths ?? []) {
    if (!facts.some((fact) => (fact.kind === 'file_stat' || fact.kind === 'file_content') && samePath(fact.path, path))) {
      fail('discovery', '配置路径未在事实中明确出现');
    }
  }
  if (!facts.some((fact) => (fact.kind === 'file_stat' || fact.kind === 'file_content') && samePath(fact.path, target.path))) {
    fail('discovery', '目标路径未在事实中明确出现');
  }
}

function validateExecutionBinding(value, context, bundle, profile) {
  const binding = record(value, 'executionBinding');
  exactKeys(binding, ['apiVersion', 'workflowVersionId', 'workflowVersion', 'profile', 'pluginVersionId', 'pluginId', 'pluginVersion', 'packageHash', 'manifestHash', 'resourceHash', 'workflowDigest', 'planDigest', 'grantRefs', 'writeEffect'], 'executionBinding');
  if (binding.apiVersion !== BINDING_VERSION) fail('executionBinding.apiVersion', '执行绑定版本无效');
  identifier(binding.workflowVersionId, 'executionBinding.workflowVersionId');
  if (binding.workflowVersion !== PLUGIN_VERSION || binding.profile !== profile.id
    || binding.pluginVersionId !== bundle.fixed.pluginVersionId || binding.pluginId !== PLUGIN_ID || binding.pluginVersion !== PLUGIN_VERSION) {
    fail('executionBinding', 'Workflow、Profile 或 PluginVersion 未固定');
  }
  if (binding.packageHash !== bundle.fixed.packageHash || binding.manifestHash !== bundle.fixed.manifestHash || binding.resourceHash !== bundle.fixed.resourceHash) {
    fail('executionBinding', '包、Manifest 或资源摘要不匹配');
  }
  const workflowPath = workflowPathFor(bundle.manifest, context.capability);
  const workflowDigest = 'sha256:' + sha256Hex(bundle.resources[workflowPath]);
  if (binding.workflowDigest !== workflowDigest) fail('executionBinding.workflowDigest', 'Workflow 摘要不匹配');
  rawDigest(binding.planDigest, 'executionBinding.planDigest');
  if (!Array.isArray(binding.grantRefs) || binding.grantRefs.length === 0 || JSON.stringify(binding.grantRefs) !== JSON.stringify(context.grantRefs)) {
    fail('executionBinding.grantRefs', '执行绑定 Grant 不匹配');
  }
  if (binding.writeEffect !== context.writeEffect) fail('executionBinding.writeEffect', '执行绑定写操作标记不匹配');
  return binding;
}

function validateSecurityShell(value) {
  const security = record(value, 'security');
  for (const field of ['token', 'decision', 'receipt', 'localPolicy', 'fixedDigests']) record(security[field], 'security.' + field);
  identifier(security.nonce, 'security.nonce');
  if (!Array.isArray(security.grantRefs) || security.grantRefs.length === 0) fail('security.grantRefs', '安全材料缺少 Grant');
  return security;
}

function buildPlan(context, input, factEnvelope, profile, target, security, pluginVersionId) {
  const token = security.token;
  const workflowVersionId = input.executionBinding.workflowVersionId;
  const operations = buildOperations(context, input, factEnvelope, profile, target);
  const plan = {
    planVersion: SECURITY_VERSION,
    planId: 'plan-' + sha256Digest({ pluginId: PLUGIN_ID, pluginVersionId, capability: context.capability, factId: factEnvelope.factId, target: target.path, workflowVersionId }).slice(0, 40),
    agentId: factEnvelope.agentId,
    tenantId: factEnvelope.tenantId,
    pluginId: PLUGIN_ID,
    pluginVersionId,
    capability: context.capability,
    operations,
    planDigest: '',
    tokenId: token.tokenId,
    policyDecisionId: security.decision.decisionId,
    nonce: security.nonce,
    expiresAt: token.expiresAt,
    writeEffect: context.writeEffect,
    ...(token.approvalRef ? { approvalRef: token.approvalRef } : {}),
  };
  const { planDigest: _planDigest, tokenId: _tokenId, policyDecisionId: _policyDecisionId, nonce: _nonce, expiresAt: _expiresAt, ...payload } = plan;
  plan.planDigest = sha256Digest(payload);
  return plan;
}

function buildOperations(context, input, factEnvelope, profile, target) {
  const operations = [];
  const add = (operationId, operationType, stage, operationInput, dependsOn = [], compensation) => {
    operations.push({
      operationId,
      operationType,
      stage,
      input: operationInput,
      dependsOn,
      idempotencyKey: 'op-' + sha256Digest({ executionId: context.executionId, executionStepId: context.executionStepId, operationId, factId: factEnvelope.factId }).slice(0, 40),
      timeoutSeconds: 60,
      ...(compensation ? { compensation } : {}),
    });
  };
  if (context.capability === 'application.discover') {
    add('collect-processes', 'process.list', 'prepare', {});
    add('collect-services', 'service.list', 'prepare', {}, ['collect-processes']);
    const paths = [...new Set([...(profile.configPaths ?? []), target.path])];
    paths.forEach((path, index) => add('read-fact-' + (index + 1), 'filesystem.read', 'verify', { path }, ['collect-services']));
    return operations;
  }
  if (context.capability === 'certificate.deploy') {
    const artifactDigest = validateArtifact(input.artifact).digest;
    add('validate-material', 'certificate.material.validate', 'prepare', { path: target.path, artifactDigest });
    add('backup-target', 'filesystem.backup', 'execute', { path: target.path }, ['validate-material'], 'restore-target');
    add('atomic-replace', 'filesystem.atomic_replace', 'execute', { path: target.path, artifactDigest }, ['backup-target'], 'restore-target');
    if (target.serviceName) add('reload-service', 'service.reload', 'verify', { serviceName: target.serviceName }, ['atomic-replace']);
    return operations;
  }
  if (context.capability === 'certificate.verify') {
    const artifactDigest = validateArtifact(input.artifact).digest;
    add('stat-target', 'filesystem.stat', 'prepare', { path: target.path });
    add('validate-material', 'certificate.material.validate', 'verify', { path: target.path, artifactDigest }, ['stat-target']);
    return operations;
  }
  if (context.capability === 'certificate.rollback') {
    if (!target.backupRef) fail('target.backupRef', '回滚缺少固定备份引用');
    add('restore-target', 'filesystem.restore', 'compensate', { path: target.path, backupRef: target.backupRef });
    if (target.serviceName) add('reload-service', 'service.reload', 'verify', { serviceName: target.serviceName }, ['restore-target']);
    return operations;
  }
  fail('capability', '不支持的 Capability');
}

function validateSecurity(value, security, plan, factEnvelope, context, binding, target, bundle) {
  const token = security.token;
  const decision = security.decision;
  const receipt = security.receipt;
  const policy = security.localPolicy;
  const fixed = security.fixedDigests;
  for (const [field, expected] of [
    ['token.pluginId', PLUGIN_ID], ['decision.pluginId', PLUGIN_ID],
    ['token.pluginVersionId', bundle.fixed.pluginVersionId], ['decision.pluginVersionId', bundle.fixed.pluginVersionId],
    ['token.capability', context.capability], ['decision.capability', context.capability],
    ['token.agentId', factEnvelope.agentId], ['decision.agentId', factEnvelope.agentId],
    ['token.tenantId', factEnvelope.tenantId], ['decision.tenantId', factEnvelope.tenantId],
    ['token.planDigest', plan.planDigest], ['decision.planDigest', plan.planDigest],
    ['token.nonce', security.nonce], ['decision.nonce', security.nonce],
    ['token.tokenId', plan.tokenId], ['decision.tokenId', plan.tokenId],
    ['decision.decisionId', plan.policyDecisionId],
  ]) if (readNested(field, token, decision) !== expected) fail(field, '授权材料绑定不匹配');
  if (decision.allowed !== true) fail('decision.allowed', 'Policy Authority 未允许当前计划');
  for (const [name, value] of [['token.signature', token.signature], ['decision.signature', decision.signature], ['token.authorityKeyId', token.authorityKeyId], ['decision.authorityKeyId', decision.authorityKeyId], ['token.policyRef', token.policyRef], ['decision.policyRef', decision.policyRef], ['token.policyVersion', token.policyVersion], ['decision.policyVersion', decision.policyVersion]]) {
    if (typeof value !== 'string' || value.trim() === '' || /default|development|dev-key/i.test(value)) fail(name, '授权材料不是受信任的固定材料');
  }
  if (token.authorityKeyId !== decision.authorityKeyId || !Array.isArray(policy.authorityKeyIds) || !policy.authorityKeyIds.includes(token.authorityKeyId)) {
    fail('authorityKeyId', 'Agent 本地策略不信任授权根');
  }
  if (policy.policyVersion !== SECURITY_VERSION || policy.agentId !== factEnvelope.agentId || policy.disabled === true) fail('localPolicy', 'Agent 本地策略无效或已禁用');
  const planExpiry = Date.parse(plan.expiresAt);
  if (!Number.isFinite(planExpiry) || planExpiry <= Date.parse(context.deadlineAt)) fail('expiresAt', '授权生命周期短于执行截止时间');
  if (security.grantRefs.length !== context.grantRefs.length || security.grantRefs.some((ref, index) => ref !== context.grantRefs[index])) {
    fail('security.grantRefs', '安全材料 Grant 与执行绑定不一致');
  }
  if (fixed.packageHash !== bundle.fixed.packageHash || fixed.manifestHash !== bundle.fixed.manifestHash || fixed.resourceHash !== bundle.fixed.resourceHash) {
    fail('fixedDigests', '固定包摘要与当前 Runner 不匹配');
  }
  if (fixed.factDigest !== factEnvelope.digest || fixed.planDigest !== plan.planDigest || binding.planDigest !== plan.planDigest) {
    fail('fixedDigests', '固定事实或计划摘要不匹配');
  }
  if (receipt.receiptVersion !== SECURITY_VERSION || receipt.status !== 'SUCCESS' || receipt.nonceConsumed !== true
    || receipt.planDigest !== plan.planDigest || receipt.planId !== plan.planId || receipt.agentId !== factEnvelope.agentId
    || receipt.tenantId !== factEnvelope.tenantId || receipt.tokenId !== plan.tokenId || !/^[a-f0-9]{64}$/.test(receipt.digest)
    || receipt.digest !== receiptDigest(receipt)) {
    fail('receipt', 'Agent Receipt 缺失、失败或与当前计划不匹配');
  }
  if (!Array.isArray(token.actions) || !Array.isArray(decision.actions) || !Array.isArray(policy.allowedActions)) fail('actions', '授权动作列表缺失');
  for (const operation of plan.operations) {
    if (!token.actions.includes(operation.operationType) || !decision.actions.includes(operation.operationType) || !policy.allowedActions.includes(operation.operationType)) {
      fail('operations.' + operation.operationId, 'Token、Decision 和本地策略未同时授权 Agent 原语');
    }
    if (operation.input.path && (!isPathAllowed(operation.input.path, token.allowedPaths)
      || !isPathAllowed(operation.input.path, decision.allowedPaths)
      || !isPathAllowedByRules(operation.input.path, policy.pathRules, operation.operationType))) {
      fail('operations.' + operation.operationId + '.input.path', 'Agent 路径超出三层授权范围');
    }
    if (operation.input.serviceName && (!Array.isArray(token.allowedServices) || !token.allowedServices.includes(operation.input.serviceName)
      || !Array.isArray(decision.allowedServices) || !decision.allowedServices.includes(operation.input.serviceName)
      || !Array.isArray(policy.serviceRules) || !policy.serviceRules.includes(operation.input.serviceName))) {
      fail('operations.' + operation.operationId + '.input.serviceName', 'Agent 服务超出三层授权范围');
    }
    if (operation.input.artifactDigest && (!Array.isArray(token.artifactDigests) || !token.artifactDigests.includes(operation.input.artifactDigest)
      || !Array.isArray(decision.artifactDigests) || !decision.artifactDigests.includes(operation.input.artifactDigest))) {
      fail('operations.' + operation.operationId + '.input.artifactDigest', 'Artifact 摘要超出授权范围');
    }
  }
  if (security.nonce !== token.nonce || security.nonce !== decision.nonce) fail('nonce', 'Nonce 绑定不一致');
}

function projectStandardObjects(factEnvelope, profile, target, bundle) {
  const targetKey = factEnvelope.agentId + ':' + stableKey(target.path);
  const applicationStableKey = PLUGIN_ID + ':' + targetKey;
  return [
    {
      apiVersion: 'gcac.application/v1',
      kind: 'Application',
      stableKey: applicationStableKey,
      displayName: target.displayName ?? applicationStableKey,
      productFamily: PLUGIN_ID,
      frameworkType: profile.frameworkType,
      agentId: factEnvelope.agentId,
      tenantId: factEnvelope.tenantId,
      profile: profile.id,
      softwareVersion: target.softwareVersion ?? 'unknown',
      endpoint: {
        address: target.address ?? factEnvelope.agentId,
        port: target.port ?? profile.defaultPort,
      },
      source: {
        factId: factEnvelope.factId,
        factDigest: factEnvelope.digest,
      },
      metadata: {
        configPaths: [...(profile.configPaths ?? [])],
        certificatePath: target.path,
        managementMethod: 'AGENT',
        pluginVersion: bundle.manifest.version,
      },
    },
    {
      apiVersion: 'gcac.certificate-binding/v1',
      kind: 'CertificateBinding',
      stableKey: applicationStableKey + ':tls:' + stableKey(target.path),
      applicationStableKey,
      targetType: 'tls.binding',
      targetKey: target.path,
      certificatePath: target.path,
      ...(target.serviceName ? { serviceName: target.serviceName } : {}),
      port: target.port ?? profile.defaultPort,
      profile: profile.id,
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      source: {
        factId: factEnvelope.factId,
        factDigest: factEnvelope.digest,
      },
    },
  ];
}

function validateArtifact(value) {
  const artifact = record(value, 'artifact');
  exactKeys(artifact, ['artifactRef', 'grantId', 'digest'], 'artifact');
  if (typeof artifact.artifactRef !== 'string' || !/^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(artifact.artifactRef)) fail('artifact.artifactRef', 'Artifact 引用无效');
  identifier(artifact.grantId, 'artifact.grantId');
  rawDigest(artifact.digest, 'artifact.digest');
  return artifact;
}

function workflowPathFor(manifest, capability) {
  const path = manifest.resources?.workflows?.[capability];
  if (typeof path !== 'string') fail('resources.workflows', '缺少 Capability Workflow');
  return path;
}

function receiptDigest(receipt) {
  const { digest: _digest, signature: _signature, ...payload } = receipt;
  return sha256Digest(payload);
}

function readNested(field, token, decision) {
  if (field.startsWith('token.')) return token[field.slice(6)];
  if (field.startsWith('decision.')) return decision[field.slice(9)];
  return undefined;
}

function isPathAllowed(path, allowed) {
  if (!Array.isArray(allowed)) return false;
  return allowed.some((prefix) => typeof prefix === 'string' && pathWithin(path, prefix));
}

function isPathAllowedByRules(path, rules, operationType) {
  if (!Array.isArray(rules)) return false;
  const prefixes = rules.filter((rule) => Array.isArray(rule.operations) && rule.operations.includes(operationType)).map((rule) => rule.prefix);
  return isPathAllowed(path, prefixes);
}

function pathWithin(path, prefix) {
  const left = normalizePath(path).toLowerCase();
  const right = normalizePath(prefix).replace(/[\\/]+$/, '').toLowerCase();
  return left === right || left.startsWith(right + '\\\\') || left.startsWith(right + '/');
}

function stableKey(value) {
  return sha256Digest(value).slice(0, 32);
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON 不支持非有限数字');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  throw new Error('Canonical JSON 不支持 undefined 或函数');
}

function sha256Digest(value) {
  return sha256Hex(canonicalJson(value));
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function parseJson(value, path) {
  try { return JSON.parse(value); } catch { fail(path, 'JSON 资源无效'); }
}

function readJson(path) {
  return parseJson(readFileSync(path, 'utf8'), path);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  return value;
}

function exactKeys(value, keys, path) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) fail(path, '包含未知字段');
}

function identifier(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) fail(path, '必须是固定标识符');
  return value;
}

function positiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) fail(path, '必须是正整数');
}

function rawDigest(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(path, '必须是 SHA-256 摘要');
}

function dateTime(value, path) {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) fail(path, '必须是 ISO 时间');
}

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes(String.fromCharCode(0))) fail('path', '路径不能为空');
  const raw = value.replaceAll('\\', '/');
  if (raw.includes('..')) fail('path', '路径不能包含 ..');
  if (raw.startsWith('/')) return raw.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (!/^[A-Za-z]:\//.test(raw) && !raw.startsWith('//')) fail('path', '必须是规范化绝对路径');
  return raw.replace(/\/+/g, '/').replace(/\/$/, '');
}

function absolutePath(value, path) {
  normalizePath(value);
  if (typeof value !== 'string') fail(path, '必须是规范化绝对路径');
}

function samePath(left, right) {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase();
}

function fail(path, message) {
  throw new Error('插件 ' + PLUGIN_ID + ' 合同失败：' + message + '（' + path + '）');
}
