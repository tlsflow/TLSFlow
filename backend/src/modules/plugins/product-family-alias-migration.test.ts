import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalPluginIdRegistry,
  canonicalPluginIds,
  validateCanonicalPluginIdRegistry,
} from './canonical-plugin-id/canonical-plugin-id.registry.js';

test('产品族别名不进入 Canonical Plugin ID Registry', () => {
  assert.equal(canonicalPluginIds.includes('CITRIX_ADC' as never), false);
  assert.equal(canonicalPluginIds.includes('Citrix NetScaler ADC' as never), false);

  const candidate = structuredClone(canonicalPluginIdRegistry) as unknown as Record<string, unknown>;
  const entries = candidate.entries as Array<Record<string, unknown>>;
  entries[0] = { ...entries[0], canonicalId: 'CITRIX_ADC' };
  assert.throws(() => validateCanonicalPluginIdRegistry(candidate), /只能使用已登记的 Canonical Plugin ID/);
});
