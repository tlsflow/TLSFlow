create table if not exists pg_monitor_targets (
  id text primary key,
  tenant_id text not null,
  service_asset_id text not null references pg_service_assets(id),
  metrics jsonb not null default '[]'::jsonb,
  interval_seconds integer not null check (interval_seconds > 0),
  status text not null check (status in ('active', 'paused')),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists uq_pg_monitor_targets_active_asset
  on pg_monitor_targets (tenant_id, service_asset_id)
  where deleted_at is null;

create index if not exists idx_pg_monitor_targets_tenant_status
  on pg_monitor_targets (tenant_id, status, updated_at desc)
  where deleted_at is null;
