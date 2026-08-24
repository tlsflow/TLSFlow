create table if not exists pg_device_liveness_signals (
  id text primary key,
  tenant_id text not null,
  resource_type varchar(16) not null check (resource_type in ('AGENT', 'DEVICE')),
  resource_id text not null,
  signal_type varchar(32) not null check (signal_type in ('HEARTBEAT', 'MANAGEMENT_TCP')),
  required boolean not null default true,
  status varchar(16) not null check (status in ('UNKNOWN', 'HEALTHY', 'SUSPECT', 'FAILED')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_observed_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  endpoint_host text,
  endpoint_port integer check (endpoint_port is null or endpoint_port between 1 and 65535),
  source varchar(24) not null check (source in ('AGENT', 'CONTROL_PLANE', 'GATEWAY')),
  reason_code varchar(64),
  reason_detail text,
  observation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, resource_type, resource_id, signal_type)
);

create unique index if not exists uq_device_liveness_observation
  on pg_device_liveness_signals (tenant_id, observation_id)
  where observation_id is not null;

create index if not exists idx_device_liveness_resource
  on pg_device_liveness_signals (tenant_id, resource_type, resource_id);

create index if not exists idx_device_liveness_status
  on pg_device_liveness_signals (tenant_id, signal_type, status, updated_at);
