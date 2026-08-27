-- 云资源的 FrameworkInstance、SiteAsset 与 ManagedTarget 统一由 CloudAccountAsset 所有。
-- 旧数据若同时保存了 asset_id 和 device_id，清除伪造的 Device 所有者。

update public.pg_framework_instances
   set device_id = null,
       updated_at = now(),
       version = version + 1
 where asset_id is not null
   and device_id is not null;

update public.pg_site_assets
   set device_id = null,
       updated_at = now(),
       version = version + 1
 where asset_id is not null
   and device_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_framework_instances_asset_id_fkey'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
    alter table public.pg_framework_instances
      add constraint pg_framework_instances_asset_id_fkey
      foreign key (asset_id) references public.pg_cloud_account_assets(id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_site_assets_asset_id_fkey'
       and conrelid = 'public.pg_site_assets'::regclass
  ) then
    alter table public.pg_site_assets
      add constraint pg_site_assets_asset_id_fkey
      foreign key (asset_id) references public.pg_cloud_account_assets(id);
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_framework_instances_asset_owner'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
    alter table public.pg_framework_instances drop constraint ck_pg_framework_instances_asset_owner;
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_site_assets_asset_owner'
       and conrelid = 'public.pg_site_assets'::regclass
  ) then
    alter table public.pg_site_assets drop constraint ck_pg_site_assets_asset_owner;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_framework_instances_exactly_one_owner'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
    alter table public.pg_framework_instances
      add constraint ck_pg_framework_instances_exactly_one_owner
      check (num_nonnulls(asset_id, device_id) = 1);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_site_assets_exactly_one_owner'
       and conrelid = 'public.pg_site_assets'::regclass
  ) then
    alter table public.pg_site_assets
      add constraint ck_pg_site_assets_exactly_one_owner
      check (num_nonnulls(asset_id, device_id) = 1);
  end if;
end $$;

create index if not exists idx_pg_framework_instances_cloud_asset
  on public.pg_framework_instances (tenant_id, asset_id, status)
  where asset_id is not null and deleted_at is null;

create index if not exists idx_pg_site_assets_cloud_asset
  on public.pg_site_assets (tenant_id, asset_id, status)
  where asset_id is not null and deleted_at is null;
