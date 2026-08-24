import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { PluginRunnerClient } from '../../../backend/dist/modules/plugins/runner/plugin-runner-client.js';

const packageRoot = resolve(process.cwd(), 'backend/src/modules/plugins/builtin-plugins');
const runnerServer = resolve(process.cwd(), 'backend/dist/modules/plugins/runner/runner-server.js');
const securityVersion = 'gcac.agent-security/v1';
const bindingVersion = 'gcac.plugin-runner-binding/v1';
const hashPattern = /^sha256:[a-f0-9]{64}$/;

const packages = [
  { directory: 'web-nginx', pluginId: 'web.nginx', profile: 'linux.agent_plan.pem', fixture: 'web-nginx-linux.json', failureFixture: 'web-nginx-target-missing.json', targetPath: '/etc/nginx/tls/server.pem', allowedPath: '/etc/nginx', serviceName: 'nginx' },
  { directory: 'web-apache', pluginId: 'web.apache', profile: 'windows.agent_plan.pem', fixture: 'web-apache-windows.json', failureFixture: 'web-apache-target-missing.json', targetPath: 'C:/Apache24/conf/certs/server.pem', allowedPath: 'C:/Apache24', serviceName: 'Apache2.4' },
  { directory: 'app-tomcat', pluginId: 'app.tomcat', profile: 'linux.agent_plan.pkcs12', fixture: 'app-tomcat-linux.json', failureFixture: 'app-tomcat-target-missing.json', targetPath: '/opt/tomcat/conf/keystore.p12', allowedPath: '/opt/tomcat', serviceName: 'tomcat' },
  { directory: 'app-java-keystore', pluginId: 'app.java-keystore', profile: 'cross-platform.agent_plan.pkcs12', fixture: 'app-java-keystore-linux.json', failureFixture: 'app-java-keystore-target-missing.json', targetPath: '/opt/java-app/conf/keystore.p12', allowedPath: '/opt/java-app' },
  { directory: 'app-rabbitmq', pluginId: 'app.rabbitmq', profile: 'linux.agent_plan.pem', fixture: 'app-rabbitmq-linux.json', failureFixture: 'app-rabbitmq-target-missing.json', targetPath: '/etc/rabbitmq/tls/server.pem', allowedPath: '/etc/rabbitmq', serviceName: 'rabbitmq-server' },
  { directory: 'app-service-certificate-file', pluginId: 'app.service-certificate-file', profile: 'windows.agent_plan.file', fixture: 'app-service-certificate-file-windows.json', failureFixture: 'app-service-certificate-file-target-missing.json', targetPath: 'C:/ProgramData/GCAC/certificates/service.pem', allowedPath: 'C:/ProgramData/GCAC', serviceName: 'gcac-certificate-service' },
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
    workflowVersion: JSON.parse(resources['workflows/discover.json']).metadata.version,
    resourceSha256,
    packageHash: sha256(packageContent),
    manifestHash: sha256(JSON.stringify(manifest)),
    resourceHash: sha256(JSON.stringify(resourceSha256)),
    runtimePath: resolve(directory, 'runtime/index.js'),
  };
}

function fixedEnvironment(pkg) {
  return {
    GCAC_PLUGIN_VERSION_ID: 'dev.' + basename(pkg.directory) + '.' + pkg.manifest.version,
    GCAC_PLUGIN_PACKAGE_HASH: pkg.packageHash,
    GCAC_PLUGIN_MANIFEST_HASH: pkg.manifestHash,
    GCAC_PLUGIN_RESOURCE_HASH: pkg.resourceHash,
  };
}

function packageKey(pkg) {
  return basename(pkg.directory);
}

function operationIdempotency(executionId, executionStepId, operationId, factId) {
  return 'op-' + digest({ executionId, executionStepId, operationId, factId }).slice(0, 40);
}

function buildDiscoverPlan(pkg, fixture, binding, executionId, executionStepId) {
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
      idempotencyKey: operationIdempotency(executionId, executionStepId, 'collect-processes', fixture.factId),
      timeoutSeconds: 60,
    },
    {
      operationId: 'collect-services',
      operationType: 'service.list',
      stage: 'prepare',
      input: {},
      dependsOn: ['collect-processes'],
      idempotencyKey: operationIdempotency(executionId, executionStepId, 'collect-services', fixture.factId),
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
    idempotencyKey: operationIdempotency(executionId, executionStepId, 'read-fact-' + (index + 1), fixture.factId),
    timeoutSeconds: 60,
  }));
  const tokenId = 'token-' + packageKey(pkg) + '-discover';
  const nonce = 'nonce-' + packageKey(pkg) + '-discover';
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
    policyDecisionId: 'decision-' + packageKey(pkg) + '-discover',
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
  const allowedPaths = [pkg.allowedPath];
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

function executionInput(pkg, fixtureName = pkg.fixture) {
  const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'compatibility/fixtures/web-app', fixtureName), 'utf8'));
  const executionId = 'execution-' + packageKey(pkg) + '-discover';
  const executionStepId = 'step-' + packageKey(pkg) + '-discover';
  const binding = {
    apiVersion: bindingVersion,
    workflowVersionId: 'workflow.' + basename(pkg.directory) + '.application.discover.' + pkg.workflowVersion,
    workflowVersion: pkg.manifest.version,
    profile: pkg.profile,
    pluginVersionId: fixedEnvironment(pkg).GCAC_PLUGIN_VERSION_ID,
    pluginId: pkg.pluginId,
    pluginVersion: pkg.manifest.version,
    packageHash: pkg.packageHash,
    manifestHash: pkg.manifestHash,
    resourceHash: pkg.resourceHash,
    workflowDigest: sha256(pkg.resources['workflows/discover.json']),
    planDigest: '0'.repeat(64),
    grantRefs: ['grant.agent.fact'],
    writeEffect: false,
  };
  const planData = buildDiscoverPlan(pkg, fixture, binding, executionId, executionStepId);
  binding.planDigest = planData.plan.planDigest;
  const input = {
    factEnvelope: fixture,
    profile: pkg.profile,
    target: {
      path: pkg.targetPath,
      ...(pkg.serviceName ? { serviceName: pkg.serviceName } : {}),
      port: 443,
      displayName: pkg.pluginId,
    },
    executionBinding: binding,
    security: buildSecurity(pkg, fixture, binding, planData),
  };
  return { fixture, binding, input };
}

function clientSpec(pkg, environment = fixedEnvironment(pkg)) {
  return {
    pluginVersionId: environment.GCAC_PLUGIN_VERSION_ID,
    pluginId: pkg.pluginId,
    pluginVersion: pkg.manifest.version,
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
for (const pkg of loadedPackages) {
  test(`${pkg.pluginId} 缺少固定摘要时真实 Runner 子进程失败关闭`, async () => {
    const environment = fixedEnvironment(pkg);
    delete environment.GCAC_PLUGIN_RESOURCE_HASH;
    const client = new PluginRunnerClient(clientSpec(pkg, environment));
    await assert.rejects(() => client.start(), (error) => {
      assert.match(String(error), /Runner|PLUGIN_RUNNER/);
      return true;
    });
    assert.equal(client.state, 'CRASHED');
    await client.stop(true);
  });

  test(`${pkg.pluginId} 目标缺失 Fixture 在真实 Runner 中失败关闭且写操作进入 UNKNOWN`, async () => {
    const execution = executionInput(pkg, pkg.failureFixture);
    const client = new PluginRunnerClient(clientSpec(pkg));
    try {
      await client.start();
      const failed = await client.execute({
        tenantId: execution.fixture.tenantId,
        executionId: 'execution-' + packageKey(pkg) + '-target-missing-read',
        executionStepId: 'step-' + packageKey(pkg) + '-target-missing-read',
        workflowVersionId: execution.binding.workflowVersionId,
        planDigest: execution.binding.planDigest,
        capability: 'application.discover',
        input: execution.input,
        grantRefs: execution.binding.grantRefs,
        idempotencyKey: 'idempotency-' + packageKey(pkg) + '-target-missing-read',
        deadlineAt: new Date(Date.now() + 5_000).toISOString(),
        writeEffect: false,
      });
      assert.equal(failed.status, 'FAILED', JSON.stringify(failed));
      assert.equal(failed.success, false);
      assert.equal(failed.error.code, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
      assert.match(failed.error.message, /目标路径必须来自 Agent 文件事实且存在/);

      const unknown = await client.execute({
        tenantId: execution.fixture.tenantId,
        executionId: 'execution-' + packageKey(pkg) + '-target-missing-write',
        executionStepId: 'step-' + packageKey(pkg) + '-target-missing-write',
        workflowVersionId: execution.binding.workflowVersionId,
        planDigest: execution.binding.planDigest,
        capability: 'certificate.deploy',
        input: execution.input,
        grantRefs: execution.binding.grantRefs,
        idempotencyKey: 'idempotency-' + packageKey(pkg) + '-target-missing-write',
        deadlineAt: new Date(Date.now() + 5_000).toISOString(),
        writeEffect: true,
      });
      assert.equal(unknown.status, 'UNKNOWN', JSON.stringify(unknown));
      assert.equal(unknown.success, false);
      assert.equal(unknown.error.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
      assert.equal(unknown.error.mayBeUnknown, true);
    } finally {
      if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
      else await client.stop(true);
    }
  });
}

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
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(result.success, true);
    assert.equal(result.summary.pluginId, pkg.pluginId);
    assert.equal(result.summary.workflowVersion, pkg.manifest.version);
    assert.equal(result.summary.operationResults.length, 4);
    assert.deepEqual(result.normalizedObjects.map((item) => item.kind), ['Application', 'CertificateBinding']);
    assert.equal(result.normalizedObjects[0].metadata.managementMethod, 'AGENT');
    assert.equal(result.normalizedObjects[0].productFamily, pkg.pluginId);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});
