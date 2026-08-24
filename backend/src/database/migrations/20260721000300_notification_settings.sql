create table if not exists notification_settings (
  tenant_id text primary key,
  private_origins jsonb not null default '{}'::jsonb,
  updated_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1
);
