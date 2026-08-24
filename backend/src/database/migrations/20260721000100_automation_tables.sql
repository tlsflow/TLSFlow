create table if not exists automation_definitions (
  id text primary key,
  tenant_id text not null,
  name text not null,
  description text,
  status varchar(16) not null check (status in ('draft', 'active', 'disabled', 'deleted')),
  current_version integer not null,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1
);

create index if not exists idx_automation_definitions_tenant_status
  on automation_definitions (tenant_id, status, updated_at desc);
create index if not exists idx_automation_definitions_due
  on automation_definitions (next_run_at)
  where status = 'active' and deleted_at is null;

create table if not exists automation_versions (
  id text primary key,
  tenant_id text not null,
  automation_id text not null references automation_definitions(id),
  version integer not null,
  trigger_config jsonb not null,
  target_selector jsonb not null,
  actions jsonb not null,
  guardrails jsonb not null,
  checksum char(64) not null,
  created_by text not null,
  created_at timestamptz not null,
  unique (automation_id, version)
);

create index if not exists idx_automation_versions_tenant_automation
  on automation_versions (tenant_id, automation_id, version desc);

create table if not exists automation_runs (
  id text primary key,
  tenant_id text not null,
  automation_id text not null references automation_definitions(id),
  automation_version integer not null,
  automation_name_snapshot text not null,
  trigger_type varchar(16) not null check (trigger_type in ('schedule', 'on_demand', 'retry')),
  scheduled_at timestamptz,
  idempotency_key text not null,
  parent_run_id text references automation_runs(id),
  status varchar(32) not null check (status in ('queued', 'running', 'waiting_approval', 'succeeded', 'partially_succeeded', 'failed', 'needs_attention', 'stopped', 'cancelled')),
  target_summary jsonb not null,
  action_types jsonb not null,
  environment_snapshots jsonb not null default '[]'::jsonb,
  failure_stage varchar(32),
  failure_code text,
  failure_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by text not null,
  created_at timestamptz not null,
  unique (tenant_id, idempotency_key)
);

create index if not exists idx_automation_runs_tenant_created
  on automation_runs (tenant_id, created_at desc);
create index if not exists idx_automation_runs_automation_created
  on automation_runs (automation_id, created_at desc);
create index if not exists idx_automation_runs_reporting
  on automation_runs (tenant_id, status, failure_stage, finished_at desc);

create table if not exists automation_run_targets (
  id text primary key,
  tenant_id text not null,
  run_id text not null references automation_runs(id),
  sequence_no integer not null,
  target_snapshot jsonb not null,
  environment_snapshot text,
  action_types jsonb not null,
  status varchar(32) not null check (status in ('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped', 'cancelled')),
  current_action text,
  failure_stage varchar(32),
  deployment_plan_id text,
  execution_run_id text,
  notification_request_ids jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (run_id, sequence_no)
);

create index if not exists idx_automation_run_targets_run_status
  on automation_run_targets (run_id, status, sequence_no);
create index if not exists idx_automation_run_targets_reporting
  on automation_run_targets (tenant_id, status, failure_stage, finished_at desc);

create table if not exists automation_run_action_results (
  id text primary key,
  tenant_id text not null,
  run_id text not null references automation_runs(id),
  run_target_id text references automation_run_targets(id),
  action_type text not null,
  action_position integer not null,
  status varchar(16) not null check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  external_reference_type text,
  external_reference_id text,
  failure_stage varchar(32),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null
);

create index if not exists idx_automation_action_results_run_target
  on automation_run_action_results (run_id, run_target_id, action_position);

create table if not exists automation_scheduler_leases (
  lease_key text primary key,
  owner_id text not null,
  leased_until timestamptz not null,
  updated_at timestamptz not null
);
