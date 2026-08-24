import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { PluginRunnerClient } from '../../../backend/dist/modules/plugins/runner/plugin-runner-client.js';

const packageRoot = resolve(process.cwd(), 'backend/src/modules/plugins/builtin-plugins');
const runnerServer = resolve(process.cwd(), 'backend/dist/modules/plugins/runner/runner-server.js');
const securityVersion = 'gcac.agent-security/v1';
const bindingVersion = 'gcac.plugin-runner-binding/v1';
const pluginVersion = '1.0.0';
const hashPattern = /^sha256:[a-f0-9]{64}$/;

const packages = [
  { directory: 'web-nginx', pluginId: 'web.nginx', profile: 'linux.agent_plan.pem', fixture: 'web-nginx-linux.json', targetPath: '/etc/nginx/tls/server.pem' },
  { directory: 'web-apache', pluginId: 'web.apache', profile: 'windows.agent_plan.pem', fixture: 'web-apache-windows.json', targetPath: 'C:/Apache24/conf/certs/server.pem' },
  { directory: 'app-tomcat', pluginId: 'app.tomcat', profile: 'linux.agent_plan.pkcs12', fixture: 'app-tomcat-linux.json', targetPath: '/opt/tomcat/conf/keystore.p12' },
  { directory: 'app-java-keystore', pluginId: 'app.java-keystore', profile: 'cross-platform.agent_plan.pkcs12', fixture: 'app-java-keystore-linux.json', targetPath: '/opt/java-app/conf/keystore.p12' },
  { directory: 'app-rabbitmq', pluginId: 'app.rabbitmq', profile: 'linux.agent_plan.pem', fixture: 'app-rabbitmq-linux.json', targetPath: '/etc/rabbitmq/tls/server.pem' },
  { directory: 'app-service-certificate-file', pluginId: 'app.service-certificate-file', profile: 'windows.agent_plan.file', fixture: 'app-service-certificate-file-windows.json', targetPath: 'C:/ProgramData/GCAC/certificates/service.pem' },
];

function sha256(value) {
  return 'sha256:' + createHash('sha256').update(value, 'utf8').digest('hex');
}

function rawSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
    return '{' + Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  throw new Error('Canonical JSON 不支持 undefined 或函数');
}

function digest(value) {
  return rawSha256(canonicalJson(value));
}

function readPackage(pkg) {
  const directory = resolve(packageRoot, pkg.directory);
  const manifestText = readFileSync(resolve(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const paths = [];
  for (const [key, value] of Object.entries(manifest.resources ?? {})) {
    if (key === 'runtimeEntrypoint' && typeof value === 'string') paths.push(value);
    else if (value && typeof value === 'object') paths.push(...Object.values(value));
  }
  const resourcePaths = [...new Set(paths)].sort();
  const resources = Object.fromEntries(resourcePaths.map((path) => [path, readFileSync(resolve(directory, path), 'utf8')]));
  const resourceSha256 = Object.fromEntries(resourcePaths.map((path) => [path, sha256(resources[path])]));
  const packageContent = JSON.stringify({ directory: basename(directory), manifest, resources });
  return {
    ...pkg,
    directory,
    manifest,
    resources,
    resourceSha256,
    packageHash: sha256(packageContent),
    manifestHash: sha256(JSON.stringify(manifest)),
    resourceHash: sha256(JSON.stringify(resourceSha256)),
    runtimePath: resolve(directory, 'runtime/index.js'),
  };
}

function fixedEnvironment(pkg) {
  return {
    GCAC_PLUGIN_VERSION_ID: 'dev.' + basename(pkg.directory) + '.1.0.0',
    GCAC_PLUGIN_PACKAGE_HASH: pkg.packageHash,
    GCAC_PLUGIN_MANIFEST_HASH: pkg.manifestHash,
    GCAC_PLUGIN_RESOURCE_HASH: pkg.resourceHash,
  };
}

function operationIdempotency(executionId, executionStepId, operationId, factId) {
  return 'op-' + digest({ executionId, executionStepId, operationId, factId }).slice(0, 40);
}

function buildDiscoverPlan(pkg, fixture, binding) {
  const profileDocument = JSON.parse(readFileSync(resolve(pkg.directory, 'discovery/profiles.json'), 'utf8'));
  const profile = profileDocument.profiles.find((item) => item.id === pkg.profile);
  if (!profile) throw new Error('Fixture Profile 不存在：' + pkg.profile);
  const operations = [
    {
      operationId: 'collect-processes',
      operationType: 'process.list',
      stage: 'prepare',
      input: {},
      dependsOn: [],
      idempotencyKey: operationIdempotency('execution-web-nginx-discover', 'step-web-nginx-discover', 'collect-processes', fixture.factId),
      timeoutSeconds: 60,
    },
    {
      operationId: 'collect-services',
      operationType: 'service.list',
      stage: 'prepare',
      input: {},
      dependsOn: ['collect-processes'],
      idempotencyKey: operationIdempotency('execution-web-nginx-discover', 'step-web-nginx-discover', 'collect-services', fixture.factId),
      timeoutSeconds: 60,
    },
  ];
  const paths = [...new Set([...(profile.configPaths ?? []), pkg.targetPath])];
  paths.forEach((path, index) => operations.push({
    operationId: 'read-fact-' + (index + 1),
    operationType: 'filesystem.read',
    stage: 'verify',
    input: { path },
    dependsOn: ['collect-services'],
    idempotencyKey: operationIdempotency('execution-web-nginx-discover', 'step-web-nginx-discover', 'read-fact-' + (index + 1), fixture.factId),
    timeoutSeconds: 60,
  }));
  const tokenId = 'token-web-nginx-discover';
  const nonce = 'nonce-web-nginx-discover';
  const planId = 'plan-' + digest({
    pluginId: pkg.pluginId,
    pluginVersionId: binding.pluginVersionId,
    capability: 'application.discover',
    factId: fixture.factId,
    target: pkg.targetPath,
    workflowVersionId: binding.workflowVersionId,
  }).slice(0, 40);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const plan = {
    planVersion: securityVersion,
    planId,
    agentId: fixture.agentId,
    tenantId: fixture.tenantId,
    pluginId: pkg.pluginId,
    pluginVersionId: binding.pluginVersionId,
    capability: 'application.discover',
    operations,
    planDigest: '',
    tokenId,
    policyDecisionId: 'decision-web-nginx-discover',
    nonce,
    expiresAt,
    writeEffect: false,
  };
  const { planDigest: _planDigest, tokenId: _tokenId, policyDecisionId: _decisionId, nonce: _nonce, expiresAt: _expiresAt, ...payload } = plan;
  plan.planDigest = digest(payload);
  return { plan, tokenId, nonce, expiresAt };
}

function buildSecurity(pkg, fixture, binding, planData) {
  const operationTypes = ['process.list', 'service.list', 'filesystem.read'];
  const allowedPaths = pkg.targetPath.startsWith('/') ? ['/etc/nginx'] : ['C:/Apache24'];
  const token = {
    pluginId: pkg.pluginId,
    pluginVersionId: binding.pluginVersionId,
    capability: 'application.discover',
    agentId: fixture.agentId,
    tenantId: fixture.tenantId,
    planDigest: planData.plan.planDigest,
    nonce: planData.nonce,
    tokenId: planData.tokenId,
    expiresAt: planData.expiresAt,
    signature: 'fixture-authority-signature',
    authorityKeyId: 'fixture-authority-key',
    policyRef: 'fixture-policy-v2',
    policyVersion: securityVersion,
    actions: operationTypes,
    allowedPaths,
  };
  const decision = {
    decisionId: planData.plan.policyDecisionId,
    allowed: true,
    pluginId: pkg.pluginId,
    pluginVersionId: binding.pluginVersionId,
    capability: 'application.discover',
    agentId: fixture.agentId,
    tenantId: fixture.tenantId,
    planDigest: planData.plan.planDigest,
    nonce: planData.nonce,
    tokenId: planData.tokenId,
    signature: 'fixture-decision-signature',
    authorityKeyId: 'fixture-authority-key',
    policyRef: 'fixture-policy-v2',
    policyVersion: securityVersion,
    actions: operationTypes,
    allowedPaths,
  };
  const receiptPayload = {
    receiptVersion: securityVersion,
    status: 'SUCCESS',
    nonceConsumed: true,
    planDigest: planData.plan.planDigest,
    planId: planData.plan.planId,
    agentId: fixture.agentId,
    tenantId: fixture.tenantId,
    tokenId: planData.tokenId,
  };
  const receipt = {
    ...receiptPayload,
    digest: digest(receiptPayload),
    signature: 'fixture-receipt-signature',
  };
  return {
    nonce: planData.nonce,
    grantRefs: [...binding.grantRefs],
    token,
    decision,
    receipt,
    localPolicy: {
      policyVersion: securityVersion,
      agentId: fixture.agentId,
      disabled: false,
      authorityKeyIds: ['fixture-authority-key'],
      allowedActions: operationTypes,
      pathRules: [{
        prefix: allowedPaths[0],
        operations: ['filesystem.read'],
      }],
      serviceRules: [],
    },
    fixedDigests: {
      packageHash: binding.packageHash,
      manifestHash: binding.manifestHash,
      resourceHash: binding.resourceHash,
      factDigest: fixture.digest,
      planDigest: planData.plan.planDigest,
    },
  };
}

function executionInput(pkg) {
  const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'compatibility/fixtures/web-app', pkg.fixture), 'utf8'));
  const binding = {
    apiVersion: bindingVersion,
    workflowVersionId: 'workflow.' + basename(pkg.directory) + '.application.discover.1.0.0',
    workflowVersion: pluginVersion,
    profile: pkg.profile,
    pluginVersionId: fixedEnvironment(pkg).GCAC_PLUGIN_VERSION_ID,
    pluginId: pkg.pluginId,
    pluginVersion,
    packageHash: pkg.packageHash,
    manifestHash: pkg.manifestHash,
    resourceHash: pkg.resourceHash,
    workflowDigest: sha256(pkg.resources['workflows/discover.json']),
    planDigest: '0'.repeat(64),
    grantRefs: ['grant.agent.fact'],
    writeEffect: false,
  };
  const planData = buildDiscoverPlan(pkg, fixture, binding);
  binding.planDigest = planData.plan.planDigest;
  const input = {
    factEnvelope: fixture,
    profile: pkg.profile,
    target: {
      path: pkg.targetPath,
      ...(pkg.pluginId === 'web.nginx' ? { serviceName: 'nginx' } : {}),
      port: 443,
      displayName: pkg.pluginId,
    },
    executionBinding: binding,
    security: buildSecurity(pkg, fixture, binding, planData),
  };
  return { fixture, binding, input };
}

function clientSpec(pkg) {
  const environment = fixedEnvironment(pkg);
  return {
    pluginVersionId: environment.GCAC_PLUGIN_VERSION_ID,
    pluginId: pkg.pluginId,
    pluginVersion,
    tenantId: 'tenant-fixture',
    executablePath: process.execPath,
    args: [runnerServer, '--executor-module', pkg.runtimePath],
    workingDirectory: process.cwd(),
    environment,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    startupTimeoutMs: 5000,
    helloTimeoutMs: 2000,
    executeTimeoutMs: 10_000,
    capabilities: pkg.manifest.capabilities.map((item) => item.key),
    hostPermissions: pkg.manifest.permissions,
    packageHash: pkg.packageHash,
    resourceHash: pkg.resourceHash,
    manifestHash: pkg.manifestHash,
  };
}

const loadedPackages = packages.map(readPackage);

test('六个 Web/App runtime 只由真实 Runner 子进程加载并完成固定握手', async () => {
  for (const pkg of loadedPackages) {
    const module = await import(pathToFileURL(pkg.runtimePath).href + '?batch=p2-web-app');
    assert.equal(typeof module.createPluginRunnerExecutor, 'function');
    const saved = { ...process.env };
    Object.assign(process.env, fixedEnvironment(pkg));
    const executor = module.createPluginRunnerExecutor();
    for (const name of Object.keys(fixedEnvironment(pkg))) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    assert.equal(executor.descriptor.pluginId, pkg.pluginId);
    assert.equal(executor.descriptor.pluginVersion, pluginVersion);
    assert.equal(executor.descriptor.packageHash, pkg.packageHash);
    assert.equal(Object.keys(module).sort().join(','), 'createPluginRunnerExecutor');

    const client = new PluginRunnerClient(clientSpec(pkg));
    try {
      await client.start();
      assert.equal(client.state, 'READY');
    } finally {
      if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
      else await client.stop(true);
    }
  }
});

test('web.nginx application.discover 通过真实 Runner 返回标准对象和授权计划结果', async () => {
  const pkg = loadedPackages.find((item) => item.pluginId === 'web.nginx');
  const execution = executionInput(pkg);
  const client = new PluginRunnerClient({
    ...clientSpec(pkg),
    hostApiHandler: async () => ({ ok: true, data: { redacted: true } }),
  });
  try {
    await client.start();
    const result = await client.execute({
      tenantId: execution.fixture.tenantId,
      executionId: 'execution-web-nginx-discover',
      executionStepId: 'step-web-nginx-discover',
      workflowVersionId: execution.binding.workflowVersionId,
      planDigest: execution.binding.planDigest,
      capability: 'application.discover',
      input: execution.input,
      grantRefs: execution.binding.grantRefs,
      idempotencyKey: 'idempotency-web-nginx-discover',
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      writeEffect: false,
    });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.success, true);
    assert.equal(result.summary.pluginId, pkg.pluginId);
    assert.equal(result.summary.workflowVersion, pluginVersion);
    assert.equal(result.summary.operationResults.length, 4);
    assert.deepEqual(result.normalizedObjects.map((item) => item.kind), ['Application', 'CertificateBinding']);
    assert.equal(result.normalizedObjects[0].metadata.managementMethod, 'AGENT');
    assert.equal(result.normalizedObjects[0].productFamily, pkg.pluginId);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('runtime 缺少主适配器四份固定绑定或安全材料时失败关闭', async () => {
  const pkg = loadedPackages[0];
  const module = await import(pathToFileURL(pkg.runtimePath).href + '?batch=p2-web-app-negative');
  const saved = { ...process.env };
  for (const name of Object.keys(fixedEnvironment(pkg))) delete process.env[name];
  assert.throws(() => module.createPluginRunnerExecutor(), /缺少主适配器注入的固定 PluginVersion 摘要/);
  Object.assign(process.env, fixedEnvironment(pkg));
  const executor = module.createPluginRunnerExecutor();
  await assert.rejects(executor.execute({
    pluginVersionId: executor.descriptor.pluginVersionId,
    pluginId: pkg.pluginId,
    pluginVersion,
    tenantId: 'tenant-fixture',
    executionId: 'execution-negative',
    executionStepId: 'step-negative',
    capability: 'application.discover',
    input: {},
    grantRefs: ['grant.agent.fact'],
    idempotencyKey: 'idempotency-negative',
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    writeEffect: false,
    signal: new AbortController().signal,
  }, { call: async () => ({}) }), /插件 .*合同失败/);
  for (const name of Object.keys(fixedEnvironment(pkg))) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
