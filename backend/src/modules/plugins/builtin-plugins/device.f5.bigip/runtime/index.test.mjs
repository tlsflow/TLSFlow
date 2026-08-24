import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPluginRunnerExecutor } from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const hash = `sha256:${'a'.repeat(64)}`;
const env = {
  GCAC_PLUGIN_VERSION_ID: `device-f5-${manifest.version.replaceAll('.', '-')}-dev`,
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};

test('F5 Runner 描述固定为只读设备识别能力', () => withEnvironment(env, () => {
  const descriptor = createPluginRunnerExecutor().descriptor;
  assert.equal(descriptor.pluginId, 'device.f5.bigip');
  assert.deepEqual(descriptor.capabilities, [
    'device.connection.test',
    'device.identity.detect',
    'device.discover',
    'certificate.deploy',
    'certificate.rollback',
  ]);
  assert.deepEqual(descriptor.actions.map((item) => item.capability), [
    'device.connection.test',
    'device.identity.detect',
    'device.discover',
  ]);
  assert.ok(descriptor.actions.every((item) => item.resourceHash === hash));
}));

test('F5 Runner 使用 Basic 用户密码 Grant 完成连接和身份识别', async () => {
  await withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const connection = await executor.execute(context(executor, 'device.connection.test', {
      deviceAddress: '192.0.2.44',
      credential: { username: 'admin', secretRef: 'secret://f5/password', grantId: 'grant-f5' },
      protocolFixture: fixture(),
    }), hostApi);
    assert.equal(connection.status, 'SUCCESS');
    assert.equal(connection.output.summary.productVersion, 'BIG-IP 17.1.0.2');

    const identity = await executor.execute(context(executor, 'device.identity.detect', {
      deviceAddress: '192.0.2.44',
      credential: { username: 'admin', secretRef: 'secret://f5/password', grantId: 'grant-f5' },
      protocolFixture: fixture(),
    }), hostApi);
    assert.equal(identity.status, 'SUCCESS');
    assert.equal(identity.output.summary.managementAddress, '192.0.2.44');
    assert.equal(identity.output.summary.haState, 'ACTIVE');
    assert.doesNotMatch(JSON.stringify(identity), /fixture-password|private-key|secret-value/);
  });
});

test('F5 Runner 发现 LTM Virtual Server、共享 Profile、证书绑定并过滤 CA 条目', async () => {
  await withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute(context(executor, 'device.discover', {
      deviceAddress: '192.0.2.44',
      displayName: 'F5 Fixture',
      credential: { username: 'admin', secretRef: 'secret://f5/password', grantId: 'grant-f5' },
      protocolFixture: fixture(),
    }), hostApi);
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    const discovery = result.output.normalizedObjects[0];
    assert.equal(discovery.device.productFamily, 'device.f5.bigip');
    assert.deepEqual(discovery.sites.map((item) => item.stableKey), ['VS:/Common/vs-app', 'VS:/Common/vs-api']);
    assert.equal(discovery.managedTargets.length, 2);
    assert.ok(discovery.managedTargets.every((target) => target.metadata.profileReferenceCount === 2));
    assert.ok(discovery.managedTargets.every((target) => target.metadata.referencingVirtualServers.join(',') === '/Common/vs-app,/Common/vs-api'));
    assert.ok(discovery.managedTargets.every((target) => target.metadata.keyChainEntryName === 'default'));
    assert.equal(discovery.certificateBindings.length, 2);
    assert.ok(discovery.certificateBindings.every((binding) => binding.metadata.sharedProfile === true));
    assert.equal(discovery.certificates[0].metadata.certificatePath, '/Common/app.crt');
    assert.doesNotMatch(JSON.stringify(discovery), /fixture-password|private-key|secret-value/);
  });
});

test('F5 Runner 对非 2xx iControl REST 响应失败关闭', async () => {
  await withEnvironment(env, async () => {
    const executor = createPluginRunnerExecutor();
    const failed = fixture();
    failed.responses['GET /mgmt/tm/sys/version'] = { statusCode: 401, body: { message: 'Authentication required' } };
    await assert.rejects(
      () => executor.execute(context(executor, 'device.connection.test', {
        deviceAddress: '192.0.2.44',
        credential: { username: 'admin', secretRef: 'secret://f5/password', grantId: 'grant-f5' },
        protocolFixture: failed,
      }), hostApi),
      (error) => error?.code === 'PLUGIN_PROTOCOL_CONTRACT_INVALID' && /HTTP 错误/.test(error.message),
    );
  });
});

function context(executor, capability, input) {
  const action = executor.descriptor.actions.find((item) => item.capability === capability);
  assert.ok(action, `缺少 ${capability} Action Contract`);
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.version,
    capability,
    actionId: action.actionId,
    actionContractVersion: action.actionContractVersion,
    inputSchemaSha256: action.inputSchemaSha256,
    outputSchemaSha256: action.outputSchemaSha256,
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    planDigest: 'b'.repeat(64),
    idempotencyKey: `idem-f5-${capability}`,
    writeEffect: false,
    grantRefs: ['grant-f5'],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    signal: new AbortController().signal,
    input,
  };
}

const hostApi = {
  call: async (method, input, grantRefs) => {
    assert.equal(method, 'secret.grant.resolve');
    assert.equal(input.grantId, 'grant-f5');
    assert.deepEqual(grantRefs, ['grant-f5']);
    return { ok: true, data: { value: '[REDACTED]' } };
  },
};

function fixture() {
  return {
    apiVersion: 'gcac.device-fixture/v1',
    protocol: 'F5_ICONTROL_REST',
    device: { managementAddress: '192.0.2.44' },
    responses: {
      'GET /mgmt/tm/sys/version': ok({ entries: { version: { nestedStats: { entries: { description: { description: 'BIG-IP 17.1.0.2' } } } } } }),
      'GET /mgmt/tm/sys/management-ip': ok({ entries: { managementIp: { nestedStats: { entries: { description: { description: '192.0.2.44' } } } } } }),
      'GET /mgmt/tm/sys/failover': ok({ entries: { status: { nestedStats: { entries: { description: { description: 'active' } } } } } }),
      'GET /mgmt/tm/ltm/virtual': ok({ items: [
        { name: 'vs-app', fullPath: '/Common/vs-app', destination: '/Common/192.0.2.80:443', profilesReference: { items: [{ name: 'clientssl', fullPath: '/Common/clientssl', context: 'clientside' }] } },
        { name: 'vs-api', fullPath: '/Common/vs-api', destination: '/Common/192.0.2.81:443', profilesReference: { items: [{ name: 'clientssl', fullPath: '/Common/clientssl', context: 'clientside' }] } },
      ] }),
      'GET /mgmt/tm/ltm/profile/client-ssl': ok({ items: [{ name: 'clientssl', fullPath: '/Common/clientssl', generation: 17, serverName: 'app.example.invalid', sniDefault: true, sniRequire: false, certKeyChain: [
        { name: 'default', cert: '/Common/app.crt', key: '/Common/app.key', usage: 'SERVER' },
        { name: 'ca-chain', cert: '/Common/ca.crt', usage: 'CA' },
      ] }] }),
      'GET /mgmt/tm/sys/file/ssl-cert': ok({ items: [{ name: 'app.crt', fullPath: '/Common/app.crt', subject: 'CN=app.example.invalid', issuer: 'CN=Fixture Issuer', expirationDate: '2027-01-01T00:00:00Z' }] }),
    },
  };
}

function ok(body) { return { statusCode: 200, body }; }

async function withEnvironment(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { return await callback(); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
