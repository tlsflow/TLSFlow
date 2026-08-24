import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { coreTableNames, requiredCoreIndexes } from './schema/core-schema.js';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import { scalar, type DatabasePort } from './database-port.js';

async function migratedDb(): Promise<DatabasePort> {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  return db;
}

describe('核心数据模型迁移', () => {
  it('空库可以创建全部核心表', async () => {
    const db = await migratedDb();
    const result = await db.query<{ tablename: string }>(`
      select tablename
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `);
    const actual = new Set(result.rows.map((row) => row.tablename));

    for (const tableName of coreTableNames) {
      assert.equal(actual.has(tableName), true, `缺少核心表 ${tableName}`);
    }
  });

  it('关键索引和唯一约束存在', async () => {
    const db = await migratedDb();
    const result = await db.query<{ indexname: string }>(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
    `);
    const actual = new Set(result.rows.map((row) => row.indexname));

    for (const indexName of requiredCoreIndexes) {
      assert.equal(actual.has(indexName), true, `缺少索引 ${indexName}`);
    }
  });

  it('证书版本指纹在租户内唯一，不能被覆盖成重复版本', async () => {
    const db = await migratedDb();
    const tenantId = await scalar<string>(db, `insert into tenants (name, code) values ('默认租户', 'default') returning id`);
    const assetId = await scalar<string>(
      db,
      `insert into certificate_assets (tenant_id, name, primary_domain, source_type)
       values ('${tenantId}', 'example.com', 'example.com', 'MANUAL') returning id`
    );

    const fp = 'a'.repeat(64);
    await db.exec(`
      insert into certificate_versions (
        tenant_id, certificate_asset_id, version_no, format, sans, serial_number,
        fingerprint_sha256, not_before, not_after, has_private_key, cert_secret_ref, status
      ) values (
        '${tenantId}', '${assetId}', 1, 'PEM', '["example.com"]', '01',
        '${fp}', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', false, 'secret://cert/1', 'VALID'
      )
    `);

    await assert.rejects(
      db.exec(`
        insert into certificate_versions (
          tenant_id, certificate_asset_id, version_no, format, sans, serial_number,
          fingerprint_sha256, not_before, not_after, has_private_key, cert_secret_ref, status
        ) values (
          '${tenantId}', '${assetId}', 2, 'PEM', '["example.com"]', '02',
          '${fp}', '2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z', false, 'secret://cert/2', 'VALID'
        )
      `)
    );
  });

  it('部署计划目标必须引用证书绑定，不能绕过绑定直连主机或证书', async () => {
    const db = await migratedDb();
    const tenantId = await scalar<string>(db, `insert into tenants (name, code) values ('默认租户', 'default') returning id`);
    const planId = await scalar<string>(
      db,
      `insert into deployment_plans (tenant_id, name, plan_type, status, created_reason)
       values ('${tenantId}', '更新 example.com', 'UPDATE', 'READY', 'MANUAL') returning id`
    );

    await assert.rejects(
      db.exec(`
        insert into deployment_plan_targets (tenant_id, deployment_plan_id, certificate_binding_id, required_capabilities)
        values ('${tenantId}', '${planId}', '00000000-0000-0000-0000-000000000001', '[]')
      `)
    );
  });

  it('可以从绑定追踪到服务、主机、证书版本和部署运行', async () => {
    const db = await migratedDb();
    const tenantId = await scalar<string>(db, `insert into tenants (name, code) values ('默认租户', 'default') returning id`);
    const assetId = await scalar<string>(
      db,
      `insert into certificate_assets (tenant_id, name, primary_domain, source_type)
       values ('${tenantId}', 'example.com', 'example.com', 'MANUAL') returning id`
    );
    const certVersionId = await scalar<string>(
      db,
      `insert into certificate_versions (
        tenant_id, certificate_asset_id, version_no, format, sans, serial_number,
        fingerprint_sha256, not_before, not_after, has_private_key, cert_secret_ref, status
      ) values (
        '${tenantId}', '${assetId}', 1, 'PEM', '["example.com"]', '01',
        '${'b'.repeat(64)}', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', false, 'secret://cert/1', 'VALID'
      ) returning id`
    );
    const hostId = await scalar<string>(
      db,
      `insert into hosts (tenant_id, hostname, os_type, compatibility_level, management_mode)
       values ('${tenantId}', 'web-01', 'LINUX', 'L1', 'AGENT') returning id`
    );
    const serviceId = await scalar<string>(
      db,
      `insert into service_instances (tenant_id, host_id, provider_type, display_name, discovery_source)
       values ('${tenantId}', '${hostId}', 'NGINX', 'nginx', 'MANUAL') returning id`
    );
    const bindingId = await scalar<string>(
      db,
      `insert into certificate_bindings (
        tenant_id, service_instance_id, domain_name, binding_type, certificate_version_id,
        desired_fingerprint_sha256, cert_path, verify_method, status
      ) values (
        '${tenantId}', '${serviceId}', 'example.com', 'FILE_PATH', '${certVersionId}',
        '${'b'.repeat(64)}', '/etc/nginx/cert.pem', 'TLS_CONNECT', 'MANAGED'
      ) returning id`
    );
    const planId = await scalar<string>(
      db,
      `insert into deployment_plans (tenant_id, name, plan_type, certificate_version_id, status, created_reason)
       values ('${tenantId}', '更新 example.com', 'UPDATE', '${certVersionId}', 'READY', 'MANUAL') returning id`
    );
    await db.exec(`
      insert into deployment_plan_targets (tenant_id, deployment_plan_id, certificate_binding_id, required_capabilities, status)
      values ('${tenantId}', '${planId}', '${bindingId}', '["file.write"]', 'READY')
    `);
    await db.exec(`
      insert into execution_runs (tenant_id, deployment_plan_id, run_no, idempotency_key, status)
      values ('${tenantId}', '${planId}', 1, 'idem-1', 'PENDING')
    `);

    const result = await db.query<{ hostname: string; provider_type: string; fingerprint_sha256: string; run_count: number }>(`
      select h.hostname, si.provider_type, cv.fingerprint_sha256, count(er.id)::int as run_count
      from certificate_bindings cb
      join service_instances si on si.id = cb.service_instance_id
      join hosts h on h.id = si.host_id
      join certificate_versions cv on cv.id = cb.certificate_version_id
      join deployment_plan_targets dpt on dpt.certificate_binding_id = cb.id
      join execution_runs er on er.deployment_plan_id = dpt.deployment_plan_id
      where cb.id = '${bindingId}'
      group by h.hostname, si.provider_type, cv.fingerprint_sha256
    `);

    assert.deepEqual(result.rows[0], {
      hostname: 'web-01',
      provider_type: 'NGINX',
      fingerprint_sha256: 'b'.repeat(64),
      run_count: 1
    });
  });
});
