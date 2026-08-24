create table if not exists task_definitions (
  id text primary key,
  task_type text not null,
  version integer not null,
  category text not null,
  display_key text not null,
  executor_key text not null,
  timeout_seconds integer not null,
  retry_policy jsonb not null,
  permission_key text not null,
  sensitive_paths jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_type, version),
  constraint task_definition_category_check check (category in ('EXECUTION', 'MONITORING', 'SYSTEM')),
  constraint task_definition_timeout_check check (timeout_seconds > 0),
  constraint task_definition_version_check check (version > 0)
);

create table if not exists task_runs (
  id text primary key,
  tenant_id text not null,
  task_type text not null,
  definition_version integer not null,
  category text not null,
  status text not null,
  requested_by text,
  trigger_source text not null,
  resource_summary jsonb,
  idempotency_key text,
  parent_task_id text references task_runs(id),
  payload jsonb not null default '{}'::jsonb,
  progress jsonb,
  available_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  constraint task_run_category_check check (category in ('EXECUTION', 'MONITORING', 'SYSTEM')),
  constraint task_run_status_check check (status in ('QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);

create table if not exists task_attempts (
  id text primary key,
  task_run_id text not null references task_runs(id) on delete cascade,
  attempt_no integer not null,
  worker_id text not null,
  lease_expires_at timestamptz not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_summary text,
  unique (task_run_id, attempt_no),
  constraint task_attempt_status_check check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'))
);

create table if not exists task_events (
  id text primary key,
  task_run_id text not null references task_runs(id) on delete cascade,
  attempt_id text references task_attempts(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  actor_type text not null,
  actor_id text,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists task_resource_refs (
  task_run_id text not null references task_runs(id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  display_key text,
  created_at timestamptz not null default now(),
  primary key (task_run_id, resource_type, resource_id)
);

create table if not exists task_monitor_probes (
  id text primary key,
  task_run_id text not null references task_runs(id) on delete cascade,
  tenant_id text not null,
  monitor_target_id text,
  service_asset_id text not null,
  status text not null,
  checked_at timestamptz not null,
  latency_ms integer,
  summary text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists idx_task_runs_queue
  on task_runs (status, available_at, next_attempt_at, created_at);
create index if not exists idx_task_runs_tenant_category
  on task_runs (tenant_id, category, created_at desc);
create index if not exists idx_task_runs_tenant_status
  on task_runs (tenant_id, status, created_at desc);
create index if not exists idx_task_runs_requested_by
  on task_runs (tenant_id, requested_by, created_at desc);
create index if not exists idx_task_runs_type
  on task_runs (tenant_id, task_type, created_at desc);
create index if not exists idx_task_runs_parent
  on task_runs (parent_task_id);
create index if not exists idx_task_attempts_task
  on task_attempts (task_run_id, attempt_no desc);
create index if not exists idx_task_events_task
  on task_events (task_run_id, created_at asc);
create index if not exists idx_task_resource_refs_resource
  on task_resource_refs (resource_type, resource_id);
create index if not exists idx_task_monitor_probes_query
  on task_monitor_probes (tenant_id, service_asset_id, checked_at desc);

create unique index if not exists uq_task_runs_active_idempotency
  on task_runs (tenant_id, task_type, idempotency_key)
  where idempotency_key is not null
    and status not in ('SUCCEEDED', 'FAILED', 'CANCELLED');
