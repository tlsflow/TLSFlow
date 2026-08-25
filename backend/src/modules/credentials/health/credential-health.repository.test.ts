import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { CredentialHealthRepository } from './credential-health.repository.js';

test('健康检测能够识别设备插件绑定中的凭据关联', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  try {
    await database.query(`insert into credential_profiles
      (id,tenant_id,name,kind,scope_type,delivery,secret_slots,metadata,status,version,created_by)
      values ('credential-binding-health','tenant-binding-health','绑定凭据','API_KEY','global','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'active',1,'test')`);
    await database.query(`insert into unified_plugin_versions
      (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
      values ('plugin-version-binding-health','tenant-binding-health','device.test','1.0.0','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED',$1::jsonb,'package','manifest','{}'::jsonb,'RETIRED','NOT_REQUIRED','[]'::jsonb,'{}'::jsonb,now(),now())`, [JSON.stringify({ capabilities: [], resources: {} })]);
    await database.query(`insert into unified_plugin_versions
      (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
      values ('plugin-version-binding-health-current','tenant-binding-health','device.test','1.1.0','USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED',$1::jsonb,'package-current','manifest-current','{}'::jsonb,'ENABLED','NOT_REQUIRED','[]'::jsonb,'{}'::jsonb,now(),now())`, [JSON.stringify({ capabilities: [{ key: 'credential.health-check' }], resources: { workflows: { 'credential.health-check': 'workflows/credential-health-check.json' } } })]);
    await database.query(`insert into unified_plugin_versions
      (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
      values ('plugin-version-binding-health-builtin','SYSTEM','device.test','1.2.0','BUILTIN','WORKFLOW_DSL','BOTH','OFFICIAL_SIGNED','OFFICIAL',$1::jsonb,'package-builtin','manifest-builtin','{}'::jsonb,'ENABLED','NOT_REQUIRED','[]'::jsonb,'{}'::jsonb,now(),now())`, [JSON.stringify({ capabilities: [{ key: 'credential.health-check' }], resources: { workflows: { 'credential.health-check': 'workflows/credential-health-check.json' } } })]);
    await database.query(`insert into unified_plugin_bindings
      (id,tenant_id,plugin_version_id,mode,input_bindings,managed_context,status,version,created_at,updated_at)
      values ('plugin-binding-health','tenant-binding-health','plugin-version-binding-health','MANAGED',$1::jsonb,$2::jsonb,'ACTIVE',1,now(),now())`, [
      JSON.stringify({
        apiVersion: 'gcac.input-bindings/v1',
        variables: {},
        connections: {},
        credentials: { management: { credentialId: 'credential-binding-health' } },
        artifacts: {},
      }),
      JSON.stringify({ hostId: 'host-binding-health' }),
    ]);
    await database.query(`insert into pg_hosts
      (id,tenant_id,hostname,display_name,os_type,discovery_source,compatibility_level,management_mode,status)
      values ('host-binding-health','tenant-binding-health','binding-health.example.test','绑定设备','NETWORK_DEVICE','MANUAL','L1','PLUGIN','ACTIVE')`);
    await database.query(`insert into pg_service_assets
      (id,tenant_id,address,address_type,port,protocol,display_name,discovery_source,status,asset_kind)
      values ('service-binding-health','tenant-binding-health','198.51.100.10','IPV4',443,'HTTPS','绑定设备','MANUAL','ACTIVE','DEVICE')`);
    await database.query(`insert into pg_device_assets
      (service_asset_id,tenant_id,host_id,device_family,management_port,credential_id,auth_mode,tls_verify,plugin_version_id,plugin_binding_id)
      values ('service-binding-health','tenant-binding-health','host-binding-health','device.test',443,null,'PLUGIN',true,'plugin-version-binding-health','plugin-binding-health')`);
    await database.query(`insert into pg_device_liveness_signals
      (id,tenant_id,resource_type,resource_id,signal_type,status,source,last_observed_at,updated_at)
      values ('liveness-binding-health','tenant-binding-health','DEVICE','host-binding-health','MANAGEMENT_TCP','HEALTHY','CONTROL_PLANE',now(),now())`);

    const repository = new CredentialHealthRepository(database);
    const devices = await repository.listEligibleDevices('tenant-binding-health', 'credential-binding-health');
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.id, 'service-binding-health');
    assert.equal(devices[0]?.credentialId, 'credential-binding-health');
    assert.equal(devices[0]?.pluginVersionId, 'plugin-version-binding-health-builtin');
    assert.equal(devices[0]?.credentialTestSupported, true);

    const state = await repository.ensureState('tenant-binding-health', 'credential-binding-health', 1, 'UNREACHABLE', devices.length);
    assert.equal(state.deviceCount, 1);

    await repository.saveConfiguration({ tenantId: 'tenant-binding-health', credentialId: 'credential-binding-health', profileVersion: 1, enabled: true, selectedDeviceAssetId: 'service-binding-health', updatedBy: 'test' });
    assert.deepEqual((await repository.getState('tenant-binding-health', 'credential-binding-health'))?.enabled, true);

    assert.deepEqual(await repository.listActiveCredentialRefs('tenant-binding-health'), [{
      tenantId: 'tenant-binding-health',
      credentialId: 'credential-binding-health',
      profileVersion: 1,
    }]);
  } finally {
    await database.close();
  }
});
