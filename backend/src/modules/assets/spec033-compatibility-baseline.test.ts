import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { normalizeDeploymentStrategy } from './application/deployment-strategy.service.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';

test('Spec033 兼容基线：旧 Agent 注册后仍可通过原列表接口查询', async () => {
  const app = createApp();
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

test('Spec033 兼容基线：旧 AGENT 策略继续保留目标和证书产物字段', () => {
  const normalized = normalizeDeploymentStrategy({
    type: 'AGENT',
    agent: {
      mode: 'NATIVE_HANDLER',
      agentId: 'agent_spec033',
      siteAssetId: 'site_spec033',
      managedTargetId: 'target_spec033',
      certificateFormatId: 'format_spec033',
    },
  }, {
    asset: { id: 'asset_spec033', agentId: 'agent_spec033', metadata: {} },
    targetBinding: {
      agentId: 'agent_spec033',
      siteAssetId: 'site_spec033',
      managedTargetId: 'target_spec033',
    },
    actorId: 'user_spec033',
    now: '2026-07-22T00:00:00.000Z',
  });

  assert.equal(normalized.type, 'AGENT');
  assert.equal(normalized.agent?.agentId, 'agent_spec033');
  assert.equal(normalized.agent?.siteAssetId, 'site_spec033');
  assert.equal(normalized.agent?.managedTargetId, 'target_spec033');
  assert.equal(normalized.agent?.certificateFormatId, 'format_spec033');
});

test('Spec033 兼容基线：现有 NetScaler 设备仍使用 DEVICE 应用资产主键', async () => {
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
