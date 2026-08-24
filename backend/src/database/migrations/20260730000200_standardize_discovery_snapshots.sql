alter table plugin_discovery_snapshots
  alter column device_asset_id drop not null,
  alter column plugin_version_id drop not null;

alter table plugin_discovery_snapshots
  add column device_id text references pg_hosts(id),
  add column discovery_provider_key text,
  add column discovery_source varchar(16);

update plugin_discovery_snapshots snapshot
set device_id = device.host_id,
    discovery_provider_key = left('plugin-version:' || snapshot.plugin_version_id, 192),
    discovery_source = 'PROVIDER'
from pg_device_assets device
where device.service_asset_id = snapshot.device_asset_id;

alter table plugin_discovery_snapshots
  alter column device_id set not null,
  alter column discovery_provider_key set not null,
  alter column discovery_source set not null,
  add constraint ck_plugin_discovery_snapshots_source
    check (discovery_source in ('AGENT', 'PROVIDER')),
  add constraint ck_plugin_discovery_snapshots_identity
    check (
      discovery_source = 'AGENT'
      or
      (discovery_source = 'PROVIDER' and device_asset_id is not null and plugin_version_id is not null)
    );

create index idx_plugin_discovery_snapshots_standard_identity
  on plugin_discovery_snapshots (
    tenant_id,
    device_id,
    discovery_provider_key,
    normalized_sha256,
    status,
    created_at desc
  );
