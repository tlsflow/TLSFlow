import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePluginCompatibility } from './capabilities/plugin-compatibility.evaluator.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';

const citrixManifest = {
  scope: 'BOTH',
  compatibility: {
    productFamilies: ['citrix.netscaler-adc'],
  },
} as UnifiedPluginManifestV1;

test('产品族匹配只接受精确 Canonical 标识', () => {
  const result = evaluatePluginCompatibility(citrixManifest, {
    productFamily: 'citrix.netscaler-adc',
    executionLocation: 'CONTROL_PLANE',
  });

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});

test('运行期拒绝产品族显示名、大小写变体和历史别名', () => {
  for (const productFamily of ['Citrix NetScaler ADC', 'CITRIX.NETSCALER-ADC', 'NETSCALER_ADC', 'CITRIX_ADC']) {
    const result = evaluatePluginCompatibility(citrixManifest, {
      productFamily,
      executionLocation: 'CONTROL_PLANE',
    });
    assert.equal(result.compatible, false, productFamily);
  }
});

test('产品族严格匹配不会把无关 ADC 设备误判为 Citrix ADC', () => {
  const result = evaluatePluginCompatibility(citrixManifest, {
    productFamily: 'F5_BIG_IP',
    executionLocation: 'CONTROL_PLANE',
  });

  assert.equal(result.compatible, false);
  assert.deepEqual(result.reasons, [{
    dimension: 'productFamily',
    expected: ['citrix.netscaler-adc'],
    actual: 'F5_BIG_IP',
  }]);
});

test('未知产品族使用精确 Canonical 标识时可以匹配', () => {
  const manifest = {
    scope: 'MANAGED',
    compatibility: { productFamilies: ['example.vendor-appliance'] },
  } as UnifiedPluginManifestV1;
  const result = evaluatePluginCompatibility(manifest, {
    productFamily: 'example.vendor-appliance',
    executionLocation: 'AGENT',
  });
  assert.equal(result.compatible, true);
});

test('能力级宿主版本、目标版本和 Agent 版本全部满足时兼容', () => {
  const manifest = { scope: 'MANAGED', compatibility: undefined } as UnifiedPluginManifestV1;
  const capability = {
    key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'],
    compatibility: {
      host: { minVersion: '1.2.0', requiredFeatures: ['artifact.grant.read'] },
      targets: [{ productFamily: 'device.example', versionRange: '>=2.11.0 <3.0.0' }],
      execution: [{ location: 'AGENT', minRuntimeVersion: '2.4.0' }],
    },
  } as UnifiedPluginManifestV1['capabilities'][number];
  const result = evaluatePluginCompatibility(manifest, {
    executionLocation: 'AGENT', productFamily: 'device.example', productVersion: '2.12.0', hostVersion: '1.4.0',
    hostFeatures: ['artifact.grant.read'], runtimeVersions: { AGENT: '2.5.0' },
  }, capability);
  assert.equal(result.status, 'COMPATIBLE');
  assert.equal(result.compatible, true);
});

test('版本未知时低风险能力允许试探，高风险写能力直接阻止', () => {
  const manifest = { scope: 'BOTH' } as UnifiedPluginManifestV1;
  const base = { key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', executionLocations: ['AGENT'], compatibility: { host: { minVersion: '1.2.0' }, execution: [{ location: 'AGENT', minRuntimeVersion: '2.4.0' }] } };
  const readonly = evaluatePluginCompatibility(manifest, { executionLocation: 'AGENT' }, { ...base, riskLevel: 'LOW' } as UnifiedPluginManifestV1['capabilities'][number]);
  const write = evaluatePluginCompatibility(manifest, { executionLocation: 'AGENT' }, { ...base, riskLevel: 'HIGH' } as UnifiedPluginManifestV1['capabilities'][number]);
  assert.equal(readonly.status, 'UNKNOWN');
  assert.equal(readonly.compatible, true);
  assert.equal(write.status, 'UNKNOWN');
  assert.equal(write.compatible, false);
});

test('无法解析的版本也必须按 UNKNOWN 处理，而不是抛出或默认兼容', () => {
  const manifest = { scope: 'BOTH' } as UnifiedPluginManifestV1;
  const capability = {
    key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', riskLevel: 'LOW', executionLocations: ['AGENT'],
    compatibility: { host: { minVersion: '1.2.0' } },
  } as UnifiedPluginManifestV1['capabilities'][number];
  const result = evaluatePluginCompatibility(manifest, { executionLocation: 'AGENT', hostVersion: 'agent-latest' }, capability);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.compatible, true);
});

test('contractVersion 不会替代宿主或目标产品版本判断', () => {
  const manifest = { scope: 'BOTH' } as UnifiedPluginManifestV1;
  const capability = {
    key: 'device.discover', contractVersion: 'v99', actionContractId: 'device.discover.v99', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'],
    compatibility: { targets: [{ productFamily: 'device.example', versionRange: '>=2.11.0' }] },
  } as UnifiedPluginManifestV1['capabilities'][number];
  const result = evaluatePluginCompatibility(manifest, { executionLocation: 'CONTROL_PLANE', productFamily: 'device.example', productVersion: '2.10.0' }, capability);
  assert.equal(result.compatible, false);
  assert.equal(result.status, 'INCOMPATIBLE');
});
