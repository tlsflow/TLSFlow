import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthorizationFilter, type PageQuery } from '../../common/pagination/pagination.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AgentRegistration } from '../agents/schema/agents.schema.js';
import type { ManagedDeviceSummaryDto } from '../devices/dto/devices.dto.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import { countExpiringCertificateDomains, DashboardApplicationService, deduplicateDashboardAgents } from './application/dashboard.application-service.js';
import { DashboardReadRepository } from './repository/dashboard-read.repository.js';

test('Dashboard Agent 状态过滤历史注册记录，只保留同一主机角色的最新记录', () => {
  const latest = dashboardAgent('agent-current', 'ONLINE', '2026-08-26T19:57:00.000Z', 'jackson-mgt');
  const historical = dashboardAgent('agent-history', 'OFFLINE', '2026-08-26T16:51:00.000Z', 'jackson-mgt');
  const adcs = dashboardAgent('agent-adcs', 'OFFLINE', '2026-08-26T19:58:00.000Z', 'jackson-mgt', 'adcs_agent');

  assert.deepEqual(
    deduplicateDashboardAgents([historical, adcs, latest]).map((agent) => agent.id),
    ['agent-adcs', 'agent-current'],
  );
});

test('Dashboard 读模型在 SQL 层过滤历史 Agent，并让在线计数与状态块一致', async () => {
  const database = new PgliteDatabase();
  try {
    await runMigrations(database, 'src/database/migrations');
    const tenantId = 'tenant-dashboard-read-model';
    const registrations = [
      dashboardAgent('agent-history', 'OFFLINE', '2026-08-26T16:51:00.000Z', 'jackson-mgt'),
      dashboardAgent('agent-current', 'ONLINE', '2026-08-26T19:57:00.000Z', 'jackson-mgt'),
      dashboardAgent('agent-other', 'ONLINE', '2026-08-26T19:58:00.000Z', 'other-host'),
    ];
    for (const registration of registrations) {
      registration.tenantId = tenantId;
      await database.query(
        `insert into pg_documents (namespace, document_id, payload, updated_at)
         values ($1, $2, $3::jsonb, $4::timestamptz)`,
        ['agents:registrations', registration.id, JSON.stringify(registration), registration.updatedAt],
      );
    }
    const unrestricted = { unrestricted: true, empty: false, objectIds: [], dynamicConditions: [] };
    const model = await new DashboardReadRepository(database).load({
      tenantId,
      nowIso: '2026-08-26T20:00:00.000Z',
      authorizations: {
        applicationAssets: unrestricted,
        certificateAssets: unrestricted,
        certificateVersions: unrestricted,
        bindings: unrestricted,
        agents: unrestricted,
        gateways: unrestricted,
        managedDevices: unrestricted,
      },
      includeAudits: false,
    });

    assert.deepEqual(model.agents.map((agent) => agent.id).sort(), ['agent-current', 'agent-other']);
    assert.equal(model.activeAgentCount, 2);

    const restrictedModel = await new DashboardReadRepository(database).load({
      tenantId,
      nowIso: '2026-08-26T20:00:00.000Z',
      authorizations: {
        applicationAssets: unrestricted,
        certificateAssets: unrestricted,
        certificateVersions: unrestricted,
        bindings: unrestricted,
        agents: { unrestricted: false, empty: false, objectIds: ['agent-current'], dynamicConditions: [] },
        gateways: unrestricted,
        managedDevices: unrestricted,
      },
      includeAudits: false,
    });
    assert.deepEqual(restrictedModel.agents.map((agent) => agent.id), ['agent-current']);
    assert.equal(restrictedModel.activeAgentCount, 1);
  } finally {
    await database.close();
  }
});

test('Dashboard 读模型不会在对象权限过滤前截断审计候选', async () => {
  const database = new PgliteDatabase();
  try {
    await runMigrations(database, 'src/database/migrations');
    const tenantId = 'tenant-dashboard-audit-candidates';
    const now = Date.parse('2026-08-26T20:00:00.000Z');
    const noisyLogs = Array.from({ length: 80 }, (_, index) => ({
      id: `audit-unknown-${index}`,
      eventType: 'task.created',
      resourceType: 'task',
      resourceId: `task-${index}`,
      updatedAt: new Date(now - index * 1000).toISOString(),
    }));
    const visibleLog = {
      id: 'audit-visible-login',
      eventType: 'auth.login.success',
      resourceType: 'authSession',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'auth.login',
      result: 'success',
      riskLevel: 'low',
      createdAt: new Date(now - 120_000).toISOString(),
      updatedAt: new Date(now - 120_000).toISOString(),
    };
    for (const log of [...noisyLogs, visibleLog]) {
      await database.query(
        `insert into pg_documents (namespace, document_id, payload, updated_at)
         values ($1, $2, $3::jsonb, $4::timestamptz)`,
        [
          'security.audit_logs',
          log.id,
          JSON.stringify({ ...log, tenantId }),
          log.updatedAt,
        ],
      );
    }

    const unrestricted = { unrestricted: true, empty: false, objectIds: [], dynamicConditions: [] };
    const model = await new DashboardReadRepository(database).load({
      tenantId,
      nowIso: new Date(now).toISOString(),
      authorizations: {
        applicationAssets: unrestricted,
        certificateAssets: unrestricted,
        certificateVersions: unrestricted,
        bindings: unrestricted,
        agents: unrestricted,
        gateways: unrestricted,
        managedDevices: unrestricted,
      },
      includeAudits: true,
    });

    assert.equal(model.auditCandidates.length, 81);
    assert.equal(model.auditCandidates.some((item) => item.id === visibleLog.id), true);
  } finally {
    await database.close();
  }
});

test('Dashboard 读模型以轻量主机摘要加载设备状态块并执行对象授权', async () => {
  const database = new PgliteDatabase();
  try {
    await runMigrations(database, 'src/database/migrations');
    const tenantId = 'tenant-dashboard-managed-devices';
    const nowIso = '2026-08-26T20:00:00.000Z';
    await database.query(
      `insert into pg_hosts (
         id, tenant_id, display_name, hostname, primary_ip, os_type, os_name, os_version,
         discovery_source, agent_id, compatibility_level, management_mode, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      ['host-dashboard-visible', tenantId, 'Dashboard Agent', 'dashboard-host', '10.0.0.20', 'WINDOWS', 'Windows Server', '2022', 'AGENT', 'agent-dashboard-visible', 'FULL', 'AGENT', 'ONLINE'],
    );
    await database.query(
      `insert into pg_documents (namespace, document_id, payload, updated_at)
       values ($1, $2, $3::jsonb, $4::timestamptz)`,
      ['agents:registrations', 'agent-dashboard-visible', JSON.stringify({
        tenantId,
        status: 'ONLINE',
        role: 'full_agent',
        descriptor: { osType: 'WINDOWS', version: '1.2.3' },
      }), nowIso],
    );
    await database.query(
      `insert into pg_documents (namespace, document_id, payload, updated_at)
       values ($1, $2, $3::jsonb, $4::timestamptz)`,
      ['agents:heartbeats', 'heartbeat-dashboard-visible', JSON.stringify({
        tenantId,
        agentId: 'agent-dashboard-visible',
        receivedAt: nowIso,
      }), nowIso],
    );

    const unrestricted = { unrestricted: true, empty: false, objectIds: [], dynamicConditions: [] };
    const baseAuthorizations = {
      applicationAssets: unrestricted,
      certificateAssets: unrestricted,
      certificateVersions: unrestricted,
      bindings: unrestricted,
      agents: unrestricted,
      gateways: unrestricted,
    };
    const repository = new DashboardReadRepository(database);
    const model = await repository.load({
      tenantId,
      nowIso,
      authorizations: { ...baseAuthorizations, managedDevices: unrestricted },
      includeAudits: false,
    });
    assert.equal(model.managedDevices.total, 1);
    assert.deepEqual(model.managedDevices.items.map((item) => item.id), ['host-dashboard-visible']);
    assert.equal(model.managedDevices.items[0]?.health, 'HEALTHY');

    const restrictedModel = await repository.load({
      tenantId,
      nowIso,
      authorizations: {
        ...baseAuthorizations,
        managedDevices: { unrestricted: false, empty: true, objectIds: [], dynamicConditions: [] },
      },
      includeAudits: false,
    });
    assert.equal(restrictedModel.managedDevices.total, 0);
    assert.deepEqual(restrictedModel.managedDevices.items, []);
  } finally {
    await database.close();
  }
});

test('Dashboard 15 天内到期指标排除已过期版本并按域名去重', () => {
  const count = countExpiringCertificateDomains([
    { certificateAssetId: 'asset-a', commonName: 'example.com', notAfter: '2026-08-25T23:00:00.000Z', status: 'active' },
    { certificateAssetId: 'asset-a', commonName: 'example.com', notAfter: '2026-08-30T00:00:00.000Z', status: 'active' },
    { certificateAssetId: 'asset-a', commonName: 'example.com', notAfter: '2026-09-01T00:00:00.000Z', status: 'active' },
    { certificateAssetId: 'asset-b', commonName: 'api.example.com', notAfter: '2026-09-10T00:00:00.000Z', status: 'active' },
    { certificateAssetId: 'asset-c', commonName: 'outside.example.com', notAfter: '2026-09-12T00:00:00.000Z', status: 'active' },
  ], [
    { id: 'asset-a', primaryDomain: 'EXAMPLE.COM' },
    { id: 'asset-b', primaryDomain: 'api.example.com' },
    { id: 'asset-c', primaryDomain: 'outside.example.com' },
  ], '2026-08-26T00:00:00.000Z');

  assert.equal(count, 2);
});

test('Dashboard 聚合只统计和展示有对象权限的资产', async () => {
  const service = createDashboardService({
    service_asset: ['application-visible'],
    certificate_asset: ['certificate-visible'],
    certificate_version: ['certificate-version-visible', 'certificate-version-visible-recent'],
    certificate_binding: ['binding-visible'],
    agent: ['agent-visible'],
    host: ['device-visible'],
    gateway: ['gateway-visible'],
  });

  const overview = await service.getOverview({
    tenantId: 'tenant-1',
    subject: { id: 'user-1', type: 'user', scope: { tenantId: 'tenant-1' } },
  });

  assert.equal(metricValue(overview.metrics, 'applications'), 1);
  assert.equal(metricValue(overview.metrics, 'activeAgents'), 1);
  assert.equal(metricValue(overview.metrics, 'activeGateways'), 1);
  assert.equal(metricValue(overview.metrics, 'managedBindings'), 1);
  assert.equal(metricTargetPath(overview.metrics, 'applications'), '/applications');
  assert.equal(metricTargetPath(overview.metrics, 'validCertificates'), '/certificates?category=valid');
  assert.equal(metricTargetPath(overview.metrics, 'expiringCertificates'), '/certificates?category=expiringSoon');
  assert.equal(metricTargetPath(overview.metrics, 'activeAgents'), '/agents?managementMethod=AGENT&health=HEALTHY');
  assert.equal(metricTargetPath(overview.metrics, 'activeGateways'), '/gateways?status=online');
  assert.deepEqual(overview.certificateStatuses.map((item) => item.certificateAssetId), ['certificate-visible']);
  assert.equal(overview.certificateStatuses[0]?.certificateVersionId, 'certificate-version-visible');
  assert.equal(overview.certificateStatuses[0]?.notAfter, '2026-12-01T00:00:00.000Z');
  assert.deepEqual(statusBlockIds(overview, 'certificates'), ['certificate-visible']);
  assert.deepEqual(statusBlockIds(overview, 'assets'), ['device-visible']);
  assert.deepEqual(statusBlockIds(overview, 'gateways'), ['gateway-visible']);
  assert.deepEqual(statusBlockIds(overview, 'applicationAssets'), ['application-visible']);
  const applicationBlock = overview.statusGroups.find((group) => group.key === 'applicationAssets')?.blocks[0];
  assert.equal(applicationBlock?.details?.type, 'applicationAsset');
  if (applicationBlock?.details?.type === 'applicationAsset') {
    assert.ok((applicationBlock.details.certificateDaysRemaining ?? 0) > 0);
  }
  assert.equal(overview.statusGroups.length, 4);
  assert.deepEqual(overview.statusGroups.map((group) => group.key), ['certificates', 'assets', 'gateways', 'applicationAssets']);
});

test('Dashboard 读模型分支直接使用设备状态摘要生成资产状态块', async () => {
  const service = createDashboardService({ host: ['device-visible'] }, [], true, {
    applicationCount: 0,
    validCertificateCount: 0,
    expiringCertificateCount: 0,
    activeAgentCount: 0,
    activeGatewayCount: 0,
    managedBindingCount: 0,
    applicationAssets: [],
    certificateAssets: [],
    certificateVersions: [],
    bindings: [],
    bindingCountsByVersionId: new Map(),
    agents: [],
    gateways: [],
    gatewayZones: [],
    gatewayReachability: [],
    managedDevices: {
      total: 1,
      items: [managedDevice('device-visible', 'HEALTHY')],
    },
    auditCandidates: [],
  });

  const overview = await service.getOverview({
    tenantId: 'tenant-1',
    subject: { id: 'user-1', type: 'user', scope: { tenantId: 'tenant-1' } },
  });

  assert.deepEqual(statusBlockIds(overview, 'assets'), ['device-visible']);
});

test('Dashboard 不展示没有活跃版本的证书资产', async () => {
  const service = createDashboardService({
    certificate_asset: ['certificate-empty'],
  });

  const overview = await service.getOverview({
    tenantId: 'tenant-1',
    subject: { id: 'user-1', type: 'user', scope: { tenantId: 'tenant-1' } },
  });

  assert.deepEqual(overview.certificateStatuses, []);
  assert.deepEqual(statusBlockIds(overview, 'certificates'), []);
});

test('Dashboard 最近审计对已知对象执行授权，未知对象默认过滤', async () => {
  const service = createDashboardService({
    service_asset: ['application-visible'],
    certificate_asset: ['certificate-visible'],
    certificate_version: ['certificate-version-visible'],
    certificate_binding: ['binding-visible'],
    agent: ['agent-visible'],
    gateway: ['gateway-visible'],
  }, [
    audit('visible-audit', 'service_asset', 'application-visible'),
    audit('hidden-audit', 'service_asset', 'application-hidden'),
    audit('unknown-audit', 'future_object', 'future-object-1'),
    {
      ...audit('login-audit', 'authSession', undefined),
      eventType: 'auth.login.success',
      action: 'auth.login',
    },
  ]);

  const overview = await service.getOverview({
    tenantId: 'tenant-1',
    subject: { id: 'user-1', type: 'user', scope: { tenantId: 'tenant-1' } },
  });

  assert.deepEqual(overview.recentAudits.map((item) => item.id), ['visible-audit', 'login-audit']);
});

test('Dashboard 没有 audit.read 时不返回任何最近审计日志', async () => {
  const service = createDashboardService({}, [
    audit('login-audit', 'authSession'),
    audit('object-audit', 'service_asset', 'application-visible'),
  ], false);

  const overview = await service.getOverview({
    tenantId: 'tenant-1',
    subject: { id: 'user-1', type: 'user', scope: { tenantId: 'tenant-1' } },
  });

  assert.deepEqual(overview.recentAudits, []);
});

function createDashboardService(
  allowedObjectIds: Record<string, string[]>,
  auditLogs: AuditLogEntity[] = [],
  canReadAudit = true,
  readModel?: Record<string, unknown>,
): DashboardApplicationService {
  const objectPermissions = {
    buildAuthorizedQuery: async (_subject: unknown, objectType: string) => {
      const objectIds = allowedObjectIds[objectType] ?? [];
      return { objectIds, empty: objectIds.length === 0, unrestricted: false, dynamicConditions: [] };
    },
    can: async (_subject: unknown, _accessLevel: string, object: { objectType: string; objectId: string }) => ({
      allowed: (allowedObjectIds[object.objectType] ?? []).includes(object.objectId),
      accessLevel: 'read',
      action: `${object.objectType}.read`,
      reason: 'test',
      matchedBindings: [],
      matchedObjectSets: [],
      matchedActions: [],
      requiresApproval: false,
    }),
  };

  const assets = [
    asset('application-visible', 'ACTIVE'),
    asset('application-hidden', 'UNREACHABLE'),
  ];
  const certificateAssets = [
    certificateAsset('certificate-visible', 'certificate-version-visible-recent'),
    certificateAsset('certificate-hidden', 'certificate-version-hidden'),
    certificateAsset('certificate-empty', ''),
  ];
  const certificateVersions = [
    {
      ...certificateVersion('certificate-version-visible', 'certificate-visible'),
      notAfter: '2026-12-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    {
      ...certificateVersion('certificate-version-visible-recent', 'certificate-visible'),
      notAfter: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-08-12T00:00:00.000Z',
    },
    certificateVersion('certificate-version-hidden', 'certificate-hidden'),
  ];
  const bindings = [
    binding('binding-visible', 'certificate-version-visible'),
    binding('binding-hidden', 'certificate-version-hidden'),
  ];
  const agents = [
    agent('agent-visible', 'ONLINE'),
    agent('agent-hidden', 'OFFLINE'),
  ];
  const devices = [
    managedDevice('device-visible', 'HEALTHY'),
    managedDevice('device-hidden', 'UNREACHABLE'),
  ];
  const gateways = [
    gateway('gateway-visible', 'online'),
    gateway('gateway-hidden', 'offline'),
  ];

  return new DashboardApplicationService({
    assets: {
      listServiceAssets: async (_tenantId: string, query: PageQuery) => authorizedPage(assets, query),
    },
    certificates: {
      listAssets: async (query: PageQuery) => authorizedPage(certificateAssets, query),
      listVersions: async (query: PageQuery) => authorizedPage(certificateVersions, query),
    },
    bindings: {
      listCertificateBindings: async (_tenantId: string, query: PageQuery) => authorizedPage(bindings, query),
    },
    agents: {
      listRegistrations: async (_tenantId: string, query: PageQuery) => authorizedPage(agents, query),
    },
    devices: {
      list: async (_tenantId: string, query: { authorizedHostIds?: string[]; pageSize?: number }) => {
        if (readModel) throw new Error('仪表盘读模型不应调用设备列表投影');
        const visible = query.authorizedHostIds
          ? devices.filter((item) => query.authorizedHostIds?.includes(item.id))
          : devices;
        return { page: 1, pageSize: query.pageSize ?? visible.length, total: visible.length, items: visible };
      },
    },
    gateways: {
      listGateways: async (_tenantId: string, query: PageQuery) => authorizedPage(gateways, query),
      ensureSchema: async () => undefined,
    },
    audit: {
      query: async () => auditLogs,
    },
    deploymentPlans: {} as never,
    objectPermissions: objectPermissions as never,
    canReadAudit: async () => canReadAudit,
    readRepository: readModel
      ? { load: async () => readModel } as never
      : undefined,
  } as never);
}

function authorizedPage<T extends object>(items: T[], query: PageQuery) {
  const filtered = applyAuthorizationFilter(items, { ...query });
  return { page: 1, pageSize: filtered.length, total: filtered.length, items: filtered };
}

function metricValue(metrics: Array<{ key: string; value: number }>, key: string): number {
  return metrics.find((metric) => metric.key === key)?.value ?? -1;
}

function metricTargetPath(metrics: Array<{ key: string; targetPath?: string }>, key: string): string {
  return metrics.find((metric) => metric.key === key)?.targetPath ?? '';
}

function statusBlockIds(overview: { statusGroups: Array<{ key: string; blocks: Array<{ id: string }> }> }, key: string): string[] {
  return overview.statusGroups.find((group) => group.key === key)?.blocks.map((block) => block.id) ?? [];
}

function asset(id: string, status: string) {
  return {
    id,
    tenantId: 'tenant-1',
    displayName: id,
    address: `${id}.example.test`,
    port: 443,
    protocol: 'HTTPS',
    status,
    updatedAt: '2026-08-07T00:00:00.000Z',
    lastDiscoveredAt: '2026-08-07T00:00:00.000Z',
    currentCertificate: status === 'ACTIVE' ? { notAfter: '2026-09-01T00:00:00.000Z' } : undefined,
  };
}

function certificateAsset(id: string, currentVersionId: string) {
  return {
    id,
    tenantId: 'tenant-1',
    name: id,
    primaryDomain: `${id}.example.test`,
    currentVersionId,
    status: 'active',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}

function certificateVersion(id: string, certificateAssetId: string) {
  return {
    id,
    tenantId: 'tenant-1',
    certificateAssetId,
    versionNo: 1,
    commonName: `${id}.example.test`,
    sans: [],
    notBefore: '2026-08-01T00:00:00.000Z',
    notAfter: '2026-09-01T00:00:00.000Z',
    status: 'active',
    chainStatus: 'valid',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}

function binding(id: string, certificateVersionId: string) {
  return {
    id,
    tenantId: 'tenant-1',
    certificateVersionId,
    serviceAssetId: 'application-visible',
    serviceInstanceId: 'service-instance-1',
    bindingKey: id,
    bindingType: 'FILE_PATH',
    verifyMethod: 'TLS_CONNECT',
    status: 'MANAGED',
    metadata: {},
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    version: 1,
  };
}

function agent(id: string, status: string) {
  return {
    id,
    tenantId: 'tenant-1',
    descriptor: { hostname: id },
    status,
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}

function managedDevice(id: string, health: ManagedDeviceSummaryDto['health']): ManagedDeviceSummaryDto {
  return {
    id,
    displayName: id,
    category: 'SERVER',
    productFamily: 'Windows',
    managementMethod: 'AGENT',
    managementAddress: `${id}.example.test`,
    livenessStatus: health === 'HEALTHY' ? 'ONLINE' : 'OFFLINE',
    healthStatus: health,
    health,
    sourceStatus: health,
    softwareVersion: '1.0.0',
    controlVersion: '1.0.0',
    lastContactAt: '2026-08-07T00:00:00.000Z',
    applicationAssetCount: 0,
    capabilities: [],
    extensionType: 'AGENT',
    agentId: id,
    agentRole: 'full_agent',
  };
}

function dashboardAgent(id: string, status: string, updatedAt: string, hostname: string, role?: string) {
  return {
    id,
    tenantId: 'tenant-1',
    agentKey: `${id}-key`,
    descriptor: {
      agentKey: `${id}-key`,
      hostname,
      version: '1.0.0',
      osType: 'WINDOWS',
      labels: [],
    },
    role,
    status,
    registeredAt: updatedAt,
    updatedAt,
    version: 1,
  } as AgentRegistration;
}

function gateway(id: string, status: string) {
  return {
    id,
    tenantId: 'tenant-1',
    agentId: `agent-${id}`,
    status,
    updatedAt: '2026-08-07T00:00:00.000Z',
    lastHeartbeatAt: '2026-08-07T00:00:00.000Z',
  };
}

function audit(id: string, resourceType: string, resourceId?: string): AuditLogEntity {
  return {
    id,
    eventType: 'service_asset.updated',
    actorType: 'user',
    actorId: 'user-1',
    action: 'service_asset.manage',
    resourceType,
    resourceId,
    result: 'success',
    riskLevel: 'medium',
    createdAt: '2026-08-07T00:00:00.000Z',
  };
}
