import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertSafeFixtureManifest, type NetscalerFixtureManifestEntry, NetscalerSupportedVersions } from './netscaler.types.js';

test('NetScaler fixture 清单覆盖所有目标版本且不包含 Secret', async () => {
  const manifestUrl = new URL('../../../../src/modules/providers/netscaler/fixtures/manifest.json', import.meta.url);
  const entries = JSON.parse(await readFile(manifestUrl, 'utf8')) as NetscalerFixtureManifestEntry[];
  assert.doesNotThrow(() => assertSafeFixtureManifest(entries));
  assert.deepEqual(entries.map((entry) => entry.version), [...NetscalerSupportedVersions]);
});

test('NetScaler fixture 清单拒绝重复版本', () => {
  const duplicate = NetscalerSupportedVersions.map((version) => ({
    version,
    build: 'test-build',
    source: 'OFFICIAL_DOCS' as const,
    resources: ['nsversion'],
    containsSecrets: false as const,
  }));
  duplicate.push({ ...duplicate[0]! });
  assert.throws(() => assertSafeFixtureManifest(duplicate), /fixture 版本重复/);
});
