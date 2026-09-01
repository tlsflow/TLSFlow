-- 为专属 ACME 续期对象补充不可变的应用策略归属。
-- 不修改历史迁移；旧策略保持 NULL，继续按原证书资产逻辑运行。
alter table pg_acme_renewal_policies
  add column if not exists application_asset_id text,
  add column if not exists application_certificate_policy_version_id text,
  add column if not exists dns_credential_ref text;

alter table pg_certificate_renewal_jobs
  add column if not exists application_asset_id text,
  add column if not exists application_certificate_policy_version_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pg_acme_renewal_policies_application_asset_fkey') then
    alter table pg_acme_renewal_policies
      add constraint pg_acme_renewal_policies_application_asset_fkey
      foreign key (application_asset_id) references pg_service_assets(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_acme_renewal_policies_application_policy_version_fkey') then
    alter table pg_acme_renewal_policies
      add constraint pg_acme_renewal_policies_application_policy_version_fkey
      foreign key (application_certificate_policy_version_id) references pg_application_certificate_policy_versions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_renewal_jobs_application_asset_fkey') then
    alter table pg_certificate_renewal_jobs
      add constraint pg_certificate_renewal_jobs_application_asset_fkey
      foreign key (application_asset_id) references pg_service_assets(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_renewal_jobs_application_policy_version_fkey') then
    alter table pg_certificate_renewal_jobs
      add constraint pg_certificate_renewal_jobs_application_policy_version_fkey
      foreign key (application_certificate_policy_version_id) references pg_application_certificate_policy_versions(id);
  end if;
end $$;

create index if not exists idx_pg_acme_renewal_policies_application
  on pg_acme_renewal_policies (tenant_id, application_asset_id)
  where application_asset_id is not null;

create index if not exists idx_pg_certificate_renewal_jobs_application
  on pg_certificate_renewal_jobs (tenant_id, application_asset_id)
  where application_asset_id is not null;
