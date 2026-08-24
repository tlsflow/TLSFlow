import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPluginRunnerExecutor } from './index.js';
import { PluginRunnerClient } from '../../../runner/plugin-runner-client.js';

const hash = `sha256:${'c'.repeat(64)}`;
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const pluginVersion = manifest.version;
const capabilities = manifest.capabilities.map((item) => item.key);
const permissions = manifest.permissions;
const env = {
  GCAC_PLUGIN_VERSION_ID: `device-synology-${pluginVersion.replaceAll('.', '-')}-dev`,
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};
const AUTH_PATH = 'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid';
const IMPORT_PATH = 'POST /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import';
const SERVICE_BINDING_PATH = 'POST /webapi/entry.cgi?api=SYNO.Core.Certificate.Service&version=1&method=set';

test('Synology 工厂只导出标准入口并读取适配器注入的四项身份', () => {
  withEnvironment(env, () => {
    const descriptor = createPluginRunnerExecutor().descriptor;
    assert.deepEqual(descriptor, {
      pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
      pluginId: 'device.synology-dsm',
      pluginVersion,
      capabilities,
      actions: descriptor.actions,
      permissions,
      packageHash: hash,
      manifestHash: hash,
      resourceHash: hash,
    });
    assert.deepEqual(descriptor.actions.map((action) => action.capability), capabilities);
    assert.ok(descriptor.actions.every((action) => action.resourceHash === hash));
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
    pluginVersion,
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'), '--executor-module', resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/device-synology-dsm/runtime/index.js')],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities,
    hostPermissions: permissions,
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
      ...actionBinding('device.discover'), grantRefs: ['secret-grant'], idempotencyKey: 'idem-synology', writeEffect: false,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: {
        deviceAddress: '192.0.2.50', displayName: 'DSM Fixture',
        credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
        protocolFixture: discoveryFixture(),
      },
    });
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(result.output.normalizedObjects[0].apiVersion, 'gcac.device-discovery/v2');
    assert.equal(result.output.normalizedObjects[0].device.productFamily, 'device.synology-dsm');
    assert.equal(result.output.normalizedObjects[0].certificateBindings.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('Synology 真实 Runner 子进程在 DSM 业务故障时失败关闭', async () => {
  const failureCase = loadErrorCases().cases.find((item) => item.name === '业务错误');
  assert.ok(failureCase);
  const client = new PluginRunnerClient({
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.synology-dsm',
    pluginVersion,
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'), '--executor-module', resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/device-synology-dsm/runtime/index.js')],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities,
    hostPermissions: permissions,
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    startupTimeoutMs: 1000,
    helloTimeoutMs: 500,
    executeTimeoutMs: 1000,
    hostApiHandler: async ({ method }) => {
      assert.equal(method, 'secret.grant.resolve');
      return { ok: true, data: { secretRef: 'secret://device/password', fingerprint: 'fixture-secret', value: '[REDACTED]' } };
    },
  });
  try {
    const result = await client.execute({
      tenantId: 'tenant-device', executionId: 'run-synology-failure', executionStepId: 'step-connection-test', workflowVersionId: 'workflow-synology-1', planDigest: 'd'.repeat(64),
      ...actionBinding('device.connection.test'), grantRefs: ['secret-grant'], idempotencyKey: 'idem-synology-failure', writeEffect: false,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: {
        deviceAddress: '192.0.2.50', displayName: 'DSM Failure Fixture',
        credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
        protocolFixture: {
          apiVersion: 'gcac.device-fixture/v1', protocol: 'DSM', device: { managementAddress: '192.0.2.50' },
          responses: { [AUTH_PATH]: failureCase.response },
        },
      },
    });
    assert.equal(result.status, 'FAILED', JSON.stringify(result));
    assert.equal(result.error.code, 'PLUGIN_CAPABILITY_EXECUTION_FAILED', JSON.stringify(result));
    assert.match(result.error.message, /DSM/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('Synology deploy Fixture 按默认 DSM 服务键验证 Artifact Grant、写后校验和脱敏', async () => {
  withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute(context(executor, 'certificate.deploy', ['secret-grant', 'artifact-grant'], true, {
      deviceAddress: '192.0.2.50', target: 'Synology DSM', certificateId: 'cert-new',
      credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
      artifact: { artifactRef: 'artifact://certificate/new', grantId: 'artifact-grant' }, protocolFixture: writeFixture(),
    }), hostApi);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.summary.certificateId, 'cert-new');
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  });
});

test('Synology rollback Fixture 按默认 DSM 服务键使用 Certificate.Service.set 恢复历史绑定', async () => {
  withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute(context(executor, 'certificate.rollback', ['secret-grant'], true, {
      deviceAddress: '192.0.2.50', target: 'Synology DSM',
      previousCertificate: { id: 'cert-old', services: [{ display_name: 'DSM Desktop Service', service: 'default' }] },
      credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
      protocolFixture: rollbackFixture(),
    }), hostApi);
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(result.summary.restoredCertificateId, 'cert-old');
  });
});

test('Synology 写入传输失败后只能返回 UNKNOWN', async () => {
  withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const fixture = writeFixture();
    const failureCase = loadErrorCases().cases.find((item) => item.name === '写入后未知');
    assert.ok(failureCase);
    fixture.responses[IMPORT_PATH] = failureCase.response;
    const result = await executor.execute(context(executor, 'certificate.deploy', ['secret-grant', 'artifact-grant'], true, {
      deviceAddress: '192.0.2.50', target: 'Synology DSM', certificateId: 'cert-new',
      credential: { username: 'fixture-user', secretRef: 'secret://device/password', grantId: 'secret-grant' },
      artifact: { artifactRef: 'artifact://certificate/new', grantId: 'artifact-grant' }, protocolFixture: fixture,
    }), hostApi);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.error.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  });
});

function context(executor, capability, grantRefs, writeEffect, input) {
  const action = executor.descriptor.actions.find((item) => item.capability === capability);
  assert.ok(action, `缺少 ${capability} Action Contract`);
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.synology-dsm',
    pluginVersion,
    tenantId: 'tenant-device', executionId: 'run-synology', executionStepId: 'step-device', capability, input,
    actionId: action.actionId,
    actionContractVersion: action.actionContractVersion,
    inputSchemaSha256: action.inputSchemaSha256,
    outputSchemaSha256: action.outputSchemaSha256,
    packageHash: env.GCAC_PLUGIN_PACKAGE_HASH,
    manifestHash: env.GCAC_PLUGIN_MANIFEST_HASH,
    resourceHash: action.resourceHash,
    workflowVersionId: 'workflow-synology-1',
    planDigest: 'd'.repeat(64),
    grantRefs, idempotencyKey: 'idem-device', deadlineAt: new Date(Date.now() + 10_000).toISOString(), writeEffect,
    signal: new AbortController().signal,
  };
}

function actionBinding(capability) {
  const descriptor = withEnvironment(env, () => createPluginRunnerExecutor().descriptor);
  const action = descriptor.actions.find((item) => item.capability === capability);
  assert.ok(action, `缺少 ${capability} Action Contract`);
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'device.synology-dsm',
    capability,
    actionId: action.actionId,
    actionContractVersion: action.actionContractVersion,
    inputSchemaSha256: action.inputSchemaSha256,
    outputSchemaSha256: action.outputSchemaSha256,
    packageHash: env.GCAC_PLUGIN_PACKAGE_HASH,
    manifestHash: env.GCAC_PLUGIN_MANIFEST_HASH,
    resourceHash: action.resourceHash,
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
      'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid': ok({ success: true, data: { sid: 'fixture-session', synotoken: 'fixture-token' } }),
      'GET /webapi/entry.cgi?api=SYNO.DSM.Info&version=2&method=get': ok({ success: true, data: { version: 'DSM 7.2.1 Fixture' } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Network.Interface&version=1&method=list': ok({ success: true, data: { services: [{ id: 'dsm-web', name: 'DSM Management', port: 5001, protocol: 'HTTPS', certificateId: 'cert-old' }] } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Certificate.CRT&version=1&method=list': ok({ success: true, data: { certificates: [{ id: 'cert-old', services: [{ display_name: 'DSM Management' }], sha256Fingerprint: 'a'.repeat(64), subject: 'CN=dsm.example.invalid', issuer: 'CN=Fixture Issuer', notAfter: '2027-01-01T00:00:00Z' }] } }),
    },
  };
}

function writeFixture() {
  return {
    apiVersion: 'gcac.device-fixture/v1', protocol: 'DSM', device: { managementAddress: '192.0.2.50' },
    responses: {
      'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid': ok({ success: true, data: { sid: 'fixture-session', synotoken: 'fixture-token' } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Certificate.CRT&version=1&method=list': [
        ok({ success: true, data: { certificates: [{ id: 'cert-old', services: [{ display_name: 'DSM Desktop Service', service: 'default' }], sha256Fingerprint: 'a'.repeat(64) }] } }),
        ok({ success: true, data: { certificates: [{ id: 'cert-new', services: [{ display_name: 'DSM Desktop Service', service: 'default' }], sha256Fingerprint: 'b'.repeat(64) }] } }),
      ],
      'POST /webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import': {
        ...ok({ success: true, data: { id: 'cert-new' } }),
        expectedRequest: {
          method: 'POST',
          path: '/webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import',
          body: { sid: 'fixture-session', target: 'Synology DSM', certificateId: 'cert-new', artifactRef: 'artifact://certificate/new', artifactSha256: `sha256:${'e'.repeat(64)}`, intermediateCount: 0 },
        },
      },
      [SERVICE_BINDING_PATH]: {
        ...ok({ success: true, data: {} }),
        expectedRequest: {
          method: 'POST',
          path: '/webapi/entry.cgi?api=SYNO.Core.Certificate.Service&version=1&method=set',
          body: { sid: 'fixture-session', settings: JSON.stringify([{ service: { display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true }, old_id: 'cert-old', id: 'cert-new' }]) },
        },
      },
    },
  };
}

function rollbackFixture() {
  return {
    apiVersion: 'gcac.device-fixture/v1', protocol: 'DSM', device: { managementAddress: '192.0.2.50' },
    responses: {
      'POST /webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid': ok({ success: true, data: { sid: 'fixture-session', synotoken: 'fixture-token' } }),
      'GET /webapi/entry.cgi?api=SYNO.Core.Certificate.CRT&version=1&method=list': [
        ok({ success: true, data: { certificates: [{ id: 'cert-new', services: [{ display_name: 'DSM Desktop Service', service: 'default' }], sha256Fingerprint: 'b'.repeat(64) }] } }),
        ok({ success: true, data: { certificates: [{ id: 'cert-old', services: [{ display_name: 'DSM Desktop Service', service: 'default' }], sha256Fingerprint: 'a'.repeat(64) }] } }),
      ],
      [SERVICE_BINDING_PATH]: {
        ...ok({ success: true, data: {} }),
        expectedRequest: {
          method: 'POST',
          path: '/webapi/entry.cgi?api=SYNO.Core.Certificate.Service&version=1&method=set',
          body: { sid: 'fixture-session', settings: JSON.stringify([{ service: { display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true }, old_id: 'cert-new', id: 'cert-old' }]) },
        },
      },
    },
  };
}

function ok(body) { return { statusCode: 200, body }; }

function loadErrorCases() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src/modules/plugins/builtin-plugins/device-synology-dsm/fixtures/dsm-error-cases.json'), 'utf8'));
}
