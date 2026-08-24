import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type {
  CompleteDeliveryAttemptInput,
  CreateNotificationChannelInput,
  CreateNotificationRouteInput,
  CreateNotificationSilenceInput,
  NotificationPage,
  NotificationPageQuery,
  UpdateNotificationChannelInput,
  UpdateNotificationRouteInput,
  UpdateNotificationSettingsInput,
  UpdateNotificationSilenceInput,
  UpsertNotificationTemplateInput,
} from '../dto/notifications.dto.js';
import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationRequest,
  NotificationRequestStatus,
  NotificationSettings,
  NotificationRoute,
  NotificationSilence,
  NotificationTemplate,
} from '../schema/notifications.schema.js';

export interface CreateNotificationRequestRecordInput {
  tenantId: string;
  source: string;
  eventKey: string;
  idempotencyKey: string;
  templateKey: string;
  routeId?: string;
  channelId?: string;
  context: Record<string, unknown>;
  sourceRefs: Record<string, string>;
  status: NotificationRequestStatus;
  statusReason?: string;
  deliveries: Array<{
    channel: NotificationChannel;
    target: Record<string, unknown>;
    renderedTitle?: string;
    renderedBody?: string;
    status?: 'queued' | 'suppressed';
    failureMessage?: string;
  }>;
}

export interface NotificationsRepository {
  getSettings(tenantId: string): Promise<NotificationSettings>;
  updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettings>;
  createChannel(input: CreateNotificationChannelInput): Promise<NotificationChannel>;
  updateChannel(input: UpdateNotificationChannelInput): Promise<NotificationChannel>;
  deleteChannel(tenantId: string, id: string, version: number): Promise<NotificationChannel>;
  getChannel(tenantId: string, id: string): Promise<NotificationChannel | undefined>;
  listChannels(tenantId: string): Promise<NotificationChannel[]>;
  updateChannelHealth(id: string, success: boolean, latencyMs?: number): Promise<void>;
  createRoute(input: CreateNotificationRouteInput): Promise<NotificationRoute>;
  updateRoute(input: UpdateNotificationRouteInput): Promise<NotificationRoute>;
  deleteRoute(tenantId: string, id: string, version: number): Promise<NotificationRoute>;
  getRoute(tenantId: string, id: string): Promise<NotificationRoute | undefined>;
  listRoutes(tenantId: string): Promise<NotificationRoute[]>;
  upsertTemplate(input: UpsertNotificationTemplateInput): Promise<NotificationTemplate>;
  getTemplate(tenantId: string, templateKey: string, locale: string): Promise<NotificationTemplate | undefined>;
  listTemplates(tenantId: string): Promise<NotificationTemplate[]>;
  createSilence(input: CreateNotificationSilenceInput): Promise<NotificationSilence>;
  updateSilence(input: UpdateNotificationSilenceInput): Promise<NotificationSilence>;
  deleteSilence(tenantId: string, id: string, version: number): Promise<NotificationSilence>;
  listSilences(tenantId: string): Promise<NotificationSilence[]>;
  createRequest(input: CreateNotificationRequestRecordInput): Promise<NotificationRequest>;
  getRequestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<NotificationRequest | undefined>;
  getRequest(tenantId: string, id: string): Promise<NotificationRequest | undefined>;
  listRecentRequests(tenantId: string, eventKey: string, since: string): Promise<NotificationRequest[]>;
  listRequests(query: NotificationPageQuery): Promise<NotificationPage<NotificationRequest>>;
  listDeliveries(query: NotificationPageQuery): Promise<NotificationPage<NotificationDelivery>>;
  getDelivery(tenantId: string, id: string): Promise<NotificationDelivery | undefined>;
  leaseNextDelivery(workerId: string, leaseSeconds: number): Promise<NotificationDelivery | undefined>;
  leaseDelivery(tenantId: string, deliveryId: string, workerId: string, leaseSeconds: number): Promise<NotificationDelivery | undefined>;
  completeDeliveryAttempt(input: CompleteDeliveryAttemptInput): Promise<NotificationDelivery>;
  retryDelivery(tenantId: string, id: string): Promise<NotificationDelivery>;
  refreshRequestStatus(requestId: string): Promise<NotificationRequestStatus>;
}

export class PgNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async getSettings(tenantId: string): Promise<NotificationSettings> {
    const result = await this.db.query<SettingsRow>('select * from notification_settings where tenant_id=$1', [tenantId]);
    return result.rows[0] ? toSettings(result.rows[0]) : emptySettings(tenantId);
  }

  async updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettings> {
    const now = new Date().toISOString();
    if (input.version === 0) {
      const created = await this.db.query<SettingsRow>(`insert into notification_settings (
        tenant_id, private_origins, updated_by, created_at, updated_at
      ) values ($1,$2::jsonb,$3,$4::timestamptz,$4::timestamptz)
      on conflict (tenant_id) do nothing returning *`, [input.tenantId, json(input.privateOrigins), input.updatedBy, now]);
      if (created.rows[0]) return toSettings(created.rows[0]);
    }
    const result = await this.db.query<SettingsRow>(`update notification_settings set
      private_origins=$1::jsonb, updated_by=$2, updated_at=$3::timestamptz, version=version+1
      where tenant_id=$4 and version=$5 returning *`, [
      json(input.privateOrigins), input.updatedBy, now, input.tenantId, input.version,
    ]);
    return toSettings(requireUpdated(result.rows[0], '通知设置版本已变化', input));
  }

  async createChannel(input: CreateNotificationChannelInput): Promise<NotificationChannel> {
    const now = new Date().toISOString();
    const id = newId('nch');
    const result = await this.db.query<ChannelRow>(`insert into notification_channels (
      id, tenant_id, name, type, status, config, secret_refs, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$8::timestamptz) returning *`, [
      id, input.tenantId, input.name, input.type, input.status ?? 'disabled', json(input.config), json(input.secretRefs), now,
    ]);
    return toChannel(result.rows[0]!);
  }

  async updateChannel(input: UpdateNotificationChannelInput): Promise<NotificationChannel> {
    const existing = await this.requireChannel(input.tenantId, input.id);
    const result = await this.db.query<ChannelRow>(`update notification_channels set
      name=$1, status=$2, config=$3::jsonb, secret_refs=$4::jsonb, updated_at=now(), version=version+1
      where tenant_id=$5 and id=$6 and version=$7 and deleted_at is null returning *`, [
      input.name ?? existing.name,
      input.status ?? existing.status,
      json(input.config ?? existing.config),
      json(input.secretRefs ?? existing.secretRefs),
      input.tenantId,
      input.id,
      input.version,
    ]);
    return toChannel(requireUpdated(result.rows[0], '通知渠道版本已变化', input));
  }

  async deleteChannel(tenantId: string, id: string, version: number): Promise<NotificationChannel> {
    const result = await this.db.query<ChannelRow>(`update notification_channels set
      status='deleted', deleted_at=now(), updated_at=now(), version=version+1
      where tenant_id=$1 and id=$2 and version=$3 and deleted_at is null returning *`, [tenantId, id, version]);
    return toChannel(requireUpdated(result.rows[0], '通知渠道版本已变化', { id, version }));
  }

  async getChannel(tenantId: string, id: string): Promise<NotificationChannel | undefined> {
    const result = await this.db.query<ChannelRow>('select * from notification_channels where tenant_id=$1 and id=$2 and deleted_at is null', [tenantId, id]);
    return result.rows[0] ? toChannel(result.rows[0]) : undefined;
  }

  async listChannels(tenantId: string): Promise<NotificationChannel[]> {
    const result = await this.db.query<ChannelRow>('select * from notification_channels where tenant_id=$1 and deleted_at is null order by updated_at desc', [tenantId]);
    return result.rows.map(toChannel);
  }

  async updateChannelHealth(id: string, success: boolean, latencyMs?: number): Promise<void> {
    if (success) {
      await this.db.query(`update notification_channels set health_status='healthy', consecutive_failures=0,
        last_succeeded_at=now(), last_latency_ms=$2, updated_at=now() where id=$1`, [id, latencyMs ?? null]);
      return;
    }
    await this.db.query(`update notification_channels set
      consecutive_failures=consecutive_failures+1,
      health_status=case when consecutive_failures+1 >= 5 then 'unavailable' else 'degraded' end,
      last_failed_at=now(), last_latency_ms=$2, updated_at=now() where id=$1`, [id, latencyMs ?? null]);
  }

  async createRoute(input: CreateNotificationRouteInput): Promise<NotificationRoute> {
    const now = new Date().toISOString();
    const result = await this.db.query<RouteRow>(`insert into notification_routes (
      id, tenant_id, name, status, priority, matcher, channel_targets, stop_on_match, dedupe_window_seconds, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz,$10::timestamptz) returning *`, [
      newId('nrt'), input.tenantId, input.name, input.status ?? 'active', input.priority, json(input.matcher),
      json(input.channelTargets), input.stopOnMatch ?? false, input.dedupeWindowSeconds ?? 0, now,
    ]);
    return toRoute(result.rows[0]!);
  }

  async updateRoute(input: UpdateNotificationRouteInput): Promise<NotificationRoute> {
    const existing = await this.requireRoute(input.tenantId, input.id);
    const result = await this.db.query<RouteRow>(`update notification_routes set
      name=$1,status=$2,priority=$3,matcher=$4::jsonb,channel_targets=$5::jsonb,stop_on_match=$6,
      dedupe_window_seconds=$7,updated_at=now(),version=version+1
      where tenant_id=$8 and id=$9 and version=$10 and deleted_at is null returning *`, [
      input.name ?? existing.name, input.status ?? existing.status, input.priority ?? existing.priority,
      json(input.matcher ?? existing.matcher), json(input.channelTargets ?? existing.channelTargets),
      input.stopOnMatch ?? existing.stopOnMatch, input.dedupeWindowSeconds ?? existing.dedupeWindowSeconds,
      input.tenantId, input.id, input.version,
    ]);
    return toRoute(requireUpdated(result.rows[0], '通知路由版本已变化', input));
  }

  async deleteRoute(tenantId: string, id: string, version: number): Promise<NotificationRoute> {
    const result = await this.db.query<RouteRow>(`update notification_routes set status='deleted',deleted_at=now(),updated_at=now(),version=version+1
      where tenant_id=$1 and id=$2 and version=$3 and deleted_at is null returning *`, [tenantId, id, version]);
    return toRoute(requireUpdated(result.rows[0], '通知路由版本已变化', { id, version }));
  }

  async getRoute(tenantId: string, id: string): Promise<NotificationRoute | undefined> {
    const result = await this.db.query<RouteRow>('select * from notification_routes where tenant_id=$1 and id=$2 and deleted_at is null', [tenantId, id]);
    return result.rows[0] ? toRoute(result.rows[0]) : undefined;
  }

  async listRoutes(tenantId: string): Promise<NotificationRoute[]> {
    const result = await this.db.query<RouteRow>(`select * from notification_routes where tenant_id=$1 and deleted_at is null
      order by priority asc, created_at asc`, [tenantId]);
    return result.rows.map(toRoute);
  }

  async upsertTemplate(input: UpsertNotificationTemplateInput): Promise<NotificationTemplate> {
    const now = new Date().toISOString();
    const result = await this.db.query<TemplateRow>(`insert into notification_templates (
      id,tenant_id,template_key,locale,title_template,body_template,required_variables,status,created_at,updated_at,version
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::timestamptz,$9::timestamptz,1)
    on conflict (tenant_id,template_key,locale) do update set
      title_template=excluded.title_template,body_template=excluded.body_template,required_variables=excluded.required_variables,
      status=excluded.status,updated_at=excluded.updated_at,version=notification_templates.version+1
    where $10::int is null or notification_templates.version=$10 returning *`, [
      newId('ntp'), input.tenantId, input.templateKey, input.locale, input.titleTemplate, input.bodyTemplate,
      json(input.requiredVariables), input.status ?? 'active', now, input.version ?? null,
    ]);
    return toTemplate(requireUpdated(result.rows[0], '通知模板版本已变化', input));
  }

  async getTemplate(tenantId: string, templateKey: string, locale: string): Promise<NotificationTemplate | undefined> {
    const result = await this.db.query<TemplateRow>(`select * from notification_templates
      where tenant_id=$1 and template_key=$2 and locale in ($3,'zh-CN') and status='active'
      order by case when locale=$3 then 0 else 1 end limit 1`, [tenantId, templateKey, locale]);
    return result.rows[0] ? toTemplate(result.rows[0]) : undefined;
  }

  async listTemplates(tenantId: string): Promise<NotificationTemplate[]> {
    const result = await this.db.query<TemplateRow>('select * from notification_templates where tenant_id=$1 order by template_key,locale', [tenantId]);
    return result.rows.map(toTemplate);
  }

  async createSilence(input: CreateNotificationSilenceInput): Promise<NotificationSilence> {
    const now = new Date().toISOString();
    const result = await this.db.query<SilenceRow>(`insert into notification_silences (
      id,tenant_id,name,status,matcher,reason,starts_at,ends_at,created_by,created_at,updated_at
    ) values ($1,$2,$3,'active',$4::jsonb,$5,$6::timestamptz,$7::timestamptz,$8,$9::timestamptz,$9::timestamptz) returning *`, [
      newId('nsl'), input.tenantId, input.name, json(input.matcher), input.reason, input.startsAt, input.endsAt, input.createdBy, now,
    ]);
    return toSilence(result.rows[0]!);
  }

  async updateSilence(input: UpdateNotificationSilenceInput): Promise<NotificationSilence> {
    const existing = (await this.listSilences(input.tenantId)).find((item) => item.id === input.id);
    if (!existing) throw new AppError('RESOURCE_NOT_FOUND', '通知静默不存在', { id: input.id });
    const result = await this.db.query<SilenceRow>(`update notification_silences set
      name=$1,status=$2,matcher=$3::jsonb,reason=$4,starts_at=$5::timestamptz,ends_at=$6::timestamptz,
      updated_at=now(),version=version+1 where tenant_id=$7 and id=$8 and version=$9 and deleted_at is null returning *`, [
      input.name ?? existing.name, input.status ?? existing.status, json(input.matcher ?? existing.matcher),
      input.reason ?? existing.reason, input.startsAt ?? existing.startsAt, input.endsAt ?? existing.endsAt,
      input.tenantId, input.id, input.version,
    ]);
    return toSilence(requireUpdated(result.rows[0], '通知静默版本已变化', input));
  }

  async deleteSilence(tenantId: string, id: string, version: number): Promise<NotificationSilence> {
    const result = await this.db.query<SilenceRow>(`update notification_silences set status='deleted',deleted_at=now(),updated_at=now(),version=version+1
      where tenant_id=$1 and id=$2 and version=$3 and deleted_at is null returning *`, [tenantId, id, version]);
    return toSilence(requireUpdated(result.rows[0], '通知静默版本已变化', { id, version }));
  }

  async listSilences(tenantId: string): Promise<NotificationSilence[]> {
    const result = await this.db.query<SilenceRow>('select * from notification_silences where tenant_id=$1 and deleted_at is null order by created_at desc', [tenantId]);
    return result.rows.map(toSilence);
  }

  async createRequest(input: CreateNotificationRequestRecordInput): Promise<NotificationRequest> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.query<RequestRow>('select * from notification_requests where tenant_id=$1 and idempotency_key=$2', [input.tenantId, input.idempotencyKey]);
      if (existing.rows[0]) return toRequest(existing.rows[0]);
      const now = new Date().toISOString();
      const requestId = newId('nrq');
      const requestResult = await tx.query<RequestRow>(`insert into notification_requests (
        id,tenant_id,source,event_key,idempotency_key,template_key,route_id,channel_id,context,source_refs,status,status_reason,created_at,updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::timestamptz,$13::timestamptz) returning *`, [
        requestId, input.tenantId, input.source, input.eventKey, input.idempotencyKey, input.templateKey,
        input.routeId ?? null, input.channelId ?? null, json(input.context), json(input.sourceRefs), input.status,
        input.statusReason ?? null, now,
      ]);
      for (const delivery of input.deliveries) {
        await tx.query(`insert into notification_deliveries (
          id,tenant_id,request_id,channel_id,channel_name_snapshot,channel_type,target_snapshot,rendered_title,rendered_body,
          status,next_attempt_at,failure_message,created_at,updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::timestamptz,$12,$13::timestamptz,$13::timestamptz)`, [
          newId('ndl'), input.tenantId, requestId, delivery.channel.id, delivery.channel.name, delivery.channel.type,
          json(delivery.target), delivery.renderedTitle ?? null, delivery.renderedBody ?? null, delivery.status ?? 'queued',
          delivery.status === 'suppressed' ? null : now, delivery.failureMessage ?? null, now,
        ]);
      }
      return toRequest(requestResult.rows[0]!);
    });
  }

  async getRequestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<NotificationRequest | undefined> {
    const result = await this.db.query<RequestRow>('select * from notification_requests where tenant_id=$1 and idempotency_key=$2', [tenantId, idempotencyKey]);
    return result.rows[0] ? toRequest(result.rows[0]) : undefined;
  }

  async getRequest(tenantId: string, id: string): Promise<NotificationRequest | undefined> {
    const result = await this.db.query<RequestRow>('select * from notification_requests where tenant_id=$1 and id=$2', [tenantId, id]);
    return result.rows[0] ? toRequest(result.rows[0]) : undefined;
  }

  async listRecentRequests(tenantId: string, eventKey: string, since: string): Promise<NotificationRequest[]> {
    const result = await this.db.query<RequestRow>(`select * from notification_requests
      where tenant_id=$1 and event_key=$2 and created_at >= $3::timestamptz order by created_at desc`, [tenantId, eventKey, since]);
    return result.rows.map(toRequest);
  }

  async listRequests(query: NotificationPageQuery): Promise<NotificationPage<NotificationRequest>> {
    const { where, params } = buildPageWhere(query, false);
    return this.page<RequestRow, NotificationRequest>('notification_requests', where, params, query, toRequest);
  }

  async listDeliveries(query: NotificationPageQuery): Promise<NotificationPage<NotificationDelivery>> {
    const { where, params } = buildPageWhere(query, true);
    return this.page<DeliveryRow, NotificationDelivery>('notification_deliveries', where, params, query, toDelivery);
  }

  async getDelivery(tenantId: string, id: string): Promise<NotificationDelivery | undefined> {
    const result = await this.db.query<DeliveryRow>('select * from notification_deliveries where tenant_id=$1 and id=$2', [tenantId, id]);
    return result.rows[0] ? toDelivery(result.rows[0]) : undefined;
  }

  async leaseNextDelivery(workerId: string, leaseSeconds: number): Promise<NotificationDelivery | undefined> {
    const result = await this.db.query<DeliveryRow>(`update notification_deliveries set
      status='sending',lease_owner=$1,lease_until=now()+($2::text || ' seconds')::interval,
      attempt_count=attempt_count+1,updated_at=now()
      where id=(select id from notification_deliveries
        where (status in ('queued','retrying') and coalesce(next_attempt_at,now()) <= now())
           or (status='sending' and lease_until < now())
        order by created_at asc limit 1 for update skip locked)
      returning *`, [workerId, leaseSeconds]);
    const row = result.rows[0];
    if (!row) return undefined;
    await this.db.query(`insert into notification_delivery_attempts (
      id,tenant_id,delivery_id,attempt_no,started_at,response_summary
    ) values ($1,$2,$3,$4,now(),'{}'::jsonb) on conflict (delivery_id,attempt_no) do nothing`, [
      newId('nat'), row.tenant_id, row.id, row.attempt_count,
    ]);
    return toDelivery(row);
  }

  async leaseDelivery(tenantId: string, deliveryId: string, workerId: string, leaseSeconds: number): Promise<NotificationDelivery | undefined> {
    const result = await this.db.query<DeliveryRow>(`update notification_deliveries set
      status='sending',lease_owner=$1,lease_until=now()+($2::text || ' seconds')::interval,
      attempt_count=attempt_count+1,updated_at=now()
      where tenant_id=$3 and id=$4
        and (((status in ('queued','retrying') and coalesce(next_attempt_at,now()) <= now())
           or (status='sending' and lease_until < now())))
      returning *`, [workerId, leaseSeconds, tenantId, deliveryId]);
    const row = result.rows[0];
    if (!row) return undefined;
    await this.db.query(`insert into notification_delivery_attempts (
      id,tenant_id,delivery_id,attempt_no,started_at,response_summary
    ) values ($1,$2,$3,$4,now(),'{}'::jsonb) on conflict (delivery_id,attempt_no) do nothing`, [
      newId('nat'), row.tenant_id, row.id, row.attempt_count,
    ]);
    return toDelivery(row);
  }

  async completeDeliveryAttempt(input: CompleteDeliveryAttemptInput): Promise<NotificationDelivery> {
    const result = await this.db.transaction(async (tx) => {
      const deliveryResult = await tx.query<DeliveryRow>('select * from notification_deliveries where id=$1', [input.deliveryId]);
      const delivery = deliveryResult.rows[0];
      if (!delivery || delivery.lease_owner !== input.leaseOwner || delivery.status !== 'sending') {
        throw new AppError('NOTIFICATION_DELIVERY_REJECTED', '通知投递租约已失效', { deliveryId: input.deliveryId });
      }
      const exhausted = delivery.attempt_count >= delivery.max_attempts;
      const nextStatus = input.success ? 'delivered' : input.retryable && !exhausted ? 'retrying' : 'failed';
      const updated = await tx.query<DeliveryRow>(`update notification_deliveries set
        status=$1,next_attempt_at=$2::timestamptz,lease_owner=null,lease_until=null,failure_category=$3,failure_message=$4,
        response_summary=$5::jsonb,external_id=$6,latency_ms=$7,delivered_at=case when $1='delivered' then now() else delivered_at end,
        updated_at=now() where id=$8 and lease_owner=$9 returning *`, [
        nextStatus, nextStatus === 'retrying' ? input.nextAttemptAt ?? new Date(Date.now() + 30_000).toISOString() : null,
        input.failureCategory ?? null, input.failureMessage ?? null, json(input.responseSummary), input.externalId ?? null,
        input.latencyMs ?? null, input.deliveryId, input.leaseOwner,
      ]);
      await tx.query(`update notification_delivery_attempts set finished_at=now(),success=$1,retryable=$2,
        failure_category=$3,failure_message=$4,status_code=$5,latency_ms=$6,response_summary=$7::jsonb
        where delivery_id=$8 and attempt_no=$9`, [
        input.success, input.retryable, input.failureCategory ?? null, input.failureMessage ?? null,
        input.statusCode ?? null, input.latencyMs ?? null, json(input.responseSummary), input.deliveryId, delivery.attempt_count,
      ]);
      return updated.rows[0]!;
    });
    await this.refreshRequestStatus(result.request_id);
    return toDelivery(result);
  }

  async retryDelivery(tenantId: string, id: string): Promise<NotificationDelivery> {
    const result = await this.db.query<DeliveryRow>(`update notification_deliveries set
      status='queued',attempt_count=0,next_attempt_at=now(),lease_owner=null,lease_until=null,
      failure_category=null,failure_message=null,updated_at=now()
      where tenant_id=$1 and id=$2 and status='failed' returning *`, [tenantId, id]);
    const row = result.rows[0];
    if (!row) throw new AppError('NOTIFICATION_DELIVERY_REJECTED', '仅最终失败的投递可以重发', { id });
    await this.refreshRequestStatus(row.request_id);
    return toDelivery(row);
  }

  async refreshRequestStatus(requestId: string): Promise<NotificationRequestStatus> {
    const result = await this.db.query<{ status: string }>(`select status from notification_deliveries where request_id=$1`, [requestId]);
    const statuses = result.rows.map((row) => row.status);
    const status = aggregate(statuses);
    await this.db.query('update notification_requests set status=$1,updated_at=now() where id=$2', [status, requestId]);
    return status;
  }

  private async requireChannel(tenantId: string, id: string): Promise<NotificationChannel> {
    const channel = await this.getChannel(tenantId, id);
    if (!channel) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在', { id });
    return channel;
  }

  private async requireRoute(tenantId: string, id: string): Promise<NotificationRoute> {
    const route = await this.getRoute(tenantId, id);
    if (!route) throw new AppError('RESOURCE_NOT_FOUND', '通知路由不存在', { id });
    return route;
  }

  private async page<TRow extends Record<string, unknown>, T>(
    table: string,
    where: string,
    params: unknown[],
    query: NotificationPageQuery,
    mapper: (row: TRow) => T,
  ): Promise<NotificationPage<T>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const count = await this.db.query<{ total: number }>(`select count(*)::int as total from ${table} ${where}`, params);
    const rows = await this.db.query<TRow>(`select * from ${table} ${where} order by created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map(mapper), page, pageSize, total: Number(count.rows[0]?.total ?? 0) };
  }
}

function buildPageWhere(query: NotificationPageQuery, delivery: boolean): { where: string; params: unknown[] } {
  const clauses = ['tenant_id=$1'];
  const params: unknown[] = [query.tenantId];
  if (query.status) { params.push(query.status); clauses.push(`status=$${params.length}`); }
  if (!delivery && query.source) { params.push(query.source); clauses.push(`source=$${params.length}`); }
  if (delivery && query.channelId) { params.push(query.channelId); clauses.push(`channel_id=$${params.length}`); }
  if (delivery && query.requestId) { params.push(query.requestId); clauses.push(`request_id=$${params.length}`); }
  return { where: `where ${clauses.join(' and ')}`, params };
}

function aggregate(statuses: string[]): NotificationRequestStatus {
  if (!statuses.length) return 'failed';
  if (statuses.every((status) => status === 'suppressed')) return 'suppressed';
  if (statuses.every((status) => status === 'delivered')) return 'delivered';
  if (statuses.some((status) => ['queued', 'sending', 'retrying'].includes(status))) return 'queued';
  return statuses.some((status) => status === 'delivered') ? 'partially_delivered' : 'failed';
}

function requireUpdated<T>(row: T | undefined, message: string, detail: unknown): T {
  if (!row) throw new AppError('RESOURCE_VERSION_CONFLICT', message, detail as Record<string, unknown>);
  return row;
}

function json(value: unknown): string { return JSON.stringify(value ?? (Array.isArray(value) ? [] : {})); }
function optionalString(value: unknown): string | undefined { return value === null || value === undefined ? undefined : String(value); }
function optionalNumber(value: unknown): number | undefined { return value === null || value === undefined ? undefined : Number(value); }
function object(value: unknown): Record<string, unknown> { return (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): Record<string, string> { return Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); }

type ChannelRow = Record<string, unknown> & { id: string; tenant_id: string; name: string; type: string; status: string; config: unknown; secret_refs: unknown; health_status: string; consecutive_failures: number; created_at: string; updated_at: string; version: number };
type SettingsRow = Record<string, unknown> & { tenant_id: string; private_origins: unknown; updated_by: string; created_at: string; updated_at: string; version: number };
type RouteRow = Record<string, unknown> & { id: string; tenant_id: string; name: string; status: string; priority: number; matcher: unknown; channel_targets: unknown; stop_on_match: boolean; dedupe_window_seconds: number; created_at: string; updated_at: string; version: number };
type TemplateRow = Record<string, unknown> & { id: string; tenant_id: string; template_key: string; locale: string; title_template: string; body_template: string; required_variables: unknown; status: string; created_at: string; updated_at: string; version: number };
type SilenceRow = Record<string, unknown> & { id: string; tenant_id: string; name: string; status: string; matcher: unknown; reason: string; starts_at: string; ends_at: string; created_by: string; created_at: string; updated_at: string; version: number };
type RequestRow = Record<string, unknown> & { id: string; tenant_id: string; source: string; event_key: string; idempotency_key: string; template_key: string; context: unknown; source_refs: unknown; status: string; created_at: string; updated_at: string };
type DeliveryRow = Record<string, unknown> & { id: string; tenant_id: string; request_id: string; channel_id: string; channel_name_snapshot: string; channel_type: string; target_snapshot: unknown; status: string; attempt_count: number; max_attempts: number; response_summary: unknown; created_at: string; updated_at: string };

function toChannel(row: ChannelRow): NotificationChannel { return {
  id: row.id, tenantId: row.tenant_id, name: row.name, type: row.type as NotificationChannel['type'], status: row.status as NotificationChannel['status'],
  config: object(row.config), secretRefs: strings(row.secret_refs), healthStatus: row.health_status as NotificationChannel['healthStatus'],
  consecutiveFailures: Number(row.consecutive_failures), lastSucceededAt: optionalString(row.last_succeeded_at), lastFailedAt: optionalString(row.last_failed_at),
  lastLatencyMs: optionalNumber(row.last_latency_ms), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: optionalString(row.deleted_at), version: Number(row.version),
}; }
function emptySettings(tenantId: string): NotificationSettings { return {
  tenantId,
  privateOrigins: { wecom: [], feishu: [], dingtalk: [] },
  version: 0,
}; }
function toSettings(row: SettingsRow): NotificationSettings {
  const privateOrigins = object(row.private_origins);
  return {
    tenantId: row.tenant_id,
    privateOrigins: {
      wecom: stringArray(privateOrigins.wecom),
      feishu: stringArray(privateOrigins.feishu),
      dingtalk: stringArray(privateOrigins.dingtalk),
    },
    updatedBy: row.updated_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
  };
}
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function toRoute(row: RouteRow): NotificationRoute { return {
  id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status as NotificationRoute['status'], priority: Number(row.priority),
  matcher: object(row.matcher), channelTargets: Array.isArray(row.channel_targets) ? row.channel_targets as NotificationRoute['channelTargets'] : [],
  stopOnMatch: Boolean(row.stop_on_match), dedupeWindowSeconds: Number(row.dedupe_window_seconds), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  deletedAt: optionalString(row.deleted_at), version: Number(row.version),
}; }
function toTemplate(row: TemplateRow): NotificationTemplate { return {
  id: row.id, tenantId: row.tenant_id, templateKey: row.template_key, locale: row.locale, titleTemplate: row.title_template, bodyTemplate: row.body_template,
  requiredVariables: Array.isArray(row.required_variables) ? row.required_variables.filter((item): item is string => typeof item === 'string') : [],
  status: row.status as NotificationTemplate['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), version: Number(row.version),
}; }
function toSilence(row: SilenceRow): NotificationSilence { return {
  id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status as NotificationSilence['status'], matcher: object(row.matcher), reason: row.reason,
  startsAt: String(row.starts_at), endsAt: String(row.ends_at), createdBy: row.created_by, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  deletedAt: optionalString(row.deleted_at), version: Number(row.version),
}; }
function toRequest(row: RequestRow): NotificationRequest { return {
  id: row.id, tenantId: row.tenant_id, source: row.source, eventKey: row.event_key, idempotencyKey: row.idempotency_key, templateKey: row.template_key,
  routeId: optionalString(row.route_id), channelId: optionalString(row.channel_id), context: object(row.context), sourceRefs: strings(row.source_refs),
  status: row.status as NotificationRequest['status'], statusReason: optionalString(row.status_reason), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
}; }
function toDelivery(row: DeliveryRow): NotificationDelivery { return {
  id: row.id, tenantId: row.tenant_id, requestId: row.request_id, channelId: row.channel_id, channelNameSnapshot: row.channel_name_snapshot,
  channelType: row.channel_type as NotificationDelivery['channelType'], targetSnapshot: object(row.target_snapshot), renderedTitle: optionalString(row.rendered_title),
  renderedBody: optionalString(row.rendered_body), status: row.status as NotificationDelivery['status'], attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts),
  nextAttemptAt: optionalString(row.next_attempt_at), leaseOwner: optionalString(row.lease_owner), leaseUntil: optionalString(row.lease_until),
  failureCategory: optionalString(row.failure_category) as NotificationDelivery['failureCategory'], failureMessage: optionalString(row.failure_message),
  responseSummary: object(row.response_summary), externalId: optionalString(row.external_id), latencyMs: optionalNumber(row.latency_ms), deliveredAt: optionalString(row.delivered_at),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
}; }
