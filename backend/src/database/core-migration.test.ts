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
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
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
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
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
    const tenantId = await scalar<string>(db, `select id::text from tenants where code = 'default'`);
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
  it('ServiceAsset 迁移到 pg_service_assets，并将 binding 关联到 service_asset_id', async () => {
    const db = await migratedDb();
    const endpointId = 'sep_legacy_001';
    const serviceId = 'svc_legacy_001';
    const bindingId = 'bnd_legacy_001';

    await db.exec(`
      insert into pg_framework_instances (
        id, tenant_id, device_id, framework_type, framework_key, discovery_provider_key, display_name, discovery_source, status, created_at, updated_at, version,
        ports, manual_overrides, raw_facts
      ) values (
        '${serviceId}', 'tenant_migration', 'hst_legacy_001', 'web.nginx', 'nginx:legacy', 'import.discovery', 'legacy-nginx', 'IMPORT', 'ACTIVE', now(), now(), 1,
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb
      );
      insert into pg_service_endpoints (
        id, tenant_id, service_instance_id, host_id, protocol, host_name, listen_ip, port, status, created_at, updated_at, version
      ) values (
        '${endpointId}', 'tenant_migration', '${serviceId}', 'hst_legacy_001', 'HTTPS', 'legacy.example.com', '10.0.0.9', 443, 'ACTIVE', now(), now(), 1
      );
      insert into pg_certificate_bindings (
        id, tenant_id, service_instance_id, service_endpoint_id, host_id, domain_name, port, protocol,
        binding_key, binding_type, verify_method, status, metadata, created_at, updated_at, version
      ) values (
        '${bindingId}', 'tenant_migration', '${serviceId}', '${endpointId}', 'hst_legacy_001', 'legacy.example.com', 443, 'HTTPS',
        'legacy:binding', 'FILE_PATH', 'TLS_CONNECT', 'DISCOVERED', '{}'::jsonb, now(), now(), 1
      );
    `);

    await db.exec(`
      create table if not exists pg_service_assets (
        id text primary key,
        tenant_id text not null,
        address varchar(255) not null,
        address_type varchar(16) not null,
        port integer not null,
        protocol varchar(16) not null,
        sni_name varchar(255),
        display_name varchar(255),
        service_instance_id text references pg_framework_instances(id),
        service_endpoint_id text references pg_service_endpoints(id),
        host_id text,
        environment varchar(32),
        discovery_source varchar(32) not null,
        last_discovered_at timestamptz,
        status varchar(32) not null,
        tags jsonb not null default '[]'::jsonb,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        version integer not null default 1
      );
      create unique index if not exists uq_pg_service_assets_active_identity
        on pg_service_assets (tenant_id, address, port, protocol)
        where deleted_at is null;
      alter table pg_certificate_bindings add column if not exists service_asset_id text references pg_service_assets(id);
      create index if not exists idx_pg_certificate_bindings_service_asset on pg_certificate_bindings (tenant_id, service_asset_id);
    `);

    await db.exec(`
      with candidate_assets as (
        select distinct
          cb.tenant_id,
          lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, ''))) as address,
          case
            when lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), '')) ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$' then 'IPV4'
            when position(':' in lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), ''))) > 0 then 'IPV6'
            else 'DNS'
          end as address_type,
          coalesce(cb.port, se.port) as port,
          upper(coalesce(nullif(cb.protocol, ''), nullif(se.protocol, ''), 'HTTPS')) as protocol,
          lower(coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''))) as sni_name,
          coalesce(nullif(cb.domain_name, ''), nullif(cb.domain, ''), nullif(se.host_name, ''), nullif(se.listen_ip, '')) as display_name,
          cb.service_instance_id,
          cb.service_endpoint_id,
          cb.host_id,
          cb.discovery_source,
          cb.created_at,
          cb.updated_at
        from pg_certificate_bindings cb
        left join pg_service_endpoints se on se.id = cb.service_endpoint_id
        where cb.deleted_at is null
      )
      insert into pg_service_assets (
        id, tenant_id, address, address_type, port, protocol, sni_name, display_name,
        service_instance_id, service_endpoint_id, host_id, discovery_source, last_discovered_at,
        status, tags, metadata, created_at, updated_at, version
      )
      select
        'sat_legacy_' || substr(md5(candidate_assets.tenant_id || ':' || candidate_assets.address || ':' || candidate_assets.port || ':' || candidate_assets.protocol), 1, 24),
        candidate_assets.tenant_id,
        candidate_assets.address,
        candidate_assets.address_type,
        candidate_assets.port,
        candidate_assets.protocol,
        candidate_assets.sni_name,
        candidate_assets.display_name,
        candidate_assets.service_instance_id,
        candidate_assets.service_endpoint_id,
        candidate_assets.host_id,
        coalesce(candidate_assets.discovery_source, 'IMPORT'),
        candidate_assets.updated_at,
        'ACTIVE', '[]'::jsonb, '{}'::jsonb, candidate_assets.created_at, candidate_assets.updated_at, 1
      from candidate_assets
      on conflict (tenant_id, address, port, protocol) where deleted_at is null do nothing;

      update pg_certificate_bindings cb
      set service_asset_id = sa.id
      from pg_service_assets sa
      where cb.tenant_id = sa.tenant_id
        and cb.id = '${bindingId}'
        and sa.address = lower(coalesce(
          nullif(cb.domain_name, ''),
          nullif(cb.domain, ''),
          nullif((select se.host_name from pg_service_endpoints se where se.id = cb.service_endpoint_id), ''),
          nullif((select se.listen_ip from pg_service_endpoints se where se.id = cb.service_endpoint_id), '')
        ))
        and sa.port = coalesce(cb.port, (select se.port from pg_service_endpoints se where se.id = cb.service_endpoint_id))
        and sa.protocol = upper(coalesce(nullif(cb.protocol, ''), nullif((select se.protocol from pg_service_endpoints se where se.id = cb.service_endpoint_id), ''), 'HTTPS'));
    `);

    const serviceAsset = await db.query<{ id: string; address: string; port: number; protocol: string }>(`
      select id, address, port, protocol from pg_service_assets where tenant_id = 'tenant_migration'
    `);
    assert.equal(serviceAsset.rows.length, 1);
    assert.equal(serviceAsset.rows[0]?.address, 'legacy.example.com');
    assert.equal(serviceAsset.rows[0]?.port, 443);
    assert.equal(serviceAsset.rows[0]?.protocol, 'HTTPS');

    const binding = await db.query<{ service_asset_id: string }>(`
      select service_asset_id from pg_certificate_bindings where id = '${bindingId}'
    `);
    assert.equal(binding.rows[0]?.service_asset_id, serviceAsset.rows[0]?.id);
  });
