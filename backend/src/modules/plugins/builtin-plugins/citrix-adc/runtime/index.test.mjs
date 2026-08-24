import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createPluginRunnerExecutor } from './index.js';

const packageDirectory = resolve(process.cwd(), 'src/modules/plugins/builtin-plugins/citrix-adc');
const manifest = JSON.parse(readFileSync(resolve(packageDirectory, 'manifest.json'), 'utf8'));
const workflow = JSON.parse(readFileSync(resolve(packageDirectory, 'workflows/certificate-deploy.json'), 'utf8'));

test('Citrix Runner 只暴露设备识别代码，证书生命周期失败关闭', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: `device-citrix-${manifest.version.replaceAll('.', '-')}-dev`,
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'a'.repeat(64)}`,
  });
  try {
    const executor = createPluginRunnerExecutor();
    assert.equal(executor.descriptor.actions.some((action) => action.capability.startsWith('certificate.')), false);
    const context = baseContext(executor, 'certificate.deploy', certificateInput());
    await assert.rejects(() => executor.execute(context, hostApi), (error) => error?.code === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
    await assert.rejects(() => executor.execute({ ...context, capability: 'certificate.rollback' }, hostApi), (error) => error?.code === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('Citrix 识别 Runner 可执行 NITRO Fixture 连接测试和发现', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: `device-citrix-${manifest.version.replaceAll('.', '-')}-dev`,
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'a'.repeat(64)}`,
  });
  try {
    const executor = createPluginRunnerExecutor();
    const connection = await executor.execute(baseContext(executor, 'device.connection.test', {
      deviceAddress: '192.0.2.10',
      credential: { username: 'nsroot', secretRef: 'secret://citrix/password', grantId: 'grant-device' },
      protocolFixture: fixture({
        'GET /nitro/v1/config/nsversion': { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NS13.1' } } },
      }),
    }), hostApi);
    assert.equal(connection.status, 'SUCCESS');
    assert.equal(connection.output.summary.productVersion, 'NS13.1');

    const discovery = await executor.execute(baseContext(executor, 'device.discover', {
      deviceAddress: '192.0.2.10',
      credential: { username: 'nsroot', secretRef: 'secret://citrix/password', grantId: 'grant-device' },
      protocolFixture: fixture({
        'GET /nitro/v1/config/nsversion': { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NS13.1' } } },
        'GET /nitro/v1/config/lbvserver': { statusCode: 200, body: { errorcode: 0, lbvserver: [{ name: 'lb-vserver', ipv46: '192.0.2.20', port: 443 }] } },
        'GET /nitro/v1/config/vpnvserver': { statusCode: 200, body: { errorcode: 0, vpnvserver: [] } },
        'GET /nitro/v1/config/csvserver': { statusCode: 200, body: { errorcode: 0, csvserver: [] } },
        'GET /nitro/v1/config/gslbvserver': { statusCode: 200, body: { errorcode: 0, gslbvserver: [] } },
        'GET /nitro/v1/config/sslvserver_sslcertkey_binding': { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [] } },
        'GET /nitro/v1/config/sslcertkey': { statusCode: 200, body: { errorcode: 0, sslcertkey: [] } },
      }),
    }), hostApi);
    assert.equal(discovery.status, 'SUCCESS');
    assert.equal(discovery.output.normalizedObjects[0].device.productFamily, manifest.pluginId);
    assert.equal(discovery.output.normalizedObjects[0].managedTargets.length, 1);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('Citrix Runner 拒绝篡改的 Action Binding 和写操作标记', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: `device-citrix-${manifest.version.replaceAll('.', '-')}-dev`,
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'a'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'a'.repeat(64)}`,
  });
  try {
    const executor = createPluginRunnerExecutor();
    const context = baseContext(executor, 'device.connection.test', {
      deviceAddress: '192.0.2.10',
      credential: { username: 'nsroot', secretRef: 'secret://citrix/password', grantId: 'grant-device' },
      protocolFixture: fixture({}),
    });
    await assert.rejects(
      () => executor.execute({ ...context, pluginVersionId: 'device-citrix-tampered' }, hostApi),
      (error) => error?.code === 'PLUGIN_CONTRACT_INVALID',
    );
    await assert.rejects(
      () => executor.execute({ ...context, outputSchemaSha256: `sha256:${'b'.repeat(64)}` }, hostApi),
      (error) => error?.code === 'PLUGIN_RUNNER_VERSION_MISMATCH',
    );
    await assert.rejects(
      () => executor.execute({ ...context, writeEffect: true }, hostApi),
      (error) => error?.code === 'PLUGIN_CONTRACT_INVALID',
    );
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('Citrix 证书部署保留 26 个 DSL 步骤和 16 个 rollback 步骤', () => {
  assert.equal(manifest.runtime, 'WORKFLOW_DSL');
  assert.equal(workflow.kind, 'CurlSshWorkflow');
  assert.equal(workflow.steps.length, 26);
  assert.equal(workflow.rollback.length, 16);
  assert.equal(workflow.steps.some((step) => step.type === 'plugin.action'), false);
  assert.equal(workflow.rollback.some((step) => step.type === 'plugin.action'), false);
  assert.ok(workflow.steps.some((step) => step.name === 'deploymentCheckpoint' && step.type === 'checkpoint'));
  assert.ok(workflow.steps.some((step) => step.name === 'verifyCertificateControlPlane' && step.type === 'http'));
  assert.ok(workflow.rollback.some((step) => step.name === 'requireFinalBindingsEquivalent' && step.type === 'condition'));
});

test('Citrix 部署和回滚只使用标准 NITRO HTTPS DSL 请求', () => {
  const allSteps = [...workflow.steps, ...workflow.rollback];
  const httpSteps = allSteps.filter((step) => step.type === 'http');
  assert.ok(httpSteps.length > 0);
  for (const step of httpSteps) {
    assert.equal(step.request.connectionRef, 'management');
    assert.match(step.request.url, /\/nitro\/v1\//);
    assert.equal(step.request.tls?.verify, '{{connections.management.tls.verifyPeer}}');
  }
  assert.equal(manifest.resources.workflows['certificate.deploy'], 'workflows/certificate-deploy.json');
  assert.equal(manifest.resources.workflows['certificate.rollback'], 'workflows/certificate-deploy.json');
});

function baseContext(executor, capability, input) {
  const action = executor.descriptor.actions.find((item) => item.capability === capability);
  return {
    pluginVersionId: process.env.GCAC_PLUGIN_VERSION_ID,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.version,
    capability,
    actionId: action?.actionId ?? `${capability}.v1`,
    actionContractVersion: action?.actionContractVersion ?? 'v1',
    inputSchemaSha256: action?.inputSchemaSha256 ?? `sha256:${'0'.repeat(64)}`,
    outputSchemaSha256: action?.outputSchemaSha256 ?? `sha256:${'0'.repeat(64)}`,
    packageHash: process.env.GCAC_PLUGIN_PACKAGE_HASH,
    manifestHash: process.env.GCAC_PLUGIN_MANIFEST_HASH,
    resourceHash: process.env.GCAC_PLUGIN_RESOURCE_HASH,
    planDigest: 'b'.repeat(64),
    idempotencyKey: 'idem-citrix',
    writeEffect: false,
    grantRefs: ['grant-device'],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    signal: new AbortController().signal,
    input,
  };
}

function certificateInput() {
  return {
    deviceAddress: '192.0.2.10',
    credential: { username: 'nsroot', secretRef: 'secret://citrix/password', grantId: 'grant-device' },
    protocolFixture: fixture({}),
  };
}

function fixture(responses) {
  return { apiVersion: 'gcac.device-fixture/v1', protocol: 'NITRO', device: { managementAddress: '192.0.2.10' }, responses };
}

const hostApi = {
  call: async (method) => {
    assert.equal(method, 'secret.grant.resolve');
    return { ok: true, data: { value: '[REDACTED]' } };
  },
};
