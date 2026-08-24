import type { PageAuthorizationFilter } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { AuditLogEntity } from '../../../persistence/entities/audit-log.entity.js';
import type { AgentRegistration } from '../../agents/schema/agents.schema.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { CertificateAssetEntity, CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { GatewayDto, GatewayReachabilityDto, GatewayZoneDto } from '../../gateways/dto/gateways.dto.js';

export interface DashboardReadAuthorizations {
  readonly applicationAssets: PageAuthorizationFilter;
  readonly certificateAssets: PageAuthorizationFilter;
  readonly certificateVersions: PageAuthorizationFilter;
  readonly bindings: PageAuthorizationFilter;
  readonly agents: PageAuthorizationFilter;
  readonly gateways: PageAuthorizationFilter;
}

export interface DashboardReadModel {
  readonly applicationCount: number;
  readonly validCertificateCount: number;
  readonly expiringCertificateCount: number;
  readonly activeAgentCount: number;
  readonly activeGatewayCount: number;
  readonly managedBindingCount: number;
  readonly applicationAssets: DashboardApplicationAsset[];
  readonly certificateAssets: CertificateAssetEntity[];
  readonly certificateVersions: CertificateVersionEntity[];
  readonly bindings: CertificateBindingDto[];
  readonly bindingCountsByVersionId: ReadonlyMap<string, number>;
  readonly agents: AgentRegistration[];
  readonly gateways: GatewayDto[];
  readonly gatewayZones: GatewayZoneDto[];
  readonly gatewayReachability: GatewayReachabilityDto[];
  readonly auditCandidates: AuditLogEntity[];
}

export interface DashboardApplicationAsset {
  readonly id: string;
  readonly displayName?: string;
  readonly address: string;
  readonly port: number;
  readonly protocol: string;
  readonly platform?: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly lastDiscoveredAt?: string;
  readonly currentCertificate?: { notAfter?: string };
}

const STATUS_LIMIT = 80;
const CERTIFICATE_STATUS_LIMIT = 12;
const AUDIT_CANDIDATE_LIMIT = 64;

/**
 * 仪表盘是读模型，不应借用页面列表接口：列表接口会补全详情投影并把全量数据搬到
 * Node 进程。这里将计数、排序和上限都放到数据库，仍使用调用方已经解析的对象授权。
 */
export class DashboardReadRepository {
  constructor(private readonly db: DatabasePort) {}

  async load(input: {
    tenantId: string;
    nowIso: string;
    authorizations: DashboardReadAuthorizations;
    includeAudits: boolean;
  }): Promise<DashboardReadModel> {
    const [
      applicationSummary,
      certificateSummary,
      bindingSummary,
      agentSummary,
      gatewaySummary,
      applicationAssets,
      certificateRows,
      bindings,
      bindingCountsByVersionId,
      agents,
      gateways,
      auditCandidates,
    ] = await Promise.all([
      this.loadApplicationSummary(input.tenantId, input.authorizations.applicationAssets),
      this.loadCertificateSummary(input.tenantId, input.nowIso, input.authorizations.certificateVersions),
      this.loadBindingSummary(input.tenantId, input.authorizations.bindings),
      this.loadAgentSummary(input.tenantId, input.authorizations.agents),
      this.loadGatewaySummary(input.tenantId, input.authorizations.gateways),
      this.loadApplicationAssets(input.tenantId, input.authorizations.applicationAssets),
      this.loadCertificateRows(input.tenantId, input.authorizations.certificateAssets, input.authorizations.certificateVersions),
      this.loadBindings(input.tenantId, input.authorizations.bindings),
      this.loadBindingCounts(input.tenantId, input.authorizations.bindings),
      this.loadAgents(input.tenantId, input.authorizations.agents),
      this.loadGateways(input.tenantId, input.authorizations.gateways),
      input.includeAudits ? this.loadAuditCandidates(input.tenantId) : Promise.resolve([]),
    ]);
    const [gatewayZones, gatewayReachability] = await Promise.all([
      this.loadGatewayZones(input.tenantId, gateways.map((gateway) => gateway.id)),
      this.loadGatewayReachability(input.tenantId, gateways.map((gateway) => gateway.id)),
    ]);

    return {
      applicationCount: applicationSummary.count,
      validCertificateCount: certificateSummary.validCount,
      expiringCertificateCount: certificateSummary.expiringCount,
      managedBindingCount: bindingSummary.count,
      activeAgentCount: agentSummary.count,
      activeGatewayCount: gatewaySummary.count,
      applicationAssets,
      certificateAssets: certificateRows.map((row) => row.asset),
      certificateVersions: certificateRows.flatMap((row) => row.version ? [row.version] : []),
      bindings,
      bindingCountsByVersionId,
      agents,
      gateways,
      gatewayZones,
      gatewayReachability,
      auditCandidates,
    };
  }

  private async loadApplicationSummary(tenantId: string, authorization: PageAuthorizationFilter): Promise<{ count: number }> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const authorizationSql = query.authorization(authorization, 'asset', {
      tenantId: 'asset.tenant_id',
      environment: 'asset.environment',
      tags: 'asset.tags',
    });
    const result = await this.db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_service_assets asset
       where asset.tenant_id = ${tenant}
         and asset.deleted_at is null
         and asset.asset_kind <> 'DEVICE'
         ${authorizationSql}
    `, query.params);
    return { count: numberValue(result.rows[0]?.count) };
  }

  private async loadCertificateSummary(tenantId: string, nowIso: string, authorization: PageAuthorizationFilter): Promise<{ validCount: number; expiringCount: number }> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const now = query.param(nowIso);
    const warningEnd = query.param(new Date(Date.parse(nowIso) + 15 * 86_400_000).toISOString());
    const authorizationSql = query.authorization(authorization, 'version', { tenantId: 'version.tenant_id' });
    const result = await this.db.query<{ valid_count: string; expiring_count: string }>(`
      select
        count(*) filter (where version.not_after > ${now}::timestamptz)::text as valid_count,
        count(*) filter (where version.not_after >= ${now}::timestamptz and version.not_after <= ${warningEnd}::timestamptz)::text as expiring_count
        from pg_certificate_versions version
       where version.tenant_id = ${tenant}
         and version.status = 'active'
         ${authorizationSql}
    `, query.params);
    return {
      validCount: numberValue(result.rows[0]?.valid_count),
      expiringCount: numberValue(result.rows[0]?.expiring_count),
    };
  }

  private async loadBindingSummary(tenantId: string, authorization: PageAuthorizationFilter): Promise<{ count: number }> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const authorizationSql = query.authorization(authorization, 'binding', { tenantId: 'binding.tenant_id' });
    const result = await this.db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_certificate_bindings binding
       where binding.tenant_id = ${tenant}
         and binding.deleted_at is null
         and binding.status = 'MANAGED'
         ${authorizationSql}
    `, query.params);
    return { count: numberValue(result.rows[0]?.count) };
  }

  private async loadAgentSummary(tenantId: string, authorization: PageAuthorizationFilter): Promise<{ count: number }> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const authorizationSql = query.authorization(authorization, 'agent', {
      tenantId: "agent.payload->>'tenantId'",
      zoneId: "agent.payload->>'zone'",
    });
    const result = await this.db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_documents agent
       where agent.namespace = 'agents:registrations'
         and agent.payload->>'tenantId' = ${tenant}
         and agent.payload->>'status' = 'ONLINE'
         ${authorizationSql}
    `, query.params);
    return { count: numberValue(result.rows[0]?.count) };
  }

  private async loadGatewaySummary(tenantId: string, authorization: PageAuthorizationFilter): Promise<{ count: number }> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const authorizationSql = query.authorization(authorization, 'gateway', { tenantId: 'gateway.tenant_id' });
    const result = await this.db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_gateways gateway
       where gateway.tenant_id = ${tenant}
         and gateway.status = 'online'
         ${authorizationSql}
    `, query.params);
    return { count: numberValue(result.rows[0]?.count) };
  }

  private async loadApplicationAssets(tenantId: string, authorization: PageAuthorizationFilter): Promise<DashboardApplicationAsset[]> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const limit = query.param(STATUS_LIMIT);
    const authorizationSql = query.authorization(authorization, 'asset', {
      tenantId: 'asset.tenant_id',
      environment: 'asset.environment',
      tags: 'asset.tags',
    });
    const result = await this.db.query<ApplicationAssetRow>(`
      select
        asset.id, asset.display_name, asset.address, asset.port, asset.protocol, asset.platform,
        asset.status, asset.updated_at, asset.last_discovered_at,
        (
          select version.not_after
            from pg_certificate_bindings binding
            join pg_certificate_versions version
              on version.tenant_id = binding.tenant_id
             and version.id = coalesce(binding.local_certificate_version_id, binding.certificate_version_id, binding.target_certificate_version_id)
           where binding.tenant_id = asset.tenant_id
             and binding.service_asset_id = asset.id
             and binding.deleted_at is null
             and version.status = 'active'
           order by coalesce(binding.last_verified_at, binding.last_deployed_at, binding.checked_at, binding.updated_at) desc nulls last
           limit 1
        ) as current_not_after
        from pg_service_assets asset
       where asset.tenant_id = ${tenant}
         and asset.deleted_at is null
         and asset.asset_kind <> 'DEVICE'
         ${authorizationSql}
       order by
         case asset.status
           when 'UNREACHABLE' then 0
           when 'STALE' then 1
           when 'INACTIVE' then 1
           when 'DISABLED' then 2
           when 'RETIRED' then 2
           when 'DELETED' then 2
           when 'ACTIVE' then 4
           else 3
         end,
         coalesce(asset.last_discovered_at, asset.updated_at) desc
       limit ${limit}
    `, query.params);
    return result.rows.map(toApplicationAsset);
  }

  private async loadCertificateRows(
    tenantId: string,
    assetAuthorization: PageAuthorizationFilter,
    versionAuthorization: PageAuthorizationFilter,
  ): Promise<Array<{ asset: CertificateAssetEntity; version?: CertificateVersionEntity }>> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const assetAuthorizationSql = query.authorization(assetAuthorization, 'asset', { tenantId: 'asset.tenant_id', tags: 'asset.tags' });
    const versionAuthorizationSql = query.authorization(versionAuthorization, 'version', { tenantId: 'version.tenant_id' });
    const limit = query.param(CERTIFICATE_STATUS_LIMIT);
    const result = await this.db.query<CertificateStatusRow>(`
      with visible_versions as (
        select version.*,
               row_number() over (
                 partition by version.certificate_asset_id
                 order by version.not_after desc, version.version_no desc, version.created_at desc
               ) as dashboard_row_no
          from pg_certificate_versions version
         where version.tenant_id = ${tenant}
           and version.status = 'active'
           ${versionAuthorizationSql}
      )
      select
        asset.id as asset_id, asset.tenant_id as asset_tenant_id, asset.name as asset_name,
        asset.primary_domain, asset.sans as asset_sans, asset.source_type as asset_source_type,
        asset.current_version_id, asset.status as asset_status, asset.tags as asset_tags,
        asset.created_by as asset_created_by, asset.created_at as asset_created_at, asset.updated_at as asset_updated_at,
        version.id as version_id, version.tenant_id as version_tenant_id,
        version.certificate_asset_id, version.version_no, version.common_name, version.sans as version_sans,
        version.issuer, version.subject, version.serial_number, version.not_before, version.not_after,
        version.fingerprint_sha256, version.public_key_fingerprint_sha256, version.public_key_algorithm,
        version.signature_algorithm, version.leaf_storage_ref, version.private_key_secret_ref,
        version.issuing_ca_id, version.certificate_request_id, version.certificate_profile_version_id,
        version.key_reference_id, version.key_custody_mode, version.chain_certificate_refs, version.chain_order,
        version.chain_diagnostics, version.chain_status, version.deployable, version.source_type as version_source_type,
        version.status as version_status, version.activation_state, version.created_by as version_created_by,
        version.created_at as version_created_at
        from pg_certificate_assets asset
        left join visible_versions version
          on version.certificate_asset_id = asset.id
         and version.dashboard_row_no = 1
       where asset.tenant_id = ${tenant}
         and asset.status = 'active'
         ${assetAuthorizationSql}
       order by
         case
           when version.id is null then 3
           when version.not_after < now() then 0
           when version.not_after <= now() + interval '3 days' then 1
           when version.not_after <= now() + interval '15 days' then 2
           else 4
         end,
         version.not_after asc nulls last,
         asset.updated_at desc
       limit ${limit}
    `, query.params);
    return result.rows.map(toCertificateStatusRow);
  }

  private async loadBindings(tenantId: string, authorization: PageAuthorizationFilter): Promise<CertificateBindingDto[]> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const limit = query.param(CERTIFICATE_STATUS_LIMIT);
    const authorizationSql = query.authorization(authorization, 'binding', { tenantId: 'binding.tenant_id' });
    const result = await this.db.query<BindingRow>(`
      select binding.id, binding.tenant_id, binding.certificate_version_id
        from pg_certificate_bindings binding
       where binding.tenant_id = ${tenant}
         and binding.deleted_at is null
         ${authorizationSql}
       order by binding.updated_at desc
       limit ${limit}
    `, query.params);
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      certificateVersionId: row.certificate_version_id ?? undefined,
    } as CertificateBindingDto));
  }

  private async loadBindingCounts(tenantId: string, authorization: PageAuthorizationFilter): Promise<ReadonlyMap<string, number>> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const authorizationSql = query.authorization(authorization, 'binding', { tenantId: 'binding.tenant_id' });
    const result = await this.db.query<{ certificate_version_id: string; count: string }>(`
      select binding.certificate_version_id, count(*)::text as count
        from pg_certificate_bindings binding
       where binding.tenant_id = ${tenant}
         and binding.deleted_at is null
         and binding.certificate_version_id is not null
         ${authorizationSql}
       group by binding.certificate_version_id
    `, query.params);
    return new Map(result.rows.map((row) => [row.certificate_version_id, numberValue(row.count)]));
  }

  private async loadAgents(tenantId: string, authorization: PageAuthorizationFilter): Promise<AgentRegistration[]> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const limit = query.param(STATUS_LIMIT);
    const authorizationSql = query.authorization(authorization, 'agent', {
      tenantId: "agent.payload->>'tenantId'",
      zoneId: "agent.payload->>'zone'",
    });
    const result = await this.db.query<DocumentRow>(`
      select agent.document_id, agent.payload
        from pg_documents agent
       where agent.namespace = 'agents:registrations'
         and agent.payload->>'tenantId' = ${tenant}
         ${authorizationSql}
       order by
         case agent.payload->>'status'
           when 'OFFLINE' then 0
           when 'DISABLED' then 2
           when 'REVOKED' then 2
           when 'ONLINE' then 4
           else 3
         end,
         coalesce(agent.payload->>'updatedAt', '') desc
       limit ${limit}
    `, query.params);
    return result.rows.map((row) => toAgent(row.document_id, row.payload));
  }

  private async loadGateways(tenantId: string, authorization: PageAuthorizationFilter): Promise<GatewayDto[]> {
    const query = new SqlQuery();
    const tenant = query.param(tenantId);
    const limit = query.param(STATUS_LIMIT);
    const authorizationSql = query.authorization(authorization, 'gateway', { tenantId: 'gateway.tenant_id' });
    const result = await this.db.query<GatewayRow>(`
      select gateway.id, gateway.tenant_id, gateway.agent_id, gateway.zone_ids, gateway.status,
             gateway.last_heartbeat_at, gateway.updated_at
        from pg_gateways gateway
       where gateway.tenant_id = ${tenant}
         ${authorizationSql}
       order by
         case gateway.status
           when 'offline' then 0
           when 'disabled' then 2
           when 'revoked' then 2
           when 'online' then 4
           else 3
         end,
         coalesce(gateway.last_heartbeat_at, gateway.updated_at) desc
       limit ${limit}
    `, query.params);
    return result.rows.map(toGateway);
  }

  private async loadGatewayZones(tenantId: string, gatewayIds: readonly string[]): Promise<GatewayZoneDto[]> {
    if (gatewayIds.length === 0) return [];
    const result = await this.db.query<GatewayZoneRow>(`
      select distinct zone.id, zone.tenant_id, zone.name
        from pg_gateway_zones zone
        join pg_gateways gateway
          on gateway.tenant_id = zone.tenant_id
         and exists (
           select 1
             from jsonb_array_elements_text(gateway.zone_ids) as gateway_zone(id)
            where gateway_zone.id = zone.id
         )
       where zone.tenant_id = $1
         and gateway.id = any($2::text[])
    `, [tenantId, gatewayIds]);
    return result.rows.map((row) => ({ id: row.id, tenantId: row.tenant_id, name: row.name } as GatewayZoneDto));
  }

  private async loadGatewayReachability(tenantId: string, gatewayIds: readonly string[]): Promise<GatewayReachabilityDto[]> {
    if (gatewayIds.length === 0) return [];
    const result = await this.db.query<GatewayReachabilityRow>(`
      select distinct on (reachability.gateway_id)
             reachability.gateway_id, reachability.latency_ms, reachability.checked_at
        from pg_gateway_reachability reachability
       where reachability.tenant_id = $1
         and reachability.gateway_id = any($2::text[])
       order by reachability.gateway_id, reachability.checked_at desc
    `, [tenantId, gatewayIds]);
    return result.rows.map((row) => ({
      gatewayId: row.gateway_id,
      latencyMs: row.latency_ms ?? undefined,
      checkedAt: isoText(row.checked_at),
    } as GatewayReachabilityDto));
  }

  private async loadAuditCandidates(tenantId: string): Promise<AuditLogEntity[]> {
    const result = await this.db.query<DocumentRow>(`
      select audit.document_id, audit.payload
        from pg_documents audit
       where audit.namespace = 'security.audit_logs'
         and audit.payload->>'tenantId' = $1
       order by audit.updated_at desc
       limit $2
    `, [tenantId, AUDIT_CANDIDATE_LIMIT]);
    return result.rows.map((row) => ({ ...asRecord(row.payload), id: row.document_id }) as AuditLogEntity);
  }
}

class SqlQuery {
  readonly params: unknown[] = [];

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  authorization(
    authorization: PageAuthorizationFilter,
    alias: string,
    fields: { tenantId: string; environment?: string; zoneId?: string; tags?: string },
  ): string {
    if (authorization.unrestricted) return '';
    const allowed = [
      this.idCondition(alias, authorization.objectIds),
      ...authorization.dynamicConditions?.map((condition) => this.dynamicCondition(condition, fields)) ?? [],
    ].filter((value): value is string => Boolean(value));
    if (authorization.empty || allowed.length === 0) return 'and false';

    if (authorization.deniedDynamicConditions?.some((condition) => hasUnsupportedDynamicCondition(condition, fields))) {
      return 'and false';
    }
    const denied = [
      this.idCondition(alias, authorization.deniedObjectIds),
      ...authorization.deniedDynamicConditions?.map((condition) => this.dynamicCondition(condition, fields)) ?? [],
    ].filter((value): value is string => Boolean(value));
    const allowedSql = `and (${allowed.join(' or ')})`;
    return denied.length ? `${allowedSql} and not (${denied.join(' or ')})` : allowedSql;
  }

  private idCondition(alias: string, ids: readonly string[] | undefined): string | undefined {
    if (!ids?.length) return undefined;
    return `${alias}.id = any(${this.param(ids)}::text[])`;
  }

  private dynamicCondition(condition: Record<string, unknown>, fields: { tenantId: string; environment?: string; zoneId?: string; tags?: string }): string {
    const clauses = Object.entries(condition)
      .map(([key, expected]) => this.dynamicClause(key, expected, fields))
      .filter((value): value is string => Boolean(value));
    const unsupported = Object.entries(condition).some(([key, expected]) => {
      if (expected === undefined || expected === null || expected === '*') return false;
      return !dynamicField(key, fields);
    });
    if (unsupported) return 'false';
    return clauses.length ? `(${clauses.join(' and ')})` : 'true';
  }

  private dynamicClause(key: string, expected: unknown, fields: { tenantId: string; environment?: string; zoneId?: string; tags?: string }): string | undefined {
    if (expected === undefined || expected === null || expected === '*') return undefined;
    const field = dynamicField(key, fields);
    if (!field) return undefined;
    const values = Array.isArray(expected) ? expected : [expected];
    const textValues = values.map(String);
    if (field.kind === 'tags') {
      return `exists (select 1 from jsonb_array_elements_text(coalesce(${field.sql}, '[]'::jsonb)) as dashboard_tag where dashboard_tag = any(${this.param(textValues)}::text[]))`;
    }
    return `${field.sql} = any(${this.param(textValues)}::text[])`;
  }
}

function dynamicField(
  key: string,
  fields: { tenantId: string; environment?: string; zoneId?: string; tags?: string },
): { sql: string; kind: 'scalar' | 'tags' } | undefined {
  if (key === 'tenantId') return { sql: fields.tenantId, kind: 'scalar' };
  if (key === 'environment' && fields.environment) return { sql: fields.environment, kind: 'scalar' };
  if (key === 'zoneId' && fields.zoneId) return { sql: fields.zoneId, kind: 'scalar' };
  if ((key === 'tag' || key === 'assetTag') && fields.tags) return { sql: fields.tags, kind: 'tags' };
  return undefined;
}

function hasUnsupportedDynamicCondition(
  condition: Record<string, unknown>,
  fields: { tenantId: string; environment?: string; zoneId?: string; tags?: string },
): boolean {
  return Object.entries(condition).some(([key, expected]) => (
    expected !== undefined
    && expected !== null
    && expected !== '*'
    && !dynamicField(key, fields)
  ));
}

type ApplicationAssetRow = {
  id: string;
  display_name?: string | null;
  address: string;
  port: number;
  protocol: string;
  platform?: string | null;
  status: string;
  updated_at: string | Date;
  last_discovered_at?: string | Date | null;
  current_not_after?: string | Date | null;
};

type CertificateStatusRow = Record<string, unknown>;
type BindingRow = { id: string; tenant_id: string; certificate_version_id?: string | null };
type DocumentRow = { document_id: string; payload: unknown };
type GatewayRow = { id: string; tenant_id: string; agent_id: string; zone_ids: unknown; status: string; last_heartbeat_at?: string | Date | null; updated_at: string | Date };
type GatewayZoneRow = { id: string; tenant_id: string; name: string };
type GatewayReachabilityRow = { gateway_id: string; latency_ms?: number | null; checked_at: string | Date };

function toApplicationAsset(row: ApplicationAssetRow): DashboardApplicationAsset {
  return {
    id: row.id,
    displayName: row.display_name ?? undefined,
    address: row.address,
    port: Number(row.port),
    protocol: row.protocol,
    platform: row.platform ?? undefined,
    status: row.status,
    updatedAt: isoText(row.updated_at),
    lastDiscoveredAt: row.last_discovered_at ? isoText(row.last_discovered_at) : undefined,
    currentCertificate: row.current_not_after ? { notAfter: isoText(row.current_not_after) } : undefined,
  };
}

function toCertificateStatusRow(row: CertificateStatusRow): { asset: CertificateAssetEntity; version?: CertificateVersionEntity } {
  const asset = {
    id: stringValue(row.asset_id),
    tenantId: stringValue(row.asset_tenant_id),
    name: stringValue(row.asset_name),
    primaryDomain: stringValue(row.primary_domain),
    sans: stringArray(row.asset_sans),
    sourceType: stringValue(row.asset_source_type),
    currentVersionId: optionalString(row.current_version_id),
    status: stringValue(row.asset_status),
    tags: stringArray(row.asset_tags),
    createdBy: stringValue(row.asset_created_by),
    createdAt: isoText(row.asset_created_at),
    updatedAt: isoText(row.asset_updated_at),
  } as CertificateAssetEntity;
  if (!row.version_id) return { asset };
  return {
    asset,
    version: {
      id: stringValue(row.version_id),
      tenantId: stringValue(row.version_tenant_id),
      certificateAssetId: stringValue(row.certificate_asset_id),
      versionNo: numberValue(row.version_no),
      commonName: optionalString(row.common_name),
      sans: stringArray(row.version_sans),
      issuer: asRecord(row.issuer) as unknown as CertificateVersionEntity['issuer'],
      subject: asRecord(row.subject) as unknown as CertificateVersionEntity['subject'],
      serialNumber: stringValue(row.serial_number),
      notBefore: isoText(row.not_before),
      notAfter: isoText(row.not_after),
      fingerprintSha256: stringValue(row.fingerprint_sha256),
      publicKeyFingerprintSha256: optionalString(row.public_key_fingerprint_sha256),
      publicKeyAlgorithm: stringValue(row.public_key_algorithm),
      signatureAlgorithm: stringValue(row.signature_algorithm),
      leafStorageRef: stringValue(row.leaf_storage_ref),
      privateKeySecretRef: optionalString(row.private_key_secret_ref),
      issuingCaId: optionalString(row.issuing_ca_id),
      certificateRequestId: optionalString(row.certificate_request_id),
      certificateProfileVersionId: optionalString(row.certificate_profile_version_id),
      keyReferenceId: optionalString(row.key_reference_id),
      keyCustodyMode: optionalString(row.key_custody_mode) as CertificateVersionEntity['keyCustodyMode'],
      chainCertificateRefs: stringArray(row.chain_certificate_refs),
      chainOrder: stringArray(row.chain_order),
      chainDiagnostics: stringArray(row.chain_diagnostics),
      chainStatus: stringValue(row.chain_status) as CertificateVersionEntity['chainStatus'],
      deployable: Boolean(row.deployable),
      sourceType: stringValue(row.version_source_type) as CertificateVersionEntity['sourceType'],
      activationState: optionalString(row.activation_state) as CertificateVersionEntity['activationState'],
      status: stringValue(row.version_status) as CertificateVersionEntity['status'],
      createdBy: stringValue(row.version_created_by),
      createdAt: isoText(row.version_created_at),
    },
  };
}

function toAgent(id: string, payload: unknown): AgentRegistration {
  return { ...asRecord(payload), id } as AgentRegistration;
}

function toGateway(row: GatewayRow): GatewayDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    zoneIds: stringArray(row.zone_ids),
    status: row.status as GatewayDto['status'],
    lastHeartbeatAt: row.last_heartbeat_at ? isoText(row.last_heartbeat_at) : undefined,
    updatedAt: isoText(row.updated_at),
  } as GatewayDto;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalString(value: unknown): string | undefined {
  const result = stringValue(value);
  return result || undefined;
}

function numberValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function isoText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return stringValue(value);
}
