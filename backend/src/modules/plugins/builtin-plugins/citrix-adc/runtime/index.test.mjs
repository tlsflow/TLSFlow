import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createPluginRunnerExecutor } from './index.js';
import { PluginRunnerClient } from '../../../runner/plugin-runner-client.js';

const hash = `sha256:${'a'.repeat(64)}`;
const env = {
  GCAC_PLUGIN_VERSION_ID: 'device-citrix-2-0-1-dev',
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};

test('Citrix 工厂只导出标准入口并从适配器环境读取四项固定身份', () => {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    const executor = createPluginRunnerExecutor();
    assert.deepEqual(executor.descriptor, {
      pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
      pluginId: 'device.citrix.netscaler-adc',
      pluginVersion: '2.0.1',
      capabilities: ['device.connection.test', 'device.identity.detect', 'device.discover', 'certificate.deploy', 'certificate.rollback'],
      permissions: ['secret.resolve', 'artifact.read', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
      packageHash: hash,
      manifestHash: hash,
      resourceHash: hash,
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('Citrix 缺少任一适配器摘要时工厂失败关闭', () => {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  delete process.env.GCAC_PLUGIN_RESOURCE_HASH;
  try { assert.throws(() => createPluginRunnerExecutor(), /GCAC_PLUGIN_RESOURCE_HASH/); }
  finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});

test('Citrix 真实 Runner 子进程执行 NITRO discovery Fixture 并脱敏 Secret', async () => {
  const executorPath = resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/citrix-adc/runtime/index.js');
  const runnerServer = resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js');
  const client = new PluginRunnerClient({
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.citrix.netscaler-adc',
    pluginVersion: '2.0.1',
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [runnerServer, '--executor-module', executorPath],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['device.connection.test', 'device.identity.detect', 'device.discover', 'certificate.deploy', 'certificate.rollback'],
    hostPermissions: ['secret.resolve', 'artifact.read', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    startupTimeoutMs: 1000,
    helloTimeoutMs: 500,
    executeTimeoutMs: 1000,
    hostApiHandler: async ({ method }) => {
      assert.equal(method, 'secret.grant.resolve');
      return { ok: true, data: { secretRef: 'secret://device/password', fingerprint: 'fp', value: '[REDACTED]' } };
    },
  });
  try {
    const result = await client.execute({
      tenantId: 'tenant-device', executionId: 'run-citrix', executionStepId: 'step-discover', workflowVersionId: 'workflow-citrix-1', planDigest: 'b'.repeat(64),
      capability: 'device.discover', grantRefs: ['secret-grant'], idempotencyKey: 'idem-citrix', writeEffect: false,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: {
        deviceAddress: '192.0.2.20', displayName: 'ADC Fixture',
        credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
        protocolFixture: { apiVersion: 'gcac.device-fixture/v1', protocol: 'NITRO', responses: nitroResponses() },
      },
    });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.normalizedObjects[0].apiVersion, 'gcac.device-discovery/v2');
    assert.equal(result.normalizedObjects[0].certificates.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

function nitroResponses() {
  const ok = (body) => ({ statusCode: 200, body });
  return {
    'GET /nitro/v1/config/nsversion': ok({ errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build fixture' } }),
    'GET /nitro/v1/config/lbvserver': ok({ errorcode: 0, lbvserver: [{ name: 'lb-one', servicetype: 'SSL', ipv46: '192.0.2.41', port: 443 }] }),
    'GET /nitro/v1/config/vpnvserver': ok({ errorcode: 0, vpnvserver: [] }),
    'GET /nitro/v1/config/csvserver': ok({ errorcode: 0, csvserver: [] }),
    'GET /nitro/v1/config/gslbvserver': ok({ errorcode: 0, gslbvserver: [] }),
    'GET /nitro/v1/config/sslvserver_sslcertkey_binding': ok({ errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'leaf-one', snicert: false }] }),
    'GET /nitro/v1/config/sslcertkey': ok({ errorcode: 0, sslcertkey: [{ certkey: 'leaf-one', cert: '/nsconfig/ssl/leaf-one.pem', subject: 'CN=example.invalid', issuer: 'CN=Fixture Issuer', clientcertnotbefore: '2026-01-01T00:00:00Z', clientcertnotafter: '2027-01-01T00:00:00Z' }] }),
  };
}
