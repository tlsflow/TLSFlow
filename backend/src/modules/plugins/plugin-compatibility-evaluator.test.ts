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
