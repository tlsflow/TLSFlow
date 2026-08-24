-- 凭据档案增加统一有效期；NULL 表示长期有效。

alter table credential_profiles
  add column if not exists expires_at timestamptz;

update credential_profiles
   set expires_at = (metadata->>'expiresAt')::timestamptz
 where kind = 'BROWSER_SESSION'
   and expires_at is null
   and metadata->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T';

create index if not exists idx_credential_profiles_tenant_expires_at
  on credential_profiles (tenant_id, expires_at);
