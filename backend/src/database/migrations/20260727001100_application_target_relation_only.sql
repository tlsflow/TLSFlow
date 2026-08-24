drop index if exists uq_pg_application_asset_targets_target;
drop index if exists idx_pg_application_asset_targets_agent;
drop index if exists idx_pg_application_asset_targets_site_asset;

alter table pg_application_asset_targets
  drop column agent_id,
  drop column device_asset_id,
  drop column site_asset_id,
  drop column provider_type,
  drop column framework_type,
  drop column target_type,
  drop column target_key,
  drop column binding_key;

create unique index uq_pg_application_asset_targets_target
  on pg_application_asset_targets (tenant_id, application_asset_id, managed_target_id)
  where deleted_at is null;
