import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalProductFamilyForOsType } from './canonical-product-family.js';

test('标准 Host OS 类型映射为 Canonical 产品族', () => {
  assert.equal(canonicalProductFamilyForOsType('windows'), 'WINDOWS_SERVER');
  assert.equal(canonicalProductFamilyForOsType(' LINUX '), 'LINUX_SERVER');
});

test('未知 Host OS 类型不猜测产品族', () => {
  assert.equal(canonicalProductFamilyForOsType('Windows Server'), undefined);
  assert.equal(canonicalProductFamilyForOsType('unknown-os'), undefined);
  assert.equal(canonicalProductFamilyForOsType(undefined), undefined);
});
