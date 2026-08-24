create table if not exists pg_monitor_probe_results (
  id text primary key,
  tenant_id text not null,
  monitor_target_id text references pg_monitor_targets(id),
  service_asset_id text not null references pg_service_assets(id),
  source text not null,
  probe_url text not null,
  status text not null check (status in ('READY', 'WARNING', 'ERROR')),
  success boolean not null,
  latency_ms integer not null,
  checked_at timestamptz not null,
  message text not null,
  http_status integer,
  certificate jsonb,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists idx_pg_monitor_probe_results_target
  on pg_monitor_probe_results (tenant_id, monitor_target_id, checked_at desc);

create index if not exists idx_pg_monitor_probe_results_asset
  on pg_monitor_probe_results (tenant_id, service_asset_id, checked_at desc);
