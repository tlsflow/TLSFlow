import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabasePort, QueryResult } from '../../database/database-port.js';
import { BuiltinPluginCompatibilityUpgradeService } from './application/builtin-plugin-compatibility-upgrade.service.js';

test('内置插件 Patch 升级原子切换五类版本引用', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db = fakeDatabase(calls, [
    { rows: [{ id: 'citrix-1.1.10' }] },
    { rows: [
      { id: 'citrix-1.1.0', plugin_version: '1.1.0' },
      { id: 'citrix-1.1.1', plugin_version: '1.1.1' },
      { id: 'citrix-1.1.2', plugin_version: '1.1.2' },
      { id: 'citrix-1.1.3', plugin_version: '1.1.3' },
      { id: 'citrix-1.1.4', plugin_version: '1.1.4' },
      { id: 'citrix-1.1.5', plugin_version: '1.1.5' },
      { id: 'citrix-1.1.6', plugin_version: '1.1.6' },
      { id: 'citrix-1.1.7', plugin_version: '1.1.7' },
      { id: 'citrix-1.1.8', plugin_version: '1.1.8' },
      { id: 'citrix-1.1.9', plugin_version: '1.1.9' },
      { id: 'citrix-1.1.11', plugin_version: '1.1.11' },
      { id: 'citrix-1.2.0', plugin_version: '1.2.0' },
    ] },
    ...Array.from({ length: 50 }, () => ({ rows: [] })),
  ]);

  await new BuiltinPluginCompatibilityUpgradeService(db).upgradePatchLine('tenant-1', 'citrix-1.1.10', 'fixture.builtin.plugin', '1.1.10');

  assert.equal(calls.length, 52);
  const sourceIds = ['citrix-1.1.0', 'citrix-1.1.1', 'citrix-1.1.2', 'citrix-1.1.3', 'citrix-1.1.4', 'citrix-1.1.5', 'citrix-1.1.6', 'citrix-1.1.7', 'citrix-1.1.8', 'citrix-1.1.9'];
  for (const [index, sourceId] of sourceIds.entries()) {
    const offset = 2 + index * 5;
    assert.match(calls[offset]!.sql, /update pg_hosts/);
    assert.match(calls[offset + 1]!.sql, /update pg_service_assets/);
    assert.match(calls[offset + 2]!.sql, /update unified_plugin_bindings/);
    assert.match(calls[offset + 3]!.sql, /update plugin_capability_assignments/);
    assert.match(calls[offset + 4]!.sql, /update pg_device_assets/);
    assert.deepEqual(calls[offset]!.params?.slice(0, 2), [sourceId, 'citrix-1.1.10']);
    for (const call of calls.slice(offset + 1, offset + 5)) {
      assert.equal(call.params?.[0], 'citrix-1.1.10');
      assert.equal(call.params?.[3], sourceId);
    }
  }
});

test('内置插件 Patch 升级拒绝非官方目标版本', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db = fakeDatabase(calls, [{ rows: [] }]);
  await assert.rejects(
    () => new BuiltinPluginCompatibilityUpgradeService(db).upgradePatchLine('tenant-1', 'user-plugin-version', 'fixture.builtin.plugin', '1.1.10'),
    /内置插件目标版本不存在/,
  );
  assert.equal(calls.length, 1);
});

function fakeDatabase(
  calls: Array<{ sql: string; params?: unknown[] }>,
  results: QueryResult[],
): DatabasePort {
  const db: DatabasePort = {
    exec: async () => undefined,
    query: async <TRow extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return (results.shift() ?? { rows: [] }) as QueryResult<TRow>;
    },
    transaction: async (work) => work(db),
  };
  return db;
}
