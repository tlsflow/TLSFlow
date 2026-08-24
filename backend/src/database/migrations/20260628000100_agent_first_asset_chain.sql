alter table pg_service_instances
  alter column host_id drop not null;

drop index if exists uq_pg_service_instances_identity;
create unique index if not exists uq_pg_service_instances_identity
  on pg_service_instances (
    tenant_id,
    coalesce(host_id, ''),
    provider_type,
    coalesce(service_name, ''),
    coalesce(config_path, '')
  ) where deleted_at is null;

alter table pg_site_assets
  alter column host_id drop not null;

drop index if exists idx_pg_site_assets_host;
create index if not exists idx_pg_site_assets_host on pg_site_assets (tenant_id, host_id);

alter table pg_site_assets
  drop constraint if exists pg_site_assets_host_id_fkey;

alter table pg_site_assets
  add constraint pg_site_assets_host_id_fkey
  foreign key (host_id) references pg_hosts(id);

alter table pg_managed_targets
  alter column host_id drop not null;

drop index if exists idx_pg_managed_targets_host;
create index if not exists idx_pg_managed_targets_host on pg_managed_targets (tenant_id, host_id);

alter table pg_managed_targets
  drop constraint if exists pg_managed_targets_host_id_fkey;

alter table pg_managed_targets
  add constraint pg_managed_targets_host_id_fkey
  foreign key (host_id) references pg_hosts(id);
