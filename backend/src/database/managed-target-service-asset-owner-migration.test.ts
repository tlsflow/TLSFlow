import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

test('ManagedTarget 支持 ServiceAsset、历史云资产和设备三类唯一所有者', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const tenantId = 'tenant-managed-target-owner';

  await db.exec(`
    insert into pg_service_assets
      (id, tenant_id, address, address_type, port, protocol, discovery_source, status)
    values ('service-asset-1', '${tenantId}', 'cdn.example.com', 'DNS', 443, 'HTTPS', 'TEST', 'ACTIVE');
    insert into pg_cloud_account_assets
      (id, tenant_id, provider_key, display_name, credential_ref, identity_key)
    values ('cloud-asset-1', '${tenantId}', 'cloud.aliyun', '阿里云 CDN', 'credential://fixture', 'aliyun:fixture');
    insert into pg_hosts
      (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-1', '${tenantId}', 'host.example.com', 'LINUX', 'TEST', 'L1', 'AGENT', 'ACTIVE');
  `);

  const columns = `
    framework_instance_id, site_id, discovery_provider_key, target_type, target_key,
    supported_capabilities, execution_locations, status, metadata, created_at, updated_at, version
  `;
  const values = (id: string, ownerId: string) => `
    ('${id}', '${tenantId}', '${ownerId}', null, null, 'plugin.test.discovery', 'plugin.test.target', '${id}',
     '["certificate.deploy"]'::jsonb, '["CONTROL_PLANE"]'::jsonb, 'ACTIVE', '{}'::jsonb, now(), now(), 1)
  `;

  await db.exec(`
    insert into pg_managed_targets (id, tenant_id, service_asset_id, ${columns})
    values ${values('target-service', 'service-asset-1')};
    insert into pg_managed_targets (id, tenant_id, asset_id, ${columns})
    values ${values('target-cloud', 'cloud-asset-1')};
    insert into pg_managed_targets (id, tenant_id, device_id, ${columns})
    values ${values('target-device', 'host-1')};
  `);

  assert.equal(
    (await db.query<{ count: string }>(
      'select count(*)::text as count from pg_managed_targets where tenant_id=$1',
      [tenantId],
    )).rows[0]?.count,
    '3',
  );

  await assert.rejects(
    db.exec(`
      insert into pg_managed_targets (id, tenant_id, asset_id, service_asset_id, ${columns})
      values ('target-two-owners', '${tenantId}', 'cloud-asset-1', 'service-asset-1', null, null,
        'plugin.test.discovery', 'plugin.test.target', 'target-two-owners',
        '["certificate.deploy"]'::jsonb, '["CONTROL_PLANE"]'::jsonb, 'ACTIVE', '{}'::jsonb, now(), now(), 1);
    `),
    /ck_pg_managed_targets_exactly_one_owner/,
  );

  await assert.rejects(
    db.exec(`
      insert into pg_managed_targets (id, tenant_id, ${columns})
      values ('target-no-owner', '${tenantId}', null, null, 'plugin.test.discovery', 'plugin.test.target', 'target-no-owner',
        '["certificate.deploy"]'::jsonb, '["CONTROL_PLANE"]'::jsonb, 'ACTIVE', '{}'::jsonb, now(), now(), 1);
    `),
    /ck_pg_managed_targets_exactly_one_owner/,
  );
});
