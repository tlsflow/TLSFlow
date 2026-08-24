import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';

test('递增迁移按插件 Contract 物化应用资产证书 Artifact Binding', async () => {
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
    create table pg_service_assets (
      id text primary key, tenant_id text not null, metadata jsonb not null, deleted_at timestamptz
    );
    create table unified_plugin_versions (
      id text primary key, tenant_id text not null, runtime text not null, manifest jsonb not null
    );
    create table unified_plugin_resources (
      plugin_version_id text not null, resource_path text not null, resource_content text not null
    );
  `);
  const inputContract = {
    artifacts: {
      certificate: {
        kind: 'certificate',
        required: true,
        artifactContract: {
          outputs: {
            certificate: { role: 'public_certificate', required: true },
            privateKey: { role: 'private_key', required: true, sensitive: true },
          },
        },
      },
    },
  };
  await db.query(`insert into unified_plugin_bindings values
    ('binding-1','tenant-1','version-1',$1::jsonb,'ACTIVE',1,now())`, [JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {},
  })]);
  await db.query(`insert into plugin_capability_assignments values
    ('tenant-1','APPLICATION_ASSET','asset-1','certificate.deploy','version-1','binding-1','ACTIVE')`);
  await db.query(`insert into pg_service_assets values ('asset-1','tenant-1',$1::jsonb,null)`, [JSON.stringify({
    deploymentStrategy: { managedTarget: { certificateFormatId: 'format-1' } },
  })]);
  await db.query(`insert into unified_plugin_versions values ('version-1','tenant-1','AGENT_ATOMIC',$1::jsonb)`, [JSON.stringify({
    resources: { agentRecipes: { 'certificate.deploy': 'agent-recipes/deploy.json' } },
  })]);
  await db.query(`insert into unified_plugin_resources values ('version-1','agent-recipes/deploy.json',$1)`, [JSON.stringify({ inputContract })]);

  const sql = await readFile('src/database/migrations/20260731000100_materialize_asset_artifacts.sql', 'utf8');
  await db.transaction(async (transaction) => transaction.exec(sql));

  const migrated = (await db.query<{ input_bindings: { artifacts: Record<string, unknown> }; version: number }>(
    'select input_bindings, version from unified_plugin_bindings where id=$1', ['binding-1'],
  )).rows[0]!;
  const backup = (await db.query<{ original_input_bindings: { artifacts: Record<string, unknown> }; original_version: number }>(
    'select original_input_bindings, original_version from deployment_input_artifact_binding_migration_backups where plugin_binding_id=$1', ['binding-1'],
  )).rows[0]!;
  assert.deepEqual(backup.original_input_bindings.artifacts, {});
  assert.equal(backup.original_version, 1);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.input_bindings.artifacts, {
    certificate: {
      certificateFormatId: 'format-1',
      outputBindings: { certificate: 'leafPem', privateKey: 'privateKeyPem' },
    },
  });

  // 重复执行不得再次改写或递增版本。
  await db.transaction(async (transaction) => transaction.exec(sql));
  assert.equal((await db.query<{ version: number }>('select version from unified_plugin_bindings where id=$1', ['binding-1'])).rows[0]!.version, 2);
});
