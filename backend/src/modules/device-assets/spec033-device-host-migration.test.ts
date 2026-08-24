import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDeviceAssetsRepository } from './repository/device-assets.repository.js';

test('Spec033 新建设备同时创建共享 Host 主记录', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgDeviceAssetsRepository(database);
  const device = await repository.create('tenant_spec033_host_create', {
    displayName: 'ADC Host Create',
    managementAddress: '10.33.1.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_adc_host_create',
    authMode: 'SESSION',
    tlsVerify: false,
  });

  const hosts = await database.query<{
    id: string;
    primary_ip: string;
    os_type: string;
    management_mode: string;
    agent_id: string | null;
  }>('select id, primary_ip, os_type, management_mode, agent_id from pg_hosts where tenant_id = $1', ['tenant_spec033_host_create']);

  assert.equal(hosts.rows.length, 1);
  assert.equal(device.hostId, hosts.rows[0]?.id);
  assert.equal(hosts.rows[0]?.primary_ip, '10.33.1.49');
  assert.equal(hosts.rows[0]?.os_type, 'NETWORK_DEVICE');
  assert.equal(hosts.rows[0]?.management_mode, 'AGENTLESS');
  assert.equal(hosts.rows[0]?.agent_id, null);
});

test('Spec033 Host 迁移为历史设备提供幂等回填结构', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');

  const columns = await database.query<{ column_name: string }>(`
    select column_name
    from information_schema.columns
    where table_name = 'pg_device_assets' and column_name = 'host_id'
  `);
  const indexes = await database.query<{ indexname: string }>(`
    select indexname
    from pg_indexes
    where tablename = 'pg_device_assets'
      and indexname in ('uq_pg_device_assets_active_host_family', 'idx_pg_device_assets_host')
    order by indexname
  `);

  assert.equal(columns.rows.length, 1);
  assert.deepEqual(indexes.rows.map((row) => row.indexname), [
    'idx_pg_device_assets_host',
    'uq_pg_device_assets_active_host_family',
  ]);
});
