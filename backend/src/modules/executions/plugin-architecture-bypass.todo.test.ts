import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { HostDto, ManagedTargetDto, ServiceAssetDto } from '../assets/dto/assets.dto.js';
import { ManagedTargetContextResolver, type ManagedTargetAssetsPort, type ResolvedManagedTargetContext } from '../assets/application/managed-target-context.resolver.js';
import { createDefaultPluginRuntimeAdapterRegistry } from '../deployment-plans/application/plugin-runtime-adapter.registry.js';
import { DeploymentStrategyResolver } from '../deployment-plans/application/deployment-strategy-resolver.js';
import { DeploymentCapabilityResolver } from '../plugins/application/deployment-capability.resolver.js';
import type { PluginBindingsApplicationService } from '../plugins/application/plugin-bindings.application-service.js';
import type { UnifiedPluginVersionRecord } from '../plugins/dto/unified-plugins.dto.js';
import { AgentExecutorAdapter, createDefaultExecutorRegistry } from './application/executors.js';
import { AppError } from '../../common/errors/app-error.js';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';

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

test('T07 无统一输入的历史 Action 必须要求重建计划且不入队', async () => {
  const queue = createAgentQueueProbe();
  const result = await new AgentExecutorAdapter(queue.agents, undefined, {} as never, {} as never).executeStep(stepInput({
    type: 'windows.iis.deploy_certificate',
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T07 无 Assignment 的历史 Action 必须拒绝且不入队', async () => {
  const queue = createAgentQueueProbe();
  const resolver = { resolve: async () => { throw new AppError('HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED', 'fixture'); } };
  const result = await new AgentExecutorAdapter(queue.agents, undefined, {} as never, resolver as never).executeStep(stepInput({
    type: 'windows.iis.deploy_certificate',
    resolvedDeploymentInput: resolvedInput(),
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED');
  assert.equal(queue.enqueueCount(), 0);
  assert.equal(queue.directCount(), 0);
});

test('T07 可转换历史 Action 只能作为带迁移审计的 Atomic Plan 入队', async () => {
  let payload: Record<string, unknown> | undefined;
  const queue = createAgentQueueProbe((value) => { payload = value; });
  const resolver = { resolve: async () => ({
    originalActionType: 'linux.nginx.deploy_certificate',
    alias: { actionType: 'linux.nginx.deploy_certificate', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' },
    capability: { pluginVersionId: 'plugin-version-fixture', binding: { id: 'binding-fixture' } },
  }) };
  const compiler = { compile: async () => ({ apiVersion: 'gcac.agent-plan/v1', planId: 'plan-fixture', authorization: { keyId: 'key-fixture', signature: 'signature-fixture' } }) };
  const result = await new AgentExecutorAdapter(queue.agents, undefined, compiler as never, resolver as never).executeStep(stepInput({
    type: 'linux.nginx.deploy_certificate',
    resolvedDeploymentInput: resolvedInput(),
    privateKeyPem: 'must-not-forward',
  }));

  assert.equal(result.success, true);
  assert.equal(payload?.actionType, 'agent.atomic_plan.execute');
  assert.equal(payload?.actionSchemaVersion, '1.0');
  assert.equal('privateKeyPem' in (payload ?? {}), false);
  const audit = payload?.historicalActionMigration as Record<string, unknown>;
  assert.equal(audit.originalActionType, 'linux.nginx.deploy_certificate');
  assert.match(String(audit.planSha256), /^sha256:[a-f0-9]{64}$/);
  assert.equal(queue.enqueueCount(), 1);
  assert.equal(queue.directCount(), 1);
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

test('T10 未知 Framework 通过 Assignment、Binding、兼容性和 Runtime Adapter 编译', async () => {
  const context = unknownFrameworkContext();
  const capability = await unknownFrameworkCapabilityResolver().resolve({
    tenantId: 'tenant_fixture',
    capabilityKey: 'certificate.deploy',
    hostId: context.host.id,
    managedTargetId: context.managedTarget.id,
    applicationAssetId: 'asset_fixture',
    executionLocations: context.availableExecutionLocations,
    compatibility: {
      frameworkType: context.frameworkType,
      targetType: context.managedTarget.targetType,
      managementMethod: 'AGENT',
      artifactContract: 'certificate.deploy.v1',
    },
  });
  const runtime = await createDefaultPluginRuntimeAdapterRegistry().compile({
    capability,
    context,
    applicationAsset: unknownFrameworkApplicationAsset(),
    resolvedInput: unknownFrameworkResolvedInput(),
  });
  const strategy = new DeploymentStrategyResolver().resolve({
    applicationAsset: unknownFrameworkApplicationAsset(),
    managedTargetContext: context,
    managedTargetRuntime: runtime,
  });

  assert.equal(capability.assignment.id, 'assignment_fixture');
  assert.equal(capability.binding.id, 'binding_fixture');
  assert.equal(capability.pluginVersionId, 'plugin_version_fixture');
  assert.equal(capability.compatibility.compatible, true);
  assert.equal(runtime.executorType, 'AGENT');
  assert.equal(strategy.executorType, 'AGENT');
  assert.equal(strategy.payload.actionType, 'agent.atomic_plan.execute');
  assert.equal((strategy.payload.pluginRuntimeCapability as { assignmentId?: string }).assignmentId, 'assignment_fixture');
  assert.equal('driverKind' in strategy.payload, false);
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

function unknownFrameworkContext(): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target_fixture', tenantId: 'tenant_fixture', deviceId: 'host_fixture', discoveryProviderKey: 'fixture.discovery',
      targetType: 'tls.binding', targetKey: 'fixture', supportedCapabilities: ['certificate.deploy'],
      executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {}, createdAt: now, updatedAt: now, version: 1,
    },
    host: {
      id: 'host_fixture', tenantId: 'tenant_fixture', primaryIp: '192.0.2.10', osType: 'LINUX', ipAddresses: ['192.0.2.10'], managementChannels: [],
      agentId: 'agent_fixture',
      discoverySource: 'AGENT', compatibilityLevel: 'L1', managementMode: 'AGENT', status: 'ACTIVE', tags: [],
      createdAt: now, updatedAt: now, version: 1,
    },
    agent: { id: 'agent_fixture' } as never,
    discoveryProviderKey: 'fixture.discovery', frameworkType: 'runtime.fixture',
    availableExecutionLocations: ['AGENT'],
  };
}

function unknownFrameworkApplicationAsset(): ServiceAssetDto {
  return {
    id: 'asset_fixture', tenantId: 'tenant_fixture', displayName: 'Fixture Asset', address: 'fixture.example.com',
    addressType: 'DNS', sniName: 'fixture.example.com', port: 443, protocol: 'HTTPS', discoverySource: 'MANUAL',
    status: 'ACTIVE', tags: [], metadata: {},
    deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target_fixture' } },
    createdAt: now, updatedAt: now, version: 1,
  };
}

function unknownFrameworkResolvedInput(): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_fixture', address: 'fixture.example.com', serverName: 'fixture.example.com', port: 443, protocol: 'HTTPS' },
      target: { id: 'target_fixture', type: 'tls.binding', key: 'fixture', metadata: {} },
      deployment: { targets: [], certificateResourceName: 'certificate-fixture' },
    },
    variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [],
    executable: true,
    resolvedSha256: 'resolved-input-fixture',
  };
}

function unknownFrameworkCapabilityResolver(): DeploymentCapabilityResolver {
  const assignment = {
    id: 'assignment_fixture', tenantId: 'tenant_fixture', ownerType: 'MANAGED_TARGET', ownerId: 'target_fixture',
    capabilityKey: 'certificate.deploy', pluginVersionId: 'plugin_version_fixture', pluginBindingId: 'binding_fixture',
    precedence: 'TARGET_OVERRIDE', status: 'ACTIVE', createdAt: now, updatedAt: now,
  } as const;
  const binding = {
    id: 'binding_fixture', tenantId: 'tenant_fixture', pluginVersionId: 'plugin_version_fixture', mode: 'MANAGED',
    inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, credentials: {}, artifacts: {}, connections: {} },
    managedContext: { hostId: 'host_fixture', managedTargetId: 'target_fixture' },
    status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now,
  } as const;
  const bindings = {
    listAssignmentCandidates: async () => [assignment],
    getTenantBinding: async () => binding,
  } as unknown as PluginBindingsApplicationService;
  return new DeploymentCapabilityResolver(bindings, {
    getVersion: async () => unknownFrameworkPlugin(),
  });
}

function unknownFrameworkPlugin(): UnifiedPluginVersionRecord {
  return {
    id: 'plugin_version_fixture', tenantId: 'tenant_fixture', pluginId: 'unknown-framework-fixture', version: '1.0.0',
    source: 'USER', runtime: 'AGENT_ATOMIC', scope: 'MANAGED', trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL',
    packageSha256: 'sha256:package', manifestSha256: 'sha256:manifest', resourceSha256: {}, resources: {}, status: 'ENABLED',
    permissionApprovalStatus: 'NOT_REQUIRED', approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'sha256:manifest', resourceSha256: {} },
    createdAt: now, updatedAt: now,
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'unknown-framework-fixture', version: '1.0.0',
      displayNameKey: 'fixture.unknownFramework', publisher: 'fixture', runtime: 'AGENT_ATOMIC', source: 'USER', scope: 'MANAGED',
      trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL', permissions: [], resources: {},
      capabilities: [{
        key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1',
        riskLevel: 'HIGH', executionLocations: ['AGENT'],
      }],
      compatibility: {
        frameworkTypes: ['runtime.fixture'], targetTypes: ['tls.binding'], managementMethods: ['AGENT'],
        executionLocations: ['AGENT'], artifactContracts: ['certificate.deploy.v1'],
      },
    },
  };
}
