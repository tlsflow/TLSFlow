import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CompatibilityCatalogApplicationService } from './application/compatibility-catalog.application-service.js';

test('兼容性 API 与 Profile 矩阵使用同一来源', () => {
  const service = new CompatibilityCatalogApplicationService(resolve(process.cwd(), '..', 'compatibility'));
  const result = service.list(new Date('2026-07-21T12:00:00.000Z'));
  assert.equal(result.schemaVersion, 'gcac.compatibility-catalog/v1');
  assert.deepEqual(result.items.map((item) => item.profileId), ['windows-compatibility-iis', 'windows-modern-iis']);
  assert.equal(result.items[0]?.effectiveStatus, 'experimental');
  assert.equal(result.items[0]?.evidenceStatus, 'current');
});

test('证据过期后自动降级并返回稳定原因码', () => {
  const service = new CompatibilityCatalogApplicationService(resolve(process.cwd(), '..', 'compatibility'));
  const result = service.list(new Date('2026-11-01T00:00:00.000Z'));
  assert.equal(result.items[0]?.evidenceStatus, 'expired');
  assert.deepEqual(result.items[0]?.reasonCodes, ['COMPATIBILITY_EVIDENCE_EXPIRED']);
});
