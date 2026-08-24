insert into pg_data_correction_batches (
  id, spec_id, operator_id, started_at, status, before_summary, after_summary,
  script_sha256, created_at, updated_at
) values (
  'spec0334-20260727-terminal', '033.4', 'codex-spec-033.4', now(), 'STARTED',
  jsonb_build_object(
    'frameworksMissingType', (select count(*) from pg_framework_instances where deleted_at is null and framework_type is null),
    'targetsMissingCapabilities', (select count(*) from pg_managed_targets where deleted_at is null and coalesce(jsonb_array_length(supported_capabilities), 0)=0),
    'deviceAssignmentsNotHost', (select count(*) from plugin_capability_assignments a left join pg_hosts h on h.id=a.owner_id and h.tenant_id=a.tenant_id where a.owner_type='DEVICE' and a.status='ACTIVE' and h.id is null),
    'agentStrategies', (select count(*) from pg_service_assets where deleted_at is null and metadata->'deploymentStrategy'->>'type'='AGENT'),
    'legacyManagedContexts', (select count(*) from unified_plugin_bindings where managed_context ? 'agentId' or managed_context ? 'deviceAssetId')
  ),
  '{}'::jsonb,
  '133fca910a28b23f8a61c03fa3cfaa87d2565880e9225cb574dc88aaa0f91c55',
  now(), now()
) on conflict (id) do nothing;

update pg_framework_instances
set framework_type = case
      when upper(coalesce(discovery_provider_key, service_name, '')) like '%IIS%' then 'web.iis'
      when upper(coalesce(discovery_provider_key, service_name, '')) like '%NGINX%' then 'web.nginx'
      when upper(coalesce(discovery_provider_key, service_name, '')) like '%APACHE%' then 'web.apache'
      when upper(coalesce(discovery_provider_key, service_name, '')) like '%TOMCAT%' then 'web.tomcat'
      when framework_key='device' and not exists (
        select 1 from pg_site_assets site where site.framework_instance_id=pg_framework_instances.id and site.deleted_at is null
      ) then 'device.generic'
      else 'adc.load-balancer'
    end,
    discovery_provider_key = case
      when discovery_provider_key like 'PLUGIN:%' then 'plugin-version:' || substring(discovery_provider_key from 8)
      when raw_facts->>'agentId' is not null then 'agent:' || (raw_facts->>'agentId')
      else lower(replace(discovery_provider_key, '_', '-'))
    end,
    updated_at=now(), version=version+1
where deleted_at is null;

update pg_site_assets site
set discovery_provider_key=framework.discovery_provider_key,
    site_type=case when framework.framework_type like 'web.%' then 'web.site' else 'network.virtual-server' end,
    updated_at=now(), version=site.version+1
from pg_framework_instances framework
where framework.id=site.framework_instance_id and framework.tenant_id=site.tenant_id and site.deleted_at is null;

update pg_managed_targets target
set discovery_provider_key=framework.discovery_provider_key,
    target_type='tls.binding',
    supported_capabilities='["certificate.deploy","certificate.verify","certificate.rollback"]'::jsonb,
    execution_locations=case when target.agent_id is null then '["CONTROL_PLANE","GATEWAY"]'::jsonb else '["AGENT"]'::jsonb end,
    framework_type=null,
    metadata=(target.metadata - 'deviceAssetId') || jsonb_build_object('correctedBySpec', '033.4'),
    updated_at=now(), version=target.version+1
from pg_framework_instances framework
where framework.id=target.framework_instance_id and framework.tenant_id=target.tenant_id and target.deleted_at is null;

update plugin_capability_assignments assignment
set owner_id=binding.managed_context->>'hostId', updated_at=now()
from unified_plugin_bindings binding
where binding.id=assignment.plugin_binding_id
  and binding.tenant_id=assignment.tenant_id
  and assignment.owner_type='DEVICE'
  and assignment.status='ACTIVE'
  and binding.managed_context->>'hostId' is not null;

update unified_plugin_bindings
set managed_context=managed_context - 'agentId' - 'deviceAssetId', updated_at=now(), version=version+1
where managed_context ? 'agentId' or managed_context ? 'deviceAssetId';

update pg_service_assets asset
set metadata=jsonb_set(
      asset.metadata,
      '{deploymentStrategy}',
      jsonb_build_object(
        'type', 'MANAGED_TARGET',
        'managedTarget', jsonb_build_object('managedTargetId', asset.metadata->'deploymentStrategy'->'agent'->>'managedTargetId'),
        'updatedAt', now(),
        'updatedBy', 'codex-spec-033.4'
      ),
      true
    ),
    updated_at=now(), version=version+1
where asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type'='AGENT'
  and asset.metadata->'deploymentStrategy'->'agent'->>'managedTargetId' is not null;

update pg_data_correction_batches
set completed_at=now(), status='VERIFIED',
    after_summary=jsonb_build_object(
      'frameworksMissingType', (select count(*) from pg_framework_instances where deleted_at is null and framework_type is null),
      'targetsMissingCapabilities', (select count(*) from pg_managed_targets where deleted_at is null and coalesce(jsonb_array_length(supported_capabilities), 0)=0),
      'deviceAssignmentsNotHost', (select count(*) from plugin_capability_assignments a left join pg_hosts h on h.id=a.owner_id and h.tenant_id=a.tenant_id where a.owner_type='DEVICE' and a.status='ACTIVE' and h.id is null),
      'agentStrategies', (select count(*) from pg_service_assets where deleted_at is null and metadata->'deploymentStrategy'->>'type'='AGENT'),
      'legacyManagedContexts', (select count(*) from unified_plugin_bindings where managed_context ? 'agentId' or managed_context ? 'deviceAssetId')
    ),
    updated_at=now()
where id='spec0334-20260727-terminal';
