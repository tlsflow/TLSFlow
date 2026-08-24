import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { PgliteDatabase } from './pglite-database.js';

const timestamp = '2026-08-09T00:00:00Z';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

function bareHash(character: string): string {
  return character.repeat(64);
}

function runnerHash(character: string): string {
  return `sha256:${bareHash(character)}`;
}

async function readMigration(name: string): Promise<string> {
  return readFile(resolve(migrationDirectory, name), 'utf8');
}

async function applyCoreMigrationsBeforeCutover(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < '20260809000100_plugin_runner_canonical_cutover.sql')
    .sort();

  for (const file of files) {
    await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
  }

  // 旧迁移已删除该表；这里恢复一份真实定义，验证 00200 对残留旧 Mount 的清退是安全的。
  await db.exec(await readMigration('20260722000100_agent_plugin_mounts.sql'));
}

async function createFixtureDatabase(): Promise<PgliteDatabase> {
  const db = new PgliteDatabase();
  await applyCoreMigrationsBeforeCutover(db);

  await insertVersion(db, {
    id: 'nginx-a',
    tenantId: 'tenant-a',
    pluginId: 'builtin.linux.nginx.pem',
    version: '1.2.3',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'builtin.linux.nginx.pem', version: '1.2.3', runtime: 'AGENT_ATOMIC' },
    packageSha256: bareHash('a'),
    manifestSha256: bareHash('b'),
    resourceSha256: { 'manifest.json': bareHash('c') },
  });
  await insertVersion(db, {
    id: 'nginx-b',
    tenantId: 'tenant-b',
    pluginId: 'builtin.linux.nginx.pem',
    version: '1.2.3',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'builtin.linux.nginx.pem', version: '1.2.3', runtime: 'AGENT_ATOMIC' },
    packageSha256: bareHash('d'),
    manifestSha256: bareHash('e'),
    resourceSha256: { 'manifest.json': bareHash('f') },
  });
  await insertVersion(db, {
    id: 'nginx-canonical-a',
    tenantId: 'tenant-a',
    pluginId: 'web.nginx',
    version: '1.2.3',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'web.nginx', canonicalPluginId: 'web.nginx', executionMode: 'isolated_process', version: '1.2.3' },
    packageSha256: runnerHash('6'),
    manifestSha256: runnerHash('7'),
    resourceSha256: { 'manifest.json': runnerHash('8') },
  });
  await insertVersion(db, {
    id: 'acme-a',
    tenantId: 'tenant-a',
    pluginId: 'acme',
    version: '2.0.0',
    runtime: 'WORKFLOW_DSL',
    manifest: { pluginId: 'acme', version: '2.0.0', runtime: 'WORKFLOW_DSL' },
    packageSha256: runnerHash('1'),
    manifestSha256: runnerHash('2'),
    resourceSha256: { 'workflow.json': runnerHash('3') },
  });
  await insertVersion(db, {
    id: 'unknown-plugin',
    tenantId: 'tenant-a',
    pluginId: 'third-party.unknown',
    version: '1.0.0',
    runtime: 'TRUSTED_JS',
    manifest: { pluginId: 'third-party.unknown', version: '1.0.0', runtime: 'TRUSTED_JS' },
    packageSha256: bareHash('4'),
    manifestSha256: bareHash('5'),
    resourceSha256: { 'entry.js': bareHash('6') },
  });
  await insertVersion(db, {
    id: 'invalid-version',
    tenantId: 'tenant-a',
    pluginId: 'acme-dns',
    version: '1.0',
    runtime: 'WORKFLOW_DSL',
    manifest: { pluginId: 'acme-dns', version: '1.0', runtime: 'WORKFLOW_DSL' },
    packageSha256: runnerHash('7'),
    manifestSha256: runnerHash('8'),
    resourceSha256: { 'workflow.json': runnerHash('9') },
  });
  await insertVersion(db, {
    id: 'invalid-hash',
    tenantId: 'tenant-a',
    pluginId: 'openssl',
    version: '3.0.0',
    runtime: 'TRUSTED_JS',
    manifest: { pluginId: 'openssl', version: '3.0.0', runtime: 'TRUSTED_JS' },
    packageSha256: 'not-a-hash',
    manifestSha256: 'also-not-a-hash',
    resourceSha256: { 'entry.js': 'not-a-resource-hash' },
    validationReport: ['legacy-invalid-hash'],
  });
  await insertVersion(db, {
    id: 'invalid-manifest',
    tenantId: 'tenant-a',
    pluginId: 'web.apache',
    version: '1.0.0',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'wrong.plugin', canonicalPluginId: 'wrong.plugin', executionMode: 'isolated_process', version: '1.0.0' },
    packageSha256: runnerHash('a'),
    manifestSha256: runnerHash('b'),
    resourceSha256: { 'manifest.json': runnerHash('c') },
  });
  await insertVersion(db, {
    id: 'invalid-resource-shape',
    tenantId: 'tenant-a',
    pluginId: 'web.iis',
    version: '4.0.0',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'web.iis', canonicalPluginId: 'web.iis', executionMode: 'isolated_process', version: '4.0.0' },
    packageSha256: runnerHash('9'),
    manifestSha256: runnerHash('a'),
    resourceSha256: 'legacy-resource-list',
  });
  await insertVersion(db, {
    id: 'invalid-resource-null',
    tenantId: 'tenant-a',
    pluginId: 'device.citrix.netscaler-adc',
    version: '5.0.0',
    runtime: 'AGENT_ATOMIC',
    manifest: { pluginId: 'device.citrix.netscaler-adc', canonicalPluginId: 'device.citrix.netscaler-adc', executionMode: 'isolated_process', version: '5.0.0' },
    packageSha256: runnerHash('c'),
    manifestSha256: runnerHash('d'),
    resourceSha256: { 'manifest.json': null },
  });

  await db.query(
    `insert into unified_plugin_resources
       (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
     values ($1, $2, $3, $4, $5::timestamptz)`,
    ['nginx-a', 'manifest.json', '{}', bareHash('c'), timestamp],
  );
  await db.query(
    `insert into unified_plugin_resources
       (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
     values ($1, $2, $3, $4, $5::timestamptz)`,
    ['invalid-hash', 'entry.js', 'bad', 'not-a-resource-hash', timestamp],
  );

  const bindingInput = JSON.stringify({
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
  });
  await db.query(
    `insert into unified_plugin_bindings (
       id, tenant_id, plugin_version_id, mode, managed_context, status, version, created_at, updated_at, input_bindings
     ) values ($1, $2, $3, 'MANAGED', null, 'ACTIVE', 1, $4::timestamptz, $4::timestamptz, $5::jsonb)`,
    ['old-binding', 'tenant-a', 'unknown-plugin', timestamp, bindingInput],
  );
  await db.query(
    `insert into plugin_capability_assignments
       (id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id, plugin_binding_id, precedence, status, created_at, updated_at)
     values ($1, $2, 'APPLICATION_ASSET', 'asset-old', 'certificate.deploy', $3, $4, 'ASSET_OVERRIDE', 'ACTIVE', $5::timestamptz, $5::timestamptz)`,
    ['old-assignment', 'tenant-a', 'unknown-plugin', 'old-binding', timestamp],
  );
  await db.query(
    `insert into unified_plugin_bindings (
       id, tenant_id, plugin_version_id, mode, managed_context, status, version, created_at, updated_at, input_bindings
     ) values ($1, $2, $3, 'MANAGED', null, 'ERROR', 1, $4::timestamptz, $4::timestamptz, $5::jsonb)`,
    ['old-error-binding', 'tenant-a', 'unknown-plugin', timestamp, bindingInput],
  );
  await db.query(
    `insert into plugin_capability_assignments
       (id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id, plugin_binding_id, precedence, status, created_at, updated_at)
     values ($1, $2, 'APPLICATION_ASSET', 'asset-old-error', 'certificate.deploy', $3, $4, 'ASSET_OVERRIDE', 'MIGRATING', $5::timestamptz, $5::timestamptz)`,
    ['old-migrating-assignment', 'tenant-a', 'unknown-plugin', 'old-error-binding', timestamp],
  );
  await db.query(
    `insert into unified_plugin_bindings (
       id, tenant_id, plugin_version_id, mode, managed_context, status, version, created_at, updated_at, input_bindings
     ) values ($1, $2, $3, 'MANAGED', null, 'ACTIVE', 1, $4::timestamptz, $4::timestamptz, $5::jsonb)`,
    ['alias-binding', 'tenant-a', 'nginx-a', timestamp, bindingInput],
  );
  await db.query(
    `insert into plugin_capability_assignments
       (id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id, plugin_binding_id, precedence, status, created_at, updated_at)
     values ($1, $2, 'APPLICATION_ASSET', 'asset-alias', 'certificate.deploy', $3, $4, 'ASSET_OVERRIDE', 'ACTIVE', $5::timestamptz, $5::timestamptz)`,
    ['alias-assignment', 'tenant-a', 'nginx-a', 'alias-binding', timestamp],
  );
  const packageId = '00000000-0000-0000-0000-000000000001';
  const providerId = '00000000-0000-0000-0000-000000000002';
  await db.query(
    `insert into plugin_packages (id, name, plugin_version, package_ref, status, created_at, updated_at, version)
     values ($1::uuid, 'legacy-package', '1.0.0', 'legacy://package-1', 'INSTALLED', $2::timestamptz, $2::timestamptz, 1)`,
    [packageId, timestamp],
  );
  await db.query(
    `insert into provider_registry (
       id, plugin_package_id, provider_type, name, provider_version, status, created_at, updated_at, version
     ) values ($1::uuid, $2::uuid, 'legacy-provider', 'legacy-provider', '1.0.0', 'ACTIVE', $3::timestamptz, $3::timestamptz, 1)`,
    [providerId, packageId, timestamp],
  );
  await insertDocument(db, 'plugins:agent-packages', 'agent-package', { status: 'installed' });
  await insertDocument(db, 'plugins:packages', 'package-document', { installStatus: 'enabled' });
  await insertDocument(db, 'plugins:catalog-activations', 'activation', { status: 'active' });
  await insertDocument(db, 'plugins:executions', 'old-execution', { status: 'running', pluginPackageId: packageId });
  await insertDocument(db, 'plugins:executions', 'legacy-v1-execution', { status: 'running', pluginPackageId: packageId, protocolVersion: 'gcac.plugin-runner/v1' });
  await insertDocument(db, 'plugins:executions', 'hybrid-legacy-execution', { status: 'running', pluginPackageId: packageId, pluginVersionId: 'nginx-canonical-a', protocolVersion: 'gcac.plugin-runner/v1' });
  await insertDocument(db, 'plugins:executions', 'new-execution', { status: 'running', protocolVersion: 'gcac.plugin-runner/v1' });
  await insertDocument(db, 'plugins:executions', 'completed-execution', { status: 'success', pluginPackageId: packageId });

  return db;
}

async function insertVersion(
  db: PgliteDatabase,
  input: {
    id: string;
    tenantId: string;
    pluginId: string;
    version: string;
    runtime: 'AGENT_ATOMIC' | 'WORKFLOW_DSL' | 'TRUSTED_JS';
    manifest: Record<string, unknown>;
    packageSha256: string;
    manifestSha256: string;
    resourceSha256: unknown;
    validationReport?: unknown;
    status?: 'ENABLED' | 'DISABLED';
  },
): Promise<void> {
  await db.query(
    `insert into unified_plugin_versions (
       id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
       manifest, package_sha256, manifest_sha256, resource_sha256, status,
       permission_approval_status, approved_permissions, validation_report, created_at, updated_at
     ) values (
       $1, $2, $3, $4, 'BUILTIN', $5, 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       $6::jsonb, $7, $8, $9::jsonb, $10,
       'NOT_REQUIRED', '[]'::jsonb, $11::jsonb, $12::timestamptz, $12::timestamptz
     )`,
    [
      input.id,
      input.tenantId,
      input.pluginId,
      input.version,
      input.runtime,
      JSON.stringify(input.manifest),
      input.packageSha256,
      input.manifestSha256,
       JSON.stringify(input.resourceSha256),
       input.status ?? 'ENABLED',
       JSON.stringify(input.validationReport ?? {}),
       timestamp,
    ],
  );
}

async function insertDocument(db: PgliteDatabase, namespace: string, documentId: string, payload: Record<string, unknown>): Promise<void> {
  await db.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at)
     values ($1, $2, $3::jsonb, $4::timestamptz)`,
    [namespace, documentId, JSON.stringify(payload), timestamp],
  );
}

async function applyInitialAndCanonicalMigrations(db: PgliteDatabase): Promise<void> {
  await db.exec(await readMigration('20260809000100_plugin_runner_canonical_cutover.sql'));
  await db.exec(await readMigration('20260809000200_plugin_runner_canonical_constraints.sql'));
  await db.exec(await readMigration('20260809000300_drop_legacy_plugin_storage.sql'));
  await db.exec(await readMigration('20260809000900_scope_plugin_runner_constraints.sql'));
  await db.exec(await readMigration('20260810000100_plugin_runner_canonical_scope_fix.sql'));
}

test('Plugin Runner canonical 收口会绑定真实版本、隔离坏数据并清退旧入口', async () => {
  const db = await createFixtureDatabase();
  try {
    await applyInitialAndCanonicalMigrations(db);

    const bindings = await db.query<{
      plugin_version_id: string;
      tenant_id: string;
      canonical_plugin_id: string;
      plugin_version: string;
      execution_mode: string;
      protocol_version: string;
      package_sha256: string;
      manifest_sha256: string;
      resource_sha256: Record<string, string>;
    }>(`select plugin_version_id, tenant_id, canonical_plugin_id, plugin_version,
               execution_mode, protocol_version, package_sha256, manifest_sha256, resource_sha256
          from plugin_runner_version_bindings
         order by tenant_id, plugin_version_id`);

    assert.deepEqual(bindings.rows, [
      {
        plugin_version_id: 'acme-a', tenant_id: 'tenant-a', canonical_plugin_id: 'ca.acme', plugin_version: '2.0.0',
        execution_mode: 'isolated_process', protocol_version: 'gcac.plugin-runner/v1',
        package_sha256: runnerHash('1'), manifest_sha256: runnerHash('2'), resource_sha256: { 'workflow.json': runnerHash('3') },
      },
      {
        plugin_version_id: 'nginx-canonical-a', tenant_id: 'tenant-a', canonical_plugin_id: 'web.nginx', plugin_version: '1.2.3',
        execution_mode: 'isolated_process', protocol_version: 'gcac.plugin-runner/v1',
        package_sha256: runnerHash('6'), manifest_sha256: runnerHash('7'), resource_sha256: { 'manifest.json': runnerHash('8') },
      },
      {
        plugin_version_id: 'nginx-b', tenant_id: 'tenant-b', canonical_plugin_id: 'web.nginx', plugin_version: '1.2.3',
        execution_mode: 'isolated_process', protocol_version: 'gcac.plugin-runner/v1',
        package_sha256: runnerHash('d'), manifest_sha256: runnerHash('e'), resource_sha256: { 'manifest.json': runnerHash('f') },
      },
    ]);

    const versions = await db.query<{
      id: string;
      plugin_id: string;
      status: string;
      manifest_plugin_id: string | null;
      manifest_canonical_id: string | null;
      execution_mode: string | null;
    }>(`select id, plugin_id, status,
               manifest->>'pluginId' as manifest_plugin_id,
               manifest->>'canonicalPluginId' as manifest_canonical_id,
               manifest->>'executionMode' as execution_mode
          from unified_plugin_versions
         order by id`);

    assert.deepEqual(versions.rows, [
      { id: 'acme-a', plugin_id: 'ca.acme', status: 'ENABLED', manifest_plugin_id: 'ca.acme', manifest_canonical_id: 'ca.acme', execution_mode: 'isolated_process' },
      { id: 'invalid-hash', plugin_id: 'ca.openssl', status: 'QUARANTINED', manifest_plugin_id: 'ca.openssl', manifest_canonical_id: 'ca.openssl', execution_mode: 'isolated_process' },
      { id: 'invalid-manifest', plugin_id: 'web.apache', status: 'QUARANTINED', manifest_plugin_id: 'wrong.plugin', manifest_canonical_id: 'wrong.plugin', execution_mode: 'isolated_process' },
      { id: 'invalid-resource-null', plugin_id: 'device.citrix.netscaler-adc', status: 'QUARANTINED', manifest_plugin_id: 'device.citrix.netscaler-adc', manifest_canonical_id: 'device.citrix.netscaler-adc', execution_mode: 'isolated_process' },
      { id: 'invalid-resource-shape', plugin_id: 'web.iis', status: 'QUARANTINED', manifest_plugin_id: 'web.iis', manifest_canonical_id: 'web.iis', execution_mode: 'isolated_process' },
      { id: 'invalid-version', plugin_id: 'ca.acme-dns', status: 'QUARANTINED', manifest_plugin_id: 'ca.acme-dns', manifest_canonical_id: 'ca.acme-dns', execution_mode: 'isolated_process' },
      { id: 'nginx-a', plugin_id: 'builtin.linux.nginx.pem', status: 'QUARANTINED', manifest_plugin_id: 'builtin.linux.nginx.pem', manifest_canonical_id: null, execution_mode: null },
      { id: 'nginx-b', plugin_id: 'web.nginx', status: 'ENABLED', manifest_plugin_id: 'web.nginx', manifest_canonical_id: 'web.nginx', execution_mode: 'isolated_process' },
      { id: 'nginx-canonical-a', plugin_id: 'web.nginx', status: 'ENABLED', manifest_plugin_id: 'web.nginx', manifest_canonical_id: 'web.nginx', execution_mode: 'isolated_process' },
      { id: 'unknown-plugin', plugin_id: 'third-party.unknown', status: 'QUARANTINED', manifest_plugin_id: 'third-party.unknown', manifest_canonical_id: null, execution_mode: null },
    ]);

    const rejectionRows = await db.query<{ plugin_version_id: string; reason: string }>(
      'select plugin_version_id, reason from plugin_runner_cutover_rejections order by plugin_version_id',
    );
    assert.deepEqual(rejectionRows.rows, [
      { plugin_version_id: 'invalid-hash', reason: 'PACKAGE_HASH_INVALID' },
      { plugin_version_id: 'invalid-manifest', reason: 'MANIFEST_PLUGIN_ID_INVALID' },
      { plugin_version_id: 'invalid-resource-null', reason: 'RESOURCE_HASH_INVALID' },
      { plugin_version_id: 'invalid-resource-shape', reason: 'RESOURCE_HASH_INVALID' },
      { plugin_version_id: 'invalid-version', reason: 'PLUGIN_VERSION_INVALID' },
      { plugin_version_id: 'nginx-a', reason: 'DUPLICATE_CANONICAL_VERSION' },
      { plugin_version_id: 'unknown-plugin', reason: 'CANONICAL_ID_INVALID' },
    ]);

    assert.equal((await db.query<{ resource_sha256: string }>(
      `select resource_sha256 from unified_plugin_resources where plugin_version_id = 'nginx-a'`,
    )).rows[0]?.resource_sha256, runnerHash('c'));
    assert.equal((await db.query<{ status: string }>(
      `select status from unified_plugin_bindings where id = 'old-binding'`,
    )).rows[0]?.status, 'DISABLED');
    assert.equal((await db.query<{ status: string }>(
      `select status from plugin_capability_assignments where id = 'old-assignment'`,
    )).rows[0]?.status, 'DISABLED');
    assert.equal((await db.query<{ status: string }>(
      `select status from unified_plugin_bindings where id = 'old-error-binding'`,
    )).rows[0]?.status, 'DISABLED');
    assert.equal((await db.query<{ status: string }>(
      `select status from plugin_capability_assignments where id = 'old-migrating-assignment'`,
    )).rows[0]?.status, 'DISABLED');
    assert.equal((await db.query<{ status: string }>(
      `select status from unified_plugin_bindings where id = 'alias-binding'`,
    )).rows[0]?.status, 'DISABLED');
    assert.equal((await db.query<{ status: string }>(
      `select status from plugin_capability_assignments where id = 'alias-assignment'`,
    )).rows[0]?.status, 'DISABLED');
    assert.deepEqual((await db.query<{ original_report: unknown }>(
      `select validation_report->'originalValidationReport' as original_report
         from unified_plugin_versions where id = 'invalid-hash'`,
    )).rows[0]?.original_report, ['legacy-invalid-hash']);

    assert.equal((await db.query<{ table_name: string | null }>(
      `select to_regclass('public.plugin_packages') as table_name`,
    )).rows[0]?.table_name, null);
    assert.equal((await db.query<{ table_name: string | null }>(
      `select to_regclass('public.provider_registry') as table_name`,
    )).rows[0]?.table_name, null);
    assert.equal((await db.query<{ table_name: string | null }>(
      `select to_regclass('public.legacy_plugin_migration_results') as table_name`,
    )).rows[0]?.table_name, null);
    assert.equal((await db.query<{ count: number }>(
      `select count(*)::int as count from pg_documents where namespace = 'plugins:agent-packages'`,
    )).rows[0]?.count, 0);
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'installStatus' as status from pg_documents where namespace = 'plugins:packages'`,
    )).rows[0]?.status, 'retired');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:catalog-activations'`,
    )).rows[0]?.status, 'retired');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:executions' and document_id = 'old-execution'`,
    )).rows[0]?.status, 'retired');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:executions' and document_id = 'legacy-v1-execution'`,
    )).rows[0]?.status, 'retired');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:executions' and document_id = 'hybrid-legacy-execution'`,
    )).rows[0]?.status, 'retired');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:executions' and document_id = 'new-execution'`,
    )).rows[0]?.status, 'running');
    assert.equal((await db.query<{ status: string }>(
      `select payload->>'status' as status from pg_documents where namespace = 'plugins:executions' and document_id = 'completed-execution'`,
    )).rows[0]?.status, 'success');
    assert.equal((await db.query<{ table_name: string | null }>(
      `select to_regclass('public.agent_plugin_mounts') as table_name`,
    )).rows[0]?.table_name, null);

    const countBeforeRepeat = (await db.query<{ count: number }>(
      'select count(*)::int as count from plugin_runner_version_bindings',
    )).rows[0]?.count;
    await db.exec(await readMigration('20260809000100_plugin_runner_canonical_cutover.sql'));
    await db.exec(await readMigration('20260809000200_plugin_runner_canonical_constraints.sql'));
    await db.exec(await readMigration('20260809000300_drop_legacy_plugin_storage.sql'));
    await db.exec(await readMigration('20260809000900_scope_plugin_runner_constraints.sql'));
    await db.exec(await readMigration('20260810000100_plugin_runner_canonical_scope_fix.sql'));
    assert.equal((await db.query<{ count: number }>(
      'select count(*)::int as count from plugin_runner_version_bindings',
    )).rows[0]?.count, countBeforeRepeat);
    assert.equal((await db.query<{ status: string }>(
      `select status from unified_plugin_versions where id = 'unknown-plugin'`,
    )).rows[0]?.status, 'QUARANTINED');
  } finally {
    await db.close();
  }
});

test('Plugin Runner 绑定拒绝跨租户、旧协议和制品/版本篡改', async () => {
  const db = await createFixtureDatabase();
  try {
    await applyInitialAndCanonicalMigrations(db);

    await assert.rejects(
      db.query(`update plugin_runner_version_bindings set tenant_id = 'tenant-b' where plugin_version_id = 'nginx-canonical-a'`),
      /tenant|Plugin Runner binding/i,
    );
    await assert.rejects(
      db.query(`update plugin_runner_version_bindings set package_sha256 = $1 where plugin_version_id = 'nginx-canonical-a'`, [runnerHash('z')]),
      /artifact hash|immutable|Plugin Runner binding/i,
    );
    await assert.rejects(
      db.query(`update plugin_runner_version_bindings set protocol_version = 'gcac.plugin/v0' where plugin_version_id = 'nginx-canonical-a'`),
      /retired execution contract|immutable|Plugin Runner binding/i,
    );
    await assert.rejects(
      db.query(`update unified_plugin_versions set runtime = 'TRUSTED_JS' where id = 'nginx-canonical-a'`),
      /immutable|Bound PluginVersion/i,
    );
    await assert.rejects(
      db.query(`update unified_plugin_versions set manifest = jsonb_set(manifest, '{version}', to_jsonb('9.9.9'::text), true) where id = 'nginx-canonical-a'`),
      /immutable|Bound PluginVersion/i,
    );

    await db.query(`update unified_plugin_versions set status = 'DISABLED' where id = 'nginx-canonical-a'`);
    assert.equal((await db.query<{ count: number }>(
      `select count(*)::int as count from plugin_runner_version_bindings where plugin_version_id = 'nginx-canonical-a'`,
    )).rows[0]?.count, 0);

    await assert.rejects(
      insertVersion(db, {
        id: 'invalid-semver-after-cutover',
        tenantId: 'tenant-a',
        pluginId: 'web.apache',
        version: '1.0',
        runtime: 'AGENT_ATOMIC',
        manifest: { pluginId: 'web.apache', canonicalPluginId: 'web.apache', executionMode: 'isolated_process', version: '1.0' },
        packageSha256: runnerHash('a'),
        manifestSha256: runnerHash('b'),
        resourceSha256: {},
      }),
      /plugin_version|check constraint/i,
    );
    await assert.rejects(
      insertVersion(db, {
        id: 'invalid-hash-after-cutover',
        tenantId: 'tenant-a',
        pluginId: 'web.apache',
        version: '9.9.9',
        runtime: 'AGENT_ATOMIC',
        manifest: { pluginId: 'web.apache', canonicalPluginId: 'web.apache', executionMode: 'isolated_process', version: '9.9.9' },
        packageSha256: 'bad',
        manifestSha256: runnerHash('b'),
        resourceSha256: {},
      }),
      /package_sha256|check constraint/i,
    );
  } finally {
    await db.close();
  }
});
