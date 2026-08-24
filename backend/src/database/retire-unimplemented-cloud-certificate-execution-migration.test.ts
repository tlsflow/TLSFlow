import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260817001000_retire_unimplemented_cloud_certificate_execution.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforeTarget(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyTarget(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('退役未实现的云端证书执行，保留云账号、发现能力和普通 DSL WorkflowVersion', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBeforeTarget(db);
  const hash = `sha256:${'a'.repeat(64)}`;
  const inputBindings = `jsonb_build_object(
    'apiVersion', 'gcac.input-bindings/v1',
    'variables', '{}'::jsonb,
    'connections', '{}'::jsonb,
    'credentials', '{}'::jsonb,
    'artifacts', '{}'::jsonb
  )`;
  await db.exec(`
    insert into pg_cloud_account_assets (
      id, tenant_id, asset_kind, provider_key, display_name, credential_ref, scope, identity_key,
      status, metadata, created_at, updated_at, version
    ) values (
      'cloud-account', 'tenant-1', 'cloud.account', 'cloud.aliyun', '测试云账号', 'credential://cloud', '{}'::jsonb, 'cloud-account',
      'ACTIVE', '{}'::jsonb, now(), now(), 1
    );

    insert into unified_plugin_versions (
      id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values
      ('cloud-plugin', 'SYSTEM', 'cloud.aliyun', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       jsonb_build_object('pluginId', 'cloud.aliyun', 'version', '1.0.0'), '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('normal-plugin', 'SYSTEM', 'device.example', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       jsonb_build_object('pluginId', 'device.example', 'version', '1.0.0'), '${hash}', '${hash}', '{}'::jsonb, 'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now());

    insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, input_bindings, managed_context, status, version, created_at, updated_at
    ) values
      ('cloud-binding', 'tenant-1', 'cloud-plugin', 'MANAGED', ${inputBindings}, jsonb_build_object('cloudAccountAssetId', 'cloud-account'), 'ACTIVE', 1, now(), now()),
      ('normal-binding', 'tenant-1', 'normal-plugin', 'MANAGED', ${inputBindings}, '{}'::jsonb, 'ACTIVE', 1, now(), now());

    insert into plugin_capability_assignments (
      id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id, plugin_binding_id, precedence, status, created_at, updated_at
    ) values
      ('cloud-deploy-assignment', 'tenant-1', 'CLOUD_ACCOUNT_ASSET', 'cloud-account', 'certificate.deploy', 'cloud-plugin', 'cloud-binding', 'ASSET_OVERRIDE', 'ACTIVE', now(), now()),
      ('cloud-discover-assignment', 'tenant-1', 'CLOUD_ACCOUNT_ASSET', 'cloud-account', 'cloud.service.discover', 'cloud-plugin', 'cloud-binding', 'ASSET_OVERRIDE', 'ACTIVE', now(), now()),
      ('normal-deploy-assignment', 'tenant-1', 'DEVICE', 'device-1', 'certificate.deploy', 'normal-plugin', 'normal-binding', 'DEVICE_DEFAULT', 'ACTIVE', now(), now());

    insert into pg_managed_targets (
      id, tenant_id, device_id, asset_id, framework_instance_id, site_id, discovery_provider_key, target_type, target_key, binding_key,
      supported_capabilities, execution_locations, last_seen_at, status, metadata, created_at, updated_at, version
    ) values (
      'cloud-target', 'tenant-1', null, 'cloud-account', null, null, 'plugin:cloud.aliyun', 'cloud.resource', 'cdn.domain:resource-1', 'cdn.domain:resource-1',
      '["certificate.deploy"]'::jsonb, '["CONTROL_PLANE"]'::jsonb, now(), 'ACTIVE', '{}'::jsonb, now(), now(), 1
    );

    insert into pg_documents (namespace, document_id, payload)
    values
      ('workflow.templates', 'cloud-template', jsonb_build_object('id', 'cloud-template', 'origin', 'plugin_internal', 'currentVersionId', 'cloud-version')),
      ('workflow.templates', 'normal-template', jsonb_build_object('id', 'normal-template', 'origin', 'plugin_internal', 'currentVersionId', 'normal-version')),
      ('workflow.template_versions', 'cloud-version', jsonb_build_object('id', 'cloud-version', 'templateId', 'cloud-template', 'version', 1, 'status', 'published', 'contentHash', '${hash}', 'content', jsonb_build_object('kind', 'CurlSshWorkflow'))),
      ('workflow.template_versions', 'cloud-discover-version', jsonb_build_object('id', 'cloud-discover-version', 'templateId', 'cloud-template', 'version', 2, 'status', 'published', 'contentHash', '${hash}', 'content', jsonb_build_object('kind', 'CurlSshWorkflow'))),
      ('workflow.template_versions', 'normal-version', jsonb_build_object('id', 'normal-version', 'templateId', 'normal-template', 'version', 1, 'status', 'published', 'contentHash', '${hash}', 'content', jsonb_build_object('kind', 'CurlSshWorkflow')));

    insert into unified_plugin_workflow_bindings (
      plugin_version_id, owner_type, capability_key, workflow_key, workflow_resource_path,
      workflow_template_id, workflow_version_id, workflow_content_sha256, created_at
    ) values
      ('cloud-plugin', 'SYSTEM', 'certificate.deploy', 'certificate.deploy', 'workflows/deploy.json', 'cloud-template', 'cloud-version', '${hash}', now()),
      ('cloud-plugin', 'SYSTEM', 'cloud.service.discover', 'cloud.service.discover', 'workflows/discover.json', 'cloud-template', 'cloud-discover-version', '${hash}', now()),
      ('normal-plugin', 'SYSTEM', 'certificate.deploy', 'certificate.deploy', 'workflows/deploy.json', 'normal-template', 'normal-version', '${hash}', now());

    insert into workflow_execution_bindings (
      id, tenant_id, plugin_version_id, capability_key, workflow_key, workflow_template_id,
      workflow_version_selection, workflow_version_id, runner, gateway_id, input_bindings,
      status, version, created_at, updated_at
    ) values
      ('cloud-execution', 'tenant-1', 'cloud-plugin', 'certificate.deploy', 'certificate.deploy', 'cloud-template', 'FIXED', 'cloud-version', 'CONTROL_PLANE', null, ${inputBindings}, 'ACTIVE', 1, now(), now()),
      ('normal-execution', 'tenant-1', 'normal-plugin', 'certificate.deploy', 'certificate.deploy', 'normal-template', 'FIXED', 'normal-version', 'CONTROL_PLANE', null, ${inputBindings}, 'ACTIVE', 1, now(), now());
  `);

  await applyTarget(db);

  assert.equal((await db.query(`select status from plugin_capability_assignments where id='cloud-deploy-assignment'`)).rows[0]?.status, 'DISABLED');
  assert.equal((await db.query(`select status from plugin_capability_assignments where id='cloud-discover-assignment'`)).rows[0]?.status, 'ACTIVE');
  assert.equal((await db.query(`select status from plugin_capability_assignments where id='normal-deploy-assignment'`)).rows[0]?.status, 'ACTIVE');
  assert.deepEqual((await db.query(`select status, metadata->>'disabledReason' as reason from pg_managed_targets where id='cloud-target'`)).rows[0], {
    status: 'DISABLED',
    reason: 'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  });
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id='cloud-plugin' and capability_key='certificate.deploy'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from workflow_execution_bindings where id='cloud-execution'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id='cloud-plugin' and capability_key='cloud.service.discover'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from unified_plugin_workflow_bindings where plugin_version_id='normal-plugin'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where namespace='workflow.template_versions' and document_id='cloud-version'`)).rows[0]?.count, '1');
  assert.equal((await db.query(`select count(*)::text as count from pg_cloud_account_assets where id='cloud-account' and deleted_at is null`)).rows[0]?.count, '1');

  const auditCount = (await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version='20260817001000'`)).rows[0]?.count;
  assert.equal(Number(auditCount) >= 4, true);
  await applyTarget(db);
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version='20260817001000'`)).rows[0]?.count, auditCount);
});
