create table if not exists risk_status_history (
  id text primary key,
  tenant_id text not null,
  risk_event_id text not null references pg_monitor_risk_events(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text not null,
  reason text,
  actor_type text not null,
  actor_id text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ck_risk_status_history_action check (action in ('created', 'acknowledged', 'suppressed', 'ignored', 'resolved', 'reopened'))
);

create index if not exists idx_risk_status_history_event_time
  on risk_status_history (tenant_id, risk_event_id, occurred_at, id);

create index if not exists idx_risk_status_history_action_time
  on risk_status_history (tenant_id, action, occurred_at desc);

create table if not exists risk_sla_policies (
  id text primary key,
  tenant_id text not null,
  version integer not null,
  severity text not null,
  acknowledgement_seconds integer not null,
  resolution_seconds integer not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint ck_risk_sla_policy_severity check (severity in ('low', 'medium', 'high', 'critical')),
  constraint ck_risk_sla_policy_ack_positive check (acknowledgement_seconds > 0),
  constraint ck_risk_sla_policy_resolution_positive check (resolution_seconds > 0),
  constraint ck_risk_sla_policy_window check (effective_to is null or effective_to > effective_from),
  unique (tenant_id, version, severity)
);

create index if not exists idx_risk_sla_policies_effective
  on risk_sla_policies (tenant_id, effective_from desc, effective_to);

create table if not exists metric_snapshots (
  id text primary key,
  tenant_id text not null,
  snapshot_date date not null,
  as_of timestamptz not null,
  metric_key text not null,
  metric_version integer not null,
  dimension_key text not null,
  dimensions jsonb not null default '{}'::jsonb,
  value numeric not null,
  sample_count integer not null default 0,
  generated_at timestamptz not null,
  unique (tenant_id, snapshot_date, metric_key, metric_version, dimension_key)
);

create index if not exists idx_metric_snapshots_query
  on metric_snapshots (tenant_id, metric_key, metric_version, snapshot_date);

create table if not exists metric_snapshot_runs (
  id text primary key,
  tenant_id text not null,
  snapshot_date date not null,
  as_of timestamptz not null,
  status text not null,
  attempt_count integer not null default 1,
  started_at timestamptz not null,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_metric_snapshot_run_status check (status in ('queued', 'running', 'succeeded', 'failed')),
  unique (tenant_id, snapshot_date)
);

create table if not exists report_artifacts (
  id text primary key,
  tenant_id text not null,
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  byte_size bigint not null,
  checksum_sha256 text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, storage_key)
);

create table if not exists report_runs (
  id text primary key,
  tenant_id text not null,
  report_type text not null,
  status text not null,
  filters jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  metric_versions jsonb not null default '{}'::jsonb,
  sla_policy_version integer,
  time_zone text not null,
  data_as_of timestamptz not null,
  artifact_id text references report_artifacts(id),
  error_message text,
  created_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ck_report_run_type check (report_type in ('incident_window', 'risk_response', 'automation_effectiveness')),
  constraint ck_report_run_status check (status in ('queued', 'running', 'succeeded', 'failed', 'expired'))
);

create index if not exists idx_report_runs_list
  on report_runs (tenant_id, created_at desc);

insert into risk_sla_policies (
  id, tenant_id, version, severity, acknowledgement_seconds, resolution_seconds, effective_from, created_by
) values
  ('sla_default_v1_low', '00000000-0000-0000-0000-000000000000', 1, 'low', 86400, 604800, '2026-07-21T00:00:00Z', 'system'),
  ('sla_default_v1_medium', '00000000-0000-0000-0000-000000000000', 1, 'medium', 14400, 172800, '2026-07-21T00:00:00Z', 'system'),
  ('sla_default_v1_high', '00000000-0000-0000-0000-000000000000', 1, 'high', 3600, 86400, '2026-07-21T00:00:00Z', 'system'),
  ('sla_default_v1_critical', '00000000-0000-0000-0000-000000000000', 1, 'critical', 900, 14400, '2026-07-21T00:00:00Z', 'system')
on conflict (tenant_id, version, severity) do nothing;
