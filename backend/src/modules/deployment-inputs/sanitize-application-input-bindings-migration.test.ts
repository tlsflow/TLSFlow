import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';

test('递增迁移按当前 Contract 清理应用资产旧 Binding 字段', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table unified_plugin_bindings (
      id text primary key, tenant_id text not null, plugin_version_id text not null,
      input_bindings jsonb not null, status text not null, version integer not null, updated_at timestamptz not null
    );
    create table plugin_capability_assignments (
      tenant_id text not null, owner_type text not null, owner_id text not null, capability_key text not null,
      plugin_version_id text not null, plugin_binding_id text not null, status text not null
    );
    create table unified_plugin_versions (
      id text primary key, tenant_id text not null, runtime text not null, manifest jsonb not null
    );
    create table unified_plugin_resources (
      plugin_version_id text not null, resource_path text not null, resource_content text not null
    );
  `);
  const inputContract = {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      targetName: { bindingPolicy: 'required_binding', configurationMode: 'required' },
      fixedName: { bindingPolicy: 'fixed', configurationMode: 'runtime' },
    },
      connections: {
        management: {
          host: { bindingPolicy: 'required_binding', configurationMode: 'required' },
          port: { bindingPolicy: 'default_overridable', configurationMode: 'advanced' },
        },
    },
    credentials: { management: {} },
    artifacts: { certificate: {} },
  };
  await db.query(`insert into unified_plugin_bindings values ($1,$2,$3,$4::jsonb,'ACTIVE',1,now())`, [
    'binding-1', 'tenant-1', 'version-1', JSON.stringify({
      apiVersion: 'gcac.input-bindings/v1',
      variables: { targetName: 'old-target', deviceHost: '10.0.0.1', fixedName: 'old-fixed' },
      connections: { management: { 'connection.address': '10.0.0.1', host: 'old.example.com', port: 443 } },
      credentials: { management: { credentialId: 'credential-1' }, legacy: { credentialId: 'credential-2' } },
      artifacts: { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'leafPem' } }, legacy: {} },
    }),
  ]);
  await db.query(`insert into plugin_capability_assignments values ('tenant-1','APPLICATION_ASSET','asset-1','certificate.deploy','version-1','binding-1','ACTIVE')`);
  await db.query(`insert into unified_plugin_versions values ('version-1','tenant-1','AGENT_ATOMIC',$1::jsonb)`, [JSON.stringify({ resources: { agentRecipes: { 'certificate.deploy': 'agent-recipes/deploy.json' } } })]);
  await db.query(`insert into unified_plugin_resources values ('version-1','agent-recipes/deploy.json',$1)`, [JSON.stringify({ inputContract })]);

  const sql = await readFile('src/database/migrations/20260731000200_sanitize_application_input_bindings.sql', 'utf8');
  await db.transaction(async (transaction) => transaction.exec(sql));

  const migrated = (await db.query<{ input_bindings: Record<string, unknown>; version: number }>(
    'select input_bindings, version from unified_plugin_bindings where id=$1', ['binding-1'],
  )).rows[0]!;
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.input_bindings, {
    apiVersion: 'gcac.input-bindings/v1',
    variables: { targetName: 'old-target' },
    connections: { management: { host: 'old.example.com', port: 443 } },
    credentials: { management: { credentialId: 'credential-1' } },
    artifacts: { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'leafPem' } } },
  });
  const backup = (await db.query<{ original_version: number; original_input_bindings: Record<string, unknown> }>(
    'select original_version, original_input_bindings from deployment_input_binding_sanitization_backups where plugin_binding_id=$1', ['binding-1'],
  )).rows[0]!;
  assert.equal(backup.original_version, 1);
  assert.equal((backup.original_input_bindings.variables as Record<string, unknown>).deviceHost, '10.0.0.1');

  await db.transaction(async (transaction) => transaction.exec(sql));
  assert.equal((await db.query<{ version: number }>('select version from unified_plugin_bindings where id=$1', ['binding-1'])).rows[0]!.version, 2);
});
