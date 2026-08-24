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
const publicResourceKeys = ['runtimeEntrypoint', 'workflows', 'actionContracts', 'forms', 'presentations', 'discoveryMappings', 'locales'];

test('四个 Cloud 包只执行只读服务识别，并拒绝证书命令', async () => {
  for (const [directory, pluginId, provider] of packageCases) {
    const packageDirectory = join(packageRoot, directory);
    const manifest = readJson(join(packageDirectory, 'manifest.json'));
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
    assert.deepEqual(manifest.capabilities.map((item) => item.key), ['cloud.service.connection-test', 'cloud.service.discover']);
    assert.equal(manifest.capabilities.some((item) => item.key.startsWith('certificate.')), false, `${pluginId} 不得声明云端证书执行能力`);
    assert.deepEqual(Object.keys(manifest.resources.workflows).sort(), manifest.capabilities.map((item) => item.key).sort(), `${pluginId} Capability 与 Workflow 未一一绑定`);
    for (const directoryName of ['runtime', 'workflows', 'discovery', 'locales', 'presentations']) assert.equal(existsSync(join(packageDirectory, directoryName)), true, `${pluginId} 缺少 ${directoryName} 目录`);
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
    assert.equal(result.authorizationDenied.success, false, `${pluginId} 缺失 Receipt 不得成功`);
    assert.equal(result.authorizationDenied.status, 'FAILED', `${pluginId} 缺失 Receipt 必须失败关闭`);
    assert.equal(result.authorizationDenied.error?.code, 'CLOUD_CONTRACT_DENIED', `${pluginId} 缺失 Grant 必须拒绝执行合同`);
    assert.equal(result.authorizationDenied.error?.mayBeUnknown, false, `${pluginId} 缺失 Grant 不得产生写入不确定性`);
    assert.equal(result.authorizationDenied.error?.secretRedacted, true, `${pluginId} 缺失 Grant 错误不得泄露密钥`);
    assert.equal(result.forbiddenCertificateAction.success, false, `${pluginId} 不得执行 certificate.deploy`);
    assert.equal(result.forbiddenCertificateAction.status, 'FAILED');
    assert.equal(result.forbiddenCertificateAction.error?.code, 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
    assert.equal(result.forbiddenCertificateAction.error?.mayBeUnknown, false);
    assert.equal(result.forbiddenCertificateAction.error?.secretRedacted, true);
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
  };
  const execute = async (capability, request, suffix, grantRefs = ['cloud-credential']) => {
    const requestId = `execute-${provider}-${suffix}`;
    child.stdin.write(`${JSON.stringify({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute', requestId, sentAt: '2026-08-11T00:00:01.000Z', pluginVersionId: versionId, tenantId: 'tenant-fixture', executionId: `execution-${suffix}`, executionStepId: `step-${suffix}`, capability, actionId: `${capability}.v1`, actionContractVersion: 'v1', packageHash: digest.packageHash, manifestHash: digest.manifestHash, resourceHash: digest.resourceHash, planDigest: 'd'.repeat(64), input: { ...baseInput, request }, grantRefs, idempotencyKey: `idempotency-${suffix}`, deadlineAt: '2099-08-11T00:00:00.000Z', writeEffect: false })}\n`);
    return reader.next();
  };
  const connection = await execute('cloud.service.connection-test', { method: 'POST', uri: '/fixture/connection', action: 'DescribeService', timestamp: '2026-08-11T00:00:00Z', body: {} }, `${provider}-connection`);
  const authorizationDenied = await execute('cloud.service.connection-test', { method: 'POST', uri: '/fixture/connection', action: 'DescribeService', timestamp: '2026-08-11T00:00:00Z', body: {} }, `${provider}-missing-grant`, []);
  const discovery = await execute('cloud.service.discover', { method: 'POST', uri: '/fixture/discover', action: 'ListResources', timestamp: '2026-08-11T00:00:00Z', body: {} }, `${provider}-discover`);
  const forbiddenCertificateAction = await execute('certificate.deploy', { method: 'POST', uri: '/fixture/certificate-deploy', action: 'DeployCertificate', timestamp: '2026-08-11T00:00:00Z', body: {} }, `${provider}-certificate-forbidden`);
  child.stdin.write(`${JSON.stringify({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'shutdown', requestId: `shutdown-${provider}`, sentAt: '2026-08-11T00:00:10.000Z', pluginVersionId: versionId })}\n`);
  await reader.next();
  child.stdin.end();
  const exit = await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code)));
  assert.equal(exit, 0, `${pluginId} Fixture Runner stderr: ${reader.stderr()}`);
  return { hello, connection, authorizationDenied, discovery, forbiddenCertificateAction };
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
