import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { DeviceAssetsApplicationService } from '../device-assets/application/device-assets.application-service.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';

const migrationPath = 'src/database/migrations/20260730000700_standardize_plugin_product_families.sql';

test('历史产品族迁移统一活跃身份副本且重复执行不改变版本', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const devices = new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(database));
  const aliases = ['NETSCALER_ADC', 'CITRIX_ADC', 'Citrix NetScaler ADC'];

  for (const [index, alias] of aliases.entries()) {
    const device = await devices.create('tenant-product-family', {
      displayName: `ADC ${index}`,
      managementAddress: `10.60.0.${index + 1}`,
      deviceFamily: alias,
      credentialId: `credential-${index}`,
    });
    await database.query(
      'update pg_device_assets set product_family=$1, product_name=$1 where service_asset_id=$2',
      [alias, device.id],
    );
  }

  const unrelated = await devices.create('tenant-product-family', {
    displayName: 'F5',
    managementAddress: '10.60.0.10',
    deviceFamily: 'f5.big-ip',
    credentialId: 'credential-f5',
  });
  await database.query(
    'update pg_device_assets set product_family=$1, product_name=$1 where service_asset_id=$2',
    ['f5.big-ip', unrelated.id],
  );

  const migrationSql = await readFile(migrationPath, 'utf8');
  await database.exec(migrationSql);

  const migrated = await readState(database);
  assert.equal(migrated.filter((row) => row.device_family === 'citrix.netscaler-adc').length, 3);
  for (const row of migrated.filter((item) => item.device_family === 'citrix.netscaler-adc')) {
    assert.equal(row.product_family, 'citrix.netscaler-adc');
    assert.equal(row.product_name, 'citrix.netscaler-adc');
    assert.equal(row.metadata_device_family, 'citrix.netscaler-adc');
    assert.match(row.asset_fingerprint ?? '', /^device:citrix\.netscaler-adc:/);
  }
  const unrelatedRow = migrated.find((row) => row.service_asset_id === unrelated.id);
  assert.equal(unrelatedRow?.device_family, 'f5.big-ip');
  assert.equal(unrelatedRow?.product_family, 'f5.big-ip');

  const versionsAfterFirstRun = migrated.map(({ service_asset_id, device_version, service_version, host_version }) => ({
    service_asset_id,
    device_version,
    service_version,
    host_version,
  }));
  await database.exec(migrationSql);
  const versionsAfterSecondRun = (await readState(database)).map(({ service_asset_id, device_version, service_version, host_version }) => ({
    service_asset_id,
    device_version,
    service_version,
    host_version,
  }));
  assert.deepEqual(versionsAfterSecondRun, versionsAfterFirstRun);
});

async function readState(database: PgliteDatabase) {
  const result = await database.query<{
    service_asset_id: string;
    device_family: string;
    product_family: string | null;
    product_name: string | null;
    metadata_device_family: string | null;
    asset_fingerprint: string | null;
    device_version: number;
    service_version: number;
    host_version: number;
  }>(`
    select device.service_asset_id, device.device_family, device.product_family, device.product_name,
           service.metadata->>'deviceFamily' as metadata_device_family, host.asset_fingerprint,
           device.version as device_version, service.version as service_version, host.version as host_version
      from pg_device_assets device
      join pg_service_assets service on service.id=device.service_asset_id and service.tenant_id=device.tenant_id
      join pg_hosts host on host.id=device.host_id and host.tenant_id=device.tenant_id
     where device.tenant_id='tenant-product-family'
     order by device.service_asset_id
  `);
  return result.rows;
}
