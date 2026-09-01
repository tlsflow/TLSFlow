-- 修复早期 Profile 选择迁移已登记但三列未实际落库的环境。
-- 不修改历史迁移；已有非空列值优先于 payload 中的旧投影。
alter table pg_certificate_profiles
  add column if not exists acme_provider_profile_id text,
  add column if not exists dns_provider_id text,
  add column if not exists credential_ref text;

update pg_certificate_profiles
   set acme_provider_profile_id = coalesce(acme_provider_profile_id, nullif(payload->>'acmeProviderProfileId', '')),
       dns_provider_id = coalesce(dns_provider_id, nullif(payload->>'dnsProviderId', '')),
       credential_ref = coalesce(credential_ref, nullif(payload->>'credentialRef', ''));

-- Repository 的读取路径仍保留 payload 镜像；补齐结构化列后同步该镜像，避免历史数据分叉。
update pg_certificate_profiles
   set payload = payload
     || case when acme_provider_profile_id is not null then jsonb_build_object('acmeProviderProfileId', acme_provider_profile_id) else '{}'::jsonb end
     || case when dns_provider_id is not null then jsonb_build_object('dnsProviderId', dns_provider_id) else '{}'::jsonb end
     || case when credential_ref is not null then jsonb_build_object('credentialRef', credential_ref) else '{}'::jsonb end;
