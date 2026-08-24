import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort, QueryResult } from '../../database/database-port.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { PgDevicesRepository } from './repository/devices.repository.js';
import { mapAgentHealth, mapNetworkDeviceHealth } from './repository/devices.repository.js';
import { DevicePlatformRegistry } from './domain/device-platform.registry.js';
import { DevicesApplicationService } from './application/devices.application-service.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { DeviceAssetsApplicationService } from '../device-assets/application/device-assets.application-service.js';
import type { SecretService } from '../secrets/secret.service.js';

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

test('Spec033 统一健康状态覆盖五种公共状态且保留详情动作边界', async () => {
  assert.equal(mapAgentHealth('online'), 'HEALTHY');
  assert.equal(mapAgentHealth('upgrading'), 'DEGRADED');
  assert.equal(mapAgentHealth('offline'), 'UNREACHABLE');
  assert.equal(mapAgentHealth('disabled'), 'DISABLED');
  assert.equal(mapAgentHealth('missing'), 'UNKNOWN');
  assert.equal(mapNetworkDeviceHealth('ACTIVE', 'NITRO_TIMEOUT', 'FULL', undefined), 'UNREACHABLE');

  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const device = await new PgDeviceAssetsRepository(database).create('tenant_spec033_device_detail', {
    displayName: 'ADC Detail', managementAddress: '10.33.4.49', managementPort: 443,
    deviceFamily: 'NETSCALER_ADC', credentialId: 'secret_detail', authMode: 'AUTO', tlsVerify: true,
  });
  const detail = await new PgDevicesRepository(database).get('tenant_spec033_device_detail', device.hostId);

  assert.equal(detail?.extensionType, 'NETWORK_APPLIANCE');
  assert.ok(detail?.allowedActions.includes('TEST_CONNECTION'));
  assert.ok(!detail?.allowedActions.includes('UPGRADE_AGENT'));
  assert.equal(detail?.publicSummary.managementMode, 'AGENTLESS');
});

test('Spec033 平台 Registry 返回六个平台并拒绝未支持厂商', () => {
  const registry = new DevicePlatformRegistry();
  const platforms = registry.list();
  assert.equal(platforms.length, 6);
  assert.deepEqual(platforms.filter((item) => item.supportStatus === 'SUPPORTED').map((item) => item.key), [
    'windows', 'windows-compatibility', 'linux', 'citrix-adc',
  ]);
  assert.throws(() => registry.requireSupported('f5'));
  assert.throws(() => registry.requireSupported('sangfor'));
  assert.ok(platforms.flatMap((item) => item.formSchema).filter((field) => field.key === 'password').every((field) => field.type === 'SECRET_INPUT'));
});

test('Spec033 统一添加复用 Agent 会话并强制确认不安全 TLS', async () => {
  const calls: string[] = [];
  const agents = {
    createWindowsPowerShellInstallSession: async () => ({ installCommand: 'install-windows' }),
    createWindowsCompatibilityInstallSession: async () => ({ installCommand: 'install-compatibility' }),
    createLinuxGoInstallSession: async () => ({ installCommand: 'install-linux' }),
  } as unknown as AgentsApplicationService;
  const service = new DevicesApplicationService(new PgDevicesRepository(new PgliteDatabase()), undefined, agents);
  const windows = await service.onboard('tenant-onboarding', {
    platformKey: 'windows', displayName: 'Windows', baseUrl: 'https://gcac.example',
  }, 'user-onboarding', 'request-onboarding');
  assert.equal((windows as { installCommand: string }).installCommand, 'install-windows');
  await assert.rejects(() => service.onboard('tenant-onboarding', {
    platformKey: 'citrix-adc', displayName: 'ADC', managementAddress: '10.33.5.49', username: 'nsroot', password: 'secret', tlsVerify: false,
  }, 'user-onboarding', 'request-onboarding'));
  assert.deepEqual(calls, []);
});

test('Spec033 Citrix ADC 添加创建 SecretRef 且不回显密码', async () => {
  const createdInputs: unknown[] = [];
  const secrets = {
    create: async (input: unknown) => {
      createdInputs.push(input);
      return { secretRef: 'secret://password/sec_adc#v1' };
    },
  } as unknown as SecretService;
  const deviceAssets = {
    create: async (_tenantId: string, input: Record<string, unknown>) => ({ id: 'device_adc', hostId: 'host_adc', tenantId: 'tenant_adc', ...input }),
    testConnection: async () => ({ reachable: true, authenticated: true, productMatched: true, capabilities: {}, warnings: [] }),
  } as unknown as DeviceAssetsApplicationService;
  const service = new DevicesApplicationService(new PgDevicesRepository(new PgliteDatabase()), undefined, undefined, deviceAssets, secrets);
  const result = await service.onboard('tenant_adc', {
    platformKey: 'citrix-adc', displayName: 'ADC', managementAddress: '10.33.5.49', username: 'nsroot', password: 'secret', tlsVerify: false, insecureTlsAcknowledged: true,
  }, 'user_adc', 'request_adc');

  assert.equal((result as { device: { credentialId: string } }).device.credentialId, 'secret://password/sec_adc#v1');
  assert.ok(!JSON.stringify(result).includes('nsroot'));
  assert.ok(!JSON.stringify(result).includes('"password"'));
  assert.equal(createdInputs.length, 1);
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
