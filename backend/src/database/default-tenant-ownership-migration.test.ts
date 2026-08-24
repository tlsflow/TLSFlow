import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { PageQuery } from '../common/pagination/pagination.js';
import { PgAssetsRepository } from '../modules/assets/repository/assets.repository.js';
import { scalar } from './database-port.js';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

const migrationFile = '20260806000100_normalize_default_tenant_ownership.sql';
const unrestrictedQuery: PageQuery = {
  page: 1,
  pageSize: 20,
  filter: {},
  authorization: { unrestricted: true },
};

describe('默认租户历史业务对象归属迁移', () => {
  it('历史 default 记录迁移为 UUID 后可被当前租户仓储查询', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'default-tenant-ownership-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const defaultTenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);

    await db.query(
      `insert into pg_hosts (
         id, tenant_id, hostname, os_type, discovery_source,
         compatibility_level, management_mode, status
       ) values ($1, 'default', 'legacy-default-host', 'LINUX', 'MANUAL', 'L1', 'MONITOR_ONLY', 'ACTIVE')`,
      ['host_legacy_default'],
    );
    await db.query(
      `insert into pg_documents (namespace, document_id, payload)
       values
         ('migration.default-tenant', 'legacy', $1::jsonb),
         ('migration.default-tenant', 'system', $2::jsonb),
         ('migration.default-tenant', 'zero', $3::jsonb)`,
      [
        JSON.stringify({ id: 'legacy', tenantId: 'default', nested: { tenantId: 'default' } }),
        JSON.stringify({ id: 'system', tenantId: 'SYSTEM' }),
        JSON.stringify({ id: 'zero', tenantId: '00000000-0000-0000-0000-000000000000' }),
      ],
    );

    await executeMigrationAgain(db);

    const page = await new PgAssetsRepository(db).listHosts(defaultTenantId, unrestrictedQuery);
    assert.equal(page.items.some((item) => item.id === 'host_legacy_default'), true);

    const documents = await db.query<{ document_id: string; payload: Record<string, unknown> }>(
      `select document_id, payload
         from pg_documents
        where namespace = 'migration.default-tenant'
        order by document_id`,
    );
    const byId = new Map(documents.rows.map((item) => [item.document_id, item.payload]));
    assert.equal(byId.get('legacy')?.tenantId, defaultTenantId);
    assert.deepEqual(byId.get('legacy')?.nested, { tenantId: 'default' });
    assert.equal(byId.get('system')?.tenantId, 'SYSTEM');
    assert.equal(byId.get('zero')?.tenantId, '00000000-0000-0000-0000-000000000000');
  });

  it('保留备份证据并合并重复的默认信任域标记', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'default-tenant-evidence-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const defaultTenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);

    await db.exec(`
      create table migration_probe_backups (
        id text primary key,
        tenant_id text not null
      );
      insert into migration_probe_backups (id, tenant_id) values ('backup_1', 'default');
    `);
    await db.query(
      `insert into pg_ca_trust_domains (
         id, tenant_id, name, code, purpose, status, is_default,
         isolation_level, root_policy, trust_policy, payload, created_at, updated_at
       ) values
         ('trust_legacy', 'default', '历史默认域', 'legacy-default', 'production_tls', 'active', true,
          'standard', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         ('trust_uuid', $1, '新默认域', 'uuid-default', 'acme', 'active', true,
          'standard', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
      [defaultTenantId],
    );

    await executeMigrationAgain(db);

    const backupTenantId = await scalar<string>(
      db,
      `select tenant_id from migration_probe_backups where id = 'backup_1'`,
    );
    assert.equal(backupTenantId, 'default');

    const trustDomains = await db.query<{ id: string; tenant_id: string; is_default: boolean }>(
      `select id, tenant_id, is_default
         from pg_ca_trust_domains
        where id in ('trust_legacy', 'trust_uuid')
        order by id`,
    );
    assert.deepEqual(trustDomains.rows, [
      { id: 'trust_legacy', tenant_id: defaultTenantId, is_default: true },
      { id: 'trust_uuid', tenant_id: defaultTenantId, is_default: false },
    ]);
  });

  it('只修正不可变部署输入快照的租户归属并恢复保护触发器', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'default-tenant-snapshot-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const defaultTenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
    const snapshot = {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotVersion: '1',
      input: { variables: { environment: 'production' } },
      sources: { variables: { environment: 'binding' } },
      sensitivePaths: [],
      identity: { pluginVersionId: 'plugin-version-1' },
      redaction: { sensitivePathCount: 0, genericRuleMatchCount: 0 },
    };
    const sealedRuntimePayload = {
      algorithm: 'aes-256-gcm',
      encryptedData: 'encrypted-data',
      encryptedDek: 'encrypted-dek',
      authTag: 'auth-tag',
    };

    await db.query(
      `insert into deployment_input_snapshots (
         id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision,
         snapshot, sealed_runtime_payload, created_at, created_by
       ) values (
         'snapshot_default_tenant', 'default', 'plan_default_tenant', 'target_default_tenant', 1,
         $1::jsonb, $2::jsonb, '2026-08-01T00:00:00Z', 'user_default_tenant'
       )`,
      [JSON.stringify(snapshot), JSON.stringify(sealedRuntimePayload)],
    );

    await executeMigrationAgain(db);

    const migrated = await db.query<{
      tenant_id: string;
      snapshot: unknown;
      sealed_runtime_payload: unknown;
      deployment_plan_id: string;
      deployment_plan_target_id: string;
      revision: number;
      created_at: Date;
      created_by: string;
    }>(
      `select tenant_id, snapshot, sealed_runtime_payload, deployment_plan_id,
              deployment_plan_target_id, revision, created_at, created_by
         from deployment_input_snapshots
        where id = 'snapshot_default_tenant'`,
    );
    assert.equal(migrated.rows[0]?.tenant_id, defaultTenantId);
    assert.deepEqual(migrated.rows[0]?.snapshot, snapshot);
    assert.deepEqual(migrated.rows[0]?.sealed_runtime_payload, sealedRuntimePayload);
    assert.equal(migrated.rows[0]?.deployment_plan_id, 'plan_default_tenant');
    assert.equal(migrated.rows[0]?.deployment_plan_target_id, 'target_default_tenant');
    assert.equal(migrated.rows[0]?.revision, 1);
    assert.equal(migrated.rows[0]?.created_at.toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(migrated.rows[0]?.created_by, 'user_default_tenant');

    await assert.rejects(
      () => db.query(
        `update deployment_input_snapshots
            set tenant_id = 'unexpected'
          where id = 'snapshot_default_tenant'`,
      ),
      /immutable/,
    );
    await assert.rejects(
      () => db.query(`delete from deployment_input_snapshots where id = 'snapshot_default_tenant'`),
      /immutable/,
    );
  });
});

async function executeMigrationAgain(db: PgliteDatabase): Promise<void> {
  const sql = await readFile(join(process.cwd(), 'src/database/migrations', migrationFile), 'utf8');
  await db.exec(sql);
}
