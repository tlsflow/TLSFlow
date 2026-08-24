-- Agent 注册记录必须具备对应的 Host 设备主记录，否则统一设备列表无法展示该 Agent。
-- 本迁移只回填缺失关联，不修改历史迁移，也不覆盖已有 Host 的人工名称和管理地址。

with registrations as (
  select
    document_id as agent_id,
    payload ->> 'tenantId' as tenant_id,
    payload -> 'descriptor' as descriptor,
    payload ->> 'status' as agent_status,
    payload ->> 'zone' as zone_id,
    (payload ->> 'registeredAt')::timestamptz as registered_at,
    (payload ->> 'updatedAt')::timestamptz as updated_at
  from pg_documents
  where namespace = 'agents:registrations'
    and coalesce(payload ->> 'tenantId', '') <> ''
    and coalesce(payload #>> '{descriptor,hostname}', '') <> ''
), matched_hosts as (
  select registration.agent_id, registration.tenant_id, matched_host.id as host_id
  from registrations registration
  cross join lateral (
    select host.id
    from pg_hosts host
    where host.tenant_id = registration.tenant_id
      and host.deleted_at is null
      and (
        host.agent_id = registration.agent_id
        or (
          nullif(registration.descriptor ->> 'machineId', '') is not null
          and host.asset_fingerprint = registration.descriptor ->> 'machineId'
        )
        or lower(host.hostname) = lower(registration.descriptor ->> 'hostname')
        or (
          nullif(registration.descriptor ->> 'ipAddress', '') is not null
          and host.primary_ip = registration.descriptor ->> 'ipAddress'
        )
      )
    order by
      case
        when host.agent_id = registration.agent_id then 0
        when nullif(registration.descriptor ->> 'machineId', '') is not null
          and host.asset_fingerprint = registration.descriptor ->> 'machineId' then 1
        when lower(host.hostname) = lower(registration.descriptor ->> 'hostname') then 2
        else 3
      end
    limit 1
  ) matched_host
), updated_hosts as (
  update pg_hosts host
  set agent_id = registration.agent_id,
      os_type = upper(registration.descriptor ->> 'osType'),
      os_name = case upper(registration.descriptor ->> 'osType')
        when 'WINDOWS' then 'Windows Server'
        when 'LINUX' then coalesce(nullif(registration.descriptor ->> 'linuxDistribution', ''), 'Linux Server')
        else upper(registration.descriptor ->> 'osType')
      end,
      os_version = nullif(registration.descriptor ->> 'osVersion', ''),
      arch = nullif(registration.descriptor ->> 'arch', ''),
      zone_id = coalesce(nullif(registration.zone_id, ''), host.zone_id),
      management_channels = '["AGENT"]'::jsonb,
      discovery_source = 'AGENT',
      last_discovered_at = registration.updated_at,
      asset_fingerprint = coalesce(host.asset_fingerprint, nullif(registration.descriptor ->> 'machineId', '')),
      management_mode = 'AGENT',
      status = case registration.agent_status
        when 'ONLINE' then 'ACTIVE'
        when 'UPGRADING' then 'ACTIVE'
        when 'OFFLINE' then 'INACTIVE'
        when 'DISABLED' then 'DISABLED'
        else 'UNKNOWN'
      end,
      tags = coalesce(registration.descriptor -> 'labels', '[]'::jsonb),
      updated_at = registration.updated_at,
      version = host.version + 1
  from registrations registration
  join matched_hosts matched
    on matched.agent_id = registration.agent_id
   and matched.tenant_id = registration.tenant_id
  where host.id = matched.host_id
  returning host.id
)
insert into pg_hosts (
  id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version, arch,
  zone_id, management_channels, discovery_source, last_discovered_at, agent_id, asset_fingerprint,
  compatibility_level, management_mode, status, tags, created_at, updated_at, version
)
select
  'host_' || registration.agent_id,
  registration.tenant_id,
  lower(registration.descriptor ->> 'hostname'),
  lower(registration.descriptor ->> 'hostname'),
  nullif(registration.descriptor ->> 'ipAddress', ''),
  case
    when nullif(registration.descriptor ->> 'ipAddress', '') is null then '[]'::jsonb
    else jsonb_build_array(registration.descriptor ->> 'ipAddress')
  end,
  upper(registration.descriptor ->> 'osType'),
  case upper(registration.descriptor ->> 'osType')
    when 'WINDOWS' then 'Windows Server'
    when 'LINUX' then coalesce(nullif(registration.descriptor ->> 'linuxDistribution', ''), 'Linux Server')
    else upper(registration.descriptor ->> 'osType')
  end,
  nullif(registration.descriptor ->> 'osVersion', ''),
  nullif(registration.descriptor ->> 'arch', ''),
  nullif(registration.zone_id, ''),
  '["AGENT"]'::jsonb,
  'AGENT',
  registration.updated_at,
  registration.agent_id,
  nullif(registration.descriptor ->> 'machineId', ''),
  'L1',
  'AGENT',
  case registration.agent_status
    when 'ONLINE' then 'ACTIVE'
    when 'UPGRADING' then 'ACTIVE'
    when 'OFFLINE' then 'INACTIVE'
    when 'DISABLED' then 'DISABLED'
    else 'UNKNOWN'
  end,
  coalesce(registration.descriptor -> 'labels', '[]'::jsonb),
  registration.registered_at,
  registration.updated_at,
  1
from registrations registration
where not exists (
  select 1
  from matched_hosts matched
  where matched.agent_id = registration.agent_id
    and matched.tenant_id = registration.tenant_id
);
