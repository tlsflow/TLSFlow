-- 浏览器临时凭据获取：新增动态凭据类型和一次性浏览器会话事实。

alter table credential_profiles
  drop constraint if exists credential_profiles_kind_check;

alter table credential_profiles
  add constraint credential_profiles_kind_check
  check (kind in (
    'USERNAME_PASSWORD',
    'SSH_KEY',
    'BEARER_TOKEN',
    'API_KEY',
    'CLIENT_CERTIFICATE',
    'DNS_PROVIDER',
    'BROWSER_SESSION'
  ));

create table if not exists browser_credential_sessions (
  id text primary key,
  tenant_id text not null,
  asset_id text not null,
  plugin_version_id text not null,
  workflow_template_id text not null,
  workflow_version_id text not null,
  capability_key text not null check (capability_key = 'credential.acquire'),
  runtime_session_id text not null unique,
  one_time_url_hash text not null,
  idempotency_key_hash text,
  status text not null check (status in ('created', 'ready', 'acquiring', 'succeeded', 'failed', 'expired', 'closed')),
  credential_profile_id text,
  expires_at timestamptz not null,
  created_by text not null,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_browser_credential_sessions_tenant_status
  on browser_credential_sessions (tenant_id, status, updated_at desc);

create index if not exists idx_browser_credential_sessions_expiry
  on browser_credential_sessions (expires_at, status);

create unique index if not exists ux_browser_credential_sessions_idempotency
  on browser_credential_sessions (tenant_id, created_by, idempotency_key_hash)
  where idempotency_key_hash is not null;
