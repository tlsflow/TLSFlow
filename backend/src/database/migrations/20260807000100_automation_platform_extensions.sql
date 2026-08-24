alter table automation_versions
  add column if not exists filters jsonb not null default '[]'::jsonb;

alter table automation_versions
  add column if not exists target_resolver jsonb;

alter table automation_versions
  add column if not exists approval_stage jsonb;

update automation_versions
set target_resolver = jsonb_build_object(
  'type', 'legacy_target_selector',
  'selector', coalesce(target_selector, '{}'::jsonb)
)
where target_resolver is null;

alter table automation_versions
  alter column target_resolver set not null;

alter table automation_runs
  alter column trigger_type type varchar(64);

alter table automation_runs
  drop constraint if exists automation_runs_trigger_type_check;

alter table automation_runs
  add constraint automation_runs_trigger_type_check
  check (trigger_type in ('schedule', 'on_demand', 'retry', 'certificate_version_created'));

alter table automation_runs
  add column if not exists trigger_context jsonb;

alter table automation_runs
  add column if not exists approval_id text;

alter table automation_runs
  add column if not exists delivery_id text;

create index if not exists idx_automation_runs_delivery
  on automation_runs (tenant_id, delivery_id)
  where delivery_id is not null;

create table if not exists automation_trigger_deliveries (
  id text primary key,
  tenant_id text not null,
  automation_id text not null references automation_definitions(id),
  automation_version integer not null,
  delivery_key text not null,
  trigger_type varchar(64) not null,
  event_type text,
  payload jsonb not null,
  status varchar(32) not null check (status in ('pending', 'matched', 'waiting_approval', 'run_created', 'skipped', 'failed')),
  run_id text references automation_runs(id),
  approval_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, automation_id, automation_version, delivery_key)
);

create index if not exists idx_automation_trigger_deliveries_status
  on automation_trigger_deliveries (tenant_id, status, created_at desc);

create index if not exists idx_automation_trigger_deliveries_run
  on automation_trigger_deliveries (run_id)
  where run_id is not null;
