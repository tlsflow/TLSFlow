import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { HostDto, ManagedTargetDto } from '../assets/dto/assets.dto.js';
import { ManagedTargetContextResolver, type ManagedTargetAssetsPort, type ResolvedManagedTargetContext } from '../assets/application/managed-target-context.resolver.js';
import { createBuiltinDeploymentDriverRegistry } from '../deployment-plans/application/deployment-driver.registry.js';
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
    actionType: 'agent.atomic_plan.execute',
    actionSchemaVersion: '2.0',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'AGENT_ACTION_SCHEMA_UNSUPPORTED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T07 无 Assignment 的历史 Action 必须拒绝且不入队', { todo: '034.1-T07' }, async () => {
  const queue = createAgentQueueProbe();
  const result = await new AgentExecutorAdapter(queue.agents).executeStep(stepInput({
    type: 'windows.iis.deploy_certificate',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T08 默认生产执行器注册表不得注册 Legacy SCRIPT_PACKAGE', { todo: '034.1-T08' }, () => {
  const registry = createDefaultExecutorRegistry();
  assert.equal(registry.has('SCRIPT_PACKAGE'), false);
});

test('T09 ManagedTarget 上下文不得包含所有者派生 driverKind', { todo: '034.1-T09' }, async () => {
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

test('T10 未知 Framework 不得被宿主固定列表拒绝', { todo: '034.1-T10' }, () => {
  const registry = createBuiltinDeploymentDriverRegistry();
  assert.doesNotThrow(() => registry.resolve(driverContext('runtime.fixture')));
});

function createAgentQueueProbe(): {
  agents: AgentsApplicationService;
  enqueueCount(): number;
  directCount(): number;
} {
  let enqueued = 0;
  let direct = 0;
  const agents = {
    enqueueDirectTask: async () => {
      enqueued += 1;
      return { id: 'task_fixture', status: 'acked' };
    },
    executeTaskDirect: async () => {
      direct += 1;
      return { success: true, detail: { mode: 'unexpected_direct_execute' } };
    },
  } as unknown as AgentsApplicationService;
  return { agents, enqueueCount: () => enqueued, directCount: () => direct };
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

function driverContext(frameworkType: string): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target_fixture', tenantId: 'tenant_fixture', deviceId: 'host_fixture', discoveryProviderKey: 'fixture.discovery',
      targetType: 'tls.binding', targetKey: 'fixture', supportedCapabilities: ['certificate.deploy'],
      executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {}, createdAt: now, updatedAt: now, version: 1,
    },
    host: {
      id: 'host_fixture', tenantId: 'tenant_fixture', osType: 'LINUX', ipAddresses: [], managementChannels: [],
      discoverySource: 'AGENT', compatibilityLevel: 'L1', managementMode: 'AGENT', status: 'ACTIVE', tags: [],
      createdAt: now, updatedAt: now, version: 1,
    },
    discoveryProviderKey: 'fixture.discovery', frameworkType, driverKind: 'AGENT_NATIVE', executionLocation: 'AGENT',
    availableExecutionLocations: ['AGENT'],
  };
}
