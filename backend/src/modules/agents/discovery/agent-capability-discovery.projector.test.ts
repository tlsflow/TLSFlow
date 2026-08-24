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
