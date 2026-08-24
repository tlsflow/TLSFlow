import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type { AlertRule, RiskEvent, RiskStatusHistory } from '../schema/monitors.schema.js';
import type {
  ChangeRiskStatusInput,
  CertificateObservationDto,
  CreateAlertRuleInput,
  CreateMonitorTargetInput,
  ListCertificateObservationsQuery,
  ListMonitorProbeResultsQuery,
  ListMonitorTargetsQuery,
  MonitorProbeResultDto,
  ListRiskEventsQuery,
  MonitorTargetDto,
  MonitorTargetPageDto,
  SaveCertificateObservationInput,
  SaveMonitorProbeResultInput,
  UpdateMonitorTargetInput,
  UpsertRiskEventInput,
} from '../dto/monitors.dto.js';

export interface MonitorsRepository {
  readonly moduleName: 'monitors';
  createMonitorTarget(input: CreateMonitorTargetInput): Promise<MonitorTargetDto>;
  listMonitorTargets(query: ListMonitorTargetsQuery): Promise<MonitorTargetPageDto>;
  listActiveMonitorTargetsForScheduler(limit: number, tenantId?: string): Promise<MonitorTargetDto[]>;
  getMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto | undefined>;
  updateMonitorTarget(input: UpdateMonitorTargetInput): Promise<MonitorTargetDto>;
  deleteMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto>;
  saveMonitorProbeResult(input: SaveMonitorProbeResultInput): Promise<MonitorProbeResultDto>;
  listMonitorProbeResults(query?: ListMonitorProbeResultsQuery): Promise<MonitorProbeResultDto[]>;
  getLatestMonitorProbeResult(tenantId: string, monitorTargetId: string): Promise<MonitorProbeResultDto | undefined>;
  upsertRiskEvent(input: UpsertRiskEventInput): Promise<RiskEvent>;
  listRiskEvents(query?: ListRiskEventsQuery): Promise<RiskEvent[]>;
  getRiskEventByDedupKey(dedupKey: string): Promise<RiskEvent | undefined>;
  getRiskEvent(tenantId: string, riskEventId: string): Promise<RiskEvent | undefined>;
  changeRiskStatus(input: ChangeRiskStatusInput): Promise<{ risk: RiskEvent; history: RiskStatusHistory }>;
  listRiskStatusHistory(tenantId: string, riskEventId: string): Promise<RiskStatusHistory[]>;
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule>;
  listAlertRules(tenantId?: string): Promise<AlertRule[]>;
  saveCertificateObservation(input: SaveCertificateObservationInput): Promise<CertificateObservationDto>;
  listCertificateObservations(query?: ListCertificateObservationsQuery): Promise<CertificateObservationDto[]>;
  getLatestCertificateObservation(tenantId: string | undefined, serviceAssetId: string): Promise<CertificateObservationDto | undefined>;
}

export class PgMonitorsRepository implements MonitorsRepository {
  readonly moduleName = 'monitors' as const;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async createMonitorTarget(input: CreateMonitorTargetInput): Promise<MonitorTargetDto> {
    const duplicate = await this.getActiveMonitorTargetByAsset(input.tenantId, input.serviceAssetId);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', '监控目标已存在', { serviceAssetId: input.serviceAssetId });

    const now = new Date().toISOString();
    const target: MonitorTargetDto = {
      id: newId('mtg'),
      tenantId: input.tenantId,
      serviceAssetId: input.serviceAssetId,
      assetId: input.serviceAssetId,
      metrics: [...(input.metrics ?? ['availability', 'latency', 'certificate', 'certificateHistory'])],
      intervalSeconds: input.intervalSeconds,
      status: input.status ?? 'active',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_monitor_targets (
      id, tenant_id, service_asset_id, metrics, interval_seconds, status, created_by, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4::jsonb,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10
    )`, [
      target.id,
      target.tenantId,
      target.serviceAssetId,
      JSON.stringify(target.metrics),
      target.intervalSeconds,
      target.status,
      target.createdBy ?? null,
      target.createdAt,
      target.updatedAt,
      target.version,
    ]);
    return target;
  }

  async listMonitorTargets(query: ListMonitorTargetsQuery): Promise<MonitorTargetPageDto> {
    const rows = (await this.db.query<MonitorTargetRow>(
      `select * from pg_monitor_targets where tenant_id = $1 and deleted_at is null`,
      [query.tenantId],
    )).rows.map(toMonitorTarget);
    return page(rows, query, monitorTargetFilter);
  }

  async listActiveMonitorTargetsForScheduler(limit: number, tenantId?: string): Promise<MonitorTargetDto[]> {
    const rows = (await this.db.query<MonitorTargetRow>(
      `select * from pg_monitor_targets
       where deleted_at is null and status = 'active'
         ${tenantId ? 'and tenant_id = $2' : ''}
       order by updated_at asc
       limit $1`,
      tenantId ? [Math.max(1, Math.trunc(limit)), tenantId] : [Math.max(1, Math.trunc(limit))],
    )).rows;
    return rows.map(toMonitorTarget);
  }

  async getMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto | undefined> {
    const row = (await this.db.query<MonitorTargetRow>(
      `select * from pg_monitor_targets where tenant_id = $1 and id = $2 and deleted_at is null limit 1`,
      [tenantId, id],
    )).rows[0];
    return row ? toMonitorTarget(row) : undefined;
  }

  async updateMonitorTarget(input: UpdateMonitorTargetInput): Promise<MonitorTargetDto> {
    const current = await this.getMonitorTarget(input.tenantId, input.id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId: input.id });
    const updated: MonitorTargetDto = {
      ...current,
      metrics: input.metrics ? [...input.metrics] : current.metrics,
      intervalSeconds: input.intervalSeconds ?? current.intervalSeconds,
      status: input.status ?? current.status,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    await this.db.query(`update pg_monitor_targets
      set metrics = $3::jsonb,
          interval_seconds = $4,
          status = $5,
          updated_at = $6::timestamptz,
          version = $7
      where tenant_id = $1 and id = $2 and deleted_at is null`, [
      input.tenantId,
      input.id,
      JSON.stringify(updated.metrics),
      updated.intervalSeconds,
      updated.status,
      updated.updatedAt,
      updated.version,
    ]);
    return updated;
  }

  async deleteMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto> {
    const current = await this.getMonitorTarget(tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId: id });
    const now = new Date().toISOString();
    const deleted: MonitorTargetDto = {
      ...current,
      deletedAt: now,
      updatedAt: now,
      version: current.version + 1,
    };
    await this.db.query(`update pg_monitor_targets
      set deleted_at = $3::timestamptz,
          updated_at = $4::timestamptz,
          version = $5
      where tenant_id = $1 and id = $2 and deleted_at is null`, [
      tenantId,
      id,
      deleted.deletedAt,
      deleted.updatedAt,
      deleted.version,
    ]);
    return deleted;
  }

  private async getActiveMonitorTargetByAsset(tenantId: string, serviceAssetId: string): Promise<MonitorTargetDto | undefined> {
    const row = (await this.db.query<MonitorTargetRow>(
      `select * from pg_monitor_targets where tenant_id = $1 and service_asset_id = $2 and deleted_at is null limit 1`,
      [tenantId, serviceAssetId],
    )).rows[0];
    return row ? toMonitorTarget(row) : undefined;
  }

  async saveMonitorProbeResult(input: SaveMonitorProbeResultInput): Promise<MonitorProbeResultDto> {
    const now = new Date().toISOString();
    const item: MonitorProbeResultDto = {
      id: newId('mprobe'),
      tenantId: input.tenantId,
      monitorTargetId: input.monitorTargetId,
      serviceAssetId: input.result.serviceAssetId,
      source: input.result.source,
      url: input.result.url,
      status: input.result.status,
      success: input.result.success,
      latencyMs: input.result.latencyMs,
      checkedAt: input.result.checkedAt,
      message: input.result.message,
      httpStatus: input.result.httpStatus,
      certificate: input.result.certificate,
      detail: input.result.detail ?? {},
      createdAt: now,
    };
    await this.db.query(`insert into pg_monitor_probe_results (
      id, tenant_id, monitor_target_id, service_asset_id, source, probe_url, status,
      success, latency_ms, checked_at, message, http_status, certificate, detail, created_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12,$13::jsonb,$14::jsonb,$15::timestamptz
    )`, [
      item.id,
      item.tenantId,
      item.monitorTargetId ?? null,
      item.serviceAssetId,
      item.source,
      item.url,
      item.status,
      item.success,
      item.latencyMs,
      item.checkedAt,
      item.message,
      item.httpStatus ?? null,
      JSON.stringify(item.certificate ?? null),
      JSON.stringify(item.detail),
      item.createdAt,
    ]);
    return item;
  }

  async listMonitorProbeResults(query: ListMonitorProbeResultsQuery = {}): Promise<MonitorProbeResultDto[]> {
    const rows = (await this.db.query<MonitorProbeResultRow>(
      `select * from pg_monitor_probe_results order by checked_at desc, created_at desc`,
    )).rows.map(toMonitorProbeResult);
    const pageSize = normalizePageSize(query.pageSize);
    return rows
      .filter((item) => query.tenantId === undefined || item.tenantId === query.tenantId)
      .filter((item) => query.monitorTargetId === undefined || item.monitorTargetId === query.monitorTargetId)
      .filter((item) => query.serviceAssetId === undefined || item.serviceAssetId === query.serviceAssetId)
      .slice(0, pageSize);
  }

  async getLatestMonitorProbeResult(tenantId: string, monitorTargetId: string): Promise<MonitorProbeResultDto | undefined> {
    const row = (await this.db.query<MonitorProbeResultRow>(
      `select * from pg_monitor_probe_results
       where tenant_id = $1 and monitor_target_id = $2
       order by checked_at desc, created_at desc
       limit 1`,
      [tenantId, monitorTargetId],
    )).rows[0];
    return row ? toMonitorProbeResult(row) : undefined;
  }

  async upsertRiskEvent(input: UpsertRiskEventInput): Promise<RiskEvent> {
    const existing = await this.getRiskEventByDedupKey(input.dedupKey);
    if (existing) {
      const now = new Date().toISOString();
      const reopened = existing.status === 'RESOLVED';
      const updated: RiskEvent = {
        ...existing,
        type: input.type,
        source: input.source,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        scope: { ...existing.scope, ...input.scope },
        metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
        lastDetectedAt: input.detectedAt,
        occurrenceCount: existing.occurrenceCount + 1,
        resolvedAt: reopened ? undefined : existing.resolvedAt,
        status: reopened ? 'OPEN' : existing.status,
      };
      await this.db.transaction(async (tx) => {
        await tx.query(`update pg_monitor_risk_events
        set risk_type = $2,
            source = $3,
            severity = $4,
            status = $5,
            title = $6,
            summary = $7,
            scope = $8::jsonb,
            metadata = $9::jsonb,
            last_detected_at = $10::timestamptz,
            resolved_at = null,
            occurrence_count = $11,
            updated_at = $12::timestamptz
        where id = $1`, [
        updated.id,
        updated.type,
        updated.source,
        updated.severity,
        updated.status,
        updated.title,
        updated.summary,
        JSON.stringify(updated.scope),
        JSON.stringify(updated.metadata),
        updated.lastDetectedAt,
        updated.occurrenceCount,
        now,
        ]);
        if (reopened) {
          await insertRiskHistory(tx, {
            tenantId: requiredPersistedTenantId(updated.scope.tenantId),
            riskEventId: updated.id,
            action: 'reopened',
            fromStatus: 'RESOLVED',
            toStatus: 'OPEN',
            actorType: 'system',
            occurredAt: input.detectedAt,
            metadata: { trigger: 'risk_recurrence' },
          });
        }
      });
      return updated;
    }

    const now = new Date().toISOString();
    const created: RiskEvent = {
      id: newId('risk'),
      dedupKey: input.dedupKey,
      type: input.type,
      source: input.source,
      status: 'OPEN',
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      scope: { ...input.scope },
      metadata: { ...(input.metadata ?? {}) },
      firstDetectedAt: input.detectedAt,
      lastDetectedAt: input.detectedAt,
      occurrenceCount: 1,
    };
    await this.db.transaction(async (tx) => {
      await tx.query(`insert into pg_monitor_risk_events (
      id, tenant_id, dedup_key, risk_type, source, severity, status, title, summary,
      scope, metadata, first_detected_at, last_detected_at, resolved_at, occurrence_count, created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15,$16::timestamptz,$17::timestamptz
    )`, [
      created.id,
      created.scope.tenantId ?? null,
      created.dedupKey,
      created.type,
      created.source,
      created.severity,
      created.status,
      created.title,
      created.summary,
      JSON.stringify(created.scope),
      JSON.stringify(created.metadata),
      created.firstDetectedAt,
      created.lastDetectedAt,
      created.resolvedAt ?? null,
      created.occurrenceCount,
      now,
      now,
      ]);
      await insertRiskHistory(tx, {
        tenantId: requiredPersistedTenantId(created.scope.tenantId),
        riskEventId: created.id,
        action: 'created',
        toStatus: 'OPEN',
        actorType: 'system',
        occurredAt: created.firstDetectedAt,
        metadata: { source: created.source },
      });
    });
    return created;
  }

  async listRiskEvents(query?: ListRiskEventsQuery): Promise<RiskEvent[]> {
    const rows = (await this.db.query<RiskEventRow>(`select * from pg_monitor_risk_events order by last_detected_at desc, created_at desc`)).rows.map(toRiskEvent);
    return rows.filter((item) => {
      if (query?.tenantId !== undefined && item.scope.tenantId !== query.tenantId) return false;
      if (query?.status !== undefined && item.status !== query.status) return false;
      if (query?.severity !== undefined && item.severity !== query.severity) return false;
      if (query?.type !== undefined && item.type !== query.type) return false;
      return true;
    });
  }

  async getRiskEventByDedupKey(dedupKey: string): Promise<RiskEvent | undefined> {
    const row = (await this.db.query<RiskEventRow>(`select * from pg_monitor_risk_events where dedup_key = $1 limit 1`, [dedupKey])).rows[0];
    return row ? toRiskEvent(row) : undefined;
  }

  async getRiskEvent(tenantId: string, riskEventId: string): Promise<RiskEvent | undefined> {
    const row = (await this.db.query<RiskEventRow>(
      `select * from pg_monitor_risk_events where id = $1 and coalesce(tenant_id, $2) = $2 limit 1`,
      [riskEventId, tenantId],
    )).rows[0];
    return row ? toRiskEvent(row) : undefined;
  }

  async changeRiskStatus(input: ChangeRiskStatusInput): Promise<{ risk: RiskEvent; history: RiskStatusHistory }> {
    const current = await this.getRiskEvent(input.tenantId, input.riskEventId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '风险事件不存在', { riskEventId: input.riskEventId });
    const toStatus = riskActionTargetStatus(input.action);
    if (current.status === toStatus && input.action !== 'suppressed') {
      throw new AppError('VALIDATION_FAILED', '风险已经处于目标状态', { riskEventId: input.riskEventId, status: toStatus });
    }
    if (input.action === 'reopened' && current.status !== 'RESOLVED') {
      throw new AppError('VALIDATION_FAILED', '只有已解决风险可以重新打开', { riskEventId: input.riskEventId, status: current.status });
    }
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const history = await this.db.transaction(async (tx) => {
      await tx.query(`update pg_monitor_risk_events
        set status = $2, resolved_at = $3::timestamptz, updated_at = $4::timestamptz
        where id = $1`, [
        current.id,
        toStatus,
        toStatus === 'RESOLVED' ? occurredAt : null,
        occurredAt,
      ]);
      return insertRiskHistory(tx, {
        tenantId: input.tenantId,
        riskEventId: current.id,
        action: input.action,
        fromStatus: current.status,
        toStatus,
        reason: input.reason,
        actorType: input.actorType,
        actorId: input.actorId,
        occurredAt,
        metadata: input.metadata ?? {},
      });
    });
    return {
      risk: { ...current, status: toStatus, resolvedAt: toStatus === 'RESOLVED' ? occurredAt : undefined },
      history,
    };
  }

  async listRiskStatusHistory(tenantId: string, riskEventId: string): Promise<RiskStatusHistory[]> {
    const rows = (await this.db.query<RiskStatusHistoryRow>(
      `select * from risk_status_history where tenant_id = $1 and risk_event_id = $2 order by occurred_at, id`,
      [tenantId, riskEventId],
    )).rows;
    return rows.map(toRiskStatusHistory);
  }

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    const now = new Date().toISOString();
    const rule: AlertRule = {
      id: newId('rule'),
      name: input.name,
      threshold: { ...input.threshold },
      scope: { ...(input.scope ?? {}) },
      status: input.status ?? 'active',
      silence: input.silence === undefined ? undefined : { ...input.silence },
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.query(`insert into pg_monitor_alert_rules (
      id, tenant_id, name, threshold, scope, status, silence, created_by, created_at, updated_at
    ) values (
      $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9::timestamptz,$10::timestamptz
    )`, [
      rule.id,
      rule.scope.tenantId ?? null,
      rule.name,
      JSON.stringify(rule.threshold),
      JSON.stringify(rule.scope),
      rule.status,
      JSON.stringify(rule.silence ?? null),
      rule.createdBy,
      rule.createdAt,
      rule.updatedAt,
    ]);
    return rule;
  }

  async listAlertRules(tenantId?: string): Promise<AlertRule[]> {
    const rows = (await this.db.query<AlertRuleRow>(`select * from pg_monitor_alert_rules order by created_at desc`)).rows.map(toAlertRule);
    return tenantId === undefined ? rows : rows.filter((item) => item.scope.tenantId === tenantId);
  }

  async saveCertificateObservation(input: SaveCertificateObservationInput): Promise<CertificateObservationDto> {
    const latest = await this.getLatestCertificateObservation(input.tenantId, input.serviceAssetId);
    if (latest && normalizeObservationFingerprint(latest.fingerprintSha256) === normalizeObservationFingerprint(input.fingerprintSha256)) {
      const updated: CertificateObservationDto = {
        ...latest,
        source: input.source,
        url: input.url,
        subject: input.subject,
        issuer: input.issuer,
        serialNumber: input.serialNumber,
        notBefore: input.notBefore,
        notAfter: input.notAfter,
        dnsNames: input.dnsNames,
        verified: input.verified,
        verificationError: input.verificationError,
        rawResult: input.rawResult ?? {},
      };
      await this.db.query(`update pg_monitor_certificate_observations set
        source = $2, probe_url = $3, subject = $4, issuer = $5, serial_number = $6,
        not_before = $7, not_after = $8, dns_names = $9::jsonb, verified = $10,
        verification_error = $11, raw_result = $12::jsonb
        where id = $1`, [
        updated.id,
        updated.source,
        updated.url,
        updated.subject ?? null,
        updated.issuer ?? null,
        updated.serialNumber ?? null,
        updated.notBefore ?? null,
        updated.notAfter ?? null,
        JSON.stringify(updated.dnsNames ?? []),
        updated.verified ?? null,
        updated.verificationError ?? null,
        JSON.stringify(updated.rawResult),
      ]);
      return updated;
    }

    const now = new Date().toISOString();
    const item: CertificateObservationDto = {
      id: newId('certobs'),
      tenantId: input.tenantId,
      serviceAssetId: input.serviceAssetId,
      source: input.source,
      url: input.url,
      observedAt: input.observedAt,
      fingerprintSha256: input.fingerprintSha256,
      subject: input.subject,
      issuer: input.issuer,
      serialNumber: input.serialNumber,
      notBefore: input.notBefore,
      notAfter: input.notAfter,
      dnsNames: input.dnsNames,
      verified: input.verified,
      verificationError: input.verificationError,
      rawResult: input.rawResult ?? {},
      createdAt: now,
    };
    await this.db.query(`insert into pg_monitor_certificate_observations (
      id, tenant_id, service_asset_id, source, probe_url, observed_at, fingerprint_sha256,
      subject, issuer, serial_number, not_before, not_after, dns_names, verified,
      verification_error, raw_result, created_at
    ) values (
      $1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17::timestamptz
    )`, [
      item.id,
      item.tenantId ?? null,
      item.serviceAssetId,
      item.source,
      item.url,
      item.observedAt,
      item.fingerprintSha256,
      item.subject ?? null,
      item.issuer ?? null,
      item.serialNumber ?? null,
      item.notBefore ?? null,
      item.notAfter ?? null,
      JSON.stringify(item.dnsNames ?? []),
      item.verified ?? null,
      item.verificationError ?? null,
      JSON.stringify(item.rawResult),
      item.createdAt,
    ]);
    return item;
  }

  async listCertificateObservations(query: ListCertificateObservationsQuery = {}): Promise<CertificateObservationDto[]> {
    const rows = (await this.db.query<CertificateObservationRow>(
      `select * from pg_monitor_certificate_observations order by observed_at desc, created_at desc`,
    )).rows.map(toCertificateObservation);
    const pageSize = normalizePageSize(query.pageSize);
    const uniqueRows = new Map<string, CertificateObservationDto>();
    for (const item of rows) {
      const key = `${item.tenantId ?? ''}|${item.serviceAssetId}|${normalizeObservationFingerprint(item.fingerprintSha256)}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, item);
    }
    return [...uniqueRows.values()]
      .filter((item) => query.tenantId === undefined || item.tenantId === query.tenantId)
      .filter((item) => query.serviceAssetId === undefined || item.serviceAssetId === query.serviceAssetId)
      .slice(0, pageSize);
  }

  async getLatestCertificateObservation(tenantId: string | undefined, serviceAssetId: string): Promise<CertificateObservationDto | undefined> {
    const row = (await this.db.query<CertificateObservationRow>(
      `select * from pg_monitor_certificate_observations
       where coalesce(tenant_id, '') = coalesce($1, '') and service_asset_id = $2
       order by observed_at desc, created_at desc
       limit 1`,
      [tenantId ?? null, serviceAssetId],
    )).rows[0];
    return row ? toCertificateObservation(row) : undefined;
  }
}

type RiskEventRow = {
  id: string;
  tenant_id?: string | null;
  dedup_key: string;
  risk_type: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  scope: unknown;
  metadata: unknown;
  first_detected_at: string | Date;
  last_detected_at: string | Date;
  resolved_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  occurrence_count: number;
};

type RiskStatusHistoryRow = {
  id: string;
  tenant_id: string;
  risk_event_id: string;
  action: string;
  from_status?: string | null;
  to_status: string;
  reason?: string | null;
  actor_type: string;
  actor_id?: string | null;
  occurred_at: string | Date;
  metadata: unknown;
};

type MonitorTargetRow = {
  id: string;
  tenant_id: string;
  service_asset_id: string;
  metrics: unknown;
  interval_seconds: number;
  status: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type MonitorProbeResultRow = {
  id: string;
  tenant_id: string;
  monitor_target_id?: string | null;
  service_asset_id: string;
  source: string;
  probe_url: string;
  status: string;
  success: boolean;
  latency_ms: number;
  checked_at: string | Date;
  message: string;
  http_status?: number | null;
  certificate?: unknown;
  detail: unknown;
  created_at: string | Date;
};

function toMonitorTarget(row: MonitorTargetRow): MonitorTargetDto {
  const metrics = Array.isArray(row.metrics)
    ? row.metrics.map(String).filter((item) => ['availability', 'latency', 'certificate', 'certificateHistory'].includes(item))
    : [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceAssetId: row.service_asset_id,
    assetId: row.service_asset_id,
    metrics: metrics as MonitorTargetDto['metrics'],
    intervalSeconds: row.interval_seconds,
    status: row.status as MonitorTargetDto['status'],
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toMonitorProbeResult(row: MonitorProbeResultRow): MonitorProbeResultDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    monitorTargetId: row.monitor_target_id ?? undefined,
    serviceAssetId: row.service_asset_id,
    source: row.source as MonitorProbeResultDto['source'],
    url: row.probe_url,
    status: row.status as MonitorProbeResultDto['status'],
    success: row.success,
    latencyMs: Number(row.latency_ms),
    checkedAt: toIsoText(row.checked_at),
    message: row.message,
    httpStatus: row.http_status ?? undefined,
    certificate: Object.keys(asObject(row.certificate)).length === 0 ? undefined : asObject(row.certificate),
    detail: asObject(row.detail),
    createdAt: toIsoText(row.created_at),
  };
}

function page<T extends object>(
  items: T[],
  query: ListMonitorTargetsQuery,
  filterFn: (item: T, field: string, expected: string) => boolean,
): MonitorTargetPageDto {
  let filtered = items;
  for (const [field, expected] of Object.entries(query.filter)) {
    filtered = filtered.filter((item) => filterFn(item, field, expected));
  }
  if (query.sort) {
    const { field, direction } = query.sort;
    filtered = [...filtered].sort((left, right) => compareValues(readField(left, field), readField(right, field), direction));
  } else {
    filtered = [...filtered].sort((left, right) => compareValues(readField(left, 'createdAt'), readField(right, 'createdAt'), 'desc'));
  }
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize) as MonitorTargetDto[],
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

function readField(item: object, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const normalizedLeft = left === undefined || left === null ? '' : String(left);
  const normalizedRight = right === undefined || right === null ? '' : String(right);
  const result = normalizedLeft.localeCompare(normalizedRight);
  return direction === 'asc' ? result : -result;
}

function monitorTargetFilter(target: MonitorTargetDto, field: string, expected: string): boolean {
  if (field === 'serviceAssetId' || field === 'assetId') return target.serviceAssetId === expected;
  if (field === 'status') return target.status === expected;
  return String(readField(target, field) ?? '').toLowerCase().includes(expected.toLowerCase());
}

function requiredPersistedTenantId(tenantId: string | undefined): string {
  if (!tenantId) throw new AppError('AUTH_UNAUTHENTICATED', '监控风险缺少租户归属');
  return tenantId;
}

function toRiskEvent(row: RiskEventRow): RiskEvent {
  const scope = asObject(row.scope);
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    type: row.risk_type as RiskEvent['type'],
    source: row.source as RiskEvent['source'],
    status: row.status as RiskEvent['status'],
    severity: row.severity as RiskEvent['severity'],
    title: row.title,
    summary: row.summary,
    scope: {
      tenantId: row.tenant_id ?? undefined,
      certificateAssetId: scope.certificateAssetId as string | undefined,
      certificateVersionId: scope.certificateVersionId as string | undefined,
      bindingId: scope.bindingId as string | undefined,
      serviceAssetId: scope.serviceAssetId as string | undefined,
      executionRunId: scope.executionRunId as string | undefined,
      serviceInstanceId: scope.serviceInstanceId as string | undefined,
      hostId: scope.hostId as string | undefined,
    },
    metadata: asObject(row.metadata),
    firstDetectedAt: toIsoText(row.first_detected_at),
    lastDetectedAt: toIsoText(row.last_detected_at),
    resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? undefined : toIsoText(row.resolved_at),
    occurrenceCount: Number(row.occurrence_count ?? 1),
  };
}

function toRiskStatusHistory(row: RiskStatusHistoryRow): RiskStatusHistory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    riskEventId: row.risk_event_id,
    action: row.action as RiskStatusHistory['action'],
    fromStatus: row.from_status ? row.from_status as RiskStatusHistory['fromStatus'] : undefined,
    toStatus: row.to_status as RiskStatusHistory['toStatus'],
    reason: row.reason ?? undefined,
    actorType: row.actor_type as RiskStatusHistory['actorType'],
    actorId: row.actor_id ?? undefined,
    occurredAt: toIsoText(row.occurred_at),
    metadata: asObject(row.metadata),
  };
}

function riskActionTargetStatus(action: ChangeRiskStatusInput['action']): RiskEvent['status'] {
  if (action === 'acknowledged' || action === 'suppressed') return 'ACKED';
  if (action === 'ignored') return 'IGNORED';
  if (action === 'resolved') return 'RESOLVED';
  return 'OPEN';
}

async function insertRiskHistory(
  db: DatabasePort,
  input: Omit<RiskStatusHistory, 'id'>,
): Promise<RiskStatusHistory> {
  const history: RiskStatusHistory = { id: newId('riskhist'), ...input };
  await db.query(`insert into risk_status_history (
    id, tenant_id, risk_event_id, action, from_status, to_status, reason,
    actor_type, actor_id, occurred_at, metadata
  ) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::jsonb
  )`, [
    history.id,
    history.tenantId,
    history.riskEventId,
    history.action,
    history.fromStatus ?? null,
    history.toStatus,
    history.reason ?? null,
    history.actorType,
    history.actorId ?? null,
    history.occurredAt,
    JSON.stringify(history.metadata),
  ]);
  return history;
}

type AlertRuleRow = {
  id: string;
  tenant_id?: string | null;
  name: string;
  threshold: unknown;
  scope: unknown;
  status: string;
  silence?: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type CertificateObservationRow = {
  id: string;
  tenant_id?: string | null;
  service_asset_id: string;
  source: string;
  probe_url: string;
  observed_at: string;
  fingerprint_sha256: string;
  subject?: string | null;
  issuer?: string | null;
  serial_number?: string | null;
  not_before?: string | null;
  not_after?: string | null;
  dns_names: unknown;
  verified?: boolean | null;
  verification_error?: string | null;
  raw_result: unknown;
  created_at: string;
};

function toAlertRule(row: AlertRuleRow): AlertRule {
  const scope = asObject(row.scope);
  return {
    id: row.id,
    name: row.name,
    threshold: asObject(row.threshold) as unknown as AlertRule['threshold'],
    scope: {
      tenantId: (scope.tenantId as string | undefined) ?? row.tenant_id ?? undefined,
      riskTypes: Array.isArray(scope.riskTypes) ? scope.riskTypes as AlertRule['scope']['riskTypes'] : undefined,
      severities: Array.isArray(scope.severities) ? scope.severities as AlertRule['scope']['severities'] : undefined,
      certificateAssetId: scope.certificateAssetId as string | undefined,
      certificateVersionId: scope.certificateVersionId as string | undefined,
      bindingId: scope.bindingId as string | undefined,
      serviceInstanceId: scope.serviceInstanceId as string | undefined,
      hostId: scope.hostId as string | undefined,
    },
    status: row.status as AlertRule['status'],
    silence: Object.keys(asObject(row.silence)).length === 0 ? undefined : asObject(row.silence) as AlertRule['silence'],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCertificateObservation(row: CertificateObservationRow): CertificateObservationDto {
  const rawResult = asObject(row.raw_result);
  const rawCertificate = asObject(rawResult.certificate);
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    serviceAssetId: row.service_asset_id,
    source: row.source as CertificateObservationDto['source'],
    url: row.probe_url,
    observedAt: row.observed_at,
    fingerprintSha256: row.fingerprint_sha256,
    subject: row.subject ?? undefined,
    issuer: row.issuer ?? undefined,
    serialNumber: row.serial_number ?? undefined,
    notBefore: row.not_before ?? undefined,
    notAfter: row.not_after ?? undefined,
    dnsNames: Array.isArray(row.dns_names) ? row.dns_names.map(String).filter(Boolean) : undefined,
    verified: row.verified ?? undefined,
    verificationError: row.verification_error ?? undefined,
    chain: Array.isArray(rawCertificate.chain) ? rawCertificate.chain as CertificateObservationDto['chain'] : undefined,
    chainStatus: typeof rawCertificate.chainStatus === 'string' ? rawCertificate.chainStatus as CertificateObservationDto['chainStatus'] : undefined,
    rawResult,
    createdAt: row.created_at,
  };
}

function normalizeObservationFingerprint(value: string | undefined): string {
  return (value ?? '').replace(/[^a-f0-9]/giu, '').toUpperCase();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizePageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(500, Math.max(1, Math.trunc(value!)));
}

function toIsoText(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
