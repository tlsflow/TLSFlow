import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthorizationFilter, type PageQuery } from '../../common/pagination/pagination.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import { DashboardApplicationService } from './application/dashboard.application-service.js';

test('Dashboard 聚合只统计和展示有对象权限的资产', async () => {
  const service = createDashboardService({
    service_asset: ['application-visible'],
    certificate_asset: ['certificate-visible'],
    certificate_version: ['certificate-version-visible'],
    certificate_binding: ['binding-visible'],
    agent: ['agent-visible'],
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
  assert.deepEqual(overview.certificateStatuses.map((item) => item.certificateAssetId), ['certificate-visible']);
  assert.deepEqual(statusBlockIds(overview, 'applicationAssets'), ['application-visible']);
  assert.deepEqual(statusBlockIds(overview, 'agents'), ['agent-visible']);
  assert.deepEqual(statusBlockIds(overview, 'gateways'), ['gateway-visible']);
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

function createDashboardService(
  allowedObjectIds: Record<string, string[]>,
  auditLogs: AuditLogEntity[] = [],
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
    certificateAsset('certificate-visible', 'certificate-version-visible'),
    certificateAsset('certificate-hidden', 'certificate-version-hidden'),
  ];
  const certificateVersions = [
    certificateVersion('certificate-version-visible', 'certificate-visible'),
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
    gateways: {
      listGateways: async (_tenantId: string, query: PageQuery) => authorizedPage(gateways, query),
    },
    audit: {
      query: async () => auditLogs,
    },
    deploymentPlans: {} as never,
    objectPermissions: objectPermissions as never,
  } as never);
}

function authorizedPage<T extends object>(items: T[], query: PageQuery) {
  const filtered = applyAuthorizationFilter(items, { ...query });
  return { page: 1, pageSize: filtered.length, total: filtered.length, items: filtered };
}

function metricValue(metrics: Array<{ key: string; value: number }>, key: string): number {
  return metrics.find((metric) => metric.key === key)?.value ?? -1;
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
