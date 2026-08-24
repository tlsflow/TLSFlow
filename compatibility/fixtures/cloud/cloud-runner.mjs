import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline';

const executorPath = argument('--executor-module');
if (!executorPath) fail('缺少 --executor-module');
const pluginId = argument('--plugin-id');
const pluginVersionId = argument('--plugin-version-id');
const pluginVersion = argument('--plugin-version');
const descriptorEnv = {
  GCAC_PLUGIN_VERSION_ID: pluginVersionId,
  GCAC_PLUGIN_PACKAGE_HASH: argument('--package-hash'),
  GCAC_PLUGIN_MANIFEST_HASH: argument('--manifest-hash'),
  GCAC_PLUGIN_RESOURCE_HASH: argument('--resource-hash'),
};
for (const [key, value] of Object.entries(descriptorEnv)) if (!value) fail(`缺少 ${key}`);
Object.assign(process.env, descriptorEnv);

const provider = providerFor(pluginId);
const module = await import(pathToFileURL(resolve(executorPath)).href);
if (typeof module.createPluginRunnerExecutor !== 'function') fail('插件入口缺少固定工厂导出');
const executor = await module.createPluginRunnerExecutor();
let activeExecution;

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try { message = JSON.parse(line); } catch { fail('Runner 收到无效 JSON 行'); }
  await handle(message);
}

async function handle(message) {
  if (message.messageType === 'hello') {
    const accepted = message.pluginVersionId === executor.descriptor.pluginVersionId
      && message.pluginId === executor.descriptor.pluginId
      && message.pluginVersion === executor.descriptor.pluginVersion
      && message.packageHash === executor.descriptor.packageHash
      && message.resourceHash === executor.descriptor.resourceHash
      && message.manifestHash === executor.descriptor.manifestHash;
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'hello_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: executor.descriptor.pluginVersionId, accepted, pluginId: executor.descriptor.pluginId, pluginVersion: executor.descriptor.pluginVersion, runnerVersion: 'fixture-1.0.0', sdkVersion: 'fixture-1.0.0', capabilities: [...executor.descriptor.capabilities], permissions: [...executor.descriptor.permissions], packageHash: executor.descriptor.packageHash, resourceHash: executor.descriptor.resourceHash, manifestHash: executor.descriptor.manifestHash });
    return;
  }
  if (message.messageType === 'shutdown') {
    write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'shutdown_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: executor.descriptor.pluginVersionId, accepted: true, status: 'SHUTDOWN' });
    process.exitCode = 0;
    return;
  }
  if (message.messageType !== 'execute') return;
  activeExecution = message;
  let result;
  try {
    result = await executor.execute({
      pluginVersionId: message.pluginVersionId,
      pluginId: executor.descriptor.pluginId,
      pluginVersion: executor.descriptor.pluginVersion,
      tenantId: message.tenantId,
      executionId: message.executionId,
      executionStepId: message.executionStepId,
      capability: message.capability,
      actionId: message.actionId,
      actionContractVersion: message.actionContractVersion,
      inputSchemaSha256: message.inputSchemaSha256,
      outputSchemaSha256: message.outputSchemaSha256,
      packageHash: message.packageHash,
      manifestHash: message.manifestHash,
      resourceHash: message.resourceHash,
      planDigest: message.planDigest,
      input: message.input,
      grantRefs: message.grantRefs,
      idempotencyKey: message.idempotencyKey,
      deadlineAt: message.deadlineAt,
      writeEffect: message.writeEffect,
      signal: new AbortController().signal,
    }, { call: hostCall });
  } catch (error) {
    result = { success: false, status: 'FAILED', summary: {}, normalizedObjects: [], warnings: [], error: { code: 'FIXTURE_RUNNER_FAILED', message: 'Fixture Runner 执行失败', retryable: false, mayBeUnknown: false, secretRedacted: true } };
  }
  const output = result.output && typeof result.output === 'object' && !Array.isArray(result.output) ? result.output : {};
  const normalizedObjects = result.normalizedObjects ?? (Array.isArray(output.resources) ? output.resources : []);
  write({ protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: message.requestId, sentAt: new Date().toISOString(), pluginVersionId: executor.descriptor.pluginVersionId, tenantId: message.tenantId, executionId: message.executionId, executionStepId: message.executionStepId, success: result.success, status: result.status, summary: result.summary ?? output, normalizedObjects, warnings: result.warnings ?? [], ...(result.error ? { error: result.error } : {}) });
  activeExecution = undefined;
}

async function hostCall(method, request) {
  if (!activeExecution) throw new Error('Fixture Host API 没有活动执行');
  if (!Array.isArray(request) && method === undefined) throw new Error('Fixture Host API 请求无效');
  if (method === 'cloudService.get') return { ok: true, data: provider.service };
  if (method === 'secret.grant.resolve') return { ok: true, data: provider.secret };
  if (method !== 'http.request') throw new Error('Fixture Host API 拒绝未知方法');
  if (!verifySignature(request, provider)) return { ok: true, data: { statusCode: 401, body: { status: 'FAILED', code: 'InvalidSignature' }, signatureVerified: false } };
  const operationPath = request.operationPath ?? request.path;
  if (operationPath === '/fixture/discover') return { ok: true, data: { statusCode: 200, body: { resources: [{ id: `${provider.name}-resource`, type: provider.resourceType, region: provider.service.scope.metadata.region }] }, signatureVerified: true } };
  return { ok: true, data: { statusCode: 200, body: { status: 'SUCCEEDED', requestId: `${provider.name}-request` }, signatureVerified: true } };
}

function providerFor(id) {
  if (id === 'cloud.aliyun') return { name: 'aliyun', algorithm: 'ALIYUN-RPC-HMAC-SHA1', resourceType: 'cdn.domain', service: providerService(id, 'aliyun', { serviceName: 'cdn', region: 'cn-hangzhou' }), secret: { accessKeyId: 'fixture-aliyun-ak', accessKeySecret: 'fixture-aliyun-secret' } };
  if (id === 'cloud.tencent') return { name: 'tencent', algorithm: 'TENCENT-TC3-HMAC-SHA256', resourceType: 'ssl.certificate', service: providerService(id, 'tencent', { serviceName: 'ssl', region: 'ap-guangzhou' }), secret: { secretId: 'fixture-tencent-id', secretKey: 'fixture-tencent-secret' } };
  if (id === 'cloud.huawei') return { name: 'huawei', algorithm: 'HUAWEI-SDK-HMAC-SHA256', resourceType: 'scm.certificate', service: providerService(id, 'huawei', { serviceName: 'scm', region: 'cn-north-4' }), secret: { accessKey: 'fixture-huawei-ak', secretKey: 'fixture-huawei-secret' } };
  if (id === 'cloud.volcengine') return { name: 'volcengine', algorithm: 'VOLCENGINE-V4-HMAC-SHA256', resourceType: 'vod.space', service: providerService(id, 'volcengine', { serviceName: 'vod', region: 'cn-north-1' }), secret: { accessKey: 'fixture-volc-ak', secretKey: 'fixture-volc-secret' } };
  fail('未知 Cloud Plugin ID');
}

function providerService(providerKey, providerName, metadata) {
  return {
    apiVersion: 'gcac.cloud-service/v1',
    kind: 'CloudService',
    cloudServiceRef: `cloud-service://${providerName}`,
    providerKey,
    displayName: `Fixture ${providerName}`,
    scope: { endpoint: 'https://fixture.invalid', metadata },
    metadata: { fixture: true },
    status: 'ACTIVE',
    version: 1,
  };
}

function verifySignature(request, item) {
  if (!request || request.provider !== `cloud.${item.name}` || request.algorithm !== item.algorithm) return false;
  const serialized = JSON.stringify(request);
  if (serialized.includes(item.secret.accessKeySecret ?? '\u0000') || serialized.includes(item.secret.secretKey ?? '\u0000')) return false;
  if (item.name === 'aliyun') return verifyAliyun(request, item.secret);
  if (item.name === 'tencent') return verifyTencent(request, item.secret, item.service);
  if (item.name === 'huawei') return verifyHuawei(request, item.secret);
  return verifyVolcengine(request, item.secret, item.service);
}

function verifyAliyun(request, secret) {
  const signature = request.query?.Signature;
  if (typeof signature !== 'string') return false;
  const unsigned = { ...request.query };
  delete unsigned.Signature;
  const source = `${request.method}&%2F&${rfc3986(canonicalQuery(unsigned))}`;
  return signature === hmacBase64('sha1', `${secret.accessKeySecret}&`, source);
}

function verifyTencent(request, secret, service) {
  const authorization = request.headers?.authorization;
  const action = request.headers?.['x-tc-action'];
  const timestamp = request.headers?.['x-tc-timestamp'];
  if (typeof authorization !== 'string' || typeof action !== 'string' || typeof timestamp !== 'number') return false;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:application/json\nhost:${request.headers.host}\nx-tc-action:${action}\n`;
  const canonicalRequest = `${request.method}\n${request.path}\n${canonicalQuery(request.query ?? {})}\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(request.body)}`;
  const serviceName = service.scope.metadata.serviceName;
  const scope = `${date}/${serviceName}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const dateKey = hmac('sha256', `TC3${secret.secretKey}`, date);
  const serviceKey = hmac('sha256', dateKey, serviceName);
  const signingKey = hmac('sha256', serviceKey, 'tc3_request');
  const expected = hmacHex('sha256', signingKey, stringToSign);
  return authorization.endsWith(`Signature=${expected}`);
}

function verifyHuawei(request, secret) {
  const authorization = request.headers?.authorization;
  const timestamp = request.headers?.['x-sdk-date'];
  if (typeof authorization !== 'string' || typeof timestamp !== 'string') return false;
  const signedHeaders = 'content-type;host;x-sdk-date';
  const canonicalHeaders = `content-type:application/json\nhost:${request.headers.host}\nx-sdk-date:${timestamp}\n`;
  const canonicalRequest = `${request.method}\n${request.path}\n${canonicalQuery(request.query ?? {})}\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(request.body)}`;
  const expected = hmacHex('sha256', secret.secretKey, `SDK-HMAC-SHA256\n${timestamp}\n${sha256Hex(canonicalRequest)}`);
  return authorization.endsWith(`Signature=${expected}`);
}

function verifyVolcengine(request, secret, service) {
  const authorization = request.headers?.authorization;
  const timestamp = request.headers?.['x-date'];
  if (typeof authorization !== 'string' || typeof timestamp !== 'string') return false;
  const date = timestamp.slice(0, 8);
  const region = service.scope.metadata.region;
  const serviceName = service.scope.metadata.serviceName;
  const scope = `${date}/${region}/${serviceName}/request`;
  const signedHeaders = 'content-type;host;x-date';
  const canonicalHeaders = `content-type:application/json\nhost:${request.headers.host}\nx-date:${timestamp}\n`;
  const canonicalRequest = `${request.method}\n${request.path}\n${canonicalQuery(request.query ?? {})}\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(request.body)}`;
  const stringToSign = `HMAC-SHA256\n${timestamp}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const dateKey = hmac('sha256', `VOLC${secret.secretKey}`, date);
  const regionKey = hmac('sha256', dateKey, region);
  const serviceKey = hmac('sha256', regionKey, serviceName);
  const expected = hmacHex('sha256', hmac('sha256', serviceKey, 'request'), stringToSign);
  return authorization.endsWith(`Signature=${expected}`);
}

function canonicalQuery(query) { return Object.entries(query).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${rfc3986(key)}=${rfc3986(String(value))}`).join('&'); }
function rfc3986(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function hmac(algorithm, key, value) { return createHmac(algorithm, key).update(value).digest(); }
function hmacBase64(algorithm, key, value) { return createHmac(algorithm, key).update(value).digest('base64'); }
function hmacHex(algorithm, key, value) { return createHmac(algorithm, key).update(value).digest('hex'); }
function sha256Hex(value) { return createHash('sha256').update(value).digest('hex'); }
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function write(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
