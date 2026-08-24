import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinPluginRegistry } from './builtin-plugins/builtin-plugin-registry.js';

test('两个原用户插件已作为内置插件注册且保留固定版本身份', async () => {
  const entries = await new BuiltinPluginRegistry().refresh();
  const migrated = new Map(entries
    .filter((entry) => ['device.chaitin-safeline-waf', 'device.nginx-proxy-manager'].includes(entry.pluginId))
    .map((entry) => [entry.pluginId, entry]));

  assert.equal(migrated.size, 2);
  assert.equal(migrated.get('device.chaitin-safeline-waf')?.version, '0.1.11');
  assert.equal(migrated.get('device.nginx-proxy-manager')?.version, '0.1.11');
  for (const entry of migrated.values()) {
    assert.equal(entry.manifest.source, 'BUILTIN');
    assert.equal(entry.manifest.trust, 'OFFICIAL_SIGNED');
    assert.equal(entry.manifest.support, 'OFFICIAL');
    assert.equal(entry.runtimeEntrypoint, 'runtime/index.js');
    assert.ok(entry.packageSha256.startsWith('sha256:'));
    assert.ok(Object.keys(entry.resourceSha256).includes('runtime/index.js'));
    assert.deepEqual(entry.manifest.resources.logos, {
      horizontal: 'logos/logo.svg',
      square: 'logos/logo-square.svg',
    });
    assert.ok(entry.resourceSha256['logos/logo.svg']?.startsWith('sha256:'));
    assert.ok(entry.resourceSha256['logos/logo-square.svg']?.startsWith('sha256:'));
  }
});
