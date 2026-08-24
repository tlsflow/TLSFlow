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

test('产品族只按标准标识执行通用规范化匹配', () => {
  const result = evaluatePluginCompatibility(citrixManifest, {
    productFamily: 'Citrix NetScaler ADC',
    executionLocation: 'CONTROL_PLANE',
  });

  assert.equal(result.compatible, true);
  assert.deepEqual(result.reasons, []);
});

test('迁移完成后不再接受核心厂商历史别名', () => {
  for (const productFamily of ['NETSCALER_ADC', 'CITRIX_ADC']) {
    const result = evaluatePluginCompatibility(citrixManifest, {
      productFamily,
      executionLocation: 'CONTROL_PLANE',
    });
    assert.equal(result.compatible, false, productFamily);
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

test('未知厂商使用相同标准键时不需要宿主别名表', () => {
  const manifest = {
    scope: 'MANAGED',
    compatibility: { productFamilies: ['example.vendor-appliance'] },
  } as UnifiedPluginManifestV1;
  const result = evaluatePluginCompatibility(manifest, {
    productFamily: 'EXAMPLE_VENDOR_APPLIANCE',
    executionLocation: 'AGENT',
  });
  assert.equal(result.compatible, true);
});
