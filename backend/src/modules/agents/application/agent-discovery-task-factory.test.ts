import assert from 'node:assert/strict';
import test from 'node:test';

import { WINDOWS_WEB_DISCOVERY_PATHS } from '../agent-discovery-paths.js';
import { createAgentDiscoveryTaskFactory } from './agent-discovery-task-factory.js';

test('Web 重新发现只创建一条 Agent Core 库存任务，不回退 Plugin Runner', async () => {
  const payloads: Record<string, unknown>[] = [];
  const factory = createAgentDiscoveryTaskFactory({
    repository: {
      findTaskByIdempotencyKey: async () => undefined,
      createTask: async (input: { payload: Record<string, unknown> }) => {
        payloads.push(input.payload);
        return { id: `task-${payloads.length}`, ...input };
      },
    },
    plugins: { listAccessibleVersions: async () => [plugin('web.apache'), plugin('web.nginx')] },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: async () => ({
        token: { actions: ['filesystem.read', 'process.list', 'service.list'], allowedPaths: ['/etc'], allowedServices: [], artifactDigests: [] },
        decision: { allowed: true },
      }),
    },
  } as never);

  const tasks = await factory.createForAgent({
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', descriptor: { osType: 'linux' } },
    requestedBy: 'user-1',
    requestId: 'request-1',
  } as never);

  assert.equal(tasks.length, 1);
  assert.equal(payloads.length, 1);
  const [payload] = payloads;
  assert.equal(payload?.actionType, 'agent.fact.collect');
  assert.equal(payload?.pluginId, 'web.nginx');
  assert.equal('pluginVersionId' in (payload ?? {}), false);
  assert.equal(payload?.refreshWebInventory, true);
  assert.equal(payload?.requestedBy, 'user-1');
  assert.equal('action' in (payload ?? {}), false);
  assert.equal('pluginFactBinding' in (payload ?? {}), false);
});

test('没有 Agent 发现授权锚点时失败关闭', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    repository: {},
    plugins: { listAccessibleVersions: async () => [] },
    policyAuthority: { assertReady: () => undefined, issueAuthorization: async () => undefined },
  } as never);

  await assert.rejects(
    () => factory.createForAgent({ tenantId: 'tenant-1', agent: { id: 'agent-1', descriptor: { osType: 'linux' } }, requestedBy: 'user-1', requestId: 'request-1' } as never),
    /没有启用且支持 Agent 发现授权的 Web 插件版本/,
  );
});

test('Windows Compatibility Agent 只请求固定 Windows Web 发现目录', async () => {
  let authorizationRequest: Record<string, unknown> | undefined;
  const factory = createAgentDiscoveryTaskFactory({
    repository: {
      findTaskByIdempotencyKey: async () => undefined,
      createTask: async (input: Record<string, unknown>) => ({ id: 'task-windows', ...input }),
    },
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

  assert.deepEqual(authorizationRequest?.allowedPaths, WINDOWS_WEB_DISCOVERY_PATHS);
});

test('授权拒绝会保留 Policy Authority 的诊断原因', async () => {
  const factory = createAgentDiscoveryTaskFactory({
    repository: {},
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

function plugin(pluginId: string) {
  return {
    id: `${pluginId}-version-1`, pluginId, version: '1.0.0', status: 'ENABLED',
    manifest: { capabilities: [{ key: 'application.discover', executionLocations: ['AGENT'] }], permissions: [] },
  };
}
