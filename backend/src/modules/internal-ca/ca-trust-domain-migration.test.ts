import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

test('信任域迁移按历史根 CA 回填层级且不误绑歧义 Profile', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const tenantId = 'tenant-ca-trust-migration';
  const providerId = 'provider-ca-trust-migration';
  const timestamp = '2026-07-23T00:00:00.000Z';
  await db.query(
    `insert into pg_ca_providers (
       id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
       capabilities, status, payload, created_at, updated_at
     ) values ($1,$2,$3,'gcac_builtin','builtin','embedded','single','{}'::jsonb,'active',$4::jsonb,$5,$5)`,
    [providerId, tenantId, '历史 Provider', JSON.stringify({ id: providerId, tenantId }), timestamp],
  );
  for (const authority of [
    { id: 'root-production-a', name: '生产根 A', role: 'root', parentCaId: null, securityDomain: 'production' },
    { id: 'intermediate-production-a', name: '生产中间 A', role: 'intermediate', parentCaId: 'root-production-a', securityDomain: 'production' },
    { id: 'root-production-b', name: '生产根 B', role: 'root', parentCaId: null, securityDomain: 'production' },
    { id: 'root-network', name: '网络根', role: 'root', parentCaId: null, securityDomain: 'network' },
  ]) {
    await db.query(
      `insert into pg_certificate_authorities (
         id, tenant_id, name, role, parent_ca_id, topology_mode, provider_id, security_domain,
         status, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,'root_with_intermediate',$6,$7,'active',$8::jsonb,$9,$9)`,
      [
        authority.id, tenantId, authority.name, authority.role, authority.parentCaId, providerId,
        authority.securityDomain, JSON.stringify({ ...authority, tenantId, providerId, topologyMode: 'root_with_intermediate', status: 'active', createdAt: timestamp, updatedAt: timestamp }), timestamp,
      ],
    );
  }
  for (const profile of [
    { id: 'profile-production', name: '生产 Profile', securityDomain: 'production' },
    { id: 'profile-network', name: '网络 Profile', securityDomain: 'network' },
  ]) {
    await db.query(
      `insert into pg_certificate_profiles (
         id, tenant_id, name, security_domain, status, current_version, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,'active',1,$5::jsonb,$6,$6)`,
      [profile.id, tenantId, profile.name, profile.securityDomain, JSON.stringify({ ...profile, tenantId, status: 'active', currentVersion: 1, createdAt: timestamp, updatedAt: timestamp }), timestamp],
    );
  }

  const migrationSql = await readFile(resolve('src/database/migrations/20260723000100_ca_trust_domains.sql'), 'utf8');
  await db.exec(migrationSql);

  const authorities = await db.query<{ id: string; trust_domain_id: string }>(
    `select id, trust_domain_id from pg_certificate_authorities where tenant_id = $1 order by id`,
    [tenantId],
  );
  const byId = new Map(authorities.rows.map((row) => [row.id, row.trust_domain_id]));
  assert.equal(byId.get('root-production-a'), byId.get('intermediate-production-a'));
  assert.notEqual(byId.get('root-production-a'), byId.get('root-production-b'));
  assert.notEqual(byId.get('root-production-a'), byId.get('root-network'));

  const profiles = await db.query<{ id: string; trust_domain_id: string | null; payload: Record<string, unknown> }>(
    `select id, trust_domain_id, payload from pg_certificate_profiles where tenant_id = $1 order by id`,
    [tenantId],
  );
  const production = profiles.rows.find((row) => row.id === 'profile-production');
  const network = profiles.rows.find((row) => row.id === 'profile-network');
  assert.equal(production?.trust_domain_id, null);
  assert.equal(network?.trust_domain_id, byId.get('root-network'));
  assert.equal(network?.payload.trustDomainId, byId.get('root-network'));
});
