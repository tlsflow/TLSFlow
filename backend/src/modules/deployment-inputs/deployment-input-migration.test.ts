import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { DeploymentInputMigrationService } from './migration/deployment-input-migration.service.js';

test('递增迁移将旧 Binding 转换为 InputBindingsV1 并物化四层父级值', async () => {
  const db = new PgliteDatabase();
  await createLegacySchema(db);
  await insertLegacyFixture(db);
  const migration = new DeploymentInputMigrationService(db);

  const before = await migration.dryRun();
  assert.equal(before.alreadyMigrated, false);
  assert.equal(before.pluginBindings, 3);
  assert.equal(before.workflowExecutionBindings, 1);
  assert.equal(before.applicationAssetBindingsWithoutOwnInput, 1);
  assert.deepEqual(before.issues, [{ code: 'APPLICATION_BINDING_REQUIRES_MATERIALIZATION', count: 1 }]);

  const sql = await readFile('src/database/migrations/20260730000100_unify_deployment_input_bindings.sql', 'utf8');
  await db.transaction(async (transaction) => transaction.exec(sql));

  const asset = (await db.query<{ input_bindings: Record<string, unknown> }>('select input_bindings from unified_plugin_bindings where id=$1', ['binding-asset'])).rows[0]!.input_bindings as {
    variables: Record<string, unknown>;
    connections: Record<string, unknown>;
    credentials: Record<string, unknown>;
    artifacts: Record<string, unknown>;
  };
  assert.deepEqual(asset.variables, { retries: 2, targetName: 'target-1' });
  assert.deepEqual(asset.connections, { management: { host: 'device.example.com', port: 8443, tls: { verifyPeer: false, serverName: 'device.example.com' } } });
  assert.deepEqual(asset.credentials, { management: { credentialId: 'credential-1' } });
  assert.deepEqual(asset.artifacts, { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'leafPem' } } });

  const audit = await migration.audit();
  assert.equal(audit.valid, true);
  assert.equal(audit.legacyColumnsRemaining, 0);
  assert.equal(audit.unresolvedApplicationAssetBindings, 0);
  assert.equal((await migration.dryRun()).alreadyMigrated, true);

  // 仅绑定制品也是有效的应用资产输入，不能被审计误判为空 Binding。
  await db.query(`update unified_plugin_bindings set input_bindings=$1::jsonb where id='binding-asset'`, [JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: {},
    credentials: {},
    artifacts: { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'leafPem' } } },
  })]);
  assert.equal((await migration.audit()).unresolvedApplicationAssetBindings, 0);
});

test('迁移服务只报告旧 Secret 数量并拒绝静默丢弃', async () => {
  const db = new PgliteDatabase();
  await createLegacySchema(db);
  await insertLegacyFixture(db);
  await db.query(`update unified_plugin_bindings set secret_bindings=$1::jsonb where id='binding-device'`, [JSON.stringify({ auth: 'secret://redacted' })]);
  const migration = new DeploymentInputMigrationService(db);

  const before = await migration.dryRun();
  assert.deepEqual(before.issues[0], { code: 'LEGACY_SECRET_BINDINGS_REQUIRE_REBIND', count: 1 });
  assert.equal(JSON.stringify(before).includes('secret://redacted'), false);
  await assert.rejects(
    () => migration.execute({ migrationsDir: 'src/database/migrations', appliedBy: 'test' }),
    (error: any) => error.errorCode === 'VALIDATION_FAILED' && error.details?.count === 1,
  );
});

async function createLegacySchema(db: PgliteDatabase): Promise<void> {
  await db.exec(`
    create table unified_plugin_bindings (
      id text primary key, tenant_id text not null, plugin_version_id text not null, mode text not null,
      variable_bindings jsonb not null default '{}'::jsonb, credential_bindings jsonb not null default '{}'::jsonb,
      secret_bindings jsonb not null default '{}'::jsonb, certificate_artifact_bindings jsonb not null default '{}'::jsonb,
      connection_bindings jsonb not null default '{}'::jsonb, managed_context jsonb, status text not null,
      version integer not null, created_at timestamptz not null, updated_at timestamptz not null
    );
    create table workflow_execution_bindings (
      id text primary key, connection_bindings jsonb not null default '{}'::jsonb,
      variable_bindings jsonb not null default '{}'::jsonb, credential_bindings jsonb not null default '{}'::jsonb,
      certificate_artifact_bindings jsonb not null default '{}'::jsonb
    );
    create table plugin_capability_assignments (
      tenant_id text not null, owner_type text not null, owner_id text not null, capability_key text not null,
      plugin_version_id text not null, plugin_binding_id text not null, status text not null
    );
    create table pg_application_asset_targets (
      tenant_id text not null, application_asset_id text not null, managed_target_id text not null, deleted_at timestamptz
    );
    create table pg_managed_targets (
      id text primary key, tenant_id text not null, device_id text not null, status text not null, deleted_at timestamptz
    );
  `);
}

async function insertLegacyFixture(db: PgliteDatabase): Promise<void> {
  const insertBinding = async (id: string, variables: object, credentials: object, artifacts: object, connections: object) => {
    await db.query(`insert into unified_plugin_bindings
      (id,tenant_id,plugin_version_id,mode,variable_bindings,credential_bindings,secret_bindings,certificate_artifact_bindings,connection_bindings,managed_context,status,version,created_at,updated_at)
      values ($1,'tenant-1','plugin-version-1','MANAGED',$2::jsonb,$3::jsonb,'{}'::jsonb,$4::jsonb,$5::jsonb,'{}'::jsonb,'ACTIVE',1,now(),now())`,
    [id, JSON.stringify(variables), JSON.stringify(credentials), JSON.stringify(artifacts), JSON.stringify(connections)]);
  };
  await insertBinding('binding-device', { retries: 1 }, { management: { credentialId: 'credential-1' } }, {}, { management: { host: 'device.example.com', tls: { verifyPeer: true, serverName: 'device.example.com' } } });
  await insertBinding('binding-target', { retries: 2, targetName: 'target-1' }, {}, {}, { management: { port: 8443, tls: { verifyPeer: false } } });
  await insertBinding('binding-asset', {}, {}, { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'leafPem' } } }, {});
  await db.exec(`
    insert into pg_managed_targets values ('target-1','tenant-1','host-1','ACTIVE',null);
    insert into pg_application_asset_targets values ('tenant-1','asset-1','target-1',null);
    insert into plugin_capability_assignments values
      ('tenant-1','DEVICE','host-1','certificate.deploy','plugin-version-1','binding-device','ACTIVE'),
      ('tenant-1','MANAGED_TARGET','target-1','certificate.deploy','plugin-version-1','binding-target','ACTIVE'),
      ('tenant-1','APPLICATION_ASSET','asset-1','certificate.deploy','plugin-version-1','binding-asset','ACTIVE');
    insert into workflow_execution_bindings values ('workflow-binding-1','{}'::jsonb,'{"path":"/tmp/cert"}'::jsonb,'{}'::jsonb,'{}'::jsonb);
  `);
}
