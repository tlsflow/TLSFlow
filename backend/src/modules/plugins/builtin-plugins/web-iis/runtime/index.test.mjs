import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPluginRunnerExecutor } from './index.js';
import { PluginRunnerClient } from '../../../runner/plugin-runner-client.js';

const hash = `sha256:${'a'.repeat(64)}`;
const planDigest = 'b'.repeat(64);
const env = {
  GCAC_PLUGIN_VERSION_ID: 'web-iis-1-0-0-dev',
  GCAC_PLUGIN_PACKAGE_HASH: hash,
  GCAC_PLUGIN_MANIFEST_HASH: hash,
  GCAC_PLUGIN_RESOURCE_HASH: hash,
};

test('IIS 工厂只导出标准入口并读取适配器注入的四项身份', () => {
  withEnvironment(env, () => {
    assert.deepEqual(createPluginRunnerExecutor().descriptor, {
      pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
      pluginId: 'web.iis',
      pluginVersion: '1.0.0',
      capabilities: ['application.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      permissions: ['artifact.read', 'agent.fact.collect', 'agent.plan.validate', 'agent.plan.execute', 'agent.execution.receipt', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
      packageHash: hash,
      manifestHash: hash,
      resourceHash: hash,
    });
  });
});

test('IIS 缺少固定摘要时工厂失败关闭', () => {
  withEnvironment(env, () => {
    delete process.env.GCAC_PLUGIN_RESOURCE_HASH;
    assert.throws(() => createPluginRunnerExecutor(), /GCAC_PLUGIN_RESOURCE_HASH/);
  });
});

test('IIS 缺少 Token、Decision、Nonce、Receipt、Grant 或本地策略时失败关闭', async () => {
  await withEnvironmentAsync(env, async () => {
    const executor = createPluginRunnerExecutor();
    const input = { protocolFixture: discoveryFixture() };
    for (const field of ['token', 'policyDecision', 'receipt', 'grant', 'localPolicy']) {
      const authorization = authorizationFixture('discover');
      delete authorization[field];
      await assert.rejects(
        () => executor.execute(context('application.discover', authorization), {}),
        new RegExp(`agentAuthorization\\.${field}`),
      );
    }
    await assert.rejects(
      () => executor.execute(context('application.discover', { ...authorizationFixture('discover'), nonce: undefined }), {}),
      /agentAuthorization\.nonce/,
    );
    void input;
  });
});

test('IIS 真实 Runner 子进程执行 Agent-side discovery Fixture 并输出标准对象', async () => {
  const client = new PluginRunnerClient({
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'web.iis',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'), '--executor-module', resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/web-iis/runtime/index.js')],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['application.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback'],
    hostPermissions: ['artifact.read', 'agent.fact.collect', 'agent.plan.validate', 'agent.plan.execute', 'agent.execution.receipt', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    startupTimeoutMs: 1000,
    helloTimeoutMs: 500,
    executeTimeoutMs: 1000,
  });
  try {
    const result = await client.execute({
      tenantId: 'tenant-device', executionId: 'run-iis', executionStepId: 'step-discover', workflowVersionId: 'workflow-iis-1', planDigest,
      capability: 'application.discover', grantRefs: ['agent-grant'], idempotencyKey: 'idem-iis', writeEffect: false,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: { deviceAddress: 'iis-fixture-01', displayName: 'IIS Fixture', agentAuthorization: authorizationFixture('discover'), protocolFixture: discoveryFixture() },
    });
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(result.normalizedObjects[0].apiVersion, 'gcac.device-discovery/v2');
    assert.equal(result.normalizedObjects[0].device.productFamily, 'web.iis');
    assert.equal(result.normalizedObjects[0].certificateBindings.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value|privateKey/);
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('IIS 真实 Runner 子进程在 Agent-side 写后断连时返回 UNKNOWN', async () => {
  const failureFixture = loadFailureFixture();
  const authorization = authorizationFixture('update-binding', ['agent-grant'], failureFixture.receipt.planDigest);
  const client = new PluginRunnerClient({
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'web.iis',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-device',
    executablePath: process.execPath,
    args: [resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'), '--executor-module', resolve(process.cwd(), 'dist/modules/plugins/builtin-plugins/web-iis/runtime/index.js')],
    workingDirectory: process.cwd(),
    environment: env,
    runnerVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['application.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback'],
    hostPermissions: ['artifact.read', 'agent.fact.collect', 'agent.plan.validate', 'agent.plan.execute', 'agent.execution.receipt', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'],
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    startupTimeoutMs: 1000,
    helloTimeoutMs: 500,
    executeTimeoutMs: 1000,
  });
  try {
    const result = await client.execute({
      tenantId: 'tenant-device', executionId: 'run-iis-failure', executionStepId: 'step-deploy', workflowVersionId: 'workflow-iis-1', planDigest: failureFixture.receipt.planDigest,
      capability: 'certificate.deploy', grantRefs: ['agent-grant'], idempotencyKey: 'idem-iis-failure', writeEffect: true,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(), input: { agentAuthorization: authorization, protocolFixture: failureFixture },
    });
    assert.equal(result.status, 'UNKNOWN', JSON.stringify(result));
    assert.equal(result.error.code, 'PLUGIN_OPERATION_UNKNOWN_STATE', JSON.stringify(result));
    assert.equal(client.state, 'READY');
  } finally {
    if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
    else await client.stop(true);
  }
});

test('IIS deploy 通过 Artifact Grant、验证和脱敏合同', async () => {
  await withEnvironmentAsync(env, async () => {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      ...context('certificate.deploy', authorizationFixture('update-binding'), ['agent-grant', 'artifact-grant']),
      writeEffect: true,
      input: {
        target: 'Default Web Site|192.0.2.80:443:www.example.invalid',
        artifact: { artifactRef: 'artifact://certificate/iis-new', grantId: 'artifact-grant' },
        agentAuthorization: authorizationFixture('update-binding', ['agent-grant', 'artifact-grant']),
        protocolFixture: deployFixture(),
      },
    }, {
      call: async (method, input, grants) => {
        assert.equal(method, 'artifact.grant.read');
        assert.equal(input.artifactRef, 'artifact://certificate/iis-new');
        assert.deepEqual(grants, ['artifact-grant']);
        return { ok: true, data: { sha256: hash } };
      },
    });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.summary.verified, true);
    assert.equal(result.summary.artifactSha256, hash);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|secret-value/);
  });
});

test('IIS 写入结果不明时只能返回 UNKNOWN', async () => {
  await withEnvironmentAsync(env, async () => {
    const executor = createPluginRunnerExecutor();
    const failureFixture = loadFailureFixture();
    const authorization = authorizationFixture('update-binding', ['agent-grant', 'artifact-grant'], failureFixture.receipt.planDigest);
    const result = await executor.execute({
      ...context('certificate.deploy', authorization, ['agent-grant', 'artifact-grant']),
      writeEffect: true,
      input: { target: 'Default Web Site|192.0.2.80:443:www.example.invalid', artifact: { artifactRef: 'artifact://certificate/iis-new', grantId: 'artifact-grant' }, agentAuthorization: authorization, protocolFixture: failureFixture },
    }, { call: async () => ({ ok: true, data: { sha256: hash } }) });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.error.code, 'PLUGIN_OPERATION_UNKNOWN_STATE');
  });
});

function context(capability, authorization, grantRefs = ['agent-grant']) {
  return {
    pluginVersionId: env.GCAC_PLUGIN_VERSION_ID,
    pluginId: 'web.iis',
    pluginVersion: '1.0.0',
    tenantId: 'tenant-device',
    executionId: 'run-iis',
    executionStepId: 'step-iis',
    capability,
    grantRefs,
    idempotencyKey: 'idem-iis',
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    writeEffect: capability === 'certificate.deploy' || capability === 'certificate.rollback',
    signal: new AbortController().signal,
    input: { agentAuthorization: authorization, protocolFixture: discoveryFixture() },
  };
}

function authorizationFixture(operation, grantRefs = ['agent-grant'], authorizationPlanDigest = planDigest) {
  const nonce = 'nonce-iis-fixture';
  const common = { agentId: 'agent-iis-01', tenantId: 'tenant-device', pluginId: 'web.iis', pluginVersion: '1.0.0', pluginVersionId: env.GCAC_PLUGIN_VERSION_ID, planDigest: authorizationPlanDigest, nonce };
  return {
    ...common,
    nonce,
    packageHash: hash,
    manifestHash: hash,
    resourceHash: hash,
    token: { ...common, tokenId: 'token-iis-01', actions: [operation], signature: 'fixture-token-signature' },
    policyDecision: { ...common, decisionId: 'decision-iis-01', allowed: true, actions: [operation], signature: 'fixture-decision-signature' },
    receipt: { ...common, planId: 'plan-iis-01', status: 'PENDING', digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    grant: { ...common, grantId: grantRefs.includes('artifact-grant') ? 'artifact-grant' : 'agent-grant', allowedActions: [operation], artifactDigests: [hash] },
    localPolicy: { agentId: 'agent-iis-01', policyVersion: 'fixture-policy-v1', disabled: false, allowedActions: [operation] },
  };
}

function discoveryFixture() {
  return {
    apiVersion: 'gcac.agent-side-plugin/v1', pluginId: 'web.iis', pluginVersion: '1.0.0', operation: 'discover', status: 'SUCCESS',
    facts: { iisVersion: '10.0.20348.1', machineName: 'iis-fixture-01', sites: [{ name: 'Default Web Site', addresses: ['192.0.2.80'], port: 443, applicationPool: 'DefaultAppPool' }], bindings: [{ siteName: 'Default Web Site', bindingInformation: '192.0.2.80:443:www.example.invalid', protocol: 'https', hostName: 'www.example.invalid', certificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD', certificateStoreName: 'My', sha256Fingerprint: 'a'.repeat(64) }] },
    receipt: { planDigest, nonce: 'nonce-iis-fixture', digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'SUCCESS' },
  };
}

function deployFixture() {
  return {
    apiVersion: 'gcac.agent-side-plugin/v1', pluginId: 'web.iis', pluginVersion: '1.0.0', operation: 'update-binding', status: 'SUCCESS', verified: true,
    previousBinding: { siteName: 'Default Web Site', bindingInformation: '192.0.2.80:443:www.example.invalid', protocol: 'https', hostName: 'www.example.invalid', certificateThumbprint: '00112233445566778899AABBCCDDEEFF00112233', certificateStoreName: 'My' },
    binding: { siteName: 'Default Web Site', bindingInformation: '192.0.2.80:443:www.example.invalid', protocol: 'https', hostName: 'www.example.invalid', certificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD', certificateStoreName: 'My' },
    receipt: { planDigest, nonce: 'nonce-iis-fixture', digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'SUCCESS' },
  };
}

function loadFailureFixture() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src/modules/plugins/builtin-plugins/web-iis/fixtures/iis-error-cases.json'), 'utf8'));
}

async function withEnvironmentAsync(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { return await callback(); }
  finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
}

function withEnvironment(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { return callback(); }
  finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
}
