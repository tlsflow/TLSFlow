import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { ResolvedManagedTargetTopology } from '../assets/application/managed-target-context.resolver.js';
import { deploymentAssetContextBuilder } from './application/deployment-asset-context.builder.js';
import { validateDeploymentAssetContextV1 } from './schema/deployment-asset-context.schema.js';

describe('DeploymentAssetContextBuilder', () => {
  it('从标准资产模型构建唯一白名单上下文', () => {
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: managedTargetContext(),
    });

    assert.equal(context.apiVersion, 'gcac.deployment-asset-context/v1');
    assert.deepEqual(context.application, {
      id: 'asset-1',
      address: '10.0.0.10',
      serverName: 'app.example.com',
      port: 443,
      protocol: 'HTTPS',
    });
    assert.equal(context.host?.hostname, 'host-1.example.com');
    assert.equal(context.site?.bindingInformation, '*:443:app.example.com');
    assert.equal(context.target?.key, 'site-binding-1');
    assert.equal(context.target?.certificateLocation?.certificatePath, '/etc/example/tls/app.crt');
    assert.equal(context.target?.certificateLocation?.privateKeyPath, '/etc/example/tls/app.key');
    assert.equal(context.deployment.targets[0]?.certificateLocation?.storageKind, 'PEM_FILES');
    assert.equal(context.deployment.targets[0]?.name, 'APP');
    assert.match(context.deployment.certificateResourceName, /^certificate-app-example-com-[a-f0-9]{10}$/);
    assert.equal('frameworkType' in (context.target ?? {}), false);
    assert.equal('configPath' in (context.site ?? {}), false);
  });

  it('无 SiteAsset 和 DeviceAsset 时仍使用标准 Target 与证书身份域名', () => {
    const topology = managedTargetContext();
    topology.siteAsset = undefined;
    topology.deviceAsset = undefined;
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.site, undefined);
    assert.equal(context.target?.id, 'target-1');
    assert.equal(context.deployment.targets[0]?.serverName, 'app.example.com');
    assert.equal(context.deployment.targets[0]?.port, 443);
  });

  it('兼容 PostgreSQL 返回的 Date 类型受管目标更新时间', () => {
    const topology = managedTargetContext();
    topology.managedTarget.metadata = {
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeName: 'My',
        storeThumbprint: '4865D416CD00954798D8793FEA6050F43D6EAED4',
        confidence: 'EXACT',
      },
    };
    topology.managedTarget.updatedAt = new Date('2026-08-01T13:31:13.224Z') as unknown as string;

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.target?.certificateLocation?.observedAt, '2026-08-01T13:31:13.224Z');
  });

  it('无受管目标时生成可重放的应用资产部署目标', () => {
    const first = deploymentAssetContextBuilder.build({ applicationAsset: applicationAsset() });
    const second = deploymentAssetContextBuilder.build({ applicationAsset: applicationAsset() });

    assert.equal(first.host, undefined);
    assert.equal(first.target, undefined);
    assert.equal(first.deployment.targets[0]?.name, '示例应用');
    assert.equal(first.deployment.certificateResourceName, second.deployment.certificateResourceName);
    assert.deepEqual(first, second);
  });

  it('Schema 拒绝未声明顶层字段和厂商对象', () => {
    const context = deploymentAssetContextBuilder.build({ applicationAsset: applicationAsset() }) as unknown as Record<string, unknown>;
    context.vendor = { product: 'forbidden' };

    assert.throws(
      () => validateDeploymentAssetContextV1(context),
      (error: unknown) => error instanceof AppError && error.errorCode === 'DEPLOYMENT_ASSET_CONTEXT_INVALID',
    );
  });
});

function applicationAsset() {
  return {
    id: 'asset-1',
    address: '10.0.0.10',
    sniName: 'app.example.com',
    port: 443,
    protocol: 'HTTPS' as const,
    displayName: '示例应用',
  };
}

function managedTargetContext(): ResolvedManagedTargetTopology {
  return {
    managedTarget: {
      id: 'target-1',
      tenantId: 'tenant-1',
      deviceId: 'host-1',
      frameworkInstanceId: 'framework-1',
      siteId: 'site-1',
      discoveryProviderKey: 'fixture',
      targetType: 'tls.binding',
      targetKey: 'site-binding-1',
      bindingKey: '*:443:app.example.com',
      supportedCapabilities: ['certificate.deploy'],
      executionLocations: ['AGENT'],
      status: 'ACTIVE',
      metadata: {
        source: 'fixture',
        certPath: '/etc/example/tls/app.crt',
        keyPath: '/etc/example/tls/app.key',
        configPath: '/etc/example/sites/app.conf',
        serviceName: 'example-service',
      },
      createdAt: '',
      updatedAt: '',
      version: 1,
    },
    host: {
      id: 'host-1',
      tenantId: 'tenant-1',
      hostname: 'host-1.example.com',
      primaryIp: '10.0.0.20',
      ipAddresses: ['10.0.0.20'],
      osType: 'LINUX',
      managementChannels: [],
      discoverySource: 'AGENT',
      compatibilityLevel: 'L1',
      managementMode: 'AGENT',
      status: 'ACTIVE',
      tags: [],
      createdAt: '',
      updatedAt: '',
      version: 1,
    },
    siteAsset: {
      id: 'site-1',
      tenantId: 'tenant-1',
      frameworkInstanceId: 'framework-1',
      deviceId: 'host-1',
      discoveryProviderKey: 'fixture',
      siteType: 'HTTPS_SITE',
      siteName: 'APP',
      siteKey: 'app',
      bindingInformation: '*:443:app.example.com',
      hostHeader: 'app.example.com',
      port: 443,
      protocol: 'HTTPS',
      configPath: '/etc/vendor-specific-path',
      discoverySource: 'AGENT',
      status: 'ACTIVE',
      metadata: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    },
    serviceInstance: {
      id: 'framework-1',
      tenantId: 'tenant-1',
      deviceId: 'host-1',
      frameworkType: 'web.example',
      frameworkKey: 'example',
      discoveryProviderKey: 'fixture',
      displayName: 'Example',
      discoverySource: 'AGENT',
      status: 'ACTIVE',
      rawFacts: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    },
    discoveryProviderKey: 'fixture',
    frameworkType: 'web.example',
  };
}
