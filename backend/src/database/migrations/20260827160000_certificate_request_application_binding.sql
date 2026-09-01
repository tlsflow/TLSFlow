-- 003.6：把证书申请的应用策略归属从 payload 提升为可约束的结构化列。
-- 历史迁移不可变；本迁移只追加字段、索引和外键。
alter table pg_certificate_requests
  add column if not exists certificate_asset_id text;

alter table pg_certificate_requests
  add column if not exists application_certificate_policy_version_id text;

create index if not exists idx_pg_certificate_requests_application_binding
  on pg_certificate_requests (tenant_id, application_asset_id, certificate_asset_id, application_certificate_policy_version_id);

create index if not exists idx_pg_certificate_requests_policy_version
  on pg_certificate_requests (tenant_id, application_certificate_policy_version_id)
  where application_certificate_policy_version_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_certificate_requests_certificate_asset_id_fkey'
  ) then
    alter table pg_certificate_requests
      add constraint pg_certificate_requests_certificate_asset_id_fkey
      foreign key (certificate_asset_id) references pg_certificate_assets(id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_certificate_requests_application_policy_version_fkey'
  ) then
    alter table pg_certificate_requests
      add constraint pg_certificate_requests_application_policy_version_fkey
      foreign key (application_certificate_policy_version_id)
      references pg_application_certificate_policy_versions(id);
  end if;
end $$;

-- 只为已有 payload 中明确包含归属的申请补齐结构化列；不猜测历史 applicationAssetId。
update pg_certificate_requests
   set certificate_asset_id = nullif(payload ->> 'certificateAssetId', ''),
       application_certificate_policy_version_id = nullif(payload ->> 'applicationCertificatePolicyVersionId', '')
 where certificate_asset_id is null
    or application_certificate_policy_version_id is null;
