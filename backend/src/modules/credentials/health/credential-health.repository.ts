import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { CredentialHealthCheckRecord, CredentialHealthDevice, CredentialHealthState } from './credential-health.types.js';

export class CredentialHealthRepository {
  constructor(private readonly db: DatabasePort) {}

  async acquireSchedulerLease(ownerId: string, now = new Date(), leaseDurationMs = 30_000): Promise<boolean> {
    const leasedUntil = new Date(now.getTime() + leaseDurationMs).toISOString();
    const result = await this.db.query<{ owner_id: string }>(`insert into pg_device_liveness_scheduler_leases (lease_key,owner_id,leased_until,updated_at)
      values ('credential-health',$1,$2,$3)
      on conflict (lease_key) do update set owner_id=excluded.owner_id,leased_until=excluded.leased_until,updated_at=excluded.updated_at
      where pg_device_liveness_scheduler_leases.leased_until <= $3 or pg_device_liveness_scheduler_leases.owner_id=$1
      returning owner_id`, [ownerId, leasedUntil, now.toISOString()]);
    return result.rows[0]?.owner_id === ownerId;
  }

  async listEligibleDevices(tenantId: string, credentialId: string): Promise<CredentialHealthDevice[]> {
    const result = await this.db.query<DeviceRow>(`select da.service_asset_id, da.host_id, da.device_family, da.management_port,
        coalesce(da.credential_id, (
          select credential_slot.value->>'credentialId'
          from jsonb_each(coalesce(binding.input_bindings->'credentials','{}'::jsonb)) as credential_slot
          where credential_slot.value->>'credentialId'=$2
          limit 1
        )) as credential_id,
        coalesce(effective_plugin.id, plugin_version.id) as plugin_version_id, da.plugin_binding_id, da.version,
        sa.display_name, sa.address,
        case when liveness.status in ('HEALTHY','SUSPECT') then 'ONLINE'
             when liveness.status='FAILED' then 'OFFLINE' else 'UNKNOWN' end as liveness_status,
        (exists (
          select 1
          from jsonb_array_elements(coalesce(effective_plugin.manifest->'capabilities', plugin_version.manifest->'capabilities','[]'::jsonb)) as declared_capability
          where declared_capability->>'key'='credential.health-check'
        ) and (
          (coalesce(effective_plugin.manifest, plugin_version.manifest)->'resources'->'workflows') ? 'credential.health-check'
          or exists (
            select 1 from unified_plugin_workflow_bindings workflow_binding
            where workflow_binding.plugin_version_id=coalesce(effective_plugin.id, plugin_version.id)
              and workflow_binding.capability_key='credential.health-check'
          )
        )) as credential_test_supported
      from pg_device_assets da
      join pg_service_assets sa on sa.id=da.service_asset_id and sa.tenant_id=da.tenant_id
      left join unified_plugin_bindings binding on binding.tenant_id=da.tenant_id and binding.id=da.plugin_binding_id
      left join unified_plugin_versions plugin_version on plugin_version.id=da.plugin_version_id
      left join lateral (
        select candidate.id, candidate.manifest
        from unified_plugin_versions candidate
        where plugin_version.id is not null
          and candidate.plugin_id=plugin_version.plugin_id
          and candidate.status='ENABLED'
          and (candidate.source='BUILTIN' or candidate.tenant_id=da.tenant_id)
        order by (candidate.source='BUILTIN') desc,
                 string_to_array(regexp_replace(candidate.plugin_version, '[^0-9.]', '', 'g'), '.')::int[] desc,
                 candidate.updated_at desc,
                 candidate.id desc
        limit 1
      ) effective_plugin on true
      left join lateral (
        select signal.status
        from pg_device_liveness_signals signal
        where signal.tenant_id=da.tenant_id
          and signal.resource_type='DEVICE'
          and signal.resource_id=da.host_id
          and signal.signal_type='MANAGEMENT_TCP'
        order by signal.last_observed_at desc nulls last, signal.updated_at desc, signal.id desc
        limit 1
      ) liveness on true
      where da.tenant_id=$1 and sa.deleted_at is null
        and (da.credential_id=$2 or exists (
          select 1
          from jsonb_each(coalesce(binding.input_bindings->'credentials','{}'::jsonb)) as credential_slot
          where credential_slot.value->>'credentialId'=$2
        ))
      order by sa.display_name nulls last, da.service_asset_id`, [tenantId, credentialId]);
    return result.rows.map((row) => ({
      id: row.service_asset_id,
      ...(row.host_id ? { hostId: row.host_id } : {}),
      displayName: row.display_name ?? row.address,
      address: row.address,
      port: Number(row.management_port),
      deviceFamily: row.device_family,
      credentialId: row.credential_id,
      ...(row.plugin_version_id ? { pluginVersionId: row.plugin_version_id } : {}),
      ...(row.plugin_binding_id ? { pluginBindingId: row.plugin_binding_id } : {}),
      version: Number(row.version),
      online: row.liveness_status === 'ONLINE',
      credentialTestSupported: Boolean(row.credential_test_supported),
      livenessStatus: row.liveness_status,
    }));
  }

  async getState(tenantId: string, credentialId: string): Promise<CredentialHealthState | undefined> {
    const row = (await this.db.query<StateRow>(`select state.*, (select count(*)::int
      from pg_device_assets da
      join pg_service_assets sa on sa.id=da.service_asset_id and sa.tenant_id=da.tenant_id
      left join unified_plugin_bindings binding on binding.tenant_id=da.tenant_id and binding.id=da.plugin_binding_id
      where da.tenant_id=state.tenant_id and sa.deleted_at is null
        and (da.credential_id=state.credential_id or exists (
          select 1
          from jsonb_each(coalesce(binding.input_bindings->'credentials','{}'::jsonb)) as credential_slot
          where credential_slot.value->>'credentialId'=state.credential_id
        ))) as device_count
      from credential_health_states state where tenant_id=$1 and credential_id=$2`, [tenantId, credentialId])).rows[0];
    return row ? toState(row) : undefined;
  }

  async ensureState(tenantId: string, credentialId: string, profileVersion: number, status: CredentialHealthState['status'], deviceCount: number): Promise<CredentialHealthState> {
    await this.db.query(`insert into credential_health_states (tenant_id,credential_id,status,profile_version,generation,next_check_at,enabled,selected_device_asset_id,config_version,updated_at)
      values ($1,$2,$3,$4,0,null::timestamptz,false,null,0,now())
      on conflict (tenant_id,credential_id) do update set
        profile_version=excluded.profile_version,
        status=case
          when credential_health_states.profile_version <> excluded.profile_version then excluded.status
          when excluded.status in ('DISABLED','UNUSED') then excluded.status
          when credential_health_states.status in ('DISABLED','UNUSED') then excluded.status
          else credential_health_states.status
        end,
        generation=case when credential_health_states.profile_version <> excluded.profile_version then credential_health_states.generation + 1 else credential_health_states.generation end,
        checking_task_id=case when credential_health_states.profile_version <> excluded.profile_version then null else credential_health_states.checking_task_id end,
        next_check_at=case when excluded.status in ('DISABLED','UNUSED') or not credential_health_states.enabled then null else credential_health_states.next_check_at end,
        updated_at=excluded.updated_at`, [tenantId, credentialId, status, profileVersion]);
    const state = await this.getState(tenantId, credentialId);
    if (!state) throw new Error('凭据健康状态写入后无法读取');
    return { ...state, deviceCount };
  }

  async saveConfiguration(input: { tenantId: string; credentialId: string; profileVersion: number; enabled: boolean; selectedDeviceAssetId?: string; updatedBy: string }): Promise<CredentialHealthState> {
    await this.db.query(`insert into credential_health_states
      (tenant_id,credential_id,status,profile_version,generation,next_check_at,enabled,selected_device_asset_id,config_version,updated_by,checked_at,reason_code,reason_summary,updated_at)
      values ($1,$2,$3,$4,1,case when $5 then now() else null::timestamptz end,$5,$6,1,$7,null,null,null,now())
      on conflict (tenant_id,credential_id) do update set
        status=case when $5 then 'UNREACHABLE' else 'DISABLED' end,
        profile_version=excluded.profile_version,
        generation=credential_health_states.generation+1,
        next_check_at=case when $5 then now() else null::timestamptz end,
        enabled=excluded.enabled,
        selected_device_asset_id=excluded.selected_device_asset_id,
        config_version=credential_health_states.config_version+1,
        updated_by=excluded.updated_by,
        checking_task_id=null,
        checked_at=null,
        reason_code=null,
        reason_summary=null,
        failure_count=0,
        updated_at=now()`, [input.tenantId, input.credentialId, input.enabled ? 'UNREACHABLE' : 'DISABLED', input.profileVersion, input.enabled, input.selectedDeviceAssetId ?? null, input.updatedBy]);
    const state = await this.getState(input.tenantId, input.credentialId);
    if (!state) throw new Error('凭据检测配置写入后无法读取');
    return state;
  }

  async startGeneration(tenantId: string, credentialId: string, profileVersion: number, taskId?: string): Promise<number> {
    const pendingTaskId = taskId ?? `pending:credential-health:${credentialId}`;
    const result = await this.db.query<{ generation: number }>(`update credential_health_states set generation=generation+1, profile_version=$3, checking_task_id=$4, updated_at=now() where tenant_id=$1 and credential_id=$2 and checking_task_id is null returning generation`, [tenantId, credentialId, profileVersion, pendingTaskId]);
    if (result.rows[0]) return Number(result.rows[0].generation);
    const state = await this.getState(tenantId, credentialId);
    if (state?.profileVersion === profileVersion && state.checkingTaskId) return state.generation;
    throw new Error('凭据检测代次无法原子推进');
  }

  async markTask(tenantId: string, credentialId: string, taskId: string | undefined, generation: number): Promise<void> {
    await this.db.query(`update credential_health_states set checking_task_id=$3, generation=$4, updated_at=now() where tenant_id=$1 and credential_id=$2`, [tenantId, credentialId, taskId ?? null, generation]);
  }

  async clearCheckingTask(tenantId: string, credentialId: string, generation: number): Promise<void> {
    await this.db.query(`update credential_health_states set checking_task_id=null, updated_at=now() where tenant_id=$1 and credential_id=$2 and generation=$3`, [tenantId, credentialId, generation]);
  }

  async saveRecord(record: Omit<CredentialHealthCheckRecord, 'id' | 'createdAt'> & { id?: string }): Promise<CredentialHealthCheckRecord> {
    const id = record.id ?? newId('cred-health');
    const createdAt = new Date().toISOString();
    await this.db.query(`insert into credential_health_check_records
      (id,tenant_id,credential_id,device_asset_id,task_id,generation,profile_version,result_status,reason_code,reason_summary,checked_at,duration_ms,plugin_version_id,workflow_version_id,secret_version_summary,detail,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
      on conflict (id) do update set result_status=excluded.result_status,reason_code=excluded.reason_code,reason_summary=excluded.reason_summary,checked_at=excluded.checked_at,duration_ms=excluded.duration_ms,detail=excluded.detail`, [
      id, record.tenantId, record.credentialId, record.deviceAssetId, record.taskId ?? null, record.generation, record.profileVersion, record.resultStatus,
      record.reasonCode ?? null, record.reasonSummary ?? null, record.checkedAt, record.durationMs, record.pluginVersionId ?? null, record.workflowVersionId ?? null,
      record.secretVersionSummary ?? null, JSON.stringify(sanitizeCredentialHealthDetail(record.detail)), createdAt,
    ]);
    return { ...record, id, createdAt, detail: sanitizeCredentialHealthDetail(record.detail) };
  }

  async listRecords(tenantId: string, credentialId: string, deviceAssetId?: string, limit = 100): Promise<CredentialHealthCheckRecord[]> {
    const rows = (await this.db.query<RecordRow>(`select * from credential_health_check_records where tenant_id=$1 and credential_id=$2 and ($3::text is null or device_asset_id=$3) order by checked_at desc limit $4`, [tenantId, credentialId, deviceAssetId ?? null, Math.min(Math.max(limit, 1), 500)])).rows;
    return rows.map(toRecord);
  }

  async finalizeState(tenantId: string, credentialId: string, generation: number, profileVersion: number, status: CredentialHealthState['status'], reasonCode?: string, reasonSummary?: string, failureCount = 0, nextCheckAt?: string): Promise<boolean> {
    const result = await this.db.query<{ credential_id: string }>(`update credential_health_states set status=$5,profile_version=$4,reason_code=$6,reason_summary=$7,failure_count=$8,checked_at=now(),next_check_at=$9::timestamptz,checking_task_id=null,updated_at=now() where tenant_id=$1 and credential_id=$2 and generation=$3 returning credential_id`, [tenantId, credentialId, generation, profileVersion, status, reasonCode ?? null, reasonSummary ?? null, failureCount, nextCheckAt ?? null]);
    return result.rows.length > 0;
  }

  async listDue(tenantId?: string, limit = 100): Promise<Array<{ tenantId: string; credentialId: string; profileVersion: number; generation: number }>> {
    const rows = (await this.db.query<{ tenant_id: string; credential_id: string; profile_version: number; generation: number }>(`select state.tenant_id,state.credential_id,state.profile_version,state.generation from credential_health_states state join credential_profiles profile on profile.tenant_id=state.tenant_id and profile.id=state.credential_id where profile.status='active' and state.enabled=true and state.selected_device_asset_id is not null and state.next_check_at is not null and state.next_check_at <= now() ${tenantId ? 'and state.tenant_id=$1' : ''} order by state.next_check_at limit $${tenantId ? 2 : 1}`, tenantId ? [tenantId, limit] : [limit])).rows;
    return rows.map((row) => ({ tenantId: row.tenant_id, credentialId: row.credential_id, profileVersion: Number(row.profile_version), generation: Number(row.generation) }));
  }

  async listActiveCredentialRefs(tenantId?: string, limit = 500): Promise<Array<{ tenantId: string; credentialId: string; profileVersion: number }>> {
    const rows = (await this.db.query<{ tenant_id: string; id: string; version: number }>(`select distinct profile.tenant_id, profile.id, profile.version
      from credential_profiles profile
      join credential_health_states state on state.tenant_id=profile.tenant_id and state.credential_id=profile.id and state.enabled=true and state.selected_device_asset_id is not null
      join pg_device_assets da on da.tenant_id=profile.tenant_id
      join pg_service_assets sa on sa.tenant_id=da.tenant_id and sa.id=da.service_asset_id and sa.deleted_at is null
      left join unified_plugin_bindings binding on binding.tenant_id=da.tenant_id and binding.id=da.plugin_binding_id
      where profile.status='active'
        and (da.credential_id=profile.id or exists (
          select 1
          from jsonb_each(coalesce(binding.input_bindings->'credentials','{}'::jsonb)) as credential_slot
          where credential_slot.value->>'credentialId'=profile.id
        ))
        ${tenantId ? 'and profile.tenant_id=$1' : ''}
      order by profile.tenant_id, profile.id limit $${tenantId ? 2 : 1}`, tenantId ? [tenantId, limit] : [limit])).rows;
    return rows.map((row) => ({ tenantId: row.tenant_id, credentialId: row.id, profileVersion: Number(row.version) }));
  }
}

interface DeviceRow extends Record<string, unknown> { service_asset_id: string; host_id: string | null; device_family: string; management_port: number; credential_id: string; plugin_version_id: string | null; plugin_binding_id: string | null; version: number; display_name: string | null; address: string; liveness_status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'; credential_test_supported: boolean }
interface StateRow extends Record<string, unknown> { tenant_id: string; credential_id: string; status: CredentialHealthState['status']; checked_at: string | null; next_check_at: string | null; checking_task_id: string | null; profile_version: number; generation: number; failure_count: number; reason_code: string | null; reason_summary: string | null; enabled: boolean; selected_device_asset_id: string | null; config_version: number; updated_at: string; device_count: number }
interface RecordRow extends Record<string, unknown> { id: string; tenant_id: string; credential_id: string; device_asset_id: string; task_id: string | null; generation: number; profile_version: number; result_status: CredentialHealthCheckRecord['resultStatus']; reason_code: string | null; reason_summary: string | null; checked_at: string; duration_ms: number; plugin_version_id: string | null; workflow_version_id: string | null; secret_version_summary: string | null; detail: Record<string, unknown>; created_at: string }
function toState(row: StateRow): CredentialHealthState { return { tenantId: row.tenant_id, credentialId: row.credential_id, status: row.status, ...(row.checked_at ? { checkedAt: String(row.checked_at) } : {}), ...(row.next_check_at ? { nextCheckAt: String(row.next_check_at) } : {}), ...(row.checking_task_id ? { checkingTaskId: row.checking_task_id } : {}), profileVersion: Number(row.profile_version), generation: Number(row.generation), failureCount: Number(row.failure_count), ...(row.reason_code ? { reasonCode: row.reason_code } : {}), ...(row.reason_summary ? { reasonSummary: row.reason_summary } : {}), deviceCount: Number(row.device_count ?? 0), enabled: Boolean(row.enabled), ...(row.selected_device_asset_id ? { selectedDeviceAssetId: row.selected_device_asset_id } : {}), configVersion: Number(row.config_version ?? 0), updatedAt: String(row.updated_at) }; }
function toRecord(row: RecordRow): CredentialHealthCheckRecord { return { id: row.id, tenantId: row.tenant_id, credentialId: row.credential_id, deviceAssetId: row.device_asset_id, ...(row.task_id ? { taskId: row.task_id } : {}), generation: Number(row.generation), profileVersion: Number(row.profile_version), resultStatus: row.result_status, ...(row.reason_code ? { reasonCode: row.reason_code } : {}), ...(row.reason_summary ? { reasonSummary: row.reason_summary } : {}), checkedAt: String(row.checked_at), durationMs: Number(row.duration_ms), ...(row.plugin_version_id ? { pluginVersionId: row.plugin_version_id } : {}), ...(row.workflow_version_id ? { workflowVersionId: row.workflow_version_id } : {}), ...(row.secret_version_summary ? { secretVersionSummary: row.secret_version_summary } : {}), detail: sanitizeCredentialHealthDetail(row.detail), createdAt: String(row.created_at) }; }
export function sanitizeCredentialHealthDetail(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const sanitized = sanitizeValue(value ?? {});
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized as Record<string, unknown> : {};
}

function sanitizeValue(value: unknown): unknown {
  const blocked = /secret|password|token|cookie|authorization|responseBody|privateKey/i;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.test(key))
      .map(([key, item]) => [key, sanitizeValue(item)]),
  );
}
