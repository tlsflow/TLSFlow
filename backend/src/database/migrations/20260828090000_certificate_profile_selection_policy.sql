-- 证书 Profile 的自动解析元数据。历史 Profile 通过默认值保持兼容，新的解析严格要求唯一活动候选。
alter table pg_certificate_profiles
  add column if not exists purpose text not null default 'https_server',
  add column if not exists provider_type text not null default 'internal_ca',
  add column if not exists provider_id text,
  add column if not exists certificate_authority_id text,
  add column if not exists acme_provider_profile_id text,
  add column if not exists dns_provider_id text,
  add column if not exists credential_ref text,
  add column if not exists domain_patterns jsonb not null default '[]'::jsonb,
  add column if not exists target_capabilities jsonb not null default '[]'::jsonb,
  add column if not exists is_default boolean not null default false,
  add column if not exists priority integer not null default 100;

update pg_certificate_profiles
   set provider_type = case
     when lower(security_domain) = 'acme' then 'acme'
     when payload ? 'providerType' then coalesce(payload->>'providerType', 'internal_ca')
     else 'internal_ca'
   end;

update pg_certificate_profiles
   set acme_provider_profile_id = coalesce(acme_provider_profile_id, payload->>'acmeProviderProfileId'),
       dns_provider_id = coalesce(dns_provider_id, payload->>'dnsProviderId'),
       credential_ref = coalesce(credential_ref, payload->>'credentialRef');

-- Repository 的历史读取路径以 payload 为主；同步默认值，保证旧 Profile 在新解析器中可重现。
update pg_certificate_profiles
   set payload = payload || jsonb_build_object(
     'purpose', purpose,
     'providerType', provider_type,
     'securityDomain', security_domain,
     'domainPatterns', domain_patterns,
     'targetCapabilities', target_capabilities,
     'isDefault', is_default,
     'priority', priority
   ) || case when provider_id is not null then jsonb_build_object('providerId', provider_id) else '{}'::jsonb end
     || case when certificate_authority_id is not null then jsonb_build_object('certificateAuthorityId', certificate_authority_id) else '{}'::jsonb end
     || case when acme_provider_profile_id is not null then jsonb_build_object('acmeProviderProfileId', acme_provider_profile_id) else '{}'::jsonb end
     || case when dns_provider_id is not null then jsonb_build_object('dnsProviderId', dns_provider_id) else '{}'::jsonb end
     || case when credential_ref is not null then jsonb_build_object('credentialRef', credential_ref) else '{}'::jsonb end;

create index if not exists idx_pg_ca_profiles_resolution
  on pg_certificate_profiles (tenant_id, purpose, provider_type, security_domain, status);

-- 默认标记是配置意图，不承担“多个候选时取优先级”的隐式选择职责；唯一性由解析器按完整条件校验。
