import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AuditService } from '../../audits/audit.service.js';
import { isSuppressedAudit } from '../../audits/audit-event-types.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AgentsRepository } from '../../agents/repository/agents.repository.js';
import type { GatewaysRepository } from '../../gateways/repository/gateways.repository.js';
import type { AuditLogEntity } from '../../../persistence/entities/audit-log.entity.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import { buildAuditPresentationContext, emptyAuditPresentationContext, presentAuditLog, type AuditPresentationContext } from '../../audits/audit-presentation.service.js';
import type { CertificateAssetEntity, CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { ObjectPermissionService } from '../../security/object-permission.service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { DashboardCertificateState, DashboardCertificateStatusItem, DashboardMetric, DashboardOverview, DashboardQuickAction, DashboardStatusBlock, DashboardStatusGroup, DashboardStatusTone } from '../schema/dashboard.schema.js';
import { readDashboardSystemResources } from '../system-resources.js';
import type { DashboardReadRepository } from '../repository/dashboard-read.repository.js';

export interface DashboardApplicationDependencies {
  assets: Pick<AssetsApplicationService, 'listServiceAssets'>;
  certificates: CertificatesRepository;
  bindings: BindingsRepository;
  agents: AgentsRepository;
  gateways: GatewaysRepository;
  audit: AuditService;
  secrets?: SecretService;
  deploymentPlans: DeploymentPlansRepository;
  objectPermissions: ObjectPermissionService;
  canReadAudit: (subject: SecuritySubject, tenantId: string) => Promise<boolean>;
  readRepository?: DashboardReadRepository;
}

const DASHBOARD_AUDIT_LIMIT = 8;

export class DashboardApplicationService {
  constructor(private readonly dependencies: DashboardApplicationDependencies) {}

  async getOverview(input: { tenantId: string; subject: SecuritySubject }): Promise<DashboardOverview> {
    const generatedAt = new Date().toISOString();
    const canReadAudit = await this.dependencies.canReadAudit(input.subject, input.tenantId);
    const [applicationAuthorization, certificateAuthorization, certificateVersionAuthorization, bindingAuthorization, agentAuthorization, gatewayAuthorization] = await Promise.all([
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'service_asset', 'read'),
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'certificate_asset', 'read'),
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'certificate_version', 'read'),
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'certificate_binding', 'read'),
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'agent', 'read'),
      this.dependencies.objectPermissions.buildAuthorizedQuery(input.subject, 'gateway', 'read'),
    ]);
    if (this.dependencies.readRepository) {
      return this.getOverviewFromReadModel({
        input,
        generatedAt,
        canReadAudit,
        authorizations: {
          applicationAssets: applicationAuthorization,
          certificateAssets: certificateAuthorization,
          certificateVersions: certificateVersionAuthorization,
          bindings: bindingAuthorization,
          agents: agentAuthorization,
          gateways: gatewayAuthorization,
        },
      });
    }
    const [
      applicationAssets,
      certificateAssets,
      certificateVersions,
      bindings,
      agents,
      gateways,
      gatewayZones,
      gatewayReachability,
      auditLogs,
    ] = await Promise.all([
      this.dependencies.assets.listServiceAssets(input.tenantId, allRowsQuery('updatedAt:desc', applicationAuthorization)),
      this.dependencies.certificates.listAssets(allRowsQuery('updatedAt:desc', certificateAuthorization), input.tenantId),
      this.dependencies.certificates.listVersions(allRowsQuery('notAfter:asc', certificateVersionAuthorization), input.tenantId),
      this.dependencies.bindings.listCertificateBindings(input.tenantId, allRowsQuery('updatedAt:desc', bindingAuthorization)),
      this.dependencies.agents.listRegistrations(input.tenantId, allRowsQuery('updatedAt:desc', agentAuthorization)),
      this.dependencies.gateways.listGateways(input.tenantId, allRowsQuery('updatedAt:desc', gatewayAuthorization)),
      this.dependencies.gateways.listZones ? this.dependencies.gateways.listZones(input.tenantId) : Promise.resolve([]),
      this.dependencies.gateways.listReachability ? this.dependencies.gateways.listReachability(input.tenantId) : Promise.resolve([]),
      canReadAudit
        ? this.dependencies.audit.query({ resourceScope: { tenantId: input.tenantId } })
        : Promise.resolve([]),
    ]);
    const authorizedAuditLogs = canReadAudit
      ? await filterDashboardAuditLogs(this.dependencies.objectPermissions, input.subject, auditLogs)
      : [];

    const activeCertificateVersions = certificateVersions.items.filter((version) => version.status === 'active');
    const validCertificateCount = activeCertificateVersions.filter((version) => isAfter(version.notAfter, generatedAt)).length;
    const expiringCertificateCount = countExpiringCertificateDomains(activeCertificateVersions, certificateAssets.items, generatedAt);
    const certificateStatuses = buildCertificateStatuses({
      assets: certificateAssets.items,
      versions: certificateVersions.items,
      bindingCountByVersionId: countBindingsByVersionId(bindings.items),
      nowIso: generatedAt,
    });
    const auditContext = await buildAuditPresentationContext({
      tenantId: input.tenantId,
      auditLogs: authorizedAuditLogs,
      deploymentPlans: this.dependencies.deploymentPlans,
      applicationAssets: applicationAssets.items,
      bindings: bindings.items,
      secrets: this.dependencies.secrets,
      certificates: this.dependencies.certificates,
    });

    return {
      generatedAt,
      systemResources: this.getSystemResources(),
      metrics: buildMetrics({
        applicationCount: applicationAssets.total,
        validCertificateCount,
        expiringCertificateCount,
        activeAgentCount: agents.items.filter((agent) => agent.status === 'ONLINE').length,
        activeGatewayCount: gateways.items.filter((gateway) => gateway.status === 'online').length,
        managedBindingCount: bindings.items.filter((binding) => binding.status === 'MANAGED').length,
      }),
      quickActions: quickActions(),
      certificateStatuses,
      statusGroups: buildStatusGroups({
        applicationAssets: applicationAssets.items,
        certificateStatuses,
        agents: agents.items,
        gateways: gateways.items,
        gatewayZones,
        gatewayReachability,
        nowIso: generatedAt,
      }),
      recentAudits: buildRecentDashboardAudits(authorizedAuditLogs, auditContext),
    };
  }

  getSystemResources(): DashboardOverview['systemResources'] {
    return readDashboardSystemResources();
  }

  private async getOverviewFromReadModel(input: {
    input: { tenantId: string; subject: SecuritySubject };
    generatedAt: string;
    canReadAudit: boolean;
    authorizations: Parameters<DashboardReadRepository['load']>[0]['authorizations'];
  }): Promise<DashboardOverview> {
    await this.dependencies.gateways.ensureSchema();
    const model = await this.dependencies.readRepository!.load({
      tenantId: input.input.tenantId,
      nowIso: input.generatedAt,
      authorizations: input.authorizations,
      includeAudits: input.canReadAudit,
    });
    const authorizedAuditLogs = input.canReadAudit
      ? await filterDashboardAuditLogs(this.dependencies.objectPermissions, input.input.subject, model.auditCandidates)
      : [];
    const certificateStatuses = buildCertificateStatuses({
      assets: model.certificateAssets,
      versions: model.certificateVersions,
      bindingCountByVersionId: model.bindingCountsByVersionId,
      nowIso: input.generatedAt,
    });
    const auditContext = await buildAuditPresentationContext({
      tenantId: input.input.tenantId,
      auditLogs: authorizedAuditLogs,
      deploymentPlans: this.dependencies.deploymentPlans,
      applicationAssets: model.applicationAssets,
      bindings: model.bindings,
      secrets: this.dependencies.secrets,
      certificates: this.dependencies.certificates,
    });

    return {
      generatedAt: input.generatedAt,
      systemResources: this.getSystemResources(),
      metrics: buildMetrics({
        applicationCount: model.applicationCount,
        validCertificateCount: model.validCertificateCount,
        expiringCertificateCount: model.expiringCertificateCount,
        activeAgentCount: model.activeAgentCount,
        activeGatewayCount: model.activeGatewayCount,
        managedBindingCount: model.managedBindingCount,
      }),
      quickActions: quickActions(),
      certificateStatuses,
      statusGroups: buildStatusGroups({
        applicationAssets: model.applicationAssets,
        certificateStatuses,
        agents: model.agents,
        gateways: model.gateways,
        gatewayZones: model.gatewayZones,
        gatewayReachability: model.gatewayReachability,
        nowIso: input.generatedAt,
      }),
      recentAudits: buildRecentDashboardAudits(authorizedAuditLogs, auditContext),
    };
  }
}

export function buildRecentDashboardAudits(auditLogs: AuditLogEntity[], context: AuditPresentationContext = emptyAuditPresentationContext()): DashboardOverview['recentAudits'] {
  return selectDashboardAuditLogs(auditLogs
    .filter(shouldShowOnDashboardAudits)
    .slice())
    .map((log) => {
      const presented = presentAuditLog(log, context);
      return {
        id: presented.id,
        eventType: presented.eventType,
        actorType: presented.actorType,
        actorId: presented.actorId,
        action: presented.action,
        resourceType: presented.resourceType,
        resourceId: presented.resourceId,
        result: presented.result,
        riskLevel: presented.riskLevel,
        requestId: presented.requestId,
        detail: presented.detail,
        presentation: presented.presentation,
        createdAt: presented.createdAt,
      };
    });
}

export function countExpiringCertificateDomains(
  versions: ReadonlyArray<Pick<CertificateVersionEntity, 'certificateAssetId' | 'commonName' | 'notAfter' | 'status'>>,
  assets: ReadonlyArray<Pick<CertificateAssetEntity, 'id' | 'primaryDomain'>>,
  nowIso: string,
): number {
  const domainByAssetId = new Map(assets.map((asset) => [asset.id, normalizeDomain(asset.primaryDomain)]));
  const expiringDomains = new Set<string>();

  for (const version of versions) {
    if (version.status !== 'active' || !isAfter(version.notAfter, nowIso)) continue;
    if (daysUntil(version.notAfter, nowIso) > CERTIFICATE_WARNING_DAYS) continue;
    const domain = domainByAssetId.get(version.certificateAssetId) || normalizeDomain(version.commonName);
    if (domain) expiringDomains.add(domain);
  }

  return expiringDomains.size;
}

function selectDashboardAuditLogs(logs: AuditLogEntity[]): AuditLogEntity[] {
  const selected: AuditLogEntity[] = [];
  const selectedIds = new Set<string>();
  const selectedGroups = new Set<string>();
  const byPriority = logs.slice().sort(compareDashboardAuditPriority);
  const byTime = logs.slice().sort(compareTimeDescByCreatedAt);

  for (const log of byPriority) {
    if (selected.length >= Math.min(4, DASHBOARD_AUDIT_LIMIT)) break;
    trySelectDashboardAudit(log, selected, selectedIds, selectedGroups, false);
  }
  for (const log of byTime) {
    if (selected.length >= DASHBOARD_AUDIT_LIMIT) break;
    trySelectDashboardAudit(log, selected, selectedIds, selectedGroups, false);
  }
  for (const log of byTime) {
    if (selected.length >= DASHBOARD_AUDIT_LIMIT) break;
    trySelectDashboardAudit(log, selected, selectedIds, selectedGroups, true);
  }

  return selected.sort(compareTimeDescByCreatedAt);
}

function trySelectDashboardAudit(
  log: AuditLogEntity,
  selected: AuditLogEntity[],
  selectedIds: Set<string>,
  selectedGroups: Set<string>,
  allowSameGroup: boolean,
): void {
  if (selectedIds.has(log.id)) return;
  const group = dashboardAuditDiversityKey(log);
  if (!allowSameGroup && selectedGroups.has(group)) return;
  selectedIds.add(log.id);
  selectedGroups.add(group);
  selected.push(log);
}

function dashboardAuditDiversityKey(log: AuditLogEntity): string {
  return [log.eventType, log.action, log.resourceType, log.result].join('|');
}

function shouldShowOnDashboardAudits(log: AuditLogEntity): boolean {
  return !isSuccessfulSecretHealthCheck(log) && !isSuppressedAudit(log);
}

function compareDashboardAuditPriority(left: AuditLogEntity, right: AuditLogEntity): number {
  const priorityDiff = dashboardAuditPriority(right) - dashboardAuditPriority(left);
  if (priorityDiff !== 0) return priorityDiff;
  return compareTimeDescByCreatedAt(left, right);
}

function compareTimeDescByCreatedAt(left: AuditLogEntity, right: AuditLogEntity): number {
  return compareTimeDesc(left.createdAt, right.createdAt);
}

function dashboardAuditPriority(log: AuditLogEntity): number {
  let score = 0;
  if (log.result === 'denied') score += 1200;
  if (log.result === 'failure') score += 1100;
  if (log.actorType === 'user') score += 500;
  if (log.riskLevel === 'critical') score += 450;
  if (log.riskLevel === 'high') score += 320;
  if (log.riskLevel === 'medium') score += 80;
  if (isKeyBusinessAudit(log)) score += 260;
  if (isNonHealthCheckSecretRead(log)) score += 240;
  if (isChangeAudit(log)) score += 140;
  return score;
}

function isSuccessfulSecretHealthCheck(log: AuditLogEntity): boolean {
  return log.eventType === 'secret.used'
    && log.result === 'success'
    && readDetailString(log.detail, 'purpose') === 'secret.health_check';
}

function isNonHealthCheckSecretRead(log: AuditLogEntity): boolean {
  return log.eventType === 'secret.used'
    && readDetailString(log.detail, 'purpose') !== 'secret.health_check';
}

function isKeyBusinessAudit(log: AuditLogEntity): boolean {
  return startsWithAny(log.eventType, ['deployment.', 'approval.', 'certificate.', 'permission.', 'security.'])
    || startsWithAny(log.action, ['deployment.', 'approval.', 'certificate.', 'permission.', 'security.'])
    || startsWithAny(log.resourceType, ['deployment', 'approval', 'certificate', 'permission', 'security']);
}

function isChangeAudit(log: AuditLogEntity): boolean {
  return /(?:^|\.)(create|created|update|updated|delete|deleted|execute|executed|approve|approved|reject|rejected|rotate|rotated|import|imported|rollback|sync|synced)(?:\.|$)/.test(`${log.action}.${log.eventType}`);
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function readDetailString(detail: unknown, key: string): string | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

async function filterDashboardAuditLogs(
  objectPermissions: ObjectPermissionService,
  subject: SecuritySubject,
  logs: AuditLogEntity[],
): Promise<AuditLogEntity[]> {
  const filtered = await Promise.all(logs.map(async (log) => {
    if (!log.resourceId) {
      return log;
    }
    const objectType = dashboardAuditObjectType(log.resourceType);
    // 带对象 ID 但无法映射对象类型时不能凭租户范围放行，避免未知对象绕过对象授权。
    if (!objectType) return undefined;
    const object = {
      objectType,
      objectId: log.resourceId,
      tenantId: subject.scope?.tenantId,
    };
    const permissionService = objectPermissions as ObjectPermissionService & {
      isAllowed?: (
        subject: SecuritySubject,
        accessLevel: 'read',
        object: { objectType: string; objectId: string; tenantId?: string },
      ) => Promise<boolean>;
    };
    const allowed = permissionService.isAllowed
      ? await permissionService.isAllowed(subject, 'read', object)
      : (await objectPermissions.can(subject, 'read', object)).allowed;
    return allowed ? log : undefined;
  }));
  return filtered.filter((log): log is AuditLogEntity => Boolean(log));
}

function dashboardAuditObjectType(resourceType: string): string | undefined {
  const aliases: Record<string, string> = {
    certificate: 'certificate_asset',
    certificate_version: 'certificate_version',
    certificate_version_format: 'certificate_version_format',
    deployment_plan: 'deployment_plan',
    executionRun: 'execution_run',
    execution_run: 'execution_run',
    approval: 'approval',
    plugin: 'plugin_version',
    plugin_version: 'plugin_version',
    workflow: 'workflow',
    workflow_template: 'workflow',
    gateway: 'gateway',
    agent: 'agent',
    service_asset: 'service_asset',
    application_asset: 'application_asset',
    binding: 'certificate_binding',
    certificate_binding: 'certificate_binding',
    secret: 'secret',
    secret_version: 'secret',
  };
  return aliases[resourceType];
}

function buildStatusGroups(input: {
  applicationAssets: Array<{ id: string; displayName?: string; address: string; port: number; protocol: string; platform?: string; status: string; updatedAt?: string; lastDiscoveredAt?: string; currentCertificate?: { notAfter?: string } }>;
  certificateStatuses: DashboardCertificateStatusItem[];
  agents: Array<{ id: string; descriptor: { hostname: string; version: string; managementEndpoint?: string }; status: string; updatedAt: string }>;
  gateways: Array<{ id: string; agentId: string; zoneIds: string[]; status: string; updatedAt: string; lastHeartbeatAt?: string }>;
  gatewayZones: Array<{ id: string; name: string }>;
  gatewayReachability: Array<{ gatewayId: string; latencyMs?: number; checkedAt: string }>;
  nowIso: string;
}): DashboardStatusGroup[] {
  const certificateBlocks = input.certificateStatuses.map((item): DashboardStatusBlock => ({
    id: item.certificateAssetId,
    label: item.primaryDomain || item.name,
    status: certificateStateLabel(item.state),
    tone: certificateTone(item.state),
    detail: item.notAfter ? `${item.name}，剩余 ${item.daysRemaining ?? '未知'} 天` : item.name,
    details: { type: 'certificate', name: item.name, issuer: item.issuer, notBefore: item.notBefore, notAfter: item.notAfter, daysRemaining: item.daysRemaining },
    updatedAt: item.updatedAt,
    targetPath: `/certificates?certificateAssetId=${encodeURIComponent(item.certificateAssetId)}`,
  }));

  const agentBlocks = input.agents.map((agent): DashboardStatusBlock => ({
    id: agent.id,
    label: agent.descriptor.hostname || agent.id,
    status: agent.status,
    tone: agentTone(agent.status),
    detail: `Agent ${agent.id}`,
    details: {
      type: 'device',
      name: agent.descriptor.hostname || agent.id,
      connectionStatus: agent.status,
      version: agent.descriptor.version,
      managementAddress: agent.descriptor.managementEndpoint,
      lastCommunicationAt: isoOrUndefined(agent.updatedAt),
    },
    updatedAt: isoOrUndefined(agent.updatedAt),
    targetPath: `/agents?agentId=${encodeURIComponent(agent.id)}`,
  }));

  const zoneNameById = new Map(input.gatewayZones.map((zone) => [zone.id, zone.name]));
  const latestReachabilityByGatewayId = new Map<string, { latencyMs?: number; checkedAt: string }>();
  for (const reachability of input.gatewayReachability) {
    const current = latestReachabilityByGatewayId.get(reachability.gatewayId);
    if (!current || compareTimeDesc(reachability.checkedAt, current.checkedAt) < 0) {
      latestReachabilityByGatewayId.set(reachability.gatewayId, reachability);
    }
  }
  const gatewayBlocks = input.gateways.map((gateway): DashboardStatusBlock => ({
    id: gateway.id,
    label: gateway.agentId || gateway.id,
    status: gateway.status,
    tone: gatewayTone(gateway.status),
    detail: `Gateway ${gateway.id}`,
    details: {
      type: 'gateway',
      name: gateway.agentId || gateway.id,
      region: (gateway.zoneIds ?? []).map((zoneId) => zoneNameById.get(zoneId) ?? zoneId).join(', ') || undefined,
      latencyMs: latestReachabilityByGatewayId.get(gateway.id)?.latencyMs,
    },
    updatedAt: isoOrUndefined(gateway.lastHeartbeatAt ?? gateway.updatedAt),
    targetPath: `/gateways?gatewayId=${encodeURIComponent(gateway.id)}`,
  }));

  const assetBlocks = input.applicationAssets.map((asset): DashboardStatusBlock => ({
    id: asset.id,
    label: asset.displayName || `${asset.address}:${asset.port}`,
    status: asset.status,
    tone: assetTone(asset.status),
    detail: `${asset.protocol} ${asset.address}:${asset.port}`,
    details: {
      type: 'applicationAsset',
      name: asset.displayName || `${asset.address}:${asset.port}`,
      platform: asset.platform,
      protocolPort: `${asset.protocol} ${asset.address}:${asset.port}`,
      certificateDaysRemaining: asset.currentCertificate?.notAfter
        ? daysUntil(asset.currentCertificate.notAfter, input.nowIso)
        : undefined,
    },
    updatedAt: isoOrUndefined(asset.lastDiscoveredAt ?? asset.updatedAt),
    targetPath: `/applications?serviceAssetId=${encodeURIComponent(asset.id)}`,
  }));

  return [
    makeStatusGroup('certificates', '证书', certificateBlocks),
    makeStatusGroup('agents', 'Agent', agentBlocks),
    makeStatusGroup('gateways', '网关', gatewayBlocks),
    makeStatusGroup('applicationAssets', '应用资产', assetBlocks),
  ];
}

function makeStatusGroup(key: string, title: string, blocks: DashboardStatusBlock[]): DashboardStatusGroup {
  const sorted = blocks.slice().sort(compareStatusBlock);
  const abnormalCount = sorted.filter((block) => block.tone === 'warning' || block.tone === 'error' || block.tone === 'unknown').length;
  return {
    key,
    title,
    summary: abnormalCount > 0 ? `${abnormalCount} 个需要关注` : '全部正常',
    total: blocks.length,
    blocks: sorted.slice(0, 80),
  };
}

function compareStatusBlock(left: DashboardStatusBlock, right: DashboardStatusBlock): number {
  const weight: Record<DashboardStatusTone, number> = {
    error: 0,
    warning: 1,
    unknown: 2,
    disabled: 3,
    ok: 4,
  };
  const toneDiff = weight[left.tone] - weight[right.tone];
  if (toneDiff !== 0) return toneDiff;
  return compareTimeDesc(left.updatedAt, right.updatedAt);
}

function buildMetrics(input: {
  applicationCount: number;
  validCertificateCount: number;
  expiringCertificateCount: number;
  activeAgentCount: number;
  activeGatewayCount: number;
  managedBindingCount: number;
}): DashboardMetric[] {
  return [
    { key: 'applications', title: '当前应用数量', value: input.applicationCount, description: '已纳管的应用入口资产。', trend: 'neutral', targetPath: '/applications' },
    { key: 'validCertificates', title: '活跃证书数量', value: input.validCertificateCount, description: '状态活跃且尚未过期的证书版本。', trend: 'good', targetPath: '/certificates?category=valid' },
    { key: 'expiringCertificates', title: '15 天内到期证书', value: input.expiringCertificateCount, description: '需要安排续期或替换的证书。', trend: input.expiringCertificateCount > 0 ? 'warning' : 'good', targetPath: '/certificates?category=expiringSoon' },
    { key: 'activeAgents', title: '活跃 Agent 数量', value: input.activeAgentCount, description: '当前在线并可调度的 Agent。', trend: 'good', targetPath: '/agents?managementMethod=AGENT&health=HEALTHY' },
    { key: 'activeGateways', title: '活跃网关数量', value: input.activeGatewayCount, description: '当前在线的隔离区网关。', trend: 'good', targetPath: '/gateways?status=online' },
    { key: 'managedBindings', title: '托管绑定数量', value: input.managedBindingCount, description: '已进入托管状态的证书绑定。', trend: 'neutral' },
  ];
}

function quickActions(): DashboardQuickAction[] {
  return [
    { key: 'certificates', title: '证书管理', description: '导入、查看和转换证书。', path: '/certificates', permission: 'certificate.asset.read' },
    { key: 'assets', title: '应用资产', description: '维护域名、端口和部署目标。', path: '/applications', permission: 'service_asset.read' },
    { key: 'agents', title: '应用资产', description: '查看 Agent 管理的应用资产及其部署状态。', path: '/agents', permission: 'agent.read' },
    { key: 'gateways', title: '网关', description: '管理隔离区执行入口。', path: '/gateways', permission: 'gateway.read' },
    { key: 'deploymentPlans', title: '应用资产部署', description: '从应用资产选择证书版本并发起部署。', path: '/applications', permission: 'service_asset.read' },
    { key: 'audits', title: '审计日志', description: '追踪操作人与执行结果。', path: '/audits', permission: 'audit.read' },
  ];
}

function buildCertificateStatuses(input: {
  assets: CertificateAssetEntity[];
  versions: CertificateVersionEntity[];
  bindingCountByVersionId: ReadonlyMap<string, number>;
  nowIso: string;
}): DashboardCertificateStatusItem[] {
  const latestVersionByAssetId = new Map<string, CertificateVersionEntity>();
  for (const version of input.versions) {
    if (version.status !== 'active') continue;
    const current = latestVersionByAssetId.get(version.certificateAssetId);
    if (!current || isLaterCertificateStatusVersion(version, current)) {
      latestVersionByAssetId.set(version.certificateAssetId, version);
    }
  }

  return input.assets
    // 资产可能在最后一个版本删除后仍保留为 active；没有活跃版本就不属于证书状态热力图。
    .filter((asset) => asset.status === 'active' && latestVersionByAssetId.has(asset.id))
    .map((asset) => {
      const version = latestVersionByAssetId.get(asset.id);
      const daysRemaining = version?.notAfter ? daysUntil(version.notAfter, input.nowIso) : undefined;
      return {
        certificateAssetId: asset.id,
        certificateVersionId: version?.id,
        name: asset.name,
        primaryDomain: asset.primaryDomain,
        issuer: version?.issuer ? version.issuer.commonName || version.issuer.organization || version.issuer.raw : undefined,
        notBefore: isoOrUndefined(version?.notBefore),
        notAfter: isoOrUndefined(version?.notAfter),
        daysRemaining,
        state: resolveCertificateState(version, daysRemaining),
        chainStatus: version?.chainStatus,
        bindingCount: version ? input.bindingCountByVersionId.get(version.id) ?? 0 : 0,
        updatedAt: isoOrUndefined(asset.updatedAt),
      };
    })
    .sort(compareCertificateStatus)
    .slice(0, 12);
}

function resolveCertificateState(version: CertificateVersionEntity | undefined, daysRemaining: number | undefined): DashboardCertificateState {
  if (!version || daysRemaining === undefined) return 'unknown';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= CERTIFICATE_CRITICAL_DAYS) return 'critical';
  if (daysRemaining <= CERTIFICATE_WARNING_DAYS) return 'expiring';
  return 'valid';
}

function certificateStateLabel(state: DashboardCertificateState): string {
  const labels: Record<DashboardCertificateState, string> = {
    valid: '正常',
    expiring: '即将到期',
    critical: '临近到期',
    expired: '已过期',
    unknown: '未知',
  };
  return labels[state];
}

function certificateTone(state: DashboardCertificateState): DashboardStatusTone {
  if (state === 'valid') return 'ok';
  if (state === 'expiring') return 'warning';
  if (state === 'critical' || state === 'expired') return 'error';
  return 'unknown';
}

function agentTone(status: string): DashboardStatusTone {
  if (status === 'ONLINE') return 'ok';
  if (status === 'UPGRADING') return 'warning';
  if (status === 'DISABLED') return 'disabled';
  if (status === 'OFFLINE') return 'error';
  return 'unknown';
}

function gatewayTone(status: string): DashboardStatusTone {
  if (status === 'online') return 'ok';
  if (status === 'upgrading') return 'warning';
  if (status === 'disabled' || status === 'revoked') return 'disabled';
  if (status === 'offline') return 'error';
  return 'unknown';
}

function assetTone(status: string): DashboardStatusTone {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'STALE' || status === 'INACTIVE') return 'warning';
  if (status === 'DISABLED' || status === 'RETIRED' || status === 'DELETED') return 'disabled';
  if (status === 'UNREACHABLE') return 'error';
  return 'unknown';
}

function compareCertificateStatus(left: DashboardCertificateStatusItem, right: DashboardCertificateStatusItem): number {
  const stateWeight: Record<DashboardCertificateState, number> = {
    expired: 0,
    critical: 1,
    expiring: 2,
    unknown: 3,
    valid: 4,
  };
  const stateDiff = stateWeight[left.state] - stateWeight[right.state];
  if (stateDiff !== 0) return stateDiff;
  return compareTimeAsc(left.notAfter, right.notAfter);
}

function isLaterCertificateStatusVersion(candidate: CertificateVersionEntity, current: CertificateVersionEntity): boolean {
  const notAfterDiff = toTime(candidate.notAfter) - toTime(current.notAfter);
  if (notAfterDiff !== 0) return notAfterDiff > 0;
  if (candidate.versionNo !== current.versionNo) return candidate.versionNo > current.versionNo;
  return compareTimeDesc(candidate.createdAt, current.createdAt) < 0;
}

function countBindingsByVersionId(bindings: Array<{ certificateVersionId?: string }>): Map<string, number> {
  const result = new Map<string, number>();
  for (const binding of bindings) {
    if (!binding.certificateVersionId) continue;
    result.set(binding.certificateVersionId, (result.get(binding.certificateVersionId) ?? 0) + 1);
  }
  return result;
}

function daysUntil(value: unknown, nowIso: string): number {
  return Math.ceil((toTime(value) - toTime(nowIso)) / 86_400_000);
}

function normalizeDomain(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function isAfter(value: unknown, nowIso: string): boolean {
  return toTime(value) > toTime(nowIso);
}

function compareTimeAsc(left: unknown, right: unknown): number {
  return toTime(left) - toTime(right);
}

function compareTimeDesc(left: unknown, right: unknown): number {
  return toTime(right) - toTime(left);
}

function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function allRowsQuery(sort = 'updatedAt:desc', authorization?: PageQuery['authorization']): PageQuery {
  const [field, direction = 'desc'] = sort.split(':');
  return {
    page: 1,
    pageSize: 1000,
    sort: { field, direction: direction === 'asc' ? 'asc' : 'desc' },
    filter: {},
    authorization,
  };
}

const CERTIFICATE_WARNING_DAYS = 15;
const CERTIFICATE_CRITICAL_DAYS = 3;
