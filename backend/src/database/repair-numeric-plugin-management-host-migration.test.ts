import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260817000800_repair_numeric_plugin_management_connection_hosts.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

/** 中文说明：先应用不可变历史，再单独验证本迁移不会猜测非确定性地址。 */
async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyTarget(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('只将受管绑定中的纯数字 management.host 修复为 Host.primaryIp', async () => {
  const db = new PgliteDatabase();
  try {
    await applyMigrationsBeforeTarget(db);
    await seed(db);

    await applyTarget(db);
    await applyTarget(db);

    const rows = await db.query<{ id: string; host: string; version: number }>(`
      select id,
             input_bindings #>> '{connections,management,host}' as host,
             version
        from unified_plugin_bindings
       where id in ('binding-repair', 'binding-valid', 'binding-missing-host-ip')
       order by id
    `);
    assert.deepEqual(rows.rows, [
      { id: 'binding-missing-host-ip', host: '2', version: 1 },
      { id: 'binding-repair', host: '10.255.0.49', version: 2 },
      { id: 'binding-valid', host: 'adc.example.com', version: 1 },
    ]);
  } finally {
    await db.close();
  }
});

async function seed(db: PgliteDatabase): Promise<void> {
  const bindings = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: { management: { host: '1', port: 443 } },
    credentials: {},
    artifacts: {},
  });
  const validBindings = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: { management: { host: 'adc.example.com', port: 443 } },
    credentials: {},
    artifacts: {},
  });
  const missingHostIpBindings = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: { management: { host: '2', port: 443 } },
    credentials: {},
    artifacts: {},
  });

  await db.exec(`
    insert into pg_hosts (
      id, tenant_id, hostname, primary_ip, ip_addresses, os_type, management_channels,
      discovery_source, compatibility_level, management_mode, status, tags, created_at, updated_at, version
    ) values
      ('host-repair', 'tenant-repair', 'adc-repair', '10.255.0.49', '["10.255.0.49"]'::jsonb,
       'NETWORK_DEVICE', '[]'::jsonb, 'PROVIDER', 'L1', 'AGENTLESS', 'ACTIVE', '[]'::jsonb, now(), now(), 1),
      ('host-no-ip', 'tenant-repair', 'adc-no-ip', null, '[]'::jsonb,
       'NETWORK_DEVICE', '[]'::jsonb, 'PROVIDER', 'L1', 'AGENTLESS', 'ACTIVE', '[]'::jsonb, now(), now(), 1);

    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values (
      'version-repair', 'tenant-repair', 'test.repair', '1.0.0', 'USER', 'WORKFLOW_DSL', 'BOTH',
      'UNSIGNED', 'SELF_MANAGED', '{}'::jsonb, 'sha256:test', 'sha256:test', '{}'::jsonb,
      'ENABLED', 'NOT_REQUIRED', '[]'::jsonb, '{}'::jsonb, now(), now()
    );

    insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, input_bindings, managed_context, status, version, created_at, updated_at
    ) values
      ('binding-repair', 'tenant-repair', 'version-repair', 'MANAGED', '${bindings}'::jsonb,
       '{"hostId":"host-repair"}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('binding-valid', 'tenant-repair', 'version-repair', 'MANAGED', '${validBindings}'::jsonb,
       '{"hostId":"host-repair"}'::jsonb, 'ACTIVE', 1, now(), now()),
      ('binding-missing-host-ip', 'tenant-repair', 'version-repair', 'MANAGED', '${missingHostIpBindings}'::jsonb,
       '{"hostId":"host-no-ip"}'::jsonb, 'ACTIVE', 1, now(), now());
  `);
}
