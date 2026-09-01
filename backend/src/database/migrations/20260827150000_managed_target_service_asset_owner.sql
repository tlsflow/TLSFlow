-- ManagedTarget 的所有者可以是历史云资产、标准 ServiceAsset 或设备。
-- 旧迁移只允许 asset_id/device_id，导致标准云资源的 service_asset_id 无法落库。
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_managed_targets_asset_owner'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets drop constraint ck_pg_managed_targets_asset_owner;
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'ck_pg_managed_targets_exactly_one_owner'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets drop constraint ck_pg_managed_targets_exactly_one_owner;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'pg_managed_targets_service_asset_id_fkey'
       and conrelid = 'public.pg_managed_targets'::regclass
  ) then
    alter table public.pg_managed_targets
      add constraint pg_managed_targets_service_asset_id_fkey
      foreign key (service_asset_id) references public.pg_service_assets(id);
  end if;

  alter table public.pg_managed_targets
    add constraint ck_pg_managed_targets_exactly_one_owner
    check (num_nonnulls(asset_id, service_asset_id, device_id) = 1);
end $$;

create index if not exists idx_pg_managed_targets_service_asset_owner
  on public.pg_managed_targets (tenant_id, service_asset_id, status)
  where service_asset_id is not null and deleted_at is null;
