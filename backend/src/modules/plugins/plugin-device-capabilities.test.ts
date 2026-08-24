import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PluginCapabilityRegistry } from './capabilities/plugin-capability.registry.js';
import { PluginConnectionProbeService } from './connections/plugin-connection-probe.service.js';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';

test('Capability Registry 拒绝未知能力和伪造风险等级', () => {
  const registry = new PluginCapabilityRegistry();
  assert.equal(registry.require('certificate.deploy').resourceLock, 'TARGET');
  assert.throws(() => registry.require('vendor.special.action'));
  assert.throws(() => registry.validate({
    key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1',
    riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'],
  }));
});

test('统一连接探测稳定区分 TLS、认证和产品识别阶段', () => {
  const service = new PluginConnectionProbeService();
  const result = service.evaluate({
    host: 'device.example', port: 443, tls: { enabled: true, verifyCertificate: true, minimumVersion: 'TLSv1.2' },
  }, {
    routeAvailable: true, tcpConnected: true, tlsNegotiated: true, tlsVersion: 'TLSv1.2', peerCertificateValid: true,
    authenticated: false, productMatched: false, errorCode: 'CONNECTION_AUTH_FAILED',
  });
  assert.equal(result.failedStage, 'AUTHENTICATION');
  assert.deepEqual(result.riskFlags, []);
});

test('标准设备发现校验父子关系、数量、稳定键和敏感字段', () => {
  const service = new DeviceDiscoverySchemaService();
  const fixture = {
    apiVersion: 'gcac.device-discovery/v1',
    device: { stableKey: 'device:mock-a', displayName: 'Mock A', productFamily: 'Mock ADC', metadata: { partition: 'default' } },
    capabilities: [{ key: 'device.discover', available: true }],
    frameworks: [{ stableKey: 'framework:lb', type: 'LOAD_BALANCER', displayName: 'Load Balancer' }],
    sites: [{ stableKey: 'site:vs-443', frameworkStableKey: 'framework:lb', displayName: 'VS 443', addresses: ['192.0.2.10'], port: 443, protocol: 'HTTPS' }],
    certificates: [{ stableKey: 'certificate:abc', sha256Fingerprint: 'AA'.repeat(32) }],
    certificateBindings: [{ stableKey: 'binding:vs-443', siteStableKey: 'site:vs-443', certificateStableKey: 'certificate:abc' }],
    warnings: [],
  };
  assert.equal(service.validate(fixture).sites.length, 1);
  assert.throws(() => service.validate({ ...fixture, certificateBindings: [{ ...fixture.certificateBindings[0], siteStableKey: 'site:missing' }] }));
  assert.throws(() => service.validate({ ...fixture, rawFacts: { apiToken: 'secret' } }));
});

test('两个不同产品 Fixture 使用同一发现 Schema', async () => {
  const service = new DeviceDiscoverySchemaService();
  for (const name of ['mock-adc', 'mock-nas']) {
    const content = await readFile(new URL(`../../../../compatibility/fixtures/device-plugins/${name}.discovery.json`, import.meta.url), 'utf8');
    assert.equal(service.validate(JSON.parse(content)).apiVersion, 'gcac.device-discovery/v1');
  }
});
