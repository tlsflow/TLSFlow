create table if not exists notification_channels (
  id text primary key,
  tenant_id text not null,
  name text not null,
  type text not null check (type in ('email', 'wecom', 'slack', 'webhook')),
  status text not null check (status in ('active', 'disabled', 'deleted')),
  config jsonb not null default '{}'::jsonb,
  secret_refs jsonb not null default '{}'::jsonb,
  health_status text not null default 'unknown' check (health_status in ('unknown', 'healthy', 'degraded', 'unavailable')),
  consecutive_failures integer not null default 0,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_latency_ms integer,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists uq_notification_channels_tenant_name
  on notification_channels (tenant_id, lower(name)) where deleted_at is null;
create index if not exists idx_notification_channels_tenant_status
  on notification_channels (tenant_id, status, updated_at desc);

create table if not exists notification_routes (
  id text primary key,
  tenant_id text not null,
  name text not null,
  status text not null check (status in ('active', 'disabled', 'deleted')),
  priority integer not null,
  matcher jsonb not null default '{}'::jsonb,
  channel_targets jsonb not null default '[]'::jsonb,
  stop_on_match boolean not null default false,
  dedupe_window_seconds integer not null default 0 check (dedupe_window_seconds >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists uq_notification_routes_tenant_name
  on notification_routes (tenant_id, lower(name)) where deleted_at is null;
create index if not exists idx_notification_routes_match
  on notification_routes (tenant_id, status, priority asc, created_at asc);

create table if not exists notification_templates (
  id text primary key,
  tenant_id text not null,
  template_key text not null,
  locale text not null,
  title_template text not null,
  body_template text not null,
  required_variables jsonb not null default '[]'::jsonb,
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1,
  unique (tenant_id, template_key, locale)
);

create index if not exists idx_notification_templates_lookup
  on notification_templates (tenant_id, template_key, locale, status);

create table if not exists notification_silences (
  id text primary key,
  tenant_id text not null,
  name text not null,
  status text not null check (status in ('active', 'disabled', 'deleted')),
  matcher jsonb not null default '{}'::jsonb,
  reason text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1,
  check (ends_at > starts_at)
);

create index if not exists idx_notification_silences_active
  on notification_silences (tenant_id, status, starts_at, ends_at);

create table if not exists notification_requests (
  id text primary key,
  tenant_id text not null,
  source text not null,
  event_key text not null,
  idempotency_key text not null,
  template_key text not null,
  route_id text references notification_routes(id),
  channel_id text references notification_channels(id),
  context jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'partially_delivered', 'delivered', 'failed', 'suppressed')),
  status_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, idempotency_key)
);

create index if not exists idx_notification_requests_query
  on notification_requests (tenant_id, status, source, created_at desc);
create index if not exists idx_notification_requests_event
  on notification_requests (tenant_id, event_key, created_at desc);

create table if not exists notification_deliveries (
  id text primary key,
  tenant_id text not null,
  request_id text not null references notification_requests(id) on delete cascade,
  channel_id text not null references notification_channels(id),
  channel_name_snapshot text not null,
  channel_type text not null,
  target_snapshot jsonb not null default '{}'::jsonb,
  rendered_title text,
  rendered_body text,
  status text not null check (status in ('queued', 'sending', 'retrying', 'delivered', 'failed', 'suppressed')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  failure_category text check (failure_category is null or failure_category in ('configuration', 'authentication', 'rate_limit', 'network', 'timeout', 'rejected', 'template', 'security', 'unknown')),
  failure_message text,
  response_summary jsonb not null default '{}'::jsonb,
  external_id text,
  latency_ms integer,
  delivered_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_notification_deliveries_worker
  on notification_deliveries (status, next_attempt_at, lease_until, created_at);
create index if not exists idx_notification_deliveries_query
  on notification_deliveries (tenant_id, request_id, channel_id, status, created_at desc);

create table if not exists notification_delivery_attempts (
  id text primary key,
  tenant_id text not null,
  delivery_id text not null references notification_deliveries(id) on delete cascade,
  attempt_no integer not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  success boolean,
  retryable boolean,
  failure_category text,
  failure_message text,
  status_code integer,
  latency_ms integer,
  response_summary jsonb not null default '{}'::jsonb,
  unique (delivery_id, attempt_no)
);

create index if not exists idx_notification_delivery_attempts_delivery
  on notification_delivery_attempts (delivery_id, attempt_no desc);
