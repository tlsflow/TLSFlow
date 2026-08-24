create table if not exists pg_monitor_risk_events (
  id text primary key,
  tenant_id text,
  dedup_key text not null,
  risk_type text not null,
  source text not null,
  severity text not null,
  status text not null,
  title text not null,
  summary text not null,
  scope jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  resolved_at timestamptz,
  occurrence_count integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_monitor_risk_events_tenant_dedup
  on pg_monitor_risk_events (coalesce(tenant_id, ''), dedup_key);

create index if not exists idx_pg_monitor_risk_events_view
  on pg_monitor_risk_events (tenant_id, status, severity, last_detected_at desc);

create table if not exists pg_monitor_alert_rules (
  id text primary key,
  tenant_id text,
  name text not null,
  threshold jsonb not null,
  scope jsonb not null default '{}'::jsonb,
  status text not null,
  silence jsonb,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_pg_monitor_alert_rules_tenant_status
  on pg_monitor_alert_rules (tenant_id, status, created_at desc);
