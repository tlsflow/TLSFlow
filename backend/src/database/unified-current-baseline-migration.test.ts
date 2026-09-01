import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

const activeMigrationDirectory = resolve(process.cwd(), 'src/database/migrations');
const baselineFile = '20260823000000_unified_current_baseline.sql';
const healthMigrationFile = '20260824000000_credential_health_check.sql';
const caLifecycleMigrationFile = '20260824100000_ca_lifecycle_policy_and_provider_bindings.sql';
const caCrlMigrationFile = '20260824110000_builtin_ca_crl_publications.sql';
const certificateRotationMigrationFile = '20260824120000_certificate_rotations.sql';
const credentialHealthSelectionMigrationFile = '20260824130000_credential_health_selection.sql';
const cloudManagedTargetOwnerMigrationFile = '20260826000000_cloud_resource_managed_target_owner.sql';
const passwordCredentialMigrationFile = '20260826100000_password_credential.sql';
const repairAdcsAgentHostAssociationsMigrationFile = '20260826110000_repair_adcs_agent_host_associations.sql';
const cloudFrameworkSiteOwnerMigrationFile = '20260826120000_cloud_resource_framework_site_owner.sql';
const automationExternalApiMigrationFile = '20260827120000_automation_external_api.sql';
const applicationCertificateSupplyMigrationFile = '20260827130000_application_certificate_supply.sql';
const cloudFrameworkSiteServiceOwnerMigrationFile = '20260827140000_cloud_resource_framework_site_service_owner.sql';
const managedTargetServiceAssetOwnerMigrationFile = '20260827150000_managed_target_service_asset_owner.sql';
const certificateRequestApplicationBindingMigrationFile = '20260827160000_certificate_request_application_binding.sql';
const acmeApplicationPolicyBindingMigrationFile = '20260828000000_acme_application_policy_binding.sql';
const dedicatedAssetActiveUniquenessMigrationFile = '20260828010000_dedicated_asset_active_uniqueness.sql';
const tenantScopedCertificateBindingsMigrationFile = '20260828020000_tenant_scoped_certificate_bindings.sql';
const legacyAcmeRequestApplicationNullableMigrationFile = '20260828030000_legacy_acme_request_application_nullable.sql';
const certificateProfileSelectionColumnsRepairMigrationFile = '20260828120000_repair_certificate_profile_selection_columns.sql';

test('活动迁移目录包含统一 baseline、凭据健康和 CA 生命周期递增迁移，空 PGlite 可直接建立当前结构', async () => {
  const files = (await readdir(activeMigrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  assert.deepEqual(files, [baselineFile, healthMigrationFile, caLifecycleMigrationFile, caCrlMigrationFile, certificateRotationMigrationFile, credentialHealthSelectionMigrationFile, cloudManagedTargetOwnerMigrationFile, passwordCredentialMigrationFile, repairAdcsAgentHostAssociationsMigrationFile, cloudFrameworkSiteOwnerMigrationFile, automationExternalApiMigrationFile, applicationCertificateSupplyMigrationFile, cloudFrameworkSiteServiceOwnerMigrationFile, managedTargetServiceAssetOwnerMigrationFile, certificateRequestApplicationBindingMigrationFile, acmeApplicationPolicyBindingMigrationFile, dedicatedAssetActiveUniquenessMigrationFile, tenantScopedCertificateBindingsMigrationFile, legacyAcmeRequestApplicationNullableMigrationFile, certificateProfileSelectionColumnsRepairMigrationFile]);

  const db = new PgliteDatabase();
  try {
    await runMigrations(db, activeMigrationDirectory, { appliedBy: 'baseline-test' });
    assert.deepEqual(
      (await db.query<{ version: string; status: string }>('select version, status from schema_migrations')).rows,
      [
        { version: '20260823000000', status: 'APPLIED' },
        { version: '20260824000000', status: 'APPLIED' },
        { version: '20260824100000', status: 'APPLIED' },
        { version: '20260824110000', status: 'APPLIED' },
        { version: '20260824120000', status: 'APPLIED' },
        { version: '20260824130000', status: 'APPLIED' },
        { version: '20260826000000', status: 'APPLIED' },
        { version: '20260826100000', status: 'APPLIED' },
        { version: '20260826110000', status: 'APPLIED' },
        { version: '20260826120000', status: 'APPLIED' },
        { version: '20260827120000', status: 'APPLIED' },
        { version: '20260827130000', status: 'APPLIED' },
        { version: '20260827140000', status: 'APPLIED' },
        { version: '20260827150000', status: 'APPLIED' },
        { version: '20260827160000', status: 'APPLIED' },
        { version: '20260828000000', status: 'APPLIED' },
        { version: '20260828010000', status: 'APPLIED' },
        { version: '20260828020000', status: 'APPLIED' },
        { version: '20260828030000', status: 'APPLIED' },
        { version: '20260828120000', status: 'APPLIED' },
      ],
    );
    const requiredTables = (await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
        [['tenants', 'tenant_memberships', 'system_initialization_state', 'pg_documents', 'job_queue', 'credential_health_states', 'credential_health_check_records', 'pg_ca_provider_action_bindings', 'pg_certificate_policies', 'pg_certificate_policy_versions', 'pg_ca_crl_states', 'pg_ca_crl_publications', 'pg_certificate_rotations']],
      )).rows.map((row) => row.table_name);
    assert.deepEqual(requiredTables, ['credential_health_check_records', 'credential_health_states', 'job_queue', 'pg_ca_crl_publications', 'pg_ca_crl_states', 'pg_ca_provider_action_bindings', 'pg_certificate_policies', 'pg_certificate_policy_versions', 'pg_certificate_rotations', 'pg_documents', 'system_initialization_state', 'tenant_memberships', 'tenants']);
    assert.equal((await db.query('select status from system_initialization_state where id = \'singleton\'')).rows[0]?.status, 'PENDING');
  } finally {
    await db.close();
  }
});

test('统一 baseline 后可继续执行同一套递增迁移并记录 checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-baseline-followup-'));
  const db = new PgliteDatabase();
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, baselineFile), await readFile(join(activeMigrationDirectory, baselineFile), 'utf8'), 'utf8');
    await writeFile(join(directory, '20260823000400_baseline_followup.sql'),
      'alter table public.system_initialization_state add column baseline_followup_marker text not null default \'ok\';\n',
      'utf8');
    const applied = await runMigrations(db, directory, { appliedBy: 'baseline-followup-test' });
    assert.deepEqual(applied.map((item) => item.version), ['20260823000000', '20260823000400']);
    assert.equal(
      (await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'system_initialization_state' and column_name = 'baseline_followup_marker'`,
      )).rows.length,
      1,
    );
    assert.equal((await db.query<{ count: string }>('select count(*)::text as count from schema_migrations')).rows[0]?.count, '2');
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
