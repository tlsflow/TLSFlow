import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { HostDto, ManagedTargetDto } from '../assets/dto/assets.dto.js';
import { ManagedTargetContextResolver, type ManagedTargetAssetsPort } from '../assets/application/managed-target-context.resolver.js';
import { UnifiedAgentPlanCompilerService } from '../plugins/application/unified-agent-plan-compiler.service.js';
import { AgentExecutorAdapter, createDefaultExecutorRegistry } from './application/executors.js';

const now = '2026-07-30T00:00:00.000Z';

test('T06 未知 Agent Action 必须在入队前失败关闭', async () => {
  const queue = createAgentQueueProbe();
  const result = await new AgentExecutorAdapter(queue.agents).executeStep(stepInput({
    actionType: 'unknown.fixture.deploy',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'AGENT_ACTION_UNREGISTERED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T06 缺失 Agent Action 必须拒绝且不得回显 Snapshot 秘密字段', async () => {
  const queue = createAgentQueueProbe();
  const result = await new AgentExecutorAdapter(queue.agents).executeStep(stepInput({
    privateKeyPem: 'sensitive-private-key',
    password: 'sensitive-password',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'AGENT_ACTION_UNREGISTERED');
  assert.equal(JSON.stringify(result).includes('sensitive-private-key'), false);
  assert.equal(JSON.stringify(result).includes('sensitive-password'), false);
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T06 不支持的 Agent Action Schema 必须在入队前失败关闭', async () => {
  const queue = createAgentQueueProbe();
  const result = await new AgentExecutorAdapter(queue.agents).executeStep(stepInput({
    actionType: 'agent.plan.execute',
    actionSchemaVersion: '2.0',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'AGENT_ACTION_SCHEMA_UNSUPPORTED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T07 Agent v2 缺少完整 Policy/Token 时失败关闭且不入队', async () => {
  const queue = createAgentQueueProbe();
  await assert.rejects(
    new AgentExecutorAdapter(queue.agents, undefined, new UnifiedAgentPlanCompilerService({} as never)).executeStep(stepInput({
      actionType: 'agent.plan.execute',
      pluginBindingId: 'binding_fixture',
      pluginRuntimeCapability: { pluginVersionId: 'plugin_version_fixture' },
      resolvedDeploymentInput: resolvedInput(),
    })),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T08 默认生产执行器注册表不得注册 Legacy SCRIPT_PACKAGE', () => {
  const registry = createDefaultExecutorRegistry();
  assert.equal(registry.has('SCRIPT_PACKAGE'), false);
});

test('T09 ManagedTarget 上下文不得包含所有者派生 driverKind', async () => {
  const resolver = new ManagedTargetContextResolver(
    managedTargetAssetsPort(),
    { getRegistration: async () => ({
      id: 'agent_fixture', tenantId: 'tenant_fixture', agentKey: 'agent-fixture',
      descriptor: { agentKey: 'agent-fixture', hostname: 'fixture', version: '1', osType: 'linux', labels: [] },
      status: 'ONLINE', registeredAt: now, updatedAt: now, version: 1,
    }) },
    { findByHostId: async () => undefined },
  );

  const context = await resolver.resolve('tenant_fixture', 'target_fixture');
  assert.equal('driverKind' in context, false);
  assert.deepEqual(context.availableExecutionLocations, ['AGENT']);
});

function createAgentQueueProbe(onEnqueue?: (payload: Record<string, unknown>) => void): {
  agents: AgentsApplicationService;
  enqueueCount(): number;
  directCount(): number;
} {
  let enqueued = 0;
  let direct = 0;
  const agents = {
    enqueueDirectTask: async (_tenantId: string, input: { payload: Record<string, unknown> }) => {
      enqueued += 1;
      onEnqueue?.(input.payload);
      return { id: 'task_fixture', status: 'acked' };
    },
    executeTaskDirect: async () => {
      direct += 1;
      return { success: true, detail: { mode: 'unexpected_direct_execute' } };
    },
  } as unknown as AgentsApplicationService;
  return { agents, enqueueCount: () => enqueued, directCount: () => direct };
}

function resolvedInput() {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1', contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_fixture', address: 'fixture.example.com', serverName: 'fixture.example.com', port: 443, protocol: 'HTTPS' },
      host: { id: 'host_fixture', osType: 'LINUX' },
      target: { id: 'target_fixture', type: 'tls.binding', key: 'fixture', metadata: { frameworkType: 'web.nginx' } },
      deployment: { targets: [], certificateResourceName: 'fixture-certificate' },
    },
    variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [], executable: true,
    resolvedSha256: 'sha256:fixture',
  };
}

function stepInput(snapshot: Record<string, unknown>) {
  return {
    step: {
      id: 'step_fixture', tenantId: 'tenant_fixture', executionRunId: 'run_fixture',
      deploymentPlanTargetId: 'target_fixture', stepNo: 1, stepType: 'INSTALL' as const,
      name: '插件架构旁路终态契约', dependsOn: [], idempotent: true, attemptCount: 1, maxAttempts: 1,
      inputSnapshot: { executorType: 'AGENT', agentId: 'agent_fixture', ...snapshot }, status: 'PENDING' as const,
      createdAt: now, updatedAt: now, createdBy: 'spec034.1', version: 1,
    },
    runType: 'apply' as const,
    dryRun: false,
  };
}

function managedTargetAssetsPort(): ManagedTargetAssetsPort {
  const target = {
    id: 'target_fixture', tenantId: 'tenant_fixture', deviceId: 'host_fixture', discoveryProviderKey: 'fixture.discovery',
    targetType: 'tls.binding', targetKey: 'fixture', supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {}, createdAt: now, updatedAt: now, version: 1,
  } as ManagedTargetDto;
  const host = {
    id: 'host_fixture', tenantId: 'tenant_fixture', agentId: 'agent_fixture', osType: 'LINUX', ipAddresses: [],
    managementChannels: [], discoverySource: 'AGENT', compatibilityLevel: 'L1', managementMode: 'AGENT',
    status: 'ACTIVE', tags: [], createdAt: now, updatedAt: now, version: 1,
  } as HostDto;
  return {
    getManagedTarget: async () => target,
    getHost: async () => host,
    getSiteAsset: async () => undefined,
    getFrameworkInstance: async () => undefined,
  };
}
