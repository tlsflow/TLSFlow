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
  claimDueMonitorTargets(now: string, limit: number, tenantId?: string): Promise<ClaimedMonitorSchedulerBatch[]>;
  claimRecoverableMonitorSchedulerWindows(now: string, limit: number): Promise<ClaimedMonitorSchedulerBatch[]>;
  markMonitorSchedulerWindowEnqueued(input: { tenantId: string; windowStart: string; taskId?: string }): Promise<void>;
  markMonitorSchedulerWindowFailed(input: { tenantId: string; windowStart: string; error: string }): Promise<void>;
  listMonitorTargetsByIds(tenantId: string, ids: readonly string[]): Promise<MonitorTargetDto[]>;
  getMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto | undefined>;
  updateMonitorTarget(input: UpdateMonitorTargetInput): Promise<MonitorTargetDto>;
  deleteMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto>;
  /** 按应用资产移除其监控目标，避免应用资产删除后监控页面留下孤立目标。 */
  deleteMonitorTargetsByServiceAssetId(tenantId: string, serviceAssetId: string): Promise<number>;
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

export interface ClaimedMonitorSchedulerBatch {
  tenantId: string;
  windowStart: string;
  candidateCount: number;
  targetIds: string[];
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
      id, tenant_id, service_asset_id, metrics, interval_seconds, status, next_run_at, created_by, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4::jsonb,$5,$6,$7::timestamptz,$8,$9::timestamptz,$10::timestamptz,$11
    )`, [
      target.id,
      target.tenantId,
      target.serviceAssetId,
      JSON.stringify(target.metrics),
      target.intervalSeconds,
      target.status,
      target.createdAt,
      target.createdBy ?? null,
      target.createdAt,
      target.updatedAt,
      target.version,
    ]);
    return target;
  }

  async listMonitorTargets(query: ListMonitorTargetsQuery): Promise<MonitorTargetPageDto> {
    const rows = (await this.db.query<MonitorTargetRow>(
      `select target.*,
              asset.display_name as asset_display_name,
              asset.address as asset_address,
              asset.deleted_at as asset_deleted_at
         from pg_monitor_targets target
         left join pg_service_assets asset
           on asset.id = target.service_asset_id
          and asset.tenant_id = target.tenant_id
        where target.tenant_id = $1
          and ($2::boolean or target.deleted_at is null)`,
      [query.tenantId, query.includeRemoved === true],
    )).rows.map(toMonitorTarget);
    return page(rows, query, monitorTargetFilter);
  }

  async claimDueMonitorTargets(nowInput: string, limit: number, tenantId?: string): Promise<ClaimedMonitorSchedulerBatch[]> {
    const now = normalizeSchedulerNow(nowInput);
    const windowStart = monitorSchedulerWindowStart(now);
    const normalizedLimit = normalizeSchedulerLimit(limit);
    return this.db.transaction(async (tx) => {
      const params: unknown[] = [now, windowStart, normalizedLimit];
      const tenantFilter = tenantId ? `and target.tenant_id = $4` : '';
      if (tenantId) params.push(tenantId);
      const candidates = (await tx.query<MonitorTargetRow>(
        `select target.*
           from pg_monitor_targets target
          where target.deleted_at is null
            and target.status = 'active'
            and target.next_run_at <= $1::timestamptz
            and not exists (
              select 1
                from pg_monitor_scheduler_windows scheduler_window
               where scheduler_window.tenant_id = target.tenant_id
                 and scheduler_window.window_start = $2::timestamptz
            )
            ${tenantFilter}
          order by target.next_run_at asc, target.tenant_id asc, target.id asc
          limit $3
          for update skip locked`,
        params,
      )).rows;
      const batches: ClaimedMonitorSchedulerBatch[] = [];
      for (const [candidateTenantId, rows] of groupMonitorTargetsByTenant(candidates)) {
        const targetIds = rows.map((row) => row.id);
        const inserted = (await tx.query<MonitorSchedulerWindowRow>(
          `insert into pg_monitor_scheduler_windows (
             tenant_id, window_start, candidate_count, target_ids, status, created_at, updated_at
           ) values ($1, $2::timestamptz, $3, $4::jsonb, 'CLAIMED', $5::timestamptz, $5::timestamptz)
           on conflict (tenant_id, window_start) do nothing
           returning tenant_id, window_start, task_id, candidate_count, target_ids, status, updated_at`,
          [candidateTenantId, windowStart, targetIds.length, JSON.stringify(targetIds), now],
        )).rows[0];
        if (!inserted) continue;
        await tx.query(
          `update pg_monitor_targets
              set next_run_at = $2::timestamptz + (interval_seconds * interval '1 second')
            where tenant_id = $1
              and id = any($3::text[])
              and deleted_at is null
              and status = 'active'`,
          [candidateTenantId, now, targetIds],
        );
        batches.push(toClaimedMonitorSchedulerBatch(inserted));
      }
      return batches;
    });
  }

  async claimRecoverableMonitorSchedulerWindows(nowInput: string, limit: number): Promise<ClaimedMonitorSchedulerBatch[]> {
    const now = normalizeSchedulerNow(nowInput);
    const normalizedLimit = normalizeSchedulerLimit(limit);
    return this.db.transaction(async (tx) => {
      const windows = (await tx.query<MonitorSchedulerWindowRow>(
        `select tenant_id, window_start, task_id, candidate_count, target_ids, status, updated_at
           from pg_monitor_scheduler_windows
          where task_id is null
            and (
              status = 'FAILED'
              or (status = 'CLAIMED' and updated_at <= $1::timestamptz - interval '1 minute')
            )
          order by updated_at asc, tenant_id asc, window_start asc
          limit $2
          for update skip locked`,
        [now, normalizedLimit],
      )).rows;
      const claimed: ClaimedMonitorSchedulerBatch[] = [];
      for (const window of windows) {
        const updated = (await tx.query<MonitorSchedulerWindowRow>(
          `update pg_monitor_scheduler_windows
              set status = 'CLAIMED',
                  last_error = null,
                  updated_at = $3::timestamptz
            where tenant_id = $1
              and window_start = $2::timestamptz
              and task_id is null
            returning tenant_id, window_start, task_id, candidate_count, target_ids, status, updated_at`,
          [window.tenant_id, window.window_start, now],
        )).rows[0];
        if (updated) claimed.push(toClaimedMonitorSchedulerBatch(updated));
      }
      return claimed;
    });
  }

  async markMonitorSchedulerWindowEnqueued(input: { tenantId: string; windowStart: string; taskId?: string }): Promise<void> {
    const windowStart = normalizeSchedulerNow(input.windowStart);
    await this.db.query(
      `update pg_monitor_scheduler_windows
          set status = 'ENQUEUED',
              task_id = coalesce($3, task_id),
              last_error = null,
              updated_at = now()
        where tenant_id = $1
          and window_start = $2::timestamptz`,
      [input.tenantId, windowStart, input.taskId ?? null],
    );
  }

  async markMonitorSchedulerWindowFailed(input: { tenantId: string; windowStart: string; error: string }): Promise<void> {
    const windowStart = normalizeSchedulerNow(input.windowStart);
    await this.db.query(
      `update pg_monitor_scheduler_windows
          set status = 'FAILED',
              last_error = $3,
              updated_at = now()
        where tenant_id = $1
          and window_start = $2::timestamptz
          and task_id is null`,
      [input.tenantId, windowStart, input.error.slice(0, 2_000)],
    );
  }

  async listMonitorTargetsByIds(tenantId: string, ids: readonly string[]): Promise<MonitorTargetDto[]> {
    const targetIds = uniqueMonitorTargetIds(ids);
    if (targetIds.length === 0) return [];
    const rows = (await this.db.query<MonitorTargetRow>(
      `select *
         from pg_monitor_targets
        where tenant_id = $1
          and id = any($2::text[])
          and deleted_at is null
          and status = 'active'`,
      [tenantId, targetIds],
    )).rows;
    const byId = new Map(rows.map((row) => [row.id, toMonitorTarget(row)]));
    return targetIds.flatMap((id) => {
      const target = byId.get(id);
      return target ? [target] : [];
    });
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
    const nextRunAt = updated.status === 'active'
      && (current.status !== 'active' || updated.intervalSeconds !== current.intervalSeconds)
      ? updated.updatedAt
      : undefined;
    await this.db.query(`update pg_monitor_targets
      set metrics = $3::jsonb,
          interval_seconds = $4,
          status = $5,
          next_run_at = coalesce($6::timestamptz, next_run_at),
          updated_at = $7::timestamptz,
          version = $8
      where tenant_id = $1 and id = $2 and deleted_at is null`, [
      input.tenantId,
      input.id,
      JSON.stringify(updated.metrics),
      updated.intervalSeconds,
      updated.status,
      nextRunAt ?? null,
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

  async deleteMonitorTargetsByServiceAssetId(tenantId: string, serviceAssetId: string): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db.query<{ id: string }>(`update pg_monitor_targets
      set deleted_at = $3::timestamptz,
          updated_at = $3::timestamptz,
          version = version + 1
      where tenant_id = $1
        and service_asset_id = $2
        and deleted_at is null
      returning id`, [tenantId, serviceAssetId, now]);
    return result.rows.length;
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
    // 中文说明：过滤条件下沉到 SQL（命中 idx_pg_monitor_probe_results_asset/target 索引），
    // 避免监控目标增多后全表扫描拖慢监控页与按资产懒加载。
    const conditions: string[] = [];
    const params: unknown[] = [];
    addOptionalCondition(query.tenantId, 'tenant_id = $PARAM', conditions, params);
    addOptionalCondition(query.monitorTargetId, 'monitor_target_id = $PARAM', conditions, params);
    addOptionalCondition(query.serviceAssetId, 'service_asset_id = $PARAM', conditions, params);
    params.push(normalizePageSize(query.pageSize));
    const rows = (await this.db.query<MonitorProbeResultRow>(
      `select * from pg_monitor_probe_results
       ${conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''}
       order by checked_at desc, created_at desc
       limit $${params.length}`,
      params,
    )).rows.map(toMonitorProbeResult);
    return rows;
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
      // 中文说明：最新指纹未变化时只更新证书内容，保留原有观测时间，避免无意义地刷新历史时间线。
      return this.updateCertificateObservation(latest, input, false);
    }

    // 中文说明：唯一索引按“资产 + 指纹”限制历史记录数量；证书回切时，历史指纹可能不是最新一条，
    // 此时必须复用原记录，否则会在插入阶段触发唯一约束并阻断资产状态写回。
    const historical = await this.getCertificateObservationByFingerprint(input.tenantId, input.serviceAssetId, input.fingerprintSha256);
    if (historical) {
      return this.updateCertificateObservation(historical, input, true);
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

  private async getCertificateObservationByFingerprint(
    tenantId: string | undefined,
    serviceAssetId: string,
    fingerprintSha256: string,
  ): Promise<CertificateObservationDto | undefined> {
    const row = (await this.db.query<CertificateObservationRow>(
      `select * from pg_monitor_certificate_observations
       where coalesce(tenant_id, '') = coalesce($1, '')
         and service_asset_id = $2
         and upper(regexp_replace(fingerprint_sha256, '[^a-fA-F0-9]', '', 'g')) =
             upper(regexp_replace($3, '[^a-fA-F0-9]', '', 'g'))
       order by observed_at desc, created_at desc
       limit 1`,
      [tenantId ?? null, serviceAssetId, fingerprintSha256],
    )).rows[0];
    return row ? toCertificateObservation(row) : undefined;
  }

  private async updateCertificateObservation(
    current: CertificateObservationDto,
    input: SaveCertificateObservationInput,
    updateObservedAt: boolean,
  ): Promise<CertificateObservationDto> {
    const updated: CertificateObservationDto = {
      ...current,
      source: input.source,
      url: input.url,
      observedAt: updateObservedAt ? input.observedAt : current.observedAt,
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
      source = $2, probe_url = $3, observed_at = $4::timestamptz, subject = $5, issuer = $6, serial_number = $7,
      not_before = $8, not_after = $9, dns_names = $10::jsonb, verified = $11,
      verification_error = $12, raw_result = $13::jsonb
      where id = $1`, [
      updated.id,
      updated.source,
      updated.url,
      updated.observedAt,
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

  async listCertificateObservations(query: ListCertificateObservationsQuery = {}): Promise<CertificateObservationDto[]> {
    // 中文说明：去重与过滤条件下沉到 SQL（distinct on 保留每个资产+指纹的最新观测），
    // 避免监控目标增多后全表扫描拖慢监控页与按资产懒加载。
    const conditions: string[] = [];
    const params: unknown[] = [];
    addOptionalCondition(query.tenantId, 'tenant_id = $PARAM', conditions, params);
    addOptionalCondition(query.serviceAssetId, 'service_asset_id = $PARAM', conditions, params);
    params.push(normalizePageSize(query.pageSize));
    const rows = (await this.db.query<CertificateObservationRow>(
      `select * from (
         select distinct on (
           service_asset_id,
           upper(regexp_replace(fingerprint_sha256, '[^a-f0-9]', '', 'g'))
         ) *
         from pg_monitor_certificate_observations
         ${conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''}
         order by service_asset_id,
                  upper(regexp_replace(fingerprint_sha256, '[^a-f0-9]', '', 'g')),
                  observed_at desc,
                  created_at desc
       ) t
       order by observed_at desc, created_at desc
       limit $${params.length}`,
      params,
    )).rows.map(toCertificateObservation);
    return rows;
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
  asset_display_name?: string | null;
  asset_address?: string | null;
  asset_deleted_at?: string | null;
  version: number;
};

type MonitorSchedulerWindowRow = {
  tenant_id: string;
  window_start: string | Date;
  task_id?: string | null;
  candidate_count: number | string;
  target_ids: unknown;
  status: 'CLAIMED' | 'ENQUEUED' | 'FAILED';
  updated_at: string | Date;
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
    assetDisplayName: row.asset_display_name ?? undefined,
    assetAddress: row.asset_address ?? undefined,
    assetDeletedAt: row.asset_deleted_at ?? undefined,
    version: row.version,
  };
}

function toClaimedMonitorSchedulerBatch(row: MonitorSchedulerWindowRow): ClaimedMonitorSchedulerBatch {
  return {
    tenantId: row.tenant_id,
    windowStart: toIsoTimestamp(row.window_start),
    candidateCount: Number(row.candidate_count),
    targetIds: uniqueMonitorTargetIds(readMonitorTargetIds(row.target_ids)),
  };
}

function groupMonitorTargetsByTenant(rows: readonly MonitorTargetRow[]): Map<string, MonitorTargetRow[]> {
  const grouped = new Map<string, MonitorTargetRow[]>();
  for (const row of rows) {
    const items = grouped.get(row.tenant_id) ?? [];
    items.push(row);
    grouped.set(row.tenant_id, items);
  }
  return grouped;
}

function normalizeSchedulerNow(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError('VALIDATION_FAILED', '监控调度时间无效');
  return parsed.toISOString();
}

function monitorSchedulerWindowStart(now: string): string {
  const parsed = new Date(now);
  parsed.setUTCSeconds(0, 0);
  return parsed.toISOString();
}

function normalizeSchedulerLimit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

function uniqueMonitorTargetIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function readMonitorTargetIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toIsoTimestamp(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('监控调度账本包含无效时间');
  return parsed.toISOString();
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

function addOptionalCondition(value: string | undefined, template: string, conditions: string[], params: unknown[]): void {
  if (value === undefined) return;
  params.push(value);
  conditions.push(template.replace('$PARAM', `$${params.length}`));
}

function toIsoText(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
