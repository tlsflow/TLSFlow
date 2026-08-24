-- 004.5：删除旧 Agent 和旧执行目标数据。
-- 本迁移只处理当前数据库中的前发布记录，不为旧值建立运行期兼容路径。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。

create temporary table if not exists gcac_retired_agent_ids (
  agent_id uuid primary key
) on commit drop;

truncate gcac_retired_agent_ids;

insert into gcac_retired_agent_ids (agent_id)
select id
from agents
where agent_type = 'LEGACY';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000600', 'agents', '', agent.id::text,
  'DELETE', 'REMOVED_LEGACY_AGENT',
  jsonb_build_object('agentType', agent.agent_type, 'tenantId', agent.tenant_id::text)
from agents agent
join gcac_retired_agent_ids retired on retired.agent_id = agent.id
on conflict do nothing;

create temporary table if not exists gcac_retired_execution_target_ids (
  target_id uuid primary key
) on commit drop;

truncate gcac_retired_execution_target_ids;

insert into gcac_retired_execution_target_ids (target_id)
select id
from execution_targets
where target_kind = 'SCRIPT_PACKAGE'
   or agent_id in (select agent_id from gcac_retired_agent_ids)
   or gateway_id in (select gateway.id from gateways gateway join gcac_retired_agent_ids retired on retired.agent_id = gateway.agent_id);

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000600', 'execution_targets', '', target.id::text,
  'DELETE', 'REMOVED_RETIRED_EXECUTION_TARGET',
  jsonb_build_object('targetKind', target.target_kind, 'agentId', target.agent_id::text, 'gatewayId', target.gateway_id::text)
from execution_targets target
join gcac_retired_execution_target_ids retired on retired.target_id = target.id
on conflict do nothing;

update deployment_plan_targets target
set execution_target_id = null,
    updated_at = now(),
    version = version + 1
where target.execution_target_id in (select target_id from gcac_retired_execution_target_ids);

update execution_runs run
set execution_target_id = null,
    updated_at = now(),
    version = version + 1
where run.execution_target_id in (select target_id from gcac_retired_execution_target_ids);

delete from execution_targets target
where target.id in (select target_id from gcac_retired_execution_target_ids);

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000600', 'gateways', '', gateway.id::text,
  'DELETE', 'REMOVED_LEGACY_AGENT_GATEWAY',
  jsonb_build_object('agentId', gateway.agent_id::text, 'tenantId', gateway.tenant_id::text)
from gateways gateway
join gcac_retired_agent_ids retired on retired.agent_id = gateway.agent_id
on conflict do nothing;

delete from gateways gateway
where gateway.agent_id in (select agent_id from gcac_retired_agent_ids);

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000600', 'target_capabilities', '', capability.id::text,
  'DELETE', 'REMOVED_RETIRED_CAPABILITY',
  jsonb_build_object('targetType', capability.target_type, 'targetId', capability.target_id::text, 'capabilityKey', capability.capability_key)
from target_capabilities capability
where lower(capability.capability_key) in (
    'process.exec',
    'process.exec.capture_output',
    'process.script.run',
    'windows.powershell.exec',
    'windows.cmd.exec',
    'windows.certutil.import_pfx',
    'service.reload.custom',
    'custom.reload.command',
    'ssh.exec',
    'winrm.exec',
    'wmi.exec',
    'agent.legacy.online'
  )
  or lower(capability.capability_key) like 'script_package.%'
on conflict do nothing;

delete from target_capabilities capability
where lower(capability.capability_key) in (
    'process.exec',
    'process.exec.capture_output',
    'process.script.run',
    'windows.powershell.exec',
    'windows.cmd.exec',
    'windows.certutil.import_pfx',
    'service.reload.custom',
    'custom.reload.command',
    'ssh.exec',
    'winrm.exec',
    'wmi.exec',
    'agent.legacy.online'
  )
  or lower(capability.capability_key) like 'script_package.%';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000600', 'pg_documents', document.namespace, document.document_id,
  'DELETE', 'REMOVED_LEGACY_AGENT_DOCUMENT',
  jsonb_build_object('agentId', document.payload->>'agentId')
from pg_documents document
where document.namespace in (
    'agents:registrations',
    'agents:snapshots',
    'agents:heartbeats',
    'agents:tasks',
    'agents:taskLogs',
    'agents:taskLogCursors',
    'agents:enrollmentTokens',
    'agents:sessions'
  )
  and document.payload->>'agentId' in (select agent_id::text from gcac_retired_agent_ids)
on conflict do nothing;

delete from pg_documents document
where document.namespace in (
    'agents:registrations',
    'agents:snapshots',
    'agents:heartbeats',
    'agents:tasks',
    'agents:taskLogs',
    'agents:taskLogCursors',
    'agents:enrollmentTokens',
    'agents:sessions'
  )
  and document.payload->>'agentId' in (select agent_id::text from gcac_retired_agent_ids);

update pg_hosts host
set agent_id = null,
    management_mode = case
      when upper(host.management_mode) in ('LEGACY_AGENT', 'SCRIPT_PACKAGE') then 'AGENTLESS'
      else host.management_mode
    end,
    updated_at = now(),
    version = version + 1
where host.agent_id in (select agent_id::text from gcac_retired_agent_ids)
   or upper(host.management_mode) in ('LEGACY_AGENT', 'SCRIPT_PACKAGE');

update hosts host
set management_mode = case
      when host.management_mode in ('LEGACY_AGENT', 'SCRIPT_PACKAGE') then 'AGENTLESS'
      else host.management_mode
    end,
    updated_at = now(),
    version = version + 1
where host.management_mode in ('LEGACY_AGENT', 'SCRIPT_PACKAGE');

delete from agents agent
where agent.id in (select agent_id from gcac_retired_agent_ids);

alter table hosts
  drop constraint if exists hosts_management_mode_check;

alter table hosts
  add constraint hosts_management_mode_check
  check (management_mode in ('AGENT', 'GATEWAY', 'AGENTLESS', 'MONITOR_ONLY'));

alter table agents
  drop constraint if exists agents_agent_type_check;

alter table agents
  add constraint agents_agent_type_check
  check (agent_type in ('FULL', 'GATEWAY'));

alter table execution_targets
  drop constraint if exists execution_targets_target_kind_check;

alter table execution_targets
  add constraint execution_targets_target_kind_check
  check (target_kind in ('AGENT', 'GATEWAY_FORWARD', 'SSH', 'WINRM', 'SMB_WMI', 'CURL', 'WORKFLOW', 'TRUSTED_JS'));
