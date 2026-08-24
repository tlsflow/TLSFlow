-- 006.4 固定宿主向导的服务端会话；只保存引用、选择和脱敏结果，不保存 Secret 明文。
create table if not exists application_onboarding_sessions (
  id text primary key,
  tenant_id text not null,
  actor_id text not null,
  platform_key text not null,
  plugin_version_id text,
  recipe_hash text,
  state text not null,
  state_version integer not null default 1,
  deployment_mode text,
  device_id text,
  asset_id text,
  discovery_snapshot_id text,
  target_id text,
  target_fingerprint text,
  certificate_id text,
  certificate_version_id text,
  input_snapshot jsonb not null default '{}'::jsonb,
  targets jsonb not null default '[]'::jsonb,
  result jsonb,
  last_error_code text,
  last_error_detail jsonb,
  idempotency_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  constraint application_onboarding_sessions_state_check check (state in (
    'CREATED','PLATFORM_SELECTED','RESOURCE_SELECTION_REQUIRED','DEVICE_INPUT_REQUIRED','DEVICE_ONBOARDING',
    'WAITING_AGENT','CONNECTION_TESTING','DISCOVERING','TARGET_SELECTION_REQUIRED','CERTIFICATE_SELECTION_REQUIRED',
    'READY_TO_COMMIT','COMMITTING','PLAN_CREATED','FAILED','CANCELLED'
  )),
  constraint application_onboarding_sessions_mode_check check (deployment_mode is null or deployment_mode in ('MANAGED_TARGET','DIRECT_WORKFLOW')),
  constraint application_onboarding_sessions_state_version_check check (state_version > 0)
);

create unique index if not exists uq_application_onboarding_sessions_tenant_idempotency
  on application_onboarding_sessions (tenant_id, idempotency_key);
create index if not exists idx_application_onboarding_sessions_tenant_updated
  on application_onboarding_sessions (tenant_id, updated_at desc);
create index if not exists idx_application_onboarding_sessions_expiry
  on application_onboarding_sessions (expires_at)
  where state not in ('PLAN_CREATED', 'CANCELLED');
