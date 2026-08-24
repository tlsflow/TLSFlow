import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { WINDOWS_WEB_DISCOVERY_PATHS } from '../agent-discovery-paths.js';
import { createAgentDiscoveryTaskFactory } from './agent-discovery-task-factory.js';

test('Web 重新发现只创建一条已授权的 Agent 直连请求，不回退 Plugin Runner 或任务队列', async () => {
  const payloads: Record<string, unknown>[] = [];
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('web.apache'), plugin('web.nginx')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'user-1',
    requestId: 'request-1',
  } as never);

  const payload = request.payload;
  payloads.push(payload);
  assert.equal(request.requestId, 'request-1');
  assert.equal(payloads.length, 1);
  assert.equal(payload?.actionType, 'agent.fact.collect');
  assert.equal(payload?.pluginId, 'web.apache');
  assert.equal('pluginVersionId' in (payload ?? {}), false);
  assert.equal(payload?.refreshWebInventory, true);
  assert.equal(payload?.requestedBy, 'user-1');
  assert.equal('action' in (payload ?? {}), false);
  assert.equal('pluginFactBinding' in (payload ?? {}), false);
  assert.equal('discoverySpec' in (payload ?? {}), false);
  assert.equal(payload?.planDigest, digest({
    actionType: 'agent.fact.collect',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    pluginId: 'web.apache',
    pluginVersionId: 'web.apache-version-1',
    capability: 'application.discover',
    paths: payload?.paths,
    refreshWebInventory: true,
  }));
});

test('证书信任事实请求复用完整 Agent v2 授权且关闭 Web 库存刷新', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('web.apache')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: input.actions, allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'trust-plan',
    requestId: 'request-trust-fact',
    refreshWebInventory: false,
  } as never);

  assert.equal(request.payload.actionType, 'agent.fact.collect');
  assert.equal(request.payload.refreshWebInventory, false);
  assert.equal('token' in request.payload, true);
  assert.equal('policyDecision' in request.payload, true);
  assert.equal('factKinds' in request.payload, false);
  assert.equal('factRequest' in request.payload, false);
  assert.equal('discoverySpec' in request.payload, false);
});

test('没有 Agent 发现授权锚点时失败关闭', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [] },
    policyAuthority: { assertReady: () => undefined, issueAuthorization: async () => undefined },
  } as never);

  await assert.rejects(
    () => factory.createForAgent({ tenantId: 'tenant-1', agent: { id: 'agent-1', descriptor: { osType: 'linux' } }, requestedBy: 'user-1', requestId: 'request-1' } as never),
    /没有启用且支持 Agent 发现授权的 Canonical 插件版本/,
  );
});

test('Windows Agent 手动发现不再请求固定 Windows Web 目录根', async () => {
  let authorizationRequest: Record<string, unknown> | undefined;
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('web.iis')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => {
        authorizationRequest = input;
        return {
          token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
          decision: { allowed: true },
        };
      },
    },
  } as never);

  await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-windows', descriptor: { osType: 'WINDOWS_COMPATIBILITY' } },
    requestedBy: 'user-1',
    requestId: 'request-windows',
  } as never);

  assert.deepEqual(WINDOWS_WEB_DISCOVERY_PATHS, []);
  assert.deepEqual(authorizationRequest?.allowedPaths, []);
  assert.deepEqual(authorizationRequest?.allowedServices, []);
});

test('授权拒绝会保留 Policy Authority 的诊断原因', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('web.iis')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async () => ({ decision: { allowed: false, reason: '生产策略未匹配当前租户、Agent、插件版本或 Capability' } }),
    },
  } as never);

  await assert.rejects(
    () => factory.createForAgent({ tenantId: 'tenant-1', agent: { id: 'agent-windows', descriptor: { osType: 'WINDOWS_COMPATIBILITY' } }, requestedBy: 'user-1', requestId: 'request-windows' } as never),
    (error: unknown) => error instanceof Error
      && error.message === 'Web 发现授权未签发'
      && 'details' in error
      && (error as { details?: { reason?: string } }).details?.reason === '生产策略未匹配当前租户、Agent、插件版本或 Capability',
  );
});

test('Windows 发现请求不会从插件注入扫描 profile', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [
      plugin('web.nginx', { source: 'USER', trust: 'UNSIGNED' }),
      plugin('web.apache'),
    ] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'user-1',
    requestId: 'request-1',
  } as never);

  assert.equal('discoverySpec' in request.payload, false);
  assert.equal(request.payload.pluginId, 'web.apache');
});

test('Windows 成熟扫描器不依赖某个框架插件的 profile', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('app.java-keystore')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'user-1',
    requestId: 'request-custom',
  } as never);

  assert.equal('discoverySpec' in request.payload, false);
  assert.equal(request.payload.pluginId, 'app.java-keystore');
});

test('非 Canonical 内置插件不能成为 Agent 发现授权锚点', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: { listAccessibleVersions: async () => [plugin('builtin.windows.iis.pfx'), plugin('web.iis')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'user-1',
    requestId: 'request-canonical-only',
  } as never);

  assert.equal('discoverySpec' in request.payload, false);
  assert.equal(request.payload.pluginId, 'web.iis');
});

test('Windows 和 Linux 发现请求都不下发插件 profile', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    plugins: {
      listAccessibleVersions: async () => [
        plugin('web.apache'),
        plugin('web.nginx'),
        plugin('app.tomcat'),
      ],
    },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async (input: Record<string, unknown>) => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: input.allowedPaths, allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const request = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-windows', descriptor: { osType: 'WINDOWS' } },
    requestedBy: 'user-1',
    requestId: 'request-windows-web-apps',
  } as never);
  assert.equal('discoverySpec' in request.payload, false);

  const linuxRequest = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-linux', descriptor: { osType: 'LINUX' } },
    requestedBy: 'user-1',
    requestId: 'request-linux-web-apps',
  } as never);
  assert.equal('discoverySpec' in linuxRequest.payload, false);
});

function plugin(pluginId: string, overrides: Partial<{
  source: 'BUILTIN' | 'USER';
  trust: 'OFFICIAL_SIGNED' | 'USER_SIGNED' | 'UNSIGNED';
}> = {}) {
  const source = overrides.source ?? 'BUILTIN';
  const trust = overrides.trust ?? 'OFFICIAL_SIGNED';
  return {
    id: `${pluginId}-version-1`, pluginId, version: '1.0.0', status: 'ENABLED',
    source,
    trust,
    manifest: {
      pluginId,
      source,
      trust,
      capabilities: [{ key: 'application.discover', executionLocations: ['AGENT'] }],
      permissions: [],
      resources: {},
    },
    resources: {},
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
