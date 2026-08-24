import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PluginCertificateResultService } from './results/plugin-certificate-result.service.js';

test('证书发现按 SHA-256 关联并区分同步、漂移和不完整', async () => {
  const db = await fixtureDatabase();
  const service = new PluginCertificateResultService(db);
  const summary = await service.reconcileDiscovery('tenant-1', 'device-1');
  assert.deepEqual(summary, { linked: 1, incomplete: 1, drifted: 0 });
  await service.setDesiredVersion('tenant-1', 'device-1', 'binding:main', 'cert-v2');
  assert.equal((await db.query<{ drift_state: string }>("select drift_state from plugin_discovered_certificate_bindings where stable_key='binding:main'")).rows[0]?.drift_state, 'DRIFTED');
});

test('只有最终验证成功或回滚成功才更新当前证书', async () => {
  const db = await fixtureDatabase();
  const service = new PluginCertificateResultService(db);
  await service.setDesiredVersion('tenant-1', 'device-1', 'binding:main', 'cert-v2');
  await service.applyDeploymentResult('tenant-1', 'device-1', {
    apiVersion: 'gcac.certificate-deploy-result/v1', bindingStableKey: 'binding:main', status: 'FAILED', verifiedAt: '2026-07-24T08:00:00Z',
  });
  assert.equal((await db.query<{ current_certificate_version_id: string | null }>("select current_certificate_version_id from plugin_discovered_certificate_bindings where stable_key='binding:main'")).rows[0]?.current_certificate_version_id, 'cert-v1');
  await service.applyDeploymentResult('tenant-1', 'device-1', {
    apiVersion: 'gcac.certificate-deploy-result/v1', bindingStableKey: 'binding:main', status: 'VERIFIED',
    certificateVersionId: 'cert-v2', observedFingerprintSha256: 'BB'.repeat(32), verifiedAt: '2026-07-24T08:01:00Z',
  });
  const binding = (await db.query<{ current_certificate_version_id: string; drift_state: string }>("select current_certificate_version_id, drift_state from plugin_discovered_certificate_bindings where stable_key='binding:main'")).rows[0];
  assert.deepEqual(binding, { current_certificate_version_id: 'cert-v2', drift_state: 'SYNCED' });
});

async function fixtureDatabase() {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  await db.query("insert into pg_hosts (id,tenant_id,hostname,os_type,discovery_source,compatibility_level,management_mode,status) values ('host-1','tenant-1','device','NETWORK_DEVICE','MANUAL','L1','AGENTLESS','ACTIVE')");
  await db.query("insert into pg_service_instances (id,tenant_id,host_id,provider_type,display_name,discovery_source,status) values ('service-1','tenant-1','host-1','PLUGIN:test','Device','PROVIDER','ACTIVE')");
  await db.query("insert into pg_service_assets (id,tenant_id,address,address_type,port,protocol,display_name,host_id,discovery_source,status,asset_kind) values ('device-1','tenant-1','192.0.2.1','IPV4',443,'HTTPS','Device','host-1','MANUAL','ACTIVE','DEVICE')");
  await db.query("insert into pg_device_assets (service_asset_id,tenant_id,device_family,credential_id) values ('device-1','tenant-1','MOCK','secret://credential/mock')");
  await db.query("insert into pg_site_assets (id,tenant_id,service_instance_id,host_id,provider_type,site_type,site_name,site_key,discovery_source,status,created_at,updated_at) values ('site-1','tenant-1','service-1','host-1','PLUGIN:test','CUSTOM','Main','site:main','PROVIDER','ACTIVE',now(),now())");
  await db.query(`insert into pg_certificate_assets (id,name,primary_domain,sans,source_type,status,created_by)
    values ('cert-a1','Old','old.example','[]'::jsonb,'MANUAL','ACTIVE','test'),
           ('cert-a2','New','new.example','[]'::jsonb,'MANUAL','ACTIVE','test')`);
  await db.query(`insert into pg_certificate_versions (
      id,certificate_asset_id,version_no,common_name,sans,issuer,subject,serial_number,not_before,not_after,
      fingerprint_sha256,public_key_algorithm,signature_algorithm,leaf_storage_ref,chain_certificate_refs,
      chain_order,chain_diagnostics,chain_status,deployable,source_type,status,created_by
    ) values (
      'cert-v1','cert-a1',1,'old.example','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'01',now(),now()+interval '1 year',
      $1,'RSA','SHA256-RSA','artifact://old','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'COMPLETE',true,'MANUAL','VALID','test'
    ),(
      'cert-v2','cert-a2',1,'new.example','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'02',now(),now()+interval '1 year',
      $2,'RSA','SHA256-RSA','artifact://new','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'COMPLETE',true,'MANUAL','VALID','test'
    )`, ['AA'.repeat(32), 'BB'.repeat(32)]);
  await db.query(`insert into plugin_discovered_certificates (id,tenant_id,device_asset_id,stable_key,fingerprint_sha256,status,last_discovered_at,created_at,updated_at)
    values ('dc-1','tenant-1','device-1','certificate:main',$1,'ACTIVE',now(),now(),now()),
           ('dc-2','tenant-1','device-1','certificate:unknown',null,'ACTIVE',now(),now(),now())`, ['AA'.repeat(32)]);
  await db.query(`insert into plugin_discovered_certificate_bindings (id,tenant_id,device_asset_id,stable_key,site_asset_id,discovered_certificate_id,status,last_discovered_at,created_at,updated_at)
    values ('db-1','tenant-1','device-1','binding:main','site-1','dc-1','ACTIVE',now(),now(),now())`);
  return db;
}
