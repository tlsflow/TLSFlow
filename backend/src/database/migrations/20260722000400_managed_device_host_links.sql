alter table pg_device_assets
  add column if not exists host_id text references pg_hosts(id);

update pg_device_assets da
set host_id = matched_host.id
from pg_service_assets sa
join pg_hosts matched_host
  on matched_host.tenant_id = sa.tenant_id
 and matched_host.deleted_at is null
 and (
   matched_host.primary_ip = sa.address
   or lower(matched_host.hostname) = lower(sa.address)
 )
where da.service_asset_id = sa.id
  and da.tenant_id = sa.tenant_id
  and da.host_id is null;

insert into pg_hosts (
  id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version,
  arch, environment, zone_id, owner_id, management_channels, discovery_source, last_discovered_at,
  agent_id, asset_fingerprint, compatibility_level, management_mode, status, tags,
  created_at, updated_at, version
)
select
  'hst_device_' || substr(md5(da.tenant_id || ':' || da.service_asset_id), 1, 24),
  da.tenant_id,
  case when sa.address_type = 'DNS' then lower(sa.address) else null end,
  coalesce(sa.display_name, sa.address),
  case when sa.address_type in ('IPV4', 'IPV6') then sa.address else null end,
  case when sa.address_type in ('IPV4', 'IPV6') then jsonb_build_array(sa.address) else '[]'::jsonb end,
  'NETWORK_DEVICE',
  coalesce(da.product_name, case when da.device_family = 'NETSCALER_ADC' then 'Citrix ADC' else da.device_family end),
  concat_ws(' ', da.software_version, da.software_build),
  null,
  null,
  null,
  null,
  jsonb_build_array(jsonb_build_object(
    'type', case when da.device_family = 'NETSCALER_ADC' then 'NITRO' else 'AGENTLESS' end,
    'enabled', true,
    'refId', da.service_asset_id,
    'metadata', jsonb_build_object('port', da.management_port, 'tlsVerify', da.tls_verify)
  )),
  'PROVIDER',
  da.last_discovered_at,
  null,
  'device:' || da.device_family || ':' || lower(sa.address) || ':' || da.management_port,
  'L1',
  'AGENTLESS',
  case when sa.status = 'DELETED' then 'DELETED' else coalesce(sa.status, 'UNKNOWN') end,
  coalesce(sa.tags, '[]'::jsonb),
  da.created_at,
  da.updated_at,
  1
from pg_device_assets da
join pg_service_assets sa
  on sa.id = da.service_asset_id
 and sa.tenant_id = da.tenant_id
where da.host_id is null
  and not exists (
    select 1
    from pg_hosts existing_host
    where existing_host.tenant_id = da.tenant_id
      and existing_host.deleted_at is null
      and (
        existing_host.primary_ip = sa.address
        or lower(existing_host.hostname) = lower(sa.address)
      )
  )
on conflict (id) do nothing;

with resolved_hosts as (
  select
    da.tenant_id,
    da.service_asset_id,
    coalesce(matched_host.id, generated_host.id) as host_id
  from pg_device_assets da
  join pg_service_assets sa
    on sa.id = da.service_asset_id
   and sa.tenant_id = da.tenant_id
  left join pg_hosts matched_host
    on matched_host.tenant_id = sa.tenant_id
   and matched_host.deleted_at is null
   and (
     matched_host.primary_ip = sa.address
     or lower(matched_host.hostname) = lower(sa.address)
   )
  left join pg_hosts generated_host
    on generated_host.id = 'hst_device_' || substr(md5(da.tenant_id || ':' || da.service_asset_id), 1, 24)
  where da.host_id is null
)
update pg_device_assets da
set host_id = resolved_hosts.host_id
from resolved_hosts
where da.tenant_id = resolved_hosts.tenant_id
  and da.service_asset_id = resolved_hosts.service_asset_id
  and resolved_hosts.host_id is not null;

update pg_service_assets sa
set host_id = da.host_id,
    updated_at = greatest(sa.updated_at, da.updated_at)
from pg_device_assets da
where da.service_asset_id = sa.id
  and da.tenant_id = sa.tenant_id
  and da.host_id is not null
  and sa.host_id is distinct from da.host_id;

create unique index if not exists uq_pg_device_assets_active_host_family
  on pg_device_assets (tenant_id, host_id, device_family)
  where host_id is not null;

create index if not exists idx_pg_device_assets_host
  on pg_device_assets (tenant_id, host_id);
