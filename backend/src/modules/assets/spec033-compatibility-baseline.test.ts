import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { normalizeDeploymentStrategy } from './application/deployment-strategy.service.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';

test('Spec033 终态基线：Agent 注册后可通过 Agent 列表查询', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const app = createApp({ db: database });
  const tenantId = 'tenant_spec033_agent_baseline';
  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers: { 'x-tenant-id': tenantId, 'x-request-id': 'req_spec033_register' },
    body: {
      agentKey: 'spec033-agent-baseline',
      hostname: 'SPEC033-WIN',
      version: '0.1.0',
      osType: 'windows',
      arch: 'amd64',
      ipAddress: '10.33.0.10',
      labels: ['spec033'],
    },
  });
  assert.equal(registered.statusCode, 201);

  const service = app.getResource('agentsService') as AgentsApplicationService;
  const listed = await service.listAgents(tenantId, { page: 1, pageSize: 20, filter: {} });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.agentKey, 'spec033-agent-baseline');
  assert.equal(listed.items[0]?.descriptor.hostname, 'spec033-win');
});

test('Spec033.4 终态拒绝旧 AGENT 部署策略', () => {
  assert.throws(() => normalizeDeploymentStrategy({ type: 'AGENT' } as never, {
    asset: { id: 'asset_spec033', metadata: {} },
    actorId: 'user_spec033',
    now: '2026-07-22T00:00:00.000Z',
  }));
});

test('Spec033 终态基线：NetScaler 设备使用 DEVICE 资产主键', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgDeviceAssetsRepository(database);
  const created = await repository.create('tenant_spec033_device_baseline', {
    displayName: 'Spec033 ADC',
    managementAddress: '10.33.0.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_spec033_adc',
    authMode: 'SESSION',
    tlsVerify: false,
  });

  const rows = await database.query<{
    service_asset_id: string;
    asset_kind: string;
    device_family: string;
  }>(`
    select da.service_asset_id, sa.asset_kind, da.device_family
    from pg_device_assets da
    join pg_service_assets sa on sa.id = da.service_asset_id
    where da.tenant_id = $1 and da.service_asset_id = $2
  `, ['tenant_spec033_device_baseline', created.id]);

  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]?.service_asset_id, created.id);
  assert.equal(rows.rows[0]?.asset_kind, 'DEVICE');
  assert.equal(rows.rows[0]?.device_family, 'NETSCALER_ADC');
});
