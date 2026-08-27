-- 云资源实例由 CloudAccountAsset 所有，但仍统一进入 ManagedTarget 证书目标体系。
-- 这是递增迁移，不修改已发布的 unified baseline。

update public.pg_managed_targets
   set device_id = null,
       updated_at = now(),
       version = version + 1
 where asset_id is not null
   and device_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_managed_targets_asset_id_fkey'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets
      add constraint pg_managed_targets_asset_id_fkey
      foreign key (asset_id) references public.pg_cloud_account_assets(id);
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_managed_targets_asset_owner'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets drop constraint ck_pg_managed_targets_asset_owner;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_managed_targets_exactly_one_owner'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets
      add constraint ck_pg_managed_targets_exactly_one_owner
      check (num_nonnulls(asset_id, device_id) = 1);
  end if;
end $$;

create index if not exists idx_pg_managed_targets_cloud_asset
  on public.pg_managed_targets (tenant_id, asset_id, status)
  where asset_id is not null and deleted_at is null;
