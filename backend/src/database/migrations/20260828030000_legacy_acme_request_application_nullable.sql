-- 全局历史 ACME 证书不属于任何应用资产。
-- 旧实现曾把 CertificateAsset.id 写入 application_asset_id，本迁移只清理可识别
-- 的历史 ACME 请求列值；payload 原文保留，作为不可变历史证据。
alter table pg_certificate_requests
  alter column application_asset_id drop not null;

update pg_certificate_requests request
   set application_asset_id = null
 where request.application_asset_id is not null
   and request.application_certificate_policy_version_id is null
   and exists (
     select 1
       from pg_certificate_authorities authority
       join pg_ca_providers provider
         on provider.tenant_id = authority.tenant_id
        and provider.id = authority.provider_id
      where authority.tenant_id = request.tenant_id
        and authority.id = request.ca_id
        and provider.type = 'acme'
   )
   and (
     request.idempotency_key like 'acme-initial-request:%'
     or request.idempotency_key like 'acme-renewal-request:%'
     or request.idempotency_key like 'acme-renewal-recovery-request:%'
   );
