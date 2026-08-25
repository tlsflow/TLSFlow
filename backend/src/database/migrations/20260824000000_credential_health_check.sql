-- 凭据有效性检测：独立保存聚合状态和设备级检测证据，不改写历史迁移。
create table if not exists credential_health_states (
  tenant_id text not null,
  credential_id text not null,
  status text not null,
  checked_at timestamptz,
  next_check_at timestamptz,
  checking_task_id text,
  profile_version integer not null,
  generation bigint not null default 0,
  failure_count integer not null default 0,
  reason_code text,
  reason_summary text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, credential_id),
  constraint credential_health_states_status_check check (status in ('DISABLED','UNUSED','UNREACHABLE','VALID','ERROR')),
  constraint credential_health_states_generation_check check (generation >= 0),
  constraint credential_health_states_failure_count_check check (failure_count >= 0),
  constraint credential_health_states_profile_version_check check (profile_version > 0),
  constraint credential_health_states_credential_fk foreign key (credential_id) references credential_profiles(id) on delete cascade
);

create table if not exists credential_health_check_records (
  id text primary key,
  tenant_id text not null,
  credential_id text not null,
  device_asset_id text not null,
  task_id text,
  generation bigint not null,
  profile_version integer not null,
  result_status text not null,
  reason_code text,
  reason_summary text,
  checked_at timestamptz not null,
  duration_ms integer not null default 0,
  plugin_version_id text,
  workflow_version_id text,
  secret_version_summary text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credential_health_records_status_check check (result_status in ('VALID','UNREACHABLE','ERROR')),
  constraint credential_health_records_generation_check check (generation >= 0),
  constraint credential_health_records_profile_version_check check (profile_version > 0),
  constraint credential_health_records_duration_check check (duration_ms >= 0),
  constraint credential_health_records_detail_object check (jsonb_typeof(detail) = 'object'),
  constraint credential_health_records_credential_fk foreign key (credential_id) references credential_profiles(id) on delete cascade
);

create index if not exists idx_credential_health_states_due on credential_health_states (tenant_id, next_check_at)
  where next_check_at is not null;
create index if not exists idx_credential_health_records_credential on credential_health_check_records (tenant_id, credential_id, checked_at desc);
create index if not exists idx_credential_health_records_device on credential_health_check_records (tenant_id, device_asset_id, checked_at desc);
create unique index if not exists uq_credential_health_records_task_device
  on credential_health_check_records (task_id, device_asset_id, generation)
  where task_id is not null;
