alter table pg_device_assets
  alter column credential_id drop not null;

alter table pg_device_assets
  drop constraint if exists pg_device_assets_auth_mode_check;

alter table pg_device_assets
  add constraint ck_pg_device_assets_auth_mode_nonempty
  check (length(trim(auth_mode)) > 0);

alter table pg_device_virtual_servers
  drop constraint if exists pg_device_virtual_servers_virtual_server_type_check;

alter table pg_device_virtual_servers
  add constraint ck_pg_device_virtual_servers_type_nonempty
  check (length(trim(virtual_server_type)) > 0);
