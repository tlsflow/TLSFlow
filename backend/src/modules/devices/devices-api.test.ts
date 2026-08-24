import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort, QueryResult } from '../../database/database-port.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { PgDevicesRepository } from './repository/devices.repository.js';

test('Spec033 统一设备列表聚合 Agent 和 Citrix ADC 且不产生 N+1', async () => {
  const database = new CountingDatabase(new PgliteDatabase());
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const devices = new PgDeviceAssetsRepository(database);
  const tenantId = 'tenant_spec033_devices';
  const agentId = 'agent_spec033_devices';

  const host = await assets.createHost(tenantId, {
    hostname: 'spec033-win',
    displayName: 'Spec033 Windows',
    primaryIp: '10.33.2.10',
    ipAddresses: ['10.33.2.10'],
    osType: 'WINDOWS',
    osName: 'Windows Server',
    agentId,
    managementMode: 'AGENT',
    status: 'ACTIVE',
  });
  await database.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at) values ($1, $2, $3::jsonb, now())`,
    ['agents:registrations', agentId, JSON.stringify({
      id: agentId,
      tenantId,
      status: 'online',
      updatedAt: '2026-07-22T08:00:00.000Z',
      descriptor: { osType: 'WINDOWS', agentVersion: '1.2.3', capabilities: ['certificate.deploy'] },
    })],
  );
  await assets.createServiceAsset(tenantId, {
    address: 'app.spec033.example',
    addressType: 'DNS',
    port: 443,
    protocol: 'HTTPS',
    hostId: host.id,
    displayName: 'Spec033 应用',
  });
  const adc = await devices.create(tenantId, {
    displayName: 'Spec033 ADC',
    managementAddress: '10.33.2.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_spec033_devices',
    authMode: 'SESSION',
    tlsVerify: false,
  });

  database.resetQueryCount();
  const result = await new PgDevicesRepository(database).list(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
    sort: { field: 'displayName', direction: 'asc' },
  });

  assert.equal(database.queryCount, 1);
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.extensionType), ['NETWORK_APPLIANCE', 'AGENT']);
  assert.equal(result.items.find((item) => item.id === host.id)?.applicationAssetCount, 1);
  assert.equal(result.items.find((item) => item.id === host.id)?.health, 'HEALTHY');
  assert.equal(result.items.find((item) => item.id === adc.hostId)?.managementMethod, 'NITRO_API');
});

test('Spec033 统一设备列表支持筛选、分页和 Host 权限范围', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const devices = new PgDeviceAssetsRepository(database);
  const tenantId = 'tenant_spec033_devices_filter';
  const first = await devices.create(tenantId, {
    displayName: 'ADC A', managementAddress: '10.33.3.1', managementPort: 443, deviceFamily: 'NETSCALER_ADC', credentialId: 'secret_a', authMode: 'AUTO', tlsVerify: true,
  });
  await devices.create(tenantId, {
    displayName: 'ADC B', managementAddress: '10.33.3.2', managementPort: 443, deviceFamily: 'NETSCALER_ADC', credentialId: 'secret_b', authMode: 'AUTO', tlsVerify: true,
  });

  const result = await new PgDevicesRepository(database).list(tenantId, {
    page: 1,
    pageSize: 1,
    filter: { category: 'NETWORK_APPLIANCE' },
    authorizedHostIds: [first.hostId],
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.id, first.hostId);
});

class CountingDatabase implements DatabasePort {
  queryCount = 0;

  constructor(private readonly database: DatabasePort) {}

  exec(sql: string): Promise<void> {
    return this.database.exec(sql);
  }

  query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    this.queryCount += 1;
    return this.database.query<TRow>(sql, params);
  }

  transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    return this.database.transaction(() => work(this));
  }

  resetQueryCount(): void {
    this.queryCount = 0;
  }
}
