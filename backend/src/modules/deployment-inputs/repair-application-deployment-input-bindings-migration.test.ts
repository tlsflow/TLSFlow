import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';

test('历史应用资产绑定切换到当前目标插件并补齐默认变量和证书 Artifact 映射', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table unified_plugin_bindings (
      id text primary key, tenant_id text not null, plugin_version_id text not null,
      input_bindings jsonb not null, managed_context jsonb, status text not null, version integer not null, updated_at timestamptz not null
    );
    create table plugin_capability_assignments (
      id text primary key, tenant_id text not null, owner_type text not null, owner_id text not null,
      capability_key text not null, plugin_version_id text not null, plugin_binding_id text not null,
      status text not null, updated_at timestamptz not null
    );
    create table pg_service_assets (
      id text primary key, tenant_id text not null, metadata jsonb not null, deleted_at timestamptz
    );
    create table pg_application_asset_targets (
      id text primary key, tenant_id text not null, application_asset_id text not null,
      managed_target_id text not null, deleted_at timestamptz
    );
    create table pg_managed_targets (
      id text primary key, tenant_id text not null, device_id text not null,
      status text not null, deleted_at timestamptz
    );
    create table unified_plugin_versions (
      id text primary key, tenant_id text not null, manifest jsonb not null
    );
    create table unified_plugin_resources (
      plugin_version_id text not null, resource_path text not null, resource_content text not null
    );
  `);
  const emptyBindings = JSON.stringify({ apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} });
  const contract = {
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {
        allowInsecureTls: {
          type: 'boolean', required: true, configurationMode: 'required', source: { kind: 'binding' },
          lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
        },
      },
      connections: {},
      credentials: {},
      artifacts: {
        certificateArtifact: {
          kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
          artifactContract: { outputs: {
            leafPemBase64: { role: 'public_certificate', required: true },
            privateKeyPemBase64: { role: 'private_key', required: true },
          } },
        },
      },
    },
  };
  await db.query(`insert into unified_plugin_versions values
    ('old-version','tenant-1',$1::jsonb),
    ('current-version','tenant-1',$2::jsonb)`, [
    JSON.stringify({ resources: { workflows: { 'certificate.deploy': 'old.json' } } }),
    JSON.stringify({ resources: { workflows: { 'certificate.deploy': 'deploy.json' }, onboarding: { applicationAsset: 'onboarding.json' } } }),
  ]);
  await db.query(`insert into unified_plugin_resources values
    ('current-version','deploy.json',$1),
    ('current-version','onboarding.json',$2)`, [
    JSON.stringify(contract),
    JSON.stringify({ deploymentDefaults: { capabilityKey: 'certificate.deploy', variables: { allowInsecureTls: true } } }),
  ]);
  const legacyArtifactBindings = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: {},
    credentials: {},
    artifacts: { certificate: { certificateFormatId: 'format-from-legacy-slot', outputBindings: { certificate: 'leafPem' } } },
  });
  await db.query(`insert into unified_plugin_bindings values
    ('target-binding','tenant-1','current-version',$1,null,'ACTIVE',1,now()),
    ('asset-binding','tenant-1','old-version',$1,$2::jsonb,'ACTIVE',3,now())`, [emptyBindings, JSON.stringify({ hostId: 'old-host', managedTargetId: 'old-target' })]);
  await db.query(`insert into pg_managed_targets values ('target-1','tenant-1','device-1','ACTIVE',null)`);
  await db.query(`insert into pg_application_asset_targets values ('relation-1','tenant-1','asset-1','target-1',null)`);
  await db.query(`update unified_plugin_bindings set input_bindings=$1::jsonb where id='asset-binding'`, [legacyArtifactBindings]);
  await db.query(`insert into pg_service_assets values ('asset-1','tenant-1',$1::jsonb,null)`, [JSON.stringify({ deploymentStrategy: { managedTarget: {} } })]);
  await db.query(`insert into plugin_capability_assignments values
    ('target-assignment','tenant-1','MANAGED_TARGET','target-1','certificate.deploy','current-version','target-binding','ACTIVE',now()),
    ('asset-assignment','tenant-1','APPLICATION_ASSET','asset-1','certificate.deploy','old-version','asset-binding','ACTIVE',now())`);

  const sql = await readFile('src/database/migrations/20260822000100_repair_application_deployment_input_bindings.sql', 'utf8');
  await db.transaction(async (transaction) => transaction.exec(sql));

  const binding = (await db.query<{ plugin_version_id: string; version: number; input_bindings: any; managed_context: any }>(
    `select plugin_version_id, version, input_bindings, managed_context from unified_plugin_bindings where id='asset-binding'`,
  )).rows[0]!;
  assert.equal(binding.plugin_version_id, 'current-version');
  assert.equal(binding.version, 4);
  assert.deepEqual(binding.managed_context, { hostId: 'device-1', managedTargetId: 'target-1' });
  assert.equal(binding.input_bindings.variables.allowInsecureTls, true);
  assert.deepEqual(binding.input_bindings.artifacts.certificateArtifact, {
    certificateFormatId: 'format-from-legacy-slot',
    outputBindings: { leafPemBase64: 'leafPem', privateKeyPemBase64: 'privateKeyPem' },
  });
  assert.equal((await db.query(`select plugin_version_id from plugin_capability_assignments where id='asset-assignment'`)).rows[0]?.plugin_version_id, 'current-version');
  assert.equal((await db.query(`select status from deployment_input_binding_repairs where plugin_binding_id='asset-binding'`)).rows[0]?.status, 'REPAIRED');
  assert.equal((await db.query(`select original_plugin_version_id from deployment_input_binding_repair_backups where plugin_binding_id='asset-binding'`)).rows[0]?.original_plugin_version_id, 'old-version');

  await db.transaction(async (transaction) => transaction.exec(sql));
  assert.equal((await db.query(`select version from unified_plugin_bindings where id='asset-binding'`)).rows[0]?.version, 4);
});
