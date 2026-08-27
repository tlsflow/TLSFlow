-- Framework、Site 和 ManagedTarget 都由标准 ServiceAsset 或历史 CloudAccountAsset 所有。
-- 新链路使用 service_asset_id；历史 asset_id 数据保持可读，不再新增旧表外键。
alter table public.pg_framework_instances
  add column if not exists service_asset_id text;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'pg_framework_instances_asset_id_fkey'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
    alter table public.pg_framework_instances drop constraint pg_framework_instances_asset_id_fkey;
  end if;
  if not exists (
     select 1 from pg_constraint
     where conname = 'pg_framework_instances_service_asset_id_fkey'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
    alter table public.pg_framework_instances
      add constraint pg_framework_instances_service_asset_id_fkey
      foreign key (service_asset_id) references public.pg_service_assets(id);
  end if;
  if exists (
     select 1 from pg_constraint
     where conname = 'pg_site_assets_asset_id_fkey'
       and conrelid = 'public.pg_site_assets'::regclass
  ) then
    alter table public.pg_site_assets drop constraint pg_site_assets_asset_id_fkey;
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
  if exists (
     select 1 from pg_constraint
     where conname = 'ck_pg_framework_instances_exactly_one_owner'
       and conrelid = 'public.pg_framework_instances'::regclass
  ) then
      alter table public.pg_framework_instances drop constraint ck_pg_framework_instances_exactly_one_owner;
  end if;
  alter table public.pg_framework_instances
    add constraint ck_pg_framework_instances_exactly_one_owner
    check (num_nonnulls(asset_id, service_asset_id, device_id) = 1);
  if exists (
     select 1 from pg_constraint
     where conname = 'ck_pg_site_assets_exactly_one_owner'
       and conrelid = 'public.pg_site_assets'::regclass
  ) then
      alter table public.pg_site_assets drop constraint ck_pg_site_assets_exactly_one_owner;
  end if;
  alter table public.pg_site_assets
    add constraint ck_pg_site_assets_exactly_one_owner
    check (num_nonnulls(asset_id, service_asset_id, device_id) = 1);
end $$;

create index if not exists idx_pg_framework_instances_service_asset_owner
  on public.pg_framework_instances (tenant_id, service_asset_id, status)
  where service_asset_id is not null and deleted_at is null;

create index if not exists idx_pg_site_assets_service_asset_owner
  on public.pg_site_assets (tenant_id, service_asset_id, status)
  where service_asset_id is not null and deleted_at is null;
