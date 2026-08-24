alter table pg_managed_targets
  alter column agent_id drop not null;

alter table pg_managed_targets
  add column if not exists device_asset_id text references pg_device_assets(service_asset_id);

drop index if exists uq_pg_managed_targets_identity;

create unique index if not exists uq_pg_managed_targets_identity
  on pg_managed_targets (
    tenant_id,
    coalesce(agent_id, ''),
    coalesce(device_asset_id, ''),
    provider_type,
    target_type,
    target_key
  )
  where deleted_at is null;

alter table pg_managed_targets
  drop constraint if exists ck_pg_managed_targets_owner;

alter table pg_managed_targets
  add constraint ck_pg_managed_targets_owner
  check ((agent_id is not null) <> (device_asset_id is not null));

create index if not exists idx_pg_managed_targets_device
  on pg_managed_targets (tenant_id, device_asset_id);

alter table pg_application_asset_targets
  alter column agent_id drop not null;

alter table pg_application_asset_targets
  add column if not exists device_asset_id text references pg_device_assets(service_asset_id);

alter table pg_application_asset_targets
  drop constraint if exists ck_pg_application_asset_targets_owner;

alter table pg_application_asset_targets
  add constraint ck_pg_application_asset_targets_owner
  check ((agent_id is not null) <> (device_asset_id is not null));

create index if not exists idx_pg_application_asset_targets_device
  on pg_application_asset_targets (tenant_id, device_asset_id);
