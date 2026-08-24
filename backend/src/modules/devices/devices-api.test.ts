import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type { DatabasePort, QueryResult } from '../../database/database-port.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { PgAgentsRepository } from '../agents/repository/agents.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { PgDevicesRepository } from './repository/devices.repository.js';
import { mapAgentHealth, mapNetworkDeviceHealth } from './repository/devices.repository.js';
import { DevicePlatformRegistry } from './domain/device-platform.registry.js';
import { DevicesApplicationService } from './application/devices.application-service.js';
import { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import { PluginBindingsApplicationService } from '../plugins/application/plugin-bindings.application-service.js';
import type { PluginWorkflowPublisherService } from '../plugins/application/plugin-workflow-publisher.service.js';
import { StandardDeviceDiscoveryProjector } from '../plugins/discovery/standard-device-discovery.projector.js';
import { PluginBindingsRepository } from '../plugins/repository/plugin-bindings.repository.js';
import { PgUnifiedPluginsRepository } from '../plugins/repository/unified-plugins.repository.js';
import type { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowRunResult } from '../workflow-templates/dto/workflow-templates.dto.js';
import { AppError } from '../../common/errors/app-error.js';
import { CredentialsRepository } from '../credentials/repository/credentials.repository.js';

test('Agent Host 投影迁移回填历史注册且重复执行不产生重复设备', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_legacy_agent_projection';
  const agentId = 'agt_legacy_windows_2008_r2';
  await database.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at)
     values ($1, $2, $3::jsonb, now())`,
    ['agents:registrations', agentId, JSON.stringify({
      id: agentId,
      tenantId,
      agentKey: 'legacy-windows-2008-r2',
      status: 'ONLINE',
      zone: 'default',
      registeredAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-23T08:00:00.000Z',
      descriptor: {
        agentKey: 'legacy-windows-2008-r2',
        machineId: 'legacy-windows-2008-r2-machine',
        hostname: 'legacy-win2008r2-migration',
        version: '0.9.0',
        osType: 'WINDOWS',
        osVersion: 'Windows Server 2008 R2',
        labels: [],
      },
    })],
  );
  const migrationSql = await readFile(resolve('src/database/migrations/20260723000200_agent_registration_host_projection.sql'), 'utf8');

  await database.exec(migrationSql);
  await database.exec(migrationSql);

  const result = await new PgDevicesRepository(database).list(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
    sort: { field: 'displayName', direction: 'asc' },
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.displayName, 'legacy-win2008r2-migration');
  assert.equal(result.items[0]?.productFamily, 'Windows Server');
});

test('Agent 注册自动创建设备主记录并兼容 Windows Server 2008 R2', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const agents = new AgentsApplicationService(new PgAgentsRepository(database));

  const registered = await agents.register('tenant_windows_2008_r2', {
    agentKey: 'windows-2008-r2-agent',
    machineId: 'windows-2008-r2-machine',
    hostname: 'legacy-win2008r2',
    version: '1.0.0',
    osType: 'windows',
    osVersion: 'Windows Server 2008 R2',
    arch: 'amd64',
    ipAddress: '10.33.2.8',
  }, 'request_windows_2008_r2');

  const result = await new PgDevicesRepository(database).list('tenant_windows_2008_r2', {
    page: 1,
    pageSize: 20,
    filter: {},
    sort: { field: 'displayName', direction: 'asc' },
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.displayName, 'legacy-win2008r2');
  assert.equal(result.items[0]?.productFamily, 'Windows Server');
  assert.equal(result.items[0]?.managementMethod, 'AGENT');
  assert.equal(result.items[0]?.managementAddress, '10.33.2.8');
  assert.equal(result.items[0]?.softwareVersion, 'Windows Server 2008 R2');
  assert.equal(result.items[0]?.extensionType, 'AGENT');
  await agents.reportCapabilities('tenant_windows_2008_r2', {
    agentId: registered.id,
    compatibilityLevel: 'L1',
    capabilities: [{
      capabilityKey: 'windows.iis.detail',
      value: {
        Installed: true,
        VersionString: 'Version 7.5',
        Sites: [{
          Name: 'Default Web Site',
          State: 'Started',
          AppPool: 'DefaultAppPool',
          PhysicalPath: 'C:\\inetpub\\wwwroot',
          Bindings: [{ Protocol: 'http', IPAddress: '*', Port: 80, HostHeader: '', BindingInformation: '*:80:' }],
        }],
      },
      confidence: 0.95,
    }],
  }, 'request_windows_2008_r2_capabilities');
  const unifiedDetail = await new DevicesApplicationService(new PgDevicesRepository(database), undefined, agents).get(
    'tenant_windows_2008_r2',
    registered.id,
  );
  assert.equal(unifiedDetail.extension.type, 'AGENT');
  assert.equal(unifiedDetail.overview.deviceType, 'AGENT');
  assert.ok(unifiedDetail.informationSections.some((section) => section.key === 'agent'));
  assert.ok(unifiedDetail.informationSections.some((section) => section.fields.some((field) => field.key === 'agentVersion' && field.value === '1.0.0')));
  assert.equal(unifiedDetail.sites[0]?.kind, 'IIS');
  assert.equal(unifiedDetail.sites[0]?.name, 'Default Web Site');
  assert.equal(unifiedDetail.sites[0]?.endpoint?.port, 80);

  await agents.heartbeat('tenant_windows_2008_r2', {
    agentId: registered.id,
    version: '1.0.0',
    directControl: {
      enabled: true,
      reachable: true,
      listenAddress: '10.33.2.18:18933',
      protocolVersion: 'v1',
      supportedActions: ['health'],
    },
  }, 'request_windows_2008_r2_heartbeat');
  const refreshed = await new PgDevicesRepository(database).list('tenant_windows_2008_r2', {
    page: 1,
    pageSize: 20,
    filter: {},
    sort: { field: 'displayName', direction: 'asc' },
  });
  assert.equal(refreshed.items[0]?.managementAddress, '10.33.2.18');

  await agents.register('tenant_windows_2008_r2', {
    agentKey: 'windows-2008-r2-agent-reinstalled',
    machineId: 'windows-2008-r2-machine',
    hostname: 'legacy-win2008r2',
    version: '1.0.1',
    osType: 'windows',
    osVersion: 'Windows Server 2008 R2',
    arch: 'amd64',
    ipAddress: '10.33.2.18',
  }, 'request_windows_2008_r2_reinstalled');

  const hosts = await database.query<{ agent_id: string; asset_fingerprint: string; os_version: string; status: string; primary_ip: string }>(
    'select agent_id, asset_fingerprint, os_version, status, primary_ip from pg_hosts where tenant_id = $1 and deleted_at is null',
    ['tenant_windows_2008_r2'],
  );
  assert.equal(hosts.rows.length, 1);
  assert.equal(hosts.rows[0]?.agent_id, registered.id);
  assert.equal(hosts.rows[0]?.asset_fingerprint, 'windows-2008-r2-machine');
  assert.equal(hosts.rows[0]?.os_version, 'Windows Server 2008 R2');
  assert.equal(hosts.rows[0]?.status, 'INACTIVE');
  assert.equal(hosts.rows[0]?.primary_ip, '10.33.2.18');
});

test('Linux Agent 接受带连字符的能力键并从能力快照识别 Nginx 站点', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const agents = new AgentsApplicationService(new PgAgentsRepository(database));
  const registered = await agents.register('tenant_linux_capabilities', {
    agentKey: 'linux-agent',
    machineId: 'linux-machine',
    hostname: 'linux-host',
    version: '0.1.0-dev',
    osType: 'linux',
    osVersion: 'Ubuntu 22.04',
    arch: 'amd64',
    ipAddress: '10.33.2.9',
  }, 'request_linux_register');

  await agents.reportCapabilities('tenant_linux_capabilities', {
    agentId: registered.id,
    compatibilityLevel: 'L1',
    capabilities: [
      { capabilityKey: 'linux.filesystem.posix-atomic.v1', value: true, confidence: 0.95 },
      {
        capabilityKey: 'linux.nginx.detail',
        value: {
          Installed: true,
          Version: '1.24.0',
          Sites: [{
            Name: 'portal.example.com',
            SitePath: '/var/www/portal',
            ServerNames: ['portal.example.com'],
            Bindings: [{
              Address: '0.0.0.0',
              Port: 443,
              Protocol: 'https',
              Certificate: {
                Subject: 'CN=portal.example.com',
                Issuer: 'CN=Test CA',
                FingerprintSHA256: 'a'.repeat(64),
              },
            }],
          }, {
            Name: 'portal.example.com',
            SitePath: '/var/www/portal',
            ServerNames: ['portal.example.com'],
            Bindings: [{ Address: '0.0.0.0', Port: 80, Protocol: 'http' }],
          }],
        },
        confidence: 0.92,
      },
      {
        capabilityKey: 'linux.apache.detail',
        value: {
          Installed: true,
          Sites: [{
            Name: 'apache.example.com',
            SitePath: '/var/www/apache',
            Listen: [{
              Address: '0.0.0.0',
              Port: 8443,
              Protocol: 'https',
              Certificate: {
                Subject: 'CN=apache.example.com',
                FingerprintSHA256: 'b'.repeat(64),
              },
            }],
          }],
        },
        confidence: 0.9,
      },
      {
        capabilityKey: 'linux.tomcat.detail',
        value: {
          Installed: true,
          ConfigPath: '/opt/tomcat/conf/server.xml',
          Connectors: [{
            Address: '*',
            Port: 8445,
            Protocol: 'HTTP/1.1',
            TLS: true,
            Certificate: {
              Subject: 'CN=tomcat.example.com',
              FingerprintSHA256: 'c'.repeat(64),
            },
          }],
        },
        confidence: 0.88,
      },
    ],
  }, 'request_linux_capabilities');

  const detail = await new DevicesApplicationService(new PgDevicesRepository(database), undefined, agents).get(
    'tenant_linux_capabilities',
    registered.id,
  );
  assert.equal(detail.sites[0]?.kind, 'NGINX');
  assert.equal(detail.sites[0]?.name, 'portal.example.com');
  assert.equal(detail.sites[0]?.endpoint?.protocol, 'https');
  assert.equal(detail.sites[0]?.bindings[0]?.certificate?.subject, 'CN=portal.example.com');
  assert.equal(detail.sites.length, 4);
  assert.equal(detail.sites[1]?.endpoint?.protocol, 'http');
  assert.equal(detail.sites.find((site) => site.kind === 'APACHE')?.bindings[0]?.certificate?.subject, 'CN=apache.example.com');
  assert.equal(detail.sites.find((site) => site.kind === 'TOMCAT')?.bindings[0]?.certificate?.subject, 'CN=tomcat.example.com');
});

test('Spec033 统一设备列表聚合 Agent 和 Citrix ADC 且不产生 N+1', async () => {
  const migratedDatabase = new PgliteDatabase();
  await runMigrations(migratedDatabase, 'src/database/migrations');
  const database = new CountingDatabase(migratedDatabase);
  const assets = new PgAssetsRepository(database);
  const devices = new PgDeviceAssetsRepository(database);
  const tenantId = 'tenant_spec033_devices';
  const agentId = 'agent_spec033_devices';
  const heartbeatAt = new Date().toISOString();

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
      status: 'ONLINE',
      updatedAt: '2026-07-22T08:00:00.000Z',
      descriptor: {
        osType: 'WINDOWS',
        version: '1.2.3',
        capabilities: ['certificate.deploy'],
      },
    })],
  );
  await database.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at) values ($1, $2, $3::jsonb, now())`,
    ['agents:heartbeats', `heartbeat:${agentId}`, JSON.stringify({
      id: `heartbeat:${agentId}`,
      tenantId,
      agentId,
      receivedAt: heartbeatAt,
    })],
  );
  await database.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at) values ($1, $2, $3::jsonb, now())`,
    ['agents:snapshots', 'snapshot_spec033_devices', JSON.stringify({
      id: 'snapshot_spec033_devices',
      tenantId,
      agentId,
      reportedAt: '2026-07-22T08:00:00.000Z',
      capabilities: [{
        capabilityKey: 'windows.os.detail',
        value: { ProductName: 'Windows Server 2022', DisplayVersion: '21H2' },
        confidence: 1,
      }],
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
  assert.equal(result.items.find((item) => item.id === host.id)?.softwareVersion, 'Windows Server 2022 21H2');
  assert.equal(result.items.find((item) => item.id === host.id)?.lastContactAt, heartbeatAt);
  assert.equal(result.items.find((item) => item.id === adc.hostId)?.managementMethod, 'PLUGIN');
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

test('Spec033 统一设备列表不展示服务资产已删除的 ADC 残留 Host', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_deleted_adc_projection';
  const device = await new PgDeviceAssetsRepository(database).create(tenantId, {
    displayName: 'ADC 残留投影',
    managementAddress: '10.33.3.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_deleted_adc',
    authMode: 'AUTO',
    tlsVerify: true,
  });
  await database.query(
    `update pg_service_assets set status='DELETED', deleted_at=now() where tenant_id=$1 and id=$2`,
    [tenantId, device.id],
  );
  const result = await new PgDevicesRepository(database).list(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
  });

  assert.equal(result.total, 0);
});

test('Spec033 统一健康状态覆盖五种公共状态且保留详情动作边界', async () => {
  const now = new Date('2026-07-25T08:00:00.000Z');
  assert.equal(mapAgentHealth('online', now.toISOString(), now), 'HEALTHY');
  assert.equal(mapAgentHealth('ONLINE', now.toISOString(), now), 'HEALTHY');
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
  assert.ok(!detail?.allowedActions.includes('device.connection.test'));
  assert.ok(!detail?.allowedActions.includes('UPGRADE_AGENT'));
  assert.equal(detail?.publicSummary.managementMode, 'AGENTLESS');
});

test('Spec033 Citrix ADC 详情返回 Virtual Server、证书和绑定资源', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_adc_detail_resources';
  const device = await new PgDeviceAssetsRepository(database).create(tenantId, {
    displayName: 'ADC Resources', managementAddress: '10.33.4.50', managementPort: 443,
    deviceFamily: 'NETSCALER_ADC', credentialId: 'secret_resources', authMode: 'AUTO', tlsVerify: false,
  });
  await database.query(
    `insert into pg_device_virtual_servers (
      id, tenant_id, device_asset_id, virtual_server_type, virtual_server_name, target_key,
      address, port, protocol, runtime_state, sni_names, status
    ) values ('vs_detail', $1, $2, 'LB', 'lb-detail', 'LB:lb-detail', '10.33.4.60', 443, 'SSL', 'UP', '[]'::jsonb, 'ACTIVE')`,
    [tenantId, device.id],
  );
  await database.query(
    `insert into pg_device_virtual_servers (
      id, tenant_id, device_asset_id, virtual_server_type, virtual_server_name, target_key,
      address, port, protocol, runtime_state, sni_names, status
    ) values ('vs_vpn_detail', $1, $2, 'VPN', 'vpn-detail', 'VPN:vpn-detail', '10.33.4.61', 443, 'SSL', 'UP', '["vpn.example.test"]'::jsonb, 'ACTIVE')`,
    [tenantId, device.id],
  );
  await database.query(
    `insert into pg_certificate_assets (
      id, name, primary_domain, source_type, status, created_by
    ) values ('asset_detail', 'Managed Detail', 'detail.example', 'IMPORTED', 'ACTIVE', 'user_admin')`,
  );
  await database.query(
    `insert into pg_certificate_versions (
      id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, deployable, source_type, status, created_by
    ) values (
      'version_detail', 'asset_detail', 1, 'detail.example', '{"commonName":"issuer"}'::jsonb,
      '{"commonName":"detail.example"}'::jsonb, '01', '2026-01-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z', repeat('a', 64), 'RSA', 'SHA256-RSA',
      'storage://detail', 'COMPLETE', true, 'IMPORTED', 'ACTIVE', 'user_admin'
    )`,
  );
  await database.query(
    `insert into pg_device_certificate_resources (
      id, tenant_id, device_asset_id, certkey_name, subject, issuer, not_before, not_after,
      fingerprint_sha256, source_version
    ) values ('cert_detail', $1, $2, 'cert-detail', 'CN=detail.example', 'CN=issuer',
      '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', repeat('a', 64), '13.1')`,
    [tenantId, device.id],
  );
  await database.query(
    `insert into pg_device_certificate_bindings (
      id, tenant_id, device_asset_id, virtual_server_id, certificate_resource_id, binding_key
    ) values ('binding_detail', $1, $2, 'vs_detail', 'cert_detail', 'LB:lb-detail:cert-detail')`,
    [tenantId, device.id],
  );
  await database.query(
    `insert into pg_device_certificate_bindings (
      id, tenant_id, device_asset_id, virtual_server_id, certificate_resource_id, binding_key
    ) values ('binding_vpn_detail', $1, $2, 'vs_vpn_detail', 'cert_detail', 'VPN:vpn-detail:cert-detail')`,
    [tenantId, device.id],
  );
  await database.query(
    `insert into pg_documents (namespace, document_id, payload)
     values ('security.audit_logs', 'audit_detail', $1::jsonb)`,
    [JSON.stringify({
      eventType: 'device_asset.connection_tested',
      action: 'device_asset.test_connection',
      resourceType: 'device_asset',
      resourceId: device.id,
      result: 'success',
      riskLevel: 'high',
      actorId: 'user_admin',
      createdAt: '2026-07-23T03:00:00.000Z',
    })],
  );

  const detail = await new PgDevicesRepository(database).get(tenantId, device.hostId);
  const extension = detail?.extensionSummary as {
    virtualServers: unknown[];
    certificateResources: unknown[];
    certificateBindings: Array<{
      virtualServerType: string;
      certificateIssuer: string;
      certificateNotBefore: string;
      certificateNotAfter: string;
    }>;
    deviceLogs: Array<{ eventType: string }>;
  };
  assert.equal(extension.virtualServers.length, 2);
  assert.equal(extension.certificateResources.length, 1);
  assert.equal(extension.certificateBindings.length, 2);
  assert.equal(extension.certificateBindings[0]?.virtualServerType, 'LB');
  assert.equal(extension.certificateBindings[0]?.certificateIssuer, 'CN=issuer');
  assert.match(extension.certificateBindings[0]?.certificateNotBefore ?? '', /^2026-01-01/);
  assert.match(extension.certificateBindings[0]?.certificateNotAfter ?? '', /^2027-01-01/);
  assert.equal(extension.deviceLogs[0]?.eventType, 'device_asset.connection_tested');
  assert.equal(detail?.overview.deviceType, 'NETSCALER_ADC');
  assert.equal(detail?.certificates[0]?.issuer, 'CN=issuer');
  assert.equal(detail?.certificates[0]?.certificateAssetId, 'asset_detail');
  assert.equal(detail?.certificates[0]?.certificateVersionId, 'version_detail');
  assert.equal(detail?.sites.find((site) => site.kind === 'LB')?.bindings[0]?.certificate?.name, 'cert-detail');
  assert.equal(detail?.sites.find((site) => site.kind === 'LB')?.bindings[0]?.certificate?.certificateAssetId, 'asset_detail');
  assert.equal(detail?.sites.find((site) => site.kind === 'VPN')?.bindings[0]?.certificate?.issuer, 'CN=issuer');
  assert.match(detail?.sites.find((site) => site.kind === 'VPN')?.bindings[0]?.certificate?.notAfter ?? '', /^2027-01-01/);
  assert.equal(detail?.logs[0]?.eventType, 'device_asset.connection_tested');
});

test('Spec033 平台 Registry 只保留 Agent 安装入口', () => {
  const registry = new DevicePlatformRegistry();
  const platforms = registry.list();
  assert.equal(platforms.length, 3);
  assert.deepEqual(platforms.filter((item) => item.supportStatus === 'SUPPORTED').map((item) => item.key), [
    'windows', 'windows-compatibility', 'linux',
  ]);
  assert.ok(platforms.every((item) => item.onboardingKind === 'AGENT_INSTALL'));
});

test('Spec033 统一添加复用 Agent 会话', async () => {
  const agents = {
    createWindowsPowerShellInstallSession: async () => ({ installCommand: 'install-windows' }),
    createWindowsCompatibilityInstallSession: async () => ({ installCommand: 'install-compatibility' }),
    createLinuxGoInstallSession: async () => ({ installCommand: 'install-linux' }),
  } as unknown as AgentsApplicationService;
  const service = new DevicesApplicationService(new PgDevicesRepository(new PgliteDatabase()), undefined, agents);
  const windows = await service.onboard('tenant-onboarding', {
    platformKey: 'windows', baseUrl: 'https://gcac.example',
  }, 'user-onboarding', 'request-onboarding');
  assert.equal((windows as { installSession: { installCommand: string } }).installSession.installCommand, 'install-windows');
  assert.equal((windows as { installCommand: string }).installCommand, 'install-windows');
});

test('Spec033 统一插件设备接入原子创建设备绑定和能力分配', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_plugin_onboarding';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(database));
  const pluginRoot = resolve('src/modules/plugins/builtin-plugins/citrix-adc');
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'manifest.json'), 'utf8')) as { resources: Record<string, Record<string, string>> };
  const resourcePaths = Object.values(manifest.resources).flatMap((value) => Object.values(value));
  const resources = Object.fromEntries(await Promise.all(resourcePaths.map(async (path) => [path, await readFile(resolve(pluginRoot, path), 'utf8')])));
  const imported = await plugins.importVersion(tenantId, { manifest, resources }, 'BUILTIN');
  await plugins.approvePermissions(imported.id, (manifest as unknown as { permissions: string[] }).permissions);
  await plugins.enableVersion(imported.id);
  await createUsernamePasswordCredential(database, tenantId, 'cred_adc', 'sec_adc');
  const discovery = JSON.parse(await readFile(resolve('../compatibility/fixtures/device-plugins/mock-adc.discovery.json'), 'utf8')) as Record<string, unknown>;
  const executedCapabilities: string[] = [];
  const pluginWorkflows = {
    require: async (pluginVersionId: string, capabilityKey: string) => ({
      pluginVersionId,
      capabilityKey,
      workflowResourcePath: `workflows/${capabilityKey}.json`,
      workflowTemplateId: `template_${capabilityKey}`,
      workflowVersionId: capabilityKey,
      workflowContentSha256: `sha256:${capabilityKey}`,
      createdAt: new Date().toISOString(),
    }),
  } as PluginWorkflowPublisherService;
  const workflows = {
    execute: async ({ templateVersionId }: { templateVersionId: string }): Promise<WorkflowRunResult> => {
      executedCapabilities.push(templateVersionId);
      return {
        id: `run_${templateVersionId}`,
        mode: 'real_test',
        plannedOnly: false,
        status: 'success',
        renderedSteps: [],
        stepResults: templateVersionId === 'device.discover' ? [{
          name: 'normalizeDiscovery',
          type: 'transform',
          status: 'success',
          attempts: 1,
          plan: {},
          extracted: { discovery },
          assertions: [],
          logs: [],
        }] : [],
        rollbackResults: [],
        logs: [],
      };
    },
  } as unknown as WorkflowTemplatesApplicationService;
  const service = new DevicesApplicationService(
    new PgDevicesRepository(database),
    undefined,
    undefined,
    database,
    plugins,
    undefined,
    new PluginBindingsApplicationService(new PluginBindingsRepository(database)),
    pluginWorkflows,
    workflows,
    undefined,
    new StandardDeviceDiscoveryProjector(database),
  );
  const result = await service.onboard(tenantId, {
    platformKey: 'plugin', pluginVersionId: imported.id, formValues: {
      displayName: 'ADC', address: '10.33.5.49', port: 443, authMode: 'NITRO_HEADER',
      credential: 'cred_adc', tlsVerify: true,
    },
  }, 'user_adc', 'request_adc');

  assert.equal(result.onboardingKind, 'PLUGIN_MANAGED');
  if (result.onboardingKind !== 'PLUGIN_MANAGED') assert.fail('应返回插件接入结果');
  assert.equal(result.device.deviceFamily, 'citrix.netscaler-adc');
  assert.equal(result.binding.managedContext?.hostId, result.device.hostId);
  assert.deepEqual(result.binding.inputBindings.credentials.credential, { credentialId: 'cred_adc' });
  assert.equal(result.assignments.length, 6);
  assert.deepEqual(executedCapabilities, ['device.connection.test', 'device.identity.detect', 'device.discover']);
  assert.ok('projection' in result.discovery && result.discovery.projection.certificateBindings === 1);
  assert.ok(!JSON.stringify(result).includes('"password":"'));
  const detail = await service.get(tenantId, result.device.hostId, 'zh-CN');
  assert.equal(detail.extension.type, 'PLUGIN');
  assert.equal(detail.pluginUi?.pluginId, 'citrix.netscaler-adc');
  assert.equal(detail.pluginUi?.source, 'BUILTIN');
  assert.deepEqual(detail.pluginUi?.capabilities, result.assignments.map((item) => item.capabilityKey).sort());
  const actions = (detail.pluginUi?.presentation?.actions ?? []) as Array<{ capabilityKey: string }>;
  assert.ok(actions.every((action) => detail.pluginUi?.capabilities.includes(action.capabilityKey)));
  const snapshots = await database.query<{ count: string }>(
    'select count(*)::text as count from plugin_discovery_snapshots where tenant_id=$1 and device_asset_id=$2',
    [tenantId, result.device.id],
  );
  assert.equal(snapshots.rows[0]?.count, '1');
  const certificateBindings = await database.query<{ count: string }>(
    'select count(*)::text as count from pg_certificate_bindings where tenant_id=$1',
    [tenantId],
  );
  assert.equal(certificateBindings.rows[0]?.count, '1');
  const serviceAsset = await database.query<{ status: string; metadata: Record<string, unknown> }>(
    'select status, metadata from pg_service_assets where tenant_id=$1 and id=$2',
    [tenantId, result.device.id],
  );
  assert.equal(serviceAsset.rows[0]?.status, 'ACTIVE');
  assert.equal(serviceAsset.rows[0]?.metadata.onboardingState, 'ACTIVE');
});

test('Spec033 插件设备接入失败保留设备并写入可恢复状态', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_plugin_onboarding_failed';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(database));
  const pluginRoot = resolve('src/modules/plugins/builtin-plugins/citrix-adc');
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'manifest.json'), 'utf8')) as { resources: Record<string, Record<string, string>>; permissions: string[] };
  const resourcePaths = Object.values(manifest.resources).flatMap((value) => Object.values(value));
  const resources = Object.fromEntries(await Promise.all(resourcePaths.map(async (path) => [path, await readFile(resolve(pluginRoot, path), 'utf8')])));
  const imported = await plugins.importVersion(tenantId, { manifest, resources }, 'BUILTIN');
  await plugins.approvePermissions(imported.id, manifest.permissions);
  await plugins.enableVersion(imported.id);
  await createUsernamePasswordCredential(database, tenantId, 'cred_adc_failed', 'sec_adc_failed');
  const pluginWorkflows = {
    require: async (pluginVersionId: string, capabilityKey: string) => ({
      pluginVersionId,
      capabilityKey,
      workflowResourcePath: `workflows/${capabilityKey}.json`,
      workflowTemplateId: `template_${capabilityKey}`,
      workflowVersionId: capabilityKey,
      workflowContentSha256: `sha256:${capabilityKey}`,
      createdAt: new Date().toISOString(),
    }),
  } as PluginWorkflowPublisherService;
  const workflows = {
    execute: async (): Promise<WorkflowRunResult> => {
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '模拟连接失败');
    },
  } as unknown as WorkflowTemplatesApplicationService;
  const service = new DevicesApplicationService(
    new PgDevicesRepository(database),
    undefined,
    undefined,
    database,
    plugins,
    undefined,
    new PluginBindingsApplicationService(new PluginBindingsRepository(database)),
    pluginWorkflows,
    workflows,
    undefined,
    new StandardDeviceDiscoveryProjector(database),
  );

  await assert.rejects(
    service.onboard(tenantId, {
      platformKey: 'plugin', pluginVersionId: imported.id, formValues: {
        displayName: 'ADC Failed', address: '10.33.5.50', port: 443, authMode: 'NITRO_HEADER',
        credential: 'cred_adc_failed', tlsVerify: true,
      },
    }, 'user_adc', 'request_adc_failed'),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PLUGIN_CAPABILITY_EXECUTION_FAILED',
  );

  const deviceRows = await database.query<{ service_asset_id: string; last_error_code: string }>(
    'select service_asset_id, last_error_code from pg_device_assets where tenant_id=$1',
    [tenantId],
  );
  assert.equal(deviceRows.rows.length, 1);
  assert.equal(deviceRows.rows[0]?.last_error_code, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
  const serviceAsset = await database.query<{ status: string; metadata: Record<string, unknown> }>(
    'select status, metadata from pg_service_assets where tenant_id=$1 and id=$2',
    [tenantId, deviceRows.rows[0]?.service_asset_id],
  );
  assert.equal(serviceAsset.rows[0]?.status, 'UNKNOWN');
  assert.equal(serviceAsset.rows[0]?.metadata.onboardingState, 'FAILED');
  assert.equal(serviceAsset.rows[0]?.metadata.onboardingErrorCode, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
});

test('Spec033 设备资产软删除后不再出现在统一设备列表', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgDeviceAssetsRepository(database);
  const device = await assets.create('tenant_delete_device', {
    displayName: 'ADC Delete', managementAddress: '10.33.5.51', managementPort: 443,
    deviceFamily: 'NETSCALER_ADC', credentialId: 'secret_delete', authMode: 'AUTO', tlsVerify: true,
  });

  await assets.softDelete('tenant_delete_device', device.id);
  const listed = await new PgDevicesRepository(database).list('tenant_delete_device', {
    page: 1, pageSize: 20, filter: {}, sort: { field: 'displayName', direction: 'asc' },
  });
  assert.equal(listed.total, 0);
});

async function createUsernamePasswordCredential(
  database: DatabasePort,
  tenantId: string,
  credentialId: string,
  secretId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await new CredentialsRepository(database).save({
    id: credentialId,
    tenantId,
    name: credentialId,
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    username: 'nsroot',
    secretSlots: { password: `secret://password/${secretId}#current` },
    metadata: {},
    status: 'active',
    version: 1,
    createdBy: 'user_adc',
    createdAt: now,
    updatedAt: now,
  });
}

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
    return this.database.transaction((tx) => work(new CountingDatabase(tx)));
  }

  resetQueryCount(): void {
    this.queryCount = 0;
  }
}
