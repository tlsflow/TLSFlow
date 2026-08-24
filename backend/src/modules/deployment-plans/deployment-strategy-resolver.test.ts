import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import type { ServiceAssetDto, ApplicationAssetTargetSummaryDto } from '../assets/dto/assets.dto.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import { DeploymentStrategyResolver } from './application/deployment-strategy-resolver.js';
import type { ResolvedManagedTargetContext } from '../assets/application/managed-target-context.resolver.js';

describe('DeploymentStrategyResolver', () => {
  it('没有显式策略时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();
    assert.throws(() => resolver.resolve({
      applicationAsset: serviceAsset({ agentId: 'agent_1' }),
      bindingTarget: bindingTarget({ managedTargetId: 'target_1' }),
      certificateBinding: certificateBinding(),
    }), (error: unknown) => error instanceof AppError
      && (error.details as { code?: string } | undefined)?.code === 'DEPLOYMENT_STRATEGY_MISSING');
  });

  it('受管目标快照只使用 Capability Resolution 生成的 Agent Runtime', () => {
    const resolver = new DeploymentStrategyResolver();
    const resolved = resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: {
          type: 'MANAGED_TARGET',
          managedTarget: { managedTargetId: 'target_1' },
        },
      }),
      bindingTarget: bindingTarget(),
      certificateBinding: certificateBinding(),
      managedTargetContext: managedTargetContext(),
      managedTargetRuntime: runtimeRequest('AGENT'),
    });

    assert.equal(resolved.strategyType, 'MANAGED_TARGET');
    assert.equal(resolved.executorType, 'AGENT');
    assert.equal(resolved.executionTargetId, 'agent_1');
    assert.equal('driverKind' in resolved.payload, false);
    assert.equal('executionLocation' in resolved.payload, false);
    assert.equal((resolved.payload.pluginRuntimeCapability as { pluginVersionId?: string }).pluginVersionId, 'plugin_version_1');
  });

  it('设备受管目标快照只使用 Capability Resolution 生成的 Workflow Runtime', () => {
    const resolver = new DeploymentStrategyResolver();
    const resolved = resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: {
          type: 'MANAGED_TARGET',
          managedTarget: { managedTargetId: 'target_1' },
        },
      }),
      bindingTarget: bindingTarget(),
      certificateBinding: certificateBinding(),
      managedTargetContext: managedTargetContext({
        discoveryProviderKey: 'plugin-version:uplgv_plugin_test',
        availableExecutionLocations: ['CONTROL_PLANE'],
        agent: undefined,
        deviceAsset: {
          id: 'device_1',
          tenantId: 'tenant_1',
          hostId: 'host_1',
          displayName: 'ADC 13.1',
          managementAddress: '10.255.0.49',
          managementPort: 80,
          deviceFamily: 'generic.device-plugin',
          credentialId: 'secret_nitro',
          authMode: 'SESSION',
          tlsVerify: false,
          supportTier: 'SUPPORTED',
          capabilityProfile: {},
          pluginBindingId: 'binding_plugin_test',
          pluginVersionId: 'uplgv_plugin_test',
          createdAt: '2026-07-03T00:00:00.000Z',
          updatedAt: '2026-07-03T00:00:00.000Z',
          version: 1,
        },
      }),
      managedTargetRuntime: runtimeRequest('WORKFLOW'),
    });

    assert.equal(resolved.executorType, 'WORKFLOW');
    assert.equal(resolved.executionTargetId, 'target_1');
    assert.equal('deploymentSteps' in resolved.payload, false);
    assert.equal('rollbackSteps' in resolved.payload, false);
    assert.equal((resolved.payload.pluginRuntimeCapability as { pluginBindingId?: string }).pluginBindingId, 'plugin_binding_1');
  });

  it('MANAGED_TARGET 缺少 Capability Resolution 结果时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();
    assert.throws(() => resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target_1' } },
      }),
      managedTargetContext: managedTargetContext(),
    }), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.errorCode, 'CAPABILITY_MISSING');
      assert.equal((error.details as { code?: string }).code, 'MANAGED_TARGET_CAPABILITY_RESOLUTION_REQUIRED');
      return true;
    });
  });

  it('MANAGED_TARGET 缺少可信上下文时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();
    assert.throws(() => resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target_1' } },
      }),
    }), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal((error.details as { code?: string }).code, 'MANAGED_TARGET_CONTEXT_REQUIRED');
      return true;
    });
  });

  it('MANAGED_TARGET 上下文目标不一致时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();
    assert.throws(() => resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: { type: 'MANAGED_TARGET', managedTarget: { managedTargetId: 'target_other' } },
      }),
      managedTargetContext: managedTargetContext(),
    }), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal((error.details as { code?: string }).code, 'MANAGED_TARGET_CONTEXT_REQUIRED');
      return true;
    });
  });

  it('缺少显式策略且不能从绑定推导 Agent 时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();

    assert.throws(
      () => resolver.resolve({
        applicationAsset: serviceAsset(),
        bindingTarget: bindingTarget({ managedTargetId: undefined }),
        certificateBinding: certificateBinding(),
      }),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.errorCode, 'VALIDATION_FAILED');
        assert.equal((error.details as { code?: string }).code, 'DEPLOYMENT_STRATEGY_MISSING');
        return true;
      },
    );
  });

  it('Gateway 工作流策略没有 gatewayId 时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();

    assert.throws(
      () => resolver.resolve({
        applicationAsset: serviceAsset({
          deploymentStrategy: {
            type: 'WORKFLOW',
            workflow: {
              workflowId: 'workflow_1',
              workflowVersionId: 'wfver_1',
              runner: 'GATEWAY',
            },
          },
        }),
        bindingTarget: bindingTarget({ managedTargetId: 'target_1' }),
        certificateBinding: certificateBinding(),
      }),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.errorCode, 'VALIDATION_FAILED');
        assert.equal((error.details as { code?: string }).code, 'WORKFLOW_RUNNER_UNAVAILABLE');
        return true;
      },
    );
  });

  it('工作流策略只把 InputBindingsV1 传给执行请求', () => {
    const resolver = new DeploymentStrategyResolver();
    const resolved = resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: 'workflow_apache',
            workflowVersionId: 'wfver_apache_7',
            runner: 'CONTROL_PLANE',
            inputBindings: {
              apiVersion: 'gcac.input-bindings/v1',
              connections: { targetSsh: { host: '10.255.0.127', port: 22, username: 'root' } },
              variables: {
                certificateFilePath: '/etc/gcac-test/certs/apache/apache-test.crt',
                deviceHost: '10.255.0.127',
              },
              credentials: { targetSsh: { credentialId: 'cred_ssh' } },
              artifacts: {},
            },
          },
        },
      }),
      certificateBinding: certificateBinding(),
    });
    const workflowRequest = resolved.payload.workflowRequest as Record<string, unknown>;
    assert.deepEqual(workflowRequest.inputBindings, {
      apiVersion: 'gcac.input-bindings/v1',
      connections: { targetSsh: { host: '10.255.0.127', port: 22, username: 'root' } },
      variables: { certificateFilePath: '/etc/gcac-test/certs/apache/apache-test.crt', deviceHost: '10.255.0.127' },
      credentials: { targetSsh: { credentialId: 'cred_ssh' } },
      artifacts: {},
    });
  });
});

function serviceAsset(patch: Partial<ServiceAssetDto> = {}): ServiceAssetDto {
  return {
    id: 'asset_1',
    tenantId: 'tenant_1',
    address: 'example.com',
    addressType: 'DNS',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'manual',
    status: 'ACTIVE',
    tags: [],
    metadata: {},
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    version: 1,
    ...patch,
  } as ServiceAssetDto;
}

function bindingTarget(patch: Partial<ApplicationAssetTargetSummaryDto> = {}): ApplicationAssetTargetSummaryDto {
  return {
    id: 'asset_target_1',
    tenantId: 'tenant_1',
    applicationAssetId: 'asset_1',
    managedTargetId: 'target_1',
    status: 'ACTIVE',
    metadata: {},
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    version: 1,
    ...patch,
  } as ApplicationAssetTargetSummaryDto;
}

function certificateBinding(patch: Partial<CertificateBindingDto> = {}): CertificateBindingDto {
  return {
    id: 'binding_1',
    tenantId: 'tenant_1',
    serviceInstanceId: 'svc_1',
    hostId: 'host_1',
    bindingType: 'WINDOWS_CERT_STORE',
    bindingKey: '*:443:example.com',
    verifyMethod: 'TLS_CONNECT',
    status: 'DISCOVERED',
    metadata: {},
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    version: 1,
    ...patch,
  } as CertificateBindingDto;
}

function managedTargetContext(patch: Partial<ResolvedManagedTargetContext> = {}): ResolvedManagedTargetContext {
  return {
    managedTarget: {
      id: 'target_1', tenantId: 'tenant_1', deviceId: 'host_1', siteId: 'site_1', discoveryProviderKey: 'agent.discovery',
      targetType: 'tls.binding', targetKey: 'target_1', supportedCapabilities: ['certificate.deploy'], executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {},
      createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z', version: 1,
    },
    host: {
      id: 'host_1', tenantId: 'tenant_1', hostname: 'server-1', osType: 'WINDOWS', managementChannels: [],
      discoverySource: 'agent', agentId: 'agent_1', compatibilityLevel: 'L1', managementMode: 'AGENT', status: 'ACTIVE', tags: [],
      createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z', version: 1,
    },
    agent: { id: 'agent_1', tenantId: 'tenant_1', name: 'agent-1', status: 'online' } as unknown as ResolvedManagedTargetContext['agent'],
    discoveryProviderKey: 'agent.discovery',
    frameworkType: 'web.iis',
    availableExecutionLocations: ['AGENT'],
    ...patch,
  } as ResolvedManagedTargetContext;
}

function runtimeRequest(runtime: 'AGENT' | 'WORKFLOW') {
  return {
    executorType: runtime,
    executionTargetId: runtime === 'AGENT' ? 'agent_1' : 'target_1',
    requiredCapabilities: runtime === 'AGENT' ? ['agent.plan.execute'] : ['workflow.run'],
    payload: {
      pluginRuntimeCapability: {
        pluginVersionId: 'plugin_version_1',
        pluginBindingId: 'plugin_binding_1',
        executionLocation: runtime === 'AGENT' ? 'AGENT' : 'CONTROL_PLANE',
      },
    },
  } as const;
}
