import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import type { ServiceAssetDto, ApplicationAssetTargetSummaryDto } from '../assets/dto/assets.dto.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import { DeploymentStrategyResolver } from './application/deployment-strategy-resolver.js';

describe('DeploymentStrategyResolver', () => {
  it('旧 Agent 绑定没有显式策略时会推导为 AGENT 策略', () => {
    const resolver = new DeploymentStrategyResolver();
    const resolved = resolver.resolve({
      applicationAsset: serviceAsset({ agentId: 'agent_1' }),
      bindingTarget: bindingTarget({ agentId: 'agent_1', siteAssetId: 'site_1', managedTargetId: 'target_1' }),
      certificateBinding: certificateBinding(),
    });

    assert.equal(resolved.strategyType, 'AGENT');
    assert.equal(resolved.executorType, 'AGENT');
    assert.equal(resolved.executionTargetId, 'target_1');
    assert.deepEqual(resolved.requiredCapabilities, ['cert.install', 'cert.verify']);
    assert.equal(resolved.payload.agentId, 'agent_1');
    assert.equal(resolved.payload.certificateBindingId, 'binding_1');
  });

  it('缺少显式策略且不能从绑定推导 Agent 时失败关闭', () => {
    const resolver = new DeploymentStrategyResolver();

    assert.throws(
      () => resolver.resolve({
        applicationAsset: serviceAsset(),
        bindingTarget: bindingTarget({ agentId: undefined, siteAssetId: undefined, managedTargetId: undefined }),
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
        bindingTarget: bindingTarget({ agentId: 'agent_1', siteAssetId: 'site_1', managedTargetId: 'target_1' }),
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

  it('工作流策略会把结构化连接和参数绑定传给执行请求', () => {
    const resolver = new DeploymentStrategyResolver();
    const resolved = resolver.resolve({
      applicationAsset: serviceAsset({
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: 'workflow_apache',
            workflowVersionId: 'wfver_apache_7',
            runner: 'CONTROL_PLANE',
            connectionBindings: {
              targetSsh: {
                host: '10.255.0.127',
                port: 22,
                username: 'root',
                credentialRef: 'sec_ssh',
                credential: { id: 'sec_ssh', kind: 'ssh_key', type: 'ssh_key' },
              },
            },
            parameterBindings: {
              certificateFilePath: '/etc/gcac-test/certs/apache/apache-test.crt',
            },
            variableBindings: {
              deviceHost: '10.255.0.127',
            },
          },
        },
      }),
      certificateBinding: certificateBinding(),
    });
    const workflowRequest = resolved.payload.workflowRequest as Record<string, unknown>;
    assert.deepEqual(workflowRequest.connectionBindings, {
      targetSsh: {
        host: '10.255.0.127',
        port: 22,
        username: 'root',
        credentialRef: 'sec_ssh',
        credential: { id: 'sec_ssh', kind: 'ssh_key', type: 'ssh_key' },
      },
    });
    assert.deepEqual(workflowRequest.parameterBindings, {
      certificateFilePath: '/etc/gcac-test/certs/apache/apache-test.crt',
    });
    assert.deepEqual(workflowRequest.variableBindings, { deviceHost: '10.255.0.127' });
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
    agentId: 'agent_1',
    siteAssetId: 'site_1',
    managedTargetId: 'target_1',
    providerType: 'IIS',
    frameworkType: 'IIS',
    targetType: 'SITE_BINDING',
    targetKey: 'target_1',
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
