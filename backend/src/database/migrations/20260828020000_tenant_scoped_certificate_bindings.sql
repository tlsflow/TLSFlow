-- 003.6：所有应用证书供应关系必须同时校验 tenant_id 和对象 ID。
-- 仅追加前向约束，不修改任何历史迁移；单列外键继续保留以兼容旧代码路径。

create unique index if not exists uq_pg_service_assets_tenant_id
  on pg_service_assets (tenant_id, id);
create unique index if not exists uq_pg_certificate_assets_tenant_id_scoped
  on pg_certificate_assets (tenant_id, id);
create unique index if not exists uq_pg_certificate_versions_tenant_id_scoped
  on pg_certificate_versions (tenant_id, id);
create unique index if not exists uq_application_certificate_policies_tenant_id
  on pg_application_certificate_policies (tenant_id, id);
create unique index if not exists uq_application_certificate_policy_versions_tenant_id
  on pg_application_certificate_policy_versions (tenant_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policies_tenant_application_fkey') then
    alter table pg_application_certificate_policies
      add constraint pg_application_certificate_policies_tenant_application_fkey
      foreign key (tenant_id, application_asset_id)
      references pg_service_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policies_tenant_current_version_fkey') then
    alter table pg_application_certificate_policies
      add constraint pg_application_certificate_policies_tenant_current_version_fkey
      foreign key (tenant_id, current_version_id)
      references pg_application_certificate_policy_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policies_tenant_dedicated_asset_fkey') then
    alter table pg_application_certificate_policies
      add constraint pg_application_certificate_policies_tenant_dedicated_asset_fkey
      foreign key (tenant_id, current_dedicated_certificate_asset_id)
      references pg_certificate_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policy_versions_tenant_policy_fkey') then
    alter table pg_application_certificate_policy_versions
      add constraint pg_application_certificate_policy_versions_tenant_policy_fkey
      foreign key (tenant_id, policy_id)
      references pg_application_certificate_policies (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policy_versions_tenant_application_fkey') then
    alter table pg_application_certificate_policy_versions
      add constraint pg_application_certificate_policy_versions_tenant_application_fkey
      foreign key (tenant_id, application_asset_id)
      references pg_service_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_application_certificate_policy_versions_tenant_certificate_version_fkey') then
    alter table pg_application_certificate_policy_versions
      add constraint pg_application_certificate_policy_versions_tenant_certificate_version_fkey
      foreign key (tenant_id, certificate_version_id)
      references pg_certificate_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_requests_tenant_certificate_asset_fkey') then
    alter table pg_certificate_requests
      add constraint pg_certificate_requests_tenant_certificate_asset_fkey
      foreign key (tenant_id, certificate_asset_id)
      references pg_certificate_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_requests_tenant_certificate_version_fkey') then
    alter table pg_certificate_requests
      add constraint pg_certificate_requests_tenant_certificate_version_fkey
      foreign key (tenant_id, certificate_version_id)
      references pg_certificate_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_requests_tenant_policy_version_fkey') then
    alter table pg_certificate_requests
      add constraint pg_certificate_requests_tenant_policy_version_fkey
      foreign key (tenant_id, application_certificate_policy_version_id)
      references pg_application_certificate_policy_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_acme_renewal_policies_tenant_application_fkey') then
    alter table pg_acme_renewal_policies
      add constraint pg_acme_renewal_policies_tenant_application_fkey
      foreign key (tenant_id, application_asset_id)
      references pg_service_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_acme_renewal_policies_tenant_certificate_asset_fkey') then
    alter table pg_acme_renewal_policies
      add constraint pg_acme_renewal_policies_tenant_certificate_asset_fkey
      foreign key (tenant_id, certificate_asset_id)
      references pg_certificate_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_acme_renewal_policies_tenant_policy_version_fkey') then
    alter table pg_acme_renewal_policies
      add constraint pg_acme_renewal_policies_tenant_policy_version_fkey
      foreign key (tenant_id, application_certificate_policy_version_id)
      references pg_application_certificate_policy_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_renewal_jobs_tenant_application_fkey') then
    alter table pg_certificate_renewal_jobs
      add constraint pg_certificate_renewal_jobs_tenant_application_fkey
      foreign key (tenant_id, application_asset_id)
      references pg_service_assets (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_renewal_jobs_tenant_certificate_version_fkey') then
    alter table pg_certificate_renewal_jobs
      add constraint pg_certificate_renewal_jobs_tenant_certificate_version_fkey
      foreign key (tenant_id, certificate_version_id)
      references pg_certificate_versions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pg_certificate_renewal_jobs_tenant_policy_version_fkey') then
    alter table pg_certificate_renewal_jobs
      add constraint pg_certificate_renewal_jobs_tenant_policy_version_fkey
      foreign key (tenant_id, application_certificate_policy_version_id)
      references pg_application_certificate_policy_versions (tenant_id, id);
  end if;
end $$;
