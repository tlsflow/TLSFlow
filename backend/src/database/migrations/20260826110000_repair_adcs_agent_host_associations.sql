-- AD CS Agent 是证书服务 Agent，不是主机资产 Agent。
-- 对历史错误关联执行一次数据修复：优先恢复同租户的 Full Agent，
-- 找不到明确属主时解除 agent_id，但保留主机资产记录。

with adcs_hosts as (
  select
    host.id,
    host.tenant_id,
    host.hostname,
    host.primary_ip,
    host.asset_fingerprint,
    host.agent_id as adcs_agent_id
  from pg_hosts host
  join pg_documents adcs
    on adcs.namespace = 'agents:registrations'
   and adcs.document_id = host.agent_id
  where host.deleted_at is null
    and (
      coalesce(adcs.payload->>'role', '') = 'adcs_agent'
      or lower(coalesce(adcs.payload #>> '{descriptor,osType}', '')) = 'windows_adcs'
    )
),
full_matches as (
  select distinct on (host.id)
    host.id as host_id,
    full_agent.document_id as full_agent_id,
    full_agent.payload as full_payload
  from adcs_hosts host
  join pg_documents full_agent
    on full_agent.namespace = 'agents:registrations'
   and full_agent.payload->>'tenantId' = host.tenant_id
   and coalesce(full_agent.payload->>'role', 'full_agent') = 'full_agent'
   and lower(coalesce(full_agent.payload #>> '{descriptor,osType}', '')) <> 'windows_adcs'
   and (
     (host.hostname is not null and lower(full_agent.payload #>> '{descriptor,hostname}') = lower(host.hostname))
     or (host.primary_ip is not null and full_agent.payload #>> '{descriptor,ipAddress}' = host.primary_ip)
     or (host.asset_fingerprint is not null and full_agent.payload #>> '{descriptor,machineId}' = host.asset_fingerprint)
   )
  order by
    host.id,
    case
      when host.hostname is not null and lower(full_agent.payload #>> '{descriptor,hostname}') = lower(host.hostname) then 0
      when host.primary_ip is not null and full_agent.payload #>> '{descriptor,ipAddress}' = host.primary_ip then 1
      else 2
    end,
    full_agent.payload->>'updatedAt' desc
)
update pg_hosts host
   set hostname = coalesce(full_matches.full_payload #>> '{descriptor,hostname}', host.hostname),
       display_name = coalesce(host.display_name, full_matches.full_payload #>> '{descriptor,hostname}'),
       primary_ip = coalesce(full_matches.full_payload #>> '{descriptor,ipAddress}', host.primary_ip),
       ip_addresses = case
         when full_matches.full_payload #>> '{descriptor,ipAddress}' is not null
           then jsonb_build_array(full_matches.full_payload #>> '{descriptor,ipAddress}')
         else host.ip_addresses
       end,
       os_type = full_matches.full_payload #>> '{descriptor,osType}',
       os_name = case lower(full_matches.full_payload #>> '{descriptor,osType}')
         when 'windows' then 'Windows Server'
         when 'linux' then coalesce(full_matches.full_payload #>> '{descriptor,linuxDistribution}', 'Linux Server')
         else full_matches.full_payload #>> '{descriptor,osType}'
       end,
       os_version = full_matches.full_payload #>> '{descriptor,osVersion}',
       arch = full_matches.full_payload #>> '{descriptor,arch}',
       zone_id = coalesce(full_matches.full_payload->>'zone', host.zone_id),
       management_channels = '["AGENT"]'::jsonb,
       discovery_source = 'AGENT',
       last_discovered_at = coalesce(full_matches.full_payload->>'updatedAt', host.last_discovered_at::text)::timestamptz,
       agent_id = full_matches.full_agent_id,
       asset_fingerprint = coalesce(host.asset_fingerprint, full_matches.full_payload #>> '{descriptor,machineId}'),
       management_mode = 'AGENT',
       status = case full_matches.full_payload->>'status'
         when 'ONLINE' then 'ACTIVE'
         when 'OFFLINE' then 'INACTIVE'
         when 'DISABLED' then 'DISABLED'
         else 'UNKNOWN'
       end,
       tags = coalesce(full_matches.full_payload #> '{descriptor,labels}', '[]'::jsonb),
       updated_at = coalesce(full_matches.full_payload->>'updatedAt', now()::text)::timestamptz,
       deleted_at = null,
       version = host.version + 1
  from full_matches
 where host.id = full_matches.host_id;

update pg_hosts host
   set agent_id = null,
       management_mode = 'AGENTLESS',
       management_channels = '[]'::jsonb,
       updated_at = now(),
       version = host.version + 1
 where host.deleted_at is null
   and exists (
     select 1
       from pg_documents adcs
      where adcs.namespace = 'agents:registrations'
        and adcs.document_id = host.agent_id
        and (
          coalesce(adcs.payload->>'role', '') = 'adcs_agent'
          or lower(coalesce(adcs.payload #>> '{descriptor,osType}', '')) = 'windows_adcs'
        )
   );
