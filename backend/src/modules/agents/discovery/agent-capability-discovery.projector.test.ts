import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import type { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

test('Go Agent 小写 IIS bindings 会生成带端口的站点和 HTTPS 受管目标', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'iis-host', display_name: 'IIS Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const mappingPath = 'discovery-mappings/iis.json';
  const mapping = JSON.stringify({
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId: 'fixture.web-server',
    capabilityKey: 'windows.iis.detail',
    projection: {
      shape: 'web_sites',
      frameworkType: 'web.iis',
      displayName: 'Microsoft IIS',
      targetType: 'tls.binding',
      deployCapability: 'certificate.deploy',
      fallbackHostHeaderToSiteName: false,
    },
  });
  const plugins = {
    listVersions: async () => [{
      id: 'plugin-version-1',
      pluginId: 'fixture.web-server',
      status: 'ENABLED',
      manifest: { resources: { agentDiscoveryMappings: { agentCapability: mappingPath } } },
      resources: { [mappingPath]: mapping },
    }],
  } as unknown as UnifiedPluginsApplicationService;
  const service = new AgentCapabilityDiscoveryProjector(database, projector, plugins);

  await service.project({
    id: 'agent-1',
    descriptor: { hostname: 'iis-host', osVersion: 'Windows Server 2022', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    reportedAt: '2026-07-29T00:00:00.000Z',
    capabilities: [{
      capabilityKey: 'windows.iis.detail',
      confidence: 1,
      value: {
        installed: true,
        versionString: '10.0',
        sites: [{
          id: 1,
          name: 'TEST',
          bindings: [
            { protocol: 'http', ipAddress: '*', port: 80, hostHeader: '', bindingInformation: '*:80:' },
            {
              protocol: 'https', ipAddress: '*', port: 4433, hostHeader: '', bindingInformation: '*:4433:', certificateStoreName: 'My',
              certificate: {
                subject: 'CN=fixture.example', issuer: 'CN=Fixture CA',
                notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z',
                fingerprintSha256: 'ab'.repeat(32), thumbprint: '12'.repeat(20), storeName: 'My',
              },
            },
          ],
        }],
      },
    }],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.sites[0]?.displayName, 'TEST');
  assert.equal(projected.sites[0]?.port, 4433);
  assert.equal(projected.sites[0]?.metadata?.bindingInformation, '*:4433:');
  assert.equal(projected.sites[0]?.metadata?.hostHeader, undefined);
  assert.deepEqual(projected.sites[0]?.addresses, ['*']);
  assert.equal(projected.managedTargets.length, 1);
  assert.equal(projected.managedTargets[0]?.bindingKey, '*:4433:');
  assert.equal(projected.managedTargets[0]?.targetType, 'tls.binding');
  assert.deepEqual(projected.managedTargets[0]?.metadata?.certificateLocation, {
    apiVersion: 'gcac.certificate-location/v1',
    storageKind: 'WINDOWS_CERTIFICATE_STORE',
    storeName: 'My',
    storeThumbprint: '12'.repeat(20),
    confidence: 'EXACT',
    observedAt: '2026-07-29T00:00:00.000Z',
  });
  assert.deepEqual(projected.certificates, [{
    stableKey: projected.certificates[0]?.stableKey,
    sha256Fingerprint: 'ab'.repeat(32),
    subject: 'CN=fixture.example',
    issuer: 'CN=Fixture CA',
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    metadata: { name: 'CN=fixture.example', storeName: 'My', thumbprint: '12'.repeat(20) },
  }]);
  assert.deepEqual(projected.certificateBindings, [{
    stableKey: projected.certificateBindings[0]?.stableKey,
    managedTargetStableKey: projected.managedTargets[0]?.stableKey,
    certificateStableKey: projected.certificates[0]?.stableKey,
    bindingName: 'TEST',
    metadata: { storeName: 'My', storeThumbprint: '12'.repeat(20) },
  }]);
});

test('IIS Binding 仅上报 CertificateThumbprint 时仍生成证书绑定', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'iis-host', display_name: 'IIS Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const mappingPath = 'discovery-mappings/iis.json';
  const mapping = JSON.stringify({
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId: 'fixture.web-server',
    capabilityKey: 'windows.iis.detail',
    projection: {
      shape: 'web_sites',
      frameworkType: 'web.iis',
      displayName: 'Microsoft IIS',
      targetType: 'tls.binding',
      deployCapability: 'certificate.deploy',
      fallbackHostHeaderToSiteName: false,
    },
  });
  const plugins = {
    listVersions: async () => [{
      id: 'plugin-version-1',
      pluginId: 'fixture.web-server',
      status: 'ENABLED',
      manifest: { resources: { agentDiscoveryMappings: { agentCapability: mappingPath } } },
      resources: { [mappingPath]: mapping },
    }],
  } as unknown as UnifiedPluginsApplicationService;
  const service = new AgentCapabilityDiscoveryProjector(database, projector, plugins);

  await service.project({
    id: 'agent-1',
    descriptor: { hostname: 'iis-host', osVersion: 'Windows Server 2008 R2', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    reportedAt: '2026-07-29T00:00:00.000Z',
    capabilities: [{
      capabilityKey: 'windows.iis.detail',
      confidence: 1,
      value: {
        Installed: true,
        Sites: [{
          Id: 1,
          Name: 'test08',
          Bindings: [{
            Protocol: 'https',
            BindingInformation: '*:443:test08',
            IPAddress: '*',
            Port: 443,
            HostHeader: 'test08',
            CertificateStoreName: 'MY',
            CertificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
          }],
        }],
      },
    }],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected?.managedTargets.length, 1);
  assert.equal(projected?.certificates.length, 1);
  assert.equal(projected?.certificates[0]?.metadata?.thumbprint, 'AABBCCDDEEFF00112233445566778899AABBCCDD');
  assert.equal(projected?.certificateBindings.length, 1);
  assert.equal(projected?.certificateBindings[0]?.metadata?.storeThumbprint, 'AABBCCDDEEFF00112233445566778899AABBCCDD');
});

test('Agent 发现使用当前租户可访问的内置插件映射', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'iis-host', display_name: 'IIS Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const mappingPath = 'discovery-mappings/iis.json';
  const mapping = JSON.stringify({
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId: 'builtin.windows.iis.pfx',
    capabilityKey: 'windows.iis.detail',
    projection: {
      shape: 'web_sites',
      frameworkType: 'web.iis',
      displayName: 'Microsoft IIS',
      targetType: 'tls.binding',
      deployCapability: 'windows.iis.binding.update_certificate',
      fallbackHostHeaderToSiteName: false,
    },
  });
  const plugin = {
    id: 'system-iis-plugin',
    pluginId: 'builtin.windows.iis.pfx',
    status: 'ENABLED',
    manifest: { resources: { agentDiscoveryMappings: { agentCapability: mappingPath } } },
    resources: { [mappingPath]: mapping },
  };
  const plugins = {
    listVersions: async () => [],
    listAccessibleVersions: async () => [plugin],
  } as unknown as UnifiedPluginsApplicationService;
  const service = new AgentCapabilityDiscoveryProjector(database, projector, plugins);

  await service.project({
    id: 'agent-1',
    descriptor: { hostname: 'iis-host', osVersion: 'Windows Server 2008 R2', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    reportedAt: '2026-07-29T00:00:00.000Z',
    capabilities: [{
      capabilityKey: 'windows.iis.detail',
      confidence: 1,
      value: {
        Installed: true,
        Sites: [{
          Id: 2,
          Name: 'test08',
          Bindings: [{
            Protocol: 'https',
            BindingInformation: '*:443:',
            IPAddress: '*',
            Port: 443,
            HostHeader: '',
            CertificateStoreName: 'MY',
            CertificateThumbprint: '370638FC7670459ACA023CCEB297DC58880FC4F6',
            Certificate: {
              FingerprintSHA256: 'd68b757dd503f25d3621249653832df563ff33323c5284c43ddb124bbd4858cd',
              Subject: 'CN=Ser08-TEST',
            },
          }],
        }],
      },
    }],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected?.frameworks[0]?.frameworkType, 'web.iis');
  assert.equal(projected?.sites[0]?.displayName, 'test08');
  assert.equal(projected?.managedTargets.length, 1);
  assert.equal(projected?.certificates.length, 1);
  assert.equal(projected?.certificates[0]?.sha256Fingerprint, 'd68b757dd503f25d3621249653832df563ff33323c5284c43ddb124bbd4858cd');
  assert.equal(projected?.certificateBindings.length, 1);
});

test('多个启用插件声明同一 Agent Capability Key 时失败关闭', async () => {
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'host', display_name: 'Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = { project: async () => ({}) } as unknown as StandardDeviceDiscoveryProjector;
  const mappingPath = 'discovery-mappings/shared.json';
  const mapping = (pluginId: string) => JSON.stringify({
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId,
    capabilityKey: 'windows.iis.detail',
    projection: { shape: 'web_sites', frameworkType: 'web.iis', displayName: 'Web Server', targetType: 'tls.binding', deployCapability: 'certificate.deploy' },
  });
  const plugins = {
    listVersions: async () => ['fixture.web-server', 'fixture.web-server-2'].map((pluginId, index) => ({
      id: `plugin-version-${index}`,
      pluginId,
      status: 'ENABLED',
      manifest: { resources: { agentDiscoveryMappings: { agentCapability: mappingPath } } },
      resources: { [mappingPath]: mapping(pluginId) },
    })),
  } as unknown as UnifiedPluginsApplicationService;
  const service = new AgentCapabilityDiscoveryProjector(database, projector, plugins);

  await assert.rejects(() => service.project({
    id: 'agent-1',
    descriptor: { hostname: 'host', osVersion: 'Windows Server 2022', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1', tenantId: 'tenant-1', reportedAt: '2026-07-29T00:00:00.000Z',
    capabilities: [{ capabilityKey: 'windows.iis.detail', confidence: 1, value: { installed: true } }],
  } as AgentCapabilitySnapshot), /多个启用插件声明同一 Agent 发现能力/);
});

test('Windows NGINX、Apache、Tomcat 发现映射生成标准目标、位置和 warning', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'windows-host', display_name: 'Windows Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const mappings = [
    {
      pluginId: 'builtin.windows.nginx.pem',
      capabilityKey: 'windows.nginx.detail',
      projection: { shape: 'web_sites', frameworkType: 'web.nginx', displayName: 'NGINX', targetType: 'tls.file', deployCapability: 'certificate.deploy' },
    },
    {
      pluginId: 'builtin.windows.apache.pem',
      capabilityKey: 'windows.apache.detail',
      projection: { shape: 'web_sites', frameworkType: 'web.apache', displayName: 'Apache HTTP Server', targetType: 'tls.file', deployCapability: 'certificate.deploy' },
    },
    {
      pluginId: 'builtin.windows.tomcat.pkcs12',
      capabilityKey: 'windows.tomcat.detail',
      projection: { shape: 'connectors', frameworkType: 'app.tomcat', displayName: 'Apache Tomcat', targetType: 'tls.keystore', deployCapability: 'certificate.deploy' },
    },
  ];
  const plugins = {
    listVersions: async () => mappings.map((mapping, index) => {
      const path = `discovery-mappings/${mapping.capabilityKey}.json`;
      return {
        id: `plugin-version-${index}`,
        pluginId: mapping.pluginId,
        status: 'ENABLED',
        manifest: { resources: { agentDiscoveryMappings: { agentCapability: path } } },
        resources: {
          [path]: JSON.stringify({
            apiVersion: 'gcac.agent-discovery-mapping/v1',
            kind: 'AgentCapabilityDiscoveryMapping',
            ...mapping,
          }),
        },
      };
    }),
  } as unknown as UnifiedPluginsApplicationService;
  const service = new AgentCapabilityDiscoveryProjector(database, projector, plugins);

  await service.project({
    id: 'agent-1',
    descriptor: { hostname: 'windows-host', osVersion: 'Windows Server 2022', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    reportedAt: '2026-08-04T00:00:00.000Z',
    capabilities: [
      {
        capabilityKey: 'windows.nginx.detail',
        confidence: 1,
        value: {
          installed: true,
          version: '1.30.4',
          binaryPath: 'C:\\GCAC-Lab\\nginx\\nginx.exe',
          configPath: 'C:\\GCAC-Lab\\nginx\\conf\\nginx.conf',
          configFingerprint: 'nginx-config',
          sites: [{
            id: 'nginx-site',
            name: 'nginx.test.local',
            configFiles: ['C:\\GCAC-Lab\\nginx\\conf\\conf.d\\site.conf'],
            listen: [{
              address: '*',
              port: 8443,
              protocol: 'HTTPS',
              hostHeader: 'nginx.test.local',
              certificatePath: 'C:\\GCAC-Lab\\certs\\nginx.crt.pem',
              certificateKeyPath: 'C:\\GCAC-Lab\\certs\\nginx.key.pem',
              certificateChainPath: 'C:\\GCAC-Lab\\certs\\ca.crt.pem',
              configFingerprint: 'nginx-config',
              certificate: { fingerprintSha256: 'aa'.repeat(32), subject: 'CN=nginx.test.local' },
            }],
          }],
          warnings: [{ code: 'CERTIFICATE_PATH_MISSING', message: '证书材料路径不存在', path: 'C:\\GCAC-Lab\\certs\\missing.pem' }],
        },
      },
      {
        capabilityKey: 'windows.apache.detail',
        confidence: 1,
        value: {
          installed: true,
          version: '2.4.66',
          binaryPath: 'C:\\GCAC-Lab\\Apache24\\bin\\httpd.exe',
          configPath: 'C:\\GCAC-Lab\\Apache24\\conf\\httpd.conf',
          configFingerprint: 'apache-config',
          sites: [{
            id: 'apache-site',
            name: 'apache.test.local',
            configFiles: ['C:\\GCAC-Lab\\Apache24\\conf\\extra\\https.conf'],
            listen: [{
              address: '*',
              port: 8444,
              protocol: 'HTTPS',
              hostHeader: 'apache.test.local',
              certificatePath: 'C:\\GCAC-Lab\\certs\\apache.crt.pem',
              certificateKeyPath: 'C:\\GCAC-Lab\\certs\\apache.key.pem',
              certificateChainPath: 'C:\\GCAC-Lab\\certs\\ca.crt.pem',
              configFingerprint: 'apache-config',
              certificate: { fingerprintSha256: 'bb'.repeat(32), subject: 'CN=apache.test.local' },
            }],
          }],
        },
      },
      {
        capabilityKey: 'windows.tomcat.detail',
        confidence: 1,
        value: {
          installed: true,
          version: '9.0.120',
          javaPath: 'C:\\GCAC-Lab\\Java\\bin\\java.exe',
          tomcatPath: 'C:\\GCAC-Lab\\Tomcat',
          configPath: 'C:\\GCAC-Lab\\Tomcat\\conf\\server.xml',
          serviceName: 'GCAC-Lab-Tomcat',
          configFingerprint: 'tomcat-config',
          connectors: [{
            address: '*',
            port: 8445,
            protocol: 'HTTPS',
            hostHeader: 'tomcat.test.local',
            keystorePath: 'C:\\GCAC-Lab\\Tomcat\\certs\\tomcat.p12',
            keystoreType: 'PKCS12',
            keyAlias: 'tomcat',
            configFingerprint: 'tomcat-config',
            certificate: { fingerprintSha256: 'cc'.repeat(32), subject: 'CN=tomcat.test.local' },
          }],
        },
      },
    ],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected.frameworks.length, 3);
  assert.equal(projected.sites.length, 3);
  assert.equal(projected.managedTargets.length, 3);
  assert.equal(projected.certificateBindings.length, 3);
  assert.equal(projected.warnings[0]?.code, 'CERTIFICATE_PATH_MISSING');
  assert.equal(projected.warnings[0]?.metadata?.capabilityKey, 'windows.nginx.detail');
  const tomcatTarget = projected.managedTargets.find((target) => target.targetType === 'tls.keystore');
  assert.equal(tomcatTarget?.metadata?.certificateLocation && (tomcatTarget.metadata.certificateLocation as Record<string, unknown>).keystoreType, 'PKCS12');
  assert.equal(tomcatTarget?.metadata?.certificateLocation && (tomcatTarget.metadata.certificateLocation as Record<string, unknown>).programPath, 'C:\\GCAC-Lab\\Java\\bin\\java.exe');
  assert.equal(tomcatTarget?.metadata?.certificateLocation && (tomcatTarget.metadata.certificateLocation as Record<string, unknown>).configFingerprint, 'tomcat-config');
});

test('Tomcat KeyStore 公开证书暂时不可读时仍保留证书绑定和位置', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'tomcat-host', display_name: 'Tomcat Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const mappingPath = 'discovery-mappings/tomcat.json';
  const mapping = JSON.stringify({
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId: 'fixture.tomcat',
    capabilityKey: 'windows.tomcat.detail',
    projection: {
      shape: 'connectors',
      frameworkType: 'app.tomcat',
      displayName: 'Windows Apache Tomcat',
      targetType: 'tls.file',
      targetTypeWhenFieldPresent: { field: 'keystorePath', value: 'tls.keystore' },
      deployCapability: 'windows.tomcat.keystore.replace',
    },
  });
  const plugins = {
    listVersions: async () => [{
      id: 'plugin-version-tomcat',
      pluginId: 'fixture.tomcat',
      status: 'ENABLED',
      manifest: { resources: { agentDiscoveryMappings: { agentCapability: mappingPath } } },
      resources: { [mappingPath]: mapping },
    }],
  } as unknown as UnifiedPluginsApplicationService;

  await new AgentCapabilityDiscoveryProjector(database, projector, plugins).project({
    id: 'agent-tomcat',
    descriptor: { hostname: 'tomcat-host', osVersion: 'Windows Server 2022', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-tomcat',
    tenantId: 'tenant-1',
    reportedAt: '2026-08-04T00:00:00.000Z',
    capabilities: [{
      capabilityKey: 'windows.tomcat.detail',
      confidence: 1,
      value: {
        installed: true,
        version: '9.0.120',
        tomcatPath: 'C:\\GCAC-Lab\\Tomcat',
        configPath: 'C:\\GCAC-Lab\\Tomcat\\conf\\server.xml',
        hosts: ['tomcat.test.local'],
        connectors: [{
          address: '*',
          port: 8445,
          protocol: 'HTTPS',
          keystorePath: 'C:\\GCAC-Lab\\certs\\tomcat.p12',
          keystoreType: 'PKCS12',
          configFingerprint: 'tomcat-config',
        }],
        warnings: [{
          code: 'KEYSTORE_CERTIFICATE_READ_FAILED',
          message: 'Tomcat KeyStore 公开证书不可读',
          path: 'C:\\GCAC-Lab\\certs\\tomcat.p12',
        }],
      },
    }],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.sites[0]?.displayName, 'tomcat.test.local');
  assert.equal(projected.sites[0]?.metadata?.hostHeader, 'tomcat.test.local');
  assert.equal(projected.sites[0]?.port, 8445);
  assert.equal(projected.managedTargets.length, 1);
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificates.length, 1);
  assert.equal(projected.certificates[0]?.sha256Fingerprint, undefined);
  assert.equal(projected.certificates[0]?.metadata?.observationStatus, 'PENDING_PUBLIC_CERTIFICATE');
  assert.equal(projected.certificateBindings[0]?.metadata?.keystorePath, 'C:\\GCAC-Lab\\certs\\tomcat.p12');
});
