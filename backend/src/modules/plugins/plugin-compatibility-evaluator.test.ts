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

test('Citrix ADC 历史产品族标识与统一插件标识兼容', () => {
  for (const productFamily of ['NETSCALER_ADC', 'CITRIX_ADC', 'Citrix NetScaler ADC']) {
    const result = evaluatePluginCompatibility(citrixManifest, {
      productFamily,
      executionLocation: 'CONTROL_PLANE',
    });

    assert.equal(result.compatible, true, productFamily);
    assert.deepEqual(result.reasons, []);
  }
});

test('产品族标准化不会把无关 ADC 设备误判为 Citrix ADC', () => {
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
