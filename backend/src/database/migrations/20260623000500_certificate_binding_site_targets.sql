alter table pg_certificate_bindings add column if not exists site_asset_id text references pg_site_assets(id);
alter table pg_certificate_bindings add column if not exists managed_target_id text references pg_managed_targets(id);

create index if not exists idx_pg_certificate_bindings_site_asset on pg_certificate_bindings (tenant_id, site_asset_id);
create index if not exists idx_pg_certificate_bindings_managed_target on pg_certificate_bindings (tenant_id, managed_target_id);
