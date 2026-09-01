import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

const migrationsDirectory = resolve(process.cwd(), 'src/database/migrations');
const repairMigrationFile = '20260828120000_repair_certificate_profile_selection_columns.sql';

test('Profile 选择字段已登记但实际缺失时，修复迁移补齐列并回填 payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-profile-columns-repair-'));
  const db = new PgliteDatabase();
  try {
    await cp(migrationsDirectory, directory, {
      recursive: true,
      filter: (source) => !source.endsWith(repairMigrationFile),
    });
    await runMigrations(db, directory, { appliedBy: 'repair-fixture' });

    await db.exec(`
      alter table pg_certificate_profiles
        drop column acme_provider_profile_id,
        drop column dns_provider_id,
        drop column credential_ref;
    `);
    await db.query(
      `insert into pg_certificate_profiles (
         id, tenant_id, name, security_domain, status, current_version, payload, created_at, updated_at,
         purpose, provider_type, domain_patterns, target_capabilities, is_default, priority
       ) values (
         'certprof-repair', 'tenant-repair', '历史 Profile', '*', 'active', 1,
         $1::jsonb, now(), now(), 'https_server', 'acme', '[]'::jsonb, '[]'::jsonb, false, 100
       )`,
      [JSON.stringify({
        acmeProviderProfileId: 'acme-profile-1',
        dnsProviderId: 'dns-provider-1',
        credentialRef: 'secret://tenant/dns-credential',
      })],
    );

    await writeFile(
      join(directory, repairMigrationFile),
      await readFile(join(migrationsDirectory, repairMigrationFile), 'utf8'),
      'utf8',
    );
    await runMigrations(db, directory, { appliedBy: 'repair-test' });

    const profile = await db.query<{
      acme_provider_profile_id: string;
      dns_provider_id: string;
      credential_ref: string;
      payload: { acmeProviderProfileId: string; dnsProviderId: string; credentialRef: string };
    }>(`
      select acme_provider_profile_id, dns_provider_id, credential_ref, payload
        from pg_certificate_profiles
       where id = 'certprof-repair'
    `);
    assert.deepEqual(profile.rows[0], {
      acme_provider_profile_id: 'acme-profile-1',
      dns_provider_id: 'dns-provider-1',
      credential_ref: 'secret://tenant/dns-credential',
      payload: {
        acmeProviderProfileId: 'acme-profile-1',
        dnsProviderId: 'dns-provider-1',
        credentialRef: 'secret://tenant/dns-credential',
      },
    });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
