-- Spec 033.3：建立宿主级 CredentialProfile，一等管理复合认证身份。

create table if not exists credential_profiles (
  id text primary key,
  tenant_id text not null,
  name text not null,
  kind text not null check (kind in ('USERNAME_PASSWORD','SSH_KEY','BEARER_TOKEN','API_KEY','CLIENT_CERTIFICATE')),
  scope_type text not null check (scope_type in ('global','team','zone','host','plugin')),
  scope_id text,
  username text,
  delivery jsonb not null default '{}'::jsonb,
  secret_slots jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disabled','error')),
  version integer not null default 1 check (version > 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_profiles_scope check (
    (scope_type = 'global' and scope_id is null)
    or (scope_type <> 'global' and scope_id is not null and length(trim(scope_id)) > 0)
  ),
  constraint credential_profiles_name check (length(trim(name)) > 0),
  constraint credential_profiles_secret_slots_object check (jsonb_typeof(secret_slots) = 'object'),
  constraint credential_profiles_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint credential_profiles_delivery_object check (jsonb_typeof(delivery) = 'object')
);

create unique index if not exists uq_credential_profiles_tenant_name
  on credential_profiles (tenant_id, lower(name));

create index if not exists idx_credential_profiles_tenant_status_kind
  on credential_profiles (tenant_id, status, kind);

create index if not exists idx_credential_profiles_scope
  on credential_profiles (tenant_id, scope_type, scope_id);

