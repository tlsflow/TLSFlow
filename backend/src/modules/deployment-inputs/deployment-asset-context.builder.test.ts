import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { ResolvedManagedTargetTopology } from '../assets/application/managed-target-context.resolver.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import { deploymentAssetContextBuilder } from './application/deployment-asset-context.builder.js';
import { resolveCertificateUpdateSnapshot } from './certificate-update/certificate-update-input.service.js';
import {
  createResolvedCertificateUpdateInput,
  loadCertificateUpdateContract,
} from './certificate-update/certificate-update.test-fixtures.js';
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
    assert.equal(context.target?.metadata.frameworkType, 'web.example');
    assert.equal(context.deployment.targets[0]?.metadata.frameworkType, 'web.example');
    assert.equal('configPath' in (context.site ?? {}), false);
  });

  it('保留历史 Target 框架事实，冲突交由证书输入门禁拒绝', () => {
    const topology = managedTargetContext();
    topology.managedTarget.metadata = {
      ...topology.managedTarget.metadata,
      frameworkType: 'web.apache',
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.target?.metadata.frameworkType, 'web.apache');
    assert.equal(context.deployment.targets[0]?.metadata.frameworkType, 'web.apache');
  });

  it('将 FrameworkInstance 的 Apache Windows 框架事实传入证书输入门禁', () => {
    const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
    const sourceTarget = resolved.assetContext.target!;
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.apache';
    topology.serviceInstance = {
      ...topology.serviceInstance!,
      frameworkType: 'web.apache',
    };
    topology.managedTarget.bindingKey = sourceTarget.bindingKey;
    topology.siteAsset!.bindingInformation = sourceTarget.bindingKey;
    topology.managedTarget.metadata = { ...sourceTarget.metadata };
    delete topology.managedTarget.metadata.frameworkType;
    topology.managedTarget.metadata.certificateLocation = sourceTarget.certificateLocation;

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: {
        id: resolved.assetContext.application.id,
        address: resolved.assetContext.application.address,
        sniName: resolved.assetContext.application.serverName,
        port: resolved.assetContext.application.port,
        protocol: resolved.assetContext.application.protocol,
      },
      managedTargetContext: topology,
    });
    resolved.assetContext = context;

    const artifact = resolved.artifacts.certificateArtifact;
    delete resolved.artifacts.certificateArtifact;
    resolved.artifacts[context.deployment.certificateResourceName] = artifact!;

    assert.doesNotThrow(() => resolveCertificateUpdateSnapshot(
      resolved,
      loadCertificateUpdateContract('web.apache.windows'),
    ));
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

  it('缺少 SNI 时使用资产访问域名作为证书验证域名', () => {
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: {
        ...applicationAsset(),
        address: 'cloud.jacksonz.cn',
        sniName: undefined,
        verifyUrl: 'https://verify.example.com:5001/webapi/entry.cgi',
      },
    });

    assert.equal(context.application.address, 'cloud.jacksonz.cn');
    assert.equal(context.application.serverName, 'cloud.jacksonz.cn');
    assert.equal(context.deployment.targets[0]?.serverName, 'cloud.jacksonz.cn');
  });

  it('显式 SNI 优先于资产访问域名', () => {
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: {
        ...applicationAsset(),
        verifyUrl: 'https://verify.example.com',
      },
    });

    assert.equal(context.application.serverName, 'app.example.com');
  });

  it('兼容历史上将连接 IP 持久化为 SNI 的工作流目标', () => {
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: {
        ...applicationAsset(),
        address: 'cloud.jacksonz.cn',
        sniName: '10.255.0.77',
        verifyUrl: 'https://cloud.jacksonz.cn:5001/webapi/entry.cgi',
      },
    });

    assert.equal(context.application.serverName, 'cloud.jacksonz.cn');
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

  it('从同一 Framework 的运行事实补齐历史 Apache Target 缺失字段', () => {
    const topology = managedTargetContext();
    topology.managedTarget.metadata = {
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'PEM_FILES',
        certificatePath: 'C:/GCAC-Lab/certs/apache.crt.pem',
        privateKeyPath: 'C:/GCAC-Lab/certs/apache.key.pem',
        sourceConfigPath: 'C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf',
        confidence: 'EXACT',
      },
    };
    topology.serviceInstance!.rawFacts = {
      source: 'runtime-effective-config',
      configPath: 'C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf',
      programPath: 'C:/GCAC-Lab/Apache24/bin/httpd.exe',
      programSha256: 'b'.repeat(64),
      serviceName: 'GCAC-Lab-Apache',
      configFingerprint: 'a'.repeat(64),
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'GCAC-Lab-Apache');
    assert.equal(context.target?.certificateLocation?.programPath, 'C:/GCAC-Lab/Apache24/bin/httpd.exe');
    assert.equal(context.target?.certificateLocation?.programSha256, 'b'.repeat(64));
    assert.equal(context.target?.certificateLocation?.configFingerprint, 'a'.repeat(64));
    assert.equal(context.target?.certificateLocation?.certificatePath, 'C:/GCAC-Lab/certs/apache.crt.pem');
  });

  it('从标准发现的 listener 事实补齐各 Web 框架的配置检查参数', () => {
    const cases = [
      { frameworkType: 'web.apache', args: ['-t', '-d', 'C:/Apache', '-f', 'C:/Apache/conf/httpd.conf'] },
      { frameworkType: 'web.nginx', args: ['-t', '-p', 'C:/nginx', '-c', 'C:/nginx/conf/nginx.conf'] },
      { frameworkType: 'app.tomcat', args: ['--check-config'] },
    ] as const;

    for (const item of cases) {
      const topology = managedTargetContext();
      topology.frameworkType = item.frameworkType;
      topology.serviceInstance = {
        ...topology.serviceInstance!,
        frameworkType: item.frameworkType,
      };
      topology.managedTarget.metadata = {
        certificateLocation: {
          apiVersion: 'gcac.certificate-location/v1',
          storageKind: 'PEM_FILES',
          certificatePath: '/etc/example/tls/app.crt',
          privateKeyPath: '/etc/example/tls/app.key',
          sourceConfigPath: '/etc/example/app.conf',
          confidence: 'EXACT',
        },
        listener: {
          configCheckArgs: [...item.args],
          configCheckArgsTemplate: [...item.args],
        },
      };

      const context = deploymentAssetContextBuilder.build({
        applicationAsset: applicationAsset(),
        managedTargetContext: topology,
      });

      assert.deepEqual(context.target?.metadata.configCheckArgs, item.args);
      assert.deepEqual(context.target?.metadata.configCheckArgsTemplate, item.args);
    }
  });

  it('从历史嵌套 IIS 位置的 listener 事实补齐服务名和配置指纹', () => {
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.iis';
    topology.serviceInstance = {
      ...topology.serviceInstance!,
      frameworkType: 'web.iis',
    };
    topology.managedTarget.metadata = {
      frameworkType: 'web.iis',
      listener: {
        bindingInformation: '*:443:iis.example.com',
        serviceName: 'W3SVC',
        programPath: 'C:/Windows/System32/inetsrv/appcmd.exe',
        configFingerprint: 'c'.repeat(64),
      },
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        storeThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
        sourceConfigPath: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
        confidence: 'EXACT',
      },
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'W3SVC');
    assert.equal(context.target?.certificateLocation?.programPath, 'C:/Windows/System32/inetsrv/appcmd.exe');
    assert.equal(context.target?.certificateLocation?.configFingerprint, 'c'.repeat(64));
  });

  it('从 Site metadata 补齐旧 IIS Target 的配置指纹并使用固定 IIS 服务默认值', () => {
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.iis';
    topology.serviceInstance = {
      ...topology.serviceInstance!,
      frameworkType: 'web.iis',
      rawFacts: {},
    };
    topology.siteAsset = {
      ...topology.siteAsset!,
      metadata: {
        listeners: [{
          protocol: 'HTTPS',
          configFingerprint: 'd'.repeat(64),
          sourceConfigPath: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
        }],
      },
    };
    topology.managedTarget.metadata = {
      frameworkType: 'web.iis',
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        storeThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
        sourceConfigPath: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
        confidence: 'EXACT',
      },
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'W3SVC');
    assert.equal(context.target?.certificateLocation?.programPath, 'C:/Windows/System32/inetsrv/appcmd.exe');
    assert.equal(context.target?.certificateLocation?.configFingerprint, 'd'.repeat(64));
  });

  it('从历史 CertificateBinding 补齐 IIS 位置和本地配置指纹', () => {
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.iis';
    topology.serviceInstance = { ...topology.serviceInstance!, frameworkType: 'web.iis', rawFacts: {} };
    topology.managedTarget.metadata = {
      frameworkType: 'web.iis',
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        storeThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
        confidence: 'EXACT',
      },
    };
    const binding = {
      ...certificateBinding(),
      localConfigPath: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
      localConfigFingerprint: 'e'.repeat(64),
      metadata: {
        deploymentTarget: {
          serviceName: 'W3SVC',
          programPath: 'C:/Windows/System32/inetsrv/appcmd.exe',
        },
      },
    } as CertificateBindingDto;

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
      certificateBinding: binding,
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'W3SVC');
    assert.equal(context.target?.certificateLocation?.programPath, 'C:/Windows/System32/inetsrv/appcmd.exe');
    assert.equal(context.target?.certificateLocation?.sourceConfigPath, 'C:/Windows/System32/inetsrv/config/applicationHost.config');
    assert.equal(context.target?.certificateLocation?.configFingerprint, 'e'.repeat(64));
  });

  it('CertificateBinding 不能覆盖 Agent 已确认的 IIS 事实', () => {
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.iis';
    topology.serviceInstance = { ...topology.serviceInstance!, frameworkType: 'web.iis', rawFacts: {} };
    topology.managedTarget.metadata = {
      frameworkType: 'web.iis',
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
        serviceName: 'AgentW3SVC',
        sourceConfigPath: 'C:/agent/applicationHost.config',
        configFingerprint: 'a'.repeat(64),
        confidence: 'EXACT',
      },
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
      certificateBinding: {
        ...certificateBinding(),
        localConfigPath: 'C:/history/applicationHost.config',
        localConfigFingerprint: 'b'.repeat(64),
        metadata: { certificateLocation: { serviceName: 'HistoricalW3SVC' } },
      } as CertificateBindingDto,
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'AgentW3SVC');
    assert.equal(context.target?.certificateLocation?.sourceConfigPath, 'C:/agent/applicationHost.config');
    assert.equal(context.target?.certificateLocation?.configFingerprint, 'a'.repeat(64));
  });

  it('CertificateBinding 没有真实本地配置指纹时不伪造 configFingerprint', () => {
    const topology = managedTargetContext();
    topology.host.osType = 'WINDOWS';
    topology.frameworkType = 'web.iis';
    topology.serviceInstance = { ...topology.serviceInstance!, frameworkType: 'web.iis', rawFacts: {} };
    topology.managedTarget.metadata = {
      frameworkType: 'web.iis',
      certificateLocation: {
        apiVersion: 'gcac.certificate-location/v1',
        storageKind: 'WINDOWS_CERTIFICATE_STORE',
        storeThumbprint: '00112233445566778899AABBCCDDEEFF00112233',
        confidence: 'EXACT',
      },
    };

    const context = deploymentAssetContextBuilder.build({
      applicationAsset: applicationAsset(),
      managedTargetContext: topology,
      certificateBinding: certificateBinding(),
    });

    assert.equal(context.target?.certificateLocation?.serviceName, 'W3SVC');
    assert.equal(context.target?.certificateLocation?.configFingerprint, undefined);
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

  it('无受管目标时优先使用工作流资产配置的目标名称', () => {
    const context = deploymentAssetContextBuilder.build({
      applicationAsset: {
        ...applicationAsset(),
        metadata: { workflowTarget: { siteName: 'Synology DSM' } },
      },
    });

    assert.equal(context.deployment.targets[0]?.name, 'Synology DSM');
  });

  it('受管目标缺失 metadata 时返回结构化合同错误', () => {
    const topology = managedTargetContext();
    delete (topology.managedTarget as unknown as Record<string, unknown>).metadata;

    assert.throws(
      () => deploymentAssetContextBuilder.build({
        applicationAsset: applicationAsset(),
        managedTargetContext: topology,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.errorCode, 'DEPLOYMENT_ASSET_CONTEXT_INVALID');
        const details = error.details as Record<string, unknown>;
        assert.equal(details.code, 'MANAGED_TARGET_METADATA_MISSING');
        assert.equal(details.path, 'managedTarget.metadata');
        assert.equal(details.managedTargetId, 'target-1');
        return true;
      },
    );
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

function certificateBinding(): CertificateBindingDto {
  return {
    id: 'binding-1',
    tenantId: 'tenant-1',
    serviceInstanceId: 'framework-1',
    bindingKey: '*:443:app.example.com',
    bindingType: 'WINDOWS_CERT_STORE',
    verifyMethod: 'STORE_QUERY',
    status: 'DISCOVERED',
    metadata: {},
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    version: 1,
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
