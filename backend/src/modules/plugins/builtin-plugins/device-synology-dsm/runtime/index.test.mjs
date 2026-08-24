import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createPluginRunnerExecutor } from './index.js';
import { PluginRunnerClient } from '../../../runner/plugin-runner-client.js';

const hash = `sha256:${'c'.repeat(64)}`;
const env = {
  GCAC_PLUGIN_VERSION_ID: 'device-synology-1-0-0-dev',
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};

test('Synology 工厂只导出标准入口并读取适配器注入的四项身份', () => {
  withEnvironment(env, () => {
    assert.deepEqual(createPluginRunnerExecutor().descriptor, {
      pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
      pluginId: 'device.synology-dsm',
      pluginVersion: '1.0.0',
      capabilities: ['device.connection.test', 'device.discover', 'certificate.deploy', 'certificate.rollback'],
      permissions: ['secret.resolve', 'artifact.read', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
      packageHash: hash,
      manifestHash: hash,
      resourceHash: hash,
    });
  });
});

test('Synology 缺少固定摘要时工厂失败关闭', () => {
  withEnvironment(env, () => {
    delete process.env.GCAC_PLUGIN_MANIFEST_HASH;
    assert.throws(() => createPluginRunnerExecutor(), /GCAC_PLUGIN_MANIFEST_HASH/);
  });
});

test('Synology 真实 Runner 子进程执行 DSM discovery Fixture 并输出标准发现对象', async () => {
  const client = new PluginRunnerClient({
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.synology-dsm',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'), '--executor-module', resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/device-synology-dsm/runtime/index.js')],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['device.connection.test', 'device.discover', 'certificate.deploy', 'certificate.rollback'],
    hostPermissions: ['secret.resolve', 'artifact.read', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    startupTimeoutMs: 1000,
    helloTimeoutMs: 500,
    executeTimeoutMs: 2000,
    hostApiHandler: async ({ method }) => {
      assert.equal(method, 'secret.grant.resolve');
      return { ok: true, data: { secretRef: 'secret://device/password', fingerprint: 'fixture-secret', value: '[REDACTED]' } };
    },
  });
  try {
    const result = await client.execute({
      tenantId: 'tenant-device', executionId: 'run-synology', executionStepId: 'step-discover', workflowVersionId: 'workflow-synology-1', planDigest: 'd'.repeat(64),
      capability: 'device.discover', grantRefs: ['secret-grant'], idempotencyKey: 'idem-synology', writeEffect: false,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: {
        deviceAddress: '192.0.2.50', displayName: 'DSM Fixture',
        credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
        protocolFixture: discoveryFixture(),
      },
    });
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(result.normalizedObjects[0].apiVersion, 'gcac.device-discovery/v2');
    assert.equal(result.normalizedObjects[0].device.productFamily, 'device.synology-dsm');
    assert.equal(result.normalizedObjects[0].certificateBindings.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('Synology deploy Fixture 验证 Artifact Grant、写后校验和脱敏', async () => {
  withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute(context('certificate.deploy', ['secret-grant', 'artifact-grant'], true, {
      deviceAddress: '192.0.2.50', target: 'DSM Management', certificateId: 'cert-new',
      credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
      artifact: { artifactRef: 'artifact://certificate/new', grantId: 'artifact-grant' }, protocolFixture: writeFixture(),
    }), hostApi);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.summary.certificateId, 'cert-new');
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  });
});

test('Synology 写入传输失败后只能返回 UNKNOWN', async () => {
  withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const fixture = writeFixture();
    fixture.responses['POST /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import'] = { statusCode: 504, transportError: true, body: { success: false, error: { code: 105 } } };
    const result = await executor.execute(context('certificate.deploy', ['secret-grant', 'artifact-grant'], true, {
      deviceAddress: '192.0.2.50', target: 'DSM Management', certificateId: 'cert-new',
      credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
      artifact: { artifactRef: 'artifact://certificate/new', grantId: 'artifact-grant' }, protocolFixture: fixture,
    }), hostApi);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.error.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  });
});

function context(capability, grantRefs, writeEffect, input) {
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.synology-dsm',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-device', executionId: 'run-synology', executionStepId: 'step-device', capability, input,
    grantRefs, idempotencyKey: 'idem-device', deadlineAt: new Date(Date.now() + 10_000).toISOString(), writeEffect,
    signal: new AbortController().signal,
  };
}

const hostApi = {
  call: async (method) => {
    if (method === 'secret.grant.resolve') return { ok: true, data: { value: '[REDACTED]' } };
    if (method === 'artifact.grant.read') return { ok: true, data: { sha256: `sha256:${'e'.repeat(64)}` } };
    throw new Error(`unexpected host method ${method}`);
  },
};

function withEnvironment(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { return callback(); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

function discoveryFixture() {
  return {
    apiVersion: 'gcac.device-fixture/v1', protocol: 'DSM', device: { managementAddress: '192.0.2.50' },
    responses: {
      'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid': ok({ success: true, data: { sid: 'fixture-session' } }),
      'GET /webapi/entry.cgi?api=SYNO.DSM.Info&version=2&method=get': ok({ success: true, data: { version: 'DSM 7.2.1 Fixture' } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Network.Interface&version=1&method=list': ok({ success: true, data: { services: [{ id: 'dsm-web', name: 'DSM Management', port: 5001, protocol: 'HTTPS', certificateId: 'cert-old' }] } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=list': ok({ success: true, data: { certificates: [{ id: 'cert-old', serviceNames: ['DSM Management'], sha256Fingerprint: 'a'.repeat(64), subject: 'CN=dsm.example.invalid', issuer: 'CN=Fixture Issuer', notAfter: '2027-01-01T00:00:00Z' }] } }),
    },
  };
}

function writeFixture() {
  return {
    apiVersion: 'gcac.device-fixture/v1', protocol: 'DSM', device: { managementAddress: '192.0.2.50' },
    responses: {
      'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid': ok({ success: true, data: { sid: 'fixture-session' } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=list': [
        ok({ success: true, data: { certificates: [{ id: 'cert-old', serviceNames: ['DSM Management'], sha256Fingerprint: 'a'.repeat(64) }] } }),
        ok({ success: true, data: { certificates: [{ id: 'cert-new', serviceNames: ['DSM Management'], sha256Fingerprint: 'b'.repeat(64) }] } }),
      ],
      'POST /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import': ok({ success: true, data: { id: 'cert-new' } }),
      'POST /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=rollback': ok({ success: true, data: { id: 'cert-old' } }),
    },
  };
}

function ok(body) { return { statusCode: 200, body }; }
