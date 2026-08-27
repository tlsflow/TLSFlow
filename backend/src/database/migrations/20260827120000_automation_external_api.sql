-- 外部自动化 API 配置和专用密钥。密钥只保存摘要，明文不会落库。
alter table automation_versions
  add column if not exists external_api jsonb;

create table if not exists automation_external_api_keys (
  id text primary key,
  tenant_id text not null,
  automation_id text not null,
  key_prefix text not null,
  key_hash character(64) not null,
  created_by text not null,
  created_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  constraint automation_external_api_keys_hash_key unique (key_hash)
);

create index if not exists idx_automation_external_api_keys_lookup
  on automation_external_api_keys (key_hash)
  where revoked_at is null;

create index if not exists idx_automation_external_api_keys_automation
  on automation_external_api_keys (tenant_id, automation_id)
  where revoked_at is null;
