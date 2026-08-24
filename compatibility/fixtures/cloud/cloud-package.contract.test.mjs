import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../..');
const packageRoot = join(repositoryRoot, 'backend/src/modules/plugins/builtin-plugins');
const runnerFixture = join(testDirectory, 'cloud-runner.mjs');
const packageCases = [
  ['cloud-aliyun', 'cloud.aliyun', 'aliyun'],
  ['cloud-tencent', 'cloud.tencent', 'tencent'],
  ['cloud-huawei', 'cloud.huawei', 'huawei'],
  ['cloud-volcengine', 'cloud.volcengine', 'volcengine'],
];
const publicManifestKeys = [
  'apiVersion', 'kind', 'pluginId', 'version', 'displayNameKey', 'descriptionKey', 'defaultLocale', 'publisher',
  'runtime', 'source', 'scope', 'trust', 'support', 'capabilities', 'permissions', 'compatibility', 'resources',
];
const publicResourceKeys = ['runtimeEntrypoint', 'workflows', 'forms', 'presentations', 'discoveryMappings', 'locales'];

test('四个 Cloud 包由真实 Runner 子进程执行，并对缺失授权和失败 Fixture 失败关闭', async () => {
  for (const [directory, pluginId, provider] of packageCases) {
    const packageDirectory = join(packageRoot, directory);
    const manifest = readJson(join(packageDirectory, 'manifest.json'));
    const deployFailureFixture = readJson(join(packageDirectory, 'fixtures', 'deploy-failure.json'));
    assert.equal(manifest.apiVersion, 'gcac.plugin-manifest/v1');
    assert.equal(manifest.kind, 'GcacPlugin');
    assert.equal(manifest.pluginId, pluginId);
    assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
    assert.equal(manifest.runtime, 'WORKFLOW_DSL');
    assert.deepEqual(Object.keys(manifest).sort(), [...publicManifestKeys].sort(), `${pluginId} 含公共 Schema 未允许的 Manifest 字段`);
    assert.deepEqual(Object.keys(manifest.resources).sort(), [...publicResourceKeys].sort(), `${pluginId} 含公共 Schema 未允许的资源字段`);
    assert.equal(manifest.resources.runtimeEntrypoint, 'runtime/index.js');
    assert.ok(manifest.resources.workflows);
    assert.equal(Object.hasOwn(manifest.resources, 'agentPlans'), false, `${pluginId} 不得声明 Agent Plan`);
    for (const forbidden of ['executionMode', 'ipcProtocol', 'providerKey', 'hostApiGrants', 'readOnly']) assert.equal(Object.hasOwn(manifest, forbidden), false, `${pluginId} 含旧 Manifest 字段 ${forbidden}`);
    assert.deepEqual(Object.keys(manifest.resources.workflows).sort(), manifest.capabilities.map((item) => item.key).sort(), `${pluginId} Capability 与 Workflow 未一一绑定`);
    for (const directoryName of ['runtime', 'workflows', 'discovery', 'locales', 'presentations', 'fixtures']) assert.equal(existsSync(join(packageDirectory, directoryName)), true, `${pluginId} 缺少 ${directoryName} 目录`);
    assert.equal(Number.isInteger(deployFailureFixture.statusCode), true, `${pluginId} deploy-failure Fixture 缺少 HTTP 状态码`);
    assert.equal(deployFailureFixture.statusCode >= 400 && deployFailureFixture.statusCode <= 599, true, `${pluginId} deploy-failure Fixture 必须描述失败响应`);
    assert.equal(deployFailureFixture.body?.status, 'FAILED', `${pluginId} deploy-failure Fixture 必须描述失败状态`);
    assert.equal(typeof deployFailureFixture.body?.code, 'string', `${pluginId} deploy-failure Fixture 缺少厂商失败码`);
    const digest = packageDigest(packageDirectory, manifest);
    const result = await runChild({ packageDirectory, manifest, pluginId, provider, digest });
    assert.equal(result.hello.accepted, true, `${pluginId} Runner 握手失败`);
    assert.equal(result.hello.pluginId, pluginId);
    assert.equal(result.hello.pluginVersion, manifest.version);
    assert.equal(result.hello.packageHash, digest.packageHash);
    assert.equal(result.hello.manifestHash, digest.manifestHash);
    assert.equal(result.hello.resourceHash, digest.resourceHash);
    assert.equal(result.connection.status, 'SUCCESS');
    assert.equal(result.connection.summary.signatureVerified, true);
    assert.equal(result.discovery.status, 'SUCCESS');
    const cloudResource = result.discovery.normalizedObjects[0];
    assert.equal(cloudResource?.apiVersion, 'gcac.cloud-service/v1');
    assert.equal(cloudResource?.kind, 'CloudServiceResource');
    assert.equal(cloudResource?.stableKey, `${pluginId}:${cloudResource?.resourceType}:${cloudResource?.resourceId}`);
    assert.equal(cloudResource?.pluginId, pluginId);
    assert.equal(cloudResource?.pluginVersionId, `${pluginId}:${manifest.version}`);
    assert.equal(cloudResource?.provider, provider);
    assert.equal(Object.hasOwn(cloudResource ?? {}, 'objectType'), false);
    assert.equal(result.deploy.status, 'SUCCESS');
    assert.equal(result.authorizationDenied.success, false, `${pluginId} 缺失 Receipt 不得成功`);
    assert.equal(result.authorizationDenied.status, 'FAILED', `${pluginId} 缺失 Receipt 必须失败关闭`);
    assert.equal(result.authorizationDenied.error?.code, 'CLOUD_CONTRACT_DENIED', `${pluginId} 缺失 Grant 必须拒绝执行合同`);
    assert.equal(result.authorizationDenied.error?.mayBeUnknown, false, `${pluginId} 缺失 Grant 不得产生写入不确定性`);
    assert.equal(result.authorizationDenied.error?.secretRedacted, true, `${pluginId} 缺失 Grant 错误不得泄露密钥`);
    assert.equal(result.deployUnknown.status, 'UNKNOWN');
    assert.equal(result.deployFailure.success, false, `${pluginId} Fixture 写失败不得被报告为成功`);
    assert.equal(result.deployFailure.status, 'UNKNOWN');
    assert.equal(result.deployFailure.error?.code, 'CLOUD_OPERATION_REJECTED', `${pluginId} 必须消费 deploy-failure Fixture 的厂商拒绝响应`);
    assert.equal(result.deployFailure.error?.mayBeUnknown, false, `${pluginId} 厂商拒绝本身不得伪装为已确认结果`);
    assert.equal(result.deployFailure.error?.secretRedacted, true, `${pluginId} Fixture 失败错误不得泄露密钥`);
    assert.equal(result.rollback.status, 'SUCCESS');
  }
});

test('四个 Cloud 工厂缺少主适配器摘要时失败关闭', () => {
  for (const [directory, pluginId] of packageCases) {
    const runtime = join(packageRoot, directory, 'runtime/index.js');
    const script = `import(${JSON.stringify(runtime.replaceAll('\\', '/'))}).then((m) => m.createPluginRunnerExecutor()).then(() => process.exit(0)).catch(() => process.exit(7));`;
    const environment = { ...process.env };
    delete environment.GCAC_PLUGIN_VERSION_ID;
    delete environment.GCAC_PLUGIN_PACKAGE_HASH;
    delete environment.GCAC_PLUGIN_MANIFEST_HASH;
    delete environment.GCAC_PLUGIN_RESOURCE_HASH;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: repositoryRoot, env: environment, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0, `${pluginId} 缺少摘要仍可创建工厂`);
  }
});

async function runChild({ packageDirectory, manifest, pluginId, provider, digest }) {
  const versionId = `${pluginId}:${manifest.version}`;
  const capabilities = manifest.capabilities.map((item) => item.key);
  const permissions = [...manifest.permissions];
  const child = spawn(process.execPath, [runnerFixture, '--executor-module', join(packageDirectory, 'runtime/index.js'), '--plugin-id', pluginId, '--plugin-version-id', versionId, '--plugin-version', manifest.version, '--package-hash', digest.packageHash, '--manifest-hash', digest.manifestHash, '--resource-hash', digest.resourceHash], { cwd: repositoryRoot, env: { ...process.env, NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const reader = createReader(child);
  const helloRequest = {
    protocolVersion: 'gcac.plugin-runner/v1', messageType: 'hello', requestId: `hello-${provider}`, sentAt: '2026-08-11T00:00:00.000Z', pluginVersionId: versionId, pluginId, pluginVersion: manifest.version, tenantId: 'tenant-fixture', runner: { pid: 1, sdkVersion: 'fixture-1.0.0', runnerVersion: 'fixture-1.0.0' }, capabilities, permissions, packageHash: digest.packageHash, resourceHash: digest.resourceHash, manifestHash: digest.manifestHash,
  };
  child.stdin.write(`${JSON.stringify(helloRequest)}\n`);
  const hello = await reader.next();
  const baseInput = {
    cloudServiceRef: `cloud-service://${provider}`,
    credential: { grantId: 'cloud-credential', secretRef: `secret://fixture/${provider}` },
    security: { tokenRef: 'token://fixture', decisionRef: 'decision://fixture', nonce: 'nonce-fixture', receiptRef: 'receipt://fixture', localPolicyRef: 'policy://fixture', grantRef: 'cloud-credential', packageHash: digest.packageHash, manifestHash: digest.manifestHash, resourceHash: digest.resourceHash },
  };
  const execute = async (capability, request, writeEffect, suffix, extra = {}, grantRefs = ['cloud-credential']) => {
    const requestId = `execute-${provider}-${suffix}`;
    child.stdin.write(`${JSON.stringify({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute', requestId, sentAt: '2026-08-11T00:00:01.000Z', pluginVersionId: versionId, tenantId: 'tenant-fixture', executionId: `execution-${suffix}`, executionStepId: `step-${suffix}`, capability, input: { ...baseInput, ...extra, request }, grantRefs, idempotencyKey: `idempotency-${suffix}`, deadlineAt: '2099-08-11T00:00:00.000Z', writeEffect })}\n`);
    return reader.next();
  };
  const connection = await execute('cloud.service.connection-test', { method: 'POST', uri: '/fixture/connection', action: 'DescribeService', timestamp: '2026-08-11T00:00:00Z', body: {} }, false, `${provider}-connection`);
  const authorizationDenied = await execute('cloud.service.connection-test', { method: 'POST', uri: '/fixture/connection', action: 'DescribeService', timestamp: '2026-08-11T00:00:00Z', body: {} }, false, `${provider}-missing-grant`, {}, []);
  const discovery = await execute('cloud.service.discover', { method: 'POST', uri: '/fixture/discover', action: 'ListResources', timestamp: '2026-08-11T00:00:00Z', body: {} }, false, `${provider}-discover`);
  const deploy = await execute('certificate.deploy', { method: 'POST', uri: '/fixture/deploy', action: 'DeployCertificate', timestamp: '2026-08-11T00:00:00Z', body: { targetRef: 'target-fixture' } }, true, `${provider}-deploy`, { certificateArtifactRef: `artifact://fixture/${provider}` });
  const deployUnknown = await execute('certificate.deploy', { method: 'POST', uri: '/fixture/unknown', action: 'DeployCertificate', timestamp: '2026-08-11T00:00:00Z', body: { targetRef: 'target-fixture' } }, true, `${provider}-unknown`, { certificateArtifactRef: `artifact://fixture/${provider}` });
  const deployFailure = await execute('certificate.deploy', { method: 'POST', uri: '/fixture/deploy-failure', action: 'DeployCertificate', timestamp: '2026-08-11T00:00:00Z', body: { targetRef: 'target-fixture' } }, true, `${provider}-failure`, { certificateArtifactRef: `artifact://fixture/${provider}` });
  const rollback = await execute('certificate.rollback', { method: 'POST', uri: '/fixture/rollback', action: 'RollbackCertificate', timestamp: '2026-08-11T00:00:00Z', body: { targetRef: 'target-fixture' } }, true, `${provider}-rollback`, { certificateArtifactRef: `artifact://fixture/${provider}` });
  child.stdin.write(`${JSON.stringify({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'shutdown', requestId: `shutdown-${provider}`, sentAt: '2026-08-11T00:00:10.000Z', pluginVersionId: versionId })}\n`);
  await reader.next();
  child.stdin.end();
  const exit = await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code)));
  assert.equal(exit, 0, `${pluginId} Fixture Runner stderr: ${reader.stderr()}`);
  return { hello, connection, authorizationDenied, discovery, deploy, deployUnknown, deployFailure, rollback };
}

function packageDigest(packageDirectory, manifest) {
  const paths = [];
  for (const [key, value] of Object.entries(manifest.resources)) {
    if (key === 'runtimeEntrypoint' && typeof value === 'string') paths.push(value);
    else if (value && typeof value === 'object') paths.push(...Object.values(value));
  }
  const resources = Object.fromEntries([...new Set(paths)].sort().map((resourcePath) => [resourcePath, readFileSync(join(packageDirectory, resourcePath), 'utf8')]));
  const resourceSha256 = Object.fromEntries(Object.entries(resources).sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => [path, sha256(content)]));
  return { manifestHash: sha256(JSON.stringify(manifest)), resourceHash: sha256(JSON.stringify(resourceSha256)), packageHash: sha256(JSON.stringify({ directory: basename(packageDirectory), manifest, resources })) };
}

function createReader(child) {
  let buffer = '';
  let errorOutput = '';
  const queue = [];
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { const value = JSON.parse(line); if (waiters.length) waiters.shift()(value); else queue.push(value); } catch { for (const resolveNext of waiters.splice(0)) resolveNext({ messageType: 'invalid' }); }
    }
  });
  child.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  return { next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolveNext) => waiters.push(resolveNext)), stderr: () => errorOutput };
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
