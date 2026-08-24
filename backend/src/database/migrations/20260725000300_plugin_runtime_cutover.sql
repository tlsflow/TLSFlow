-- Spec 033.2：活动插件数据硬切到 Unified PluginVersion / PluginBinding / CapabilityAssignment。

-- Citrix ADC 的设备 Binding 统一绑定 PEM 叶子证书、私钥、中间链和目标指纹。
update unified_plugin_bindings binding
set certificate_artifact_bindings = jsonb_build_object(
      'certificate',
      jsonb_build_object(
        'certificateFormatId', format.id,
        'outputBindings', jsonb_build_object(
          'leafPem', 'public',
          'privateKeyPem', 'private',
          'orderedChainPem', 'chain',
          'fingerprintSha256', 'fingerprintSha256'
        )
      )
    ),
    updated_at = now(),
    version = binding.version + 1
from unified_plugin_versions plugin
cross join lateral (
  select candidate.id
  from pg_certificate_version_formats candidate
  where candidate.certificate_version_id is null
    and candidate.format = 'pem'
    and coalesce((candidate.parameters->>'generatePrivateKeyFile')::boolean, false) = true
  order by candidate.created_at desc
  limit 1
) format
where binding.plugin_version_id = plugin.id
  and plugin.plugin_id = 'citrix.netscaler-adc'
  and binding.certificate_artifact_bindings = '{}'::jsonb;

-- Standalone Workflow 应用资产按工作流名称映射到内置统一插件。
with workflow_assets as (
  select asset.id application_asset_id,
         asset.tenant_id,
         asset.metadata->'deploymentStrategy' strategy,
         asset.metadata->'deploymentStrategy'->'workflow' workflow,
         template.payload->>'name' workflow_name,
         plugin.id plugin_version_id
  from pg_service_assets asset
  join pg_documents template
    on template.namespace = 'workflow.templates'
   and template.document_id = asset.metadata->'deploymentStrategy'->'workflow'->>'workflowId'
  join unified_plugin_versions plugin
    on plugin.tenant_id = asset.tenant_id
   and plugin.runtime = 'WORKFLOW_DSL'
   and plugin.status = 'ENABLED'
   and plugin.plugin_id = case template.payload->>'name'
     when 'apache-8444-cert-switch' then 'builtin.workflow.apache-8444-cert-switch'
     when 'synology-dsm-cert-import' then 'builtin.workflow.synology-dsm-cert-import'
   end
  where asset.asset_kind = 'APPLICATION'
    and asset.deleted_at is null
    and asset.metadata->'deploymentStrategy'->>'type' = 'WORKFLOW'
    and template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
), inserted_workflow_bindings as (
  insert into unified_plugin_bindings (
    id, tenant_id, plugin_version_id, mode, variable_bindings, secret_bindings,
    certificate_artifact_bindings, connection_bindings, managed_context, status, version, created_at, updated_at
  )
  select 'plgb_cutover_' || substr(md5(asset.tenant_id || ':workflow:' || asset.application_asset_id), 1, 24),
         asset.tenant_id,
         asset.plugin_version_id,
         'STANDALONE',
         coalesce(asset.workflow->'variableBindings', asset.workflow->'parameterBindings', '{}'::jsonb),
         coalesce(asset.workflow->'credentialRefs', '{}'::jsonb),
         coalesce(asset.workflow->'certificateArtifactBindings', '{}'::jsonb),
         coalesce(asset.workflow->'connectionBindings', '{}'::jsonb),
         null,
         'ACTIVE', 1, now(), now()
  from workflow_assets asset
  on conflict (id) do update set
    plugin_version_id = excluded.plugin_version_id,
    variable_bindings = excluded.variable_bindings,
    secret_bindings = excluded.secret_bindings,
    certificate_artifact_bindings = excluded.certificate_artifact_bindings,
    connection_bindings = excluded.connection_bindings,
    status = 'ACTIVE',
    updated_at = excluded.updated_at,
    version = unified_plugin_bindings.version + 1
  returning id, tenant_id, plugin_version_id
)
insert into plugin_capability_assignments (
  id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id,
  plugin_binding_id, precedence, status, created_at, updated_at
)
select 'capa_cutover_' || substr(md5(asset.tenant_id || ':workflow:' || asset.application_asset_id), 1, 24),
       asset.tenant_id, 'APPLICATION_ASSET', asset.application_asset_id, 'certificate.deploy',
       asset.plugin_version_id,
       'plgb_cutover_' || substr(md5(asset.tenant_id || ':workflow:' || asset.application_asset_id), 1, 24),
       'ASSET_OVERRIDE', 'ACTIVE', now(), now()
from workflow_assets asset
on conflict (tenant_id, owner_type, owner_id, capability_key) do update set
  plugin_version_id = excluded.plugin_version_id,
  plugin_binding_id = excluded.plugin_binding_id,
  precedence = excluded.precedence,
  status = 'ACTIVE',
  updated_at = excluded.updated_at;

-- 将 Workflow 策略固定到统一 Binding；正式执行由插件发布的 WorkflowBinding 决定版本。
update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy,workflow,pluginBindingId}',
      to_jsonb('plgb_cutover_' || substr(md5(asset.tenant_id || ':workflow:' || asset.id), 1, 24)),
      true
    ),
    updated_at = now(),
    version = asset.version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
  and exists (
    select 1 from unified_plugin_bindings binding
    where binding.id = 'plgb_cutover_' || substr(md5(asset.tenant_id || ':workflow:' || asset.id), 1, 24)
  );

-- Agent 管理的 IIS/NGINX 应用资产硬切到内置 AGENT_ATOMIC 插件。
with agent_assets as (
  select asset.id application_asset_id,
         asset.tenant_id,
         asset.address,
         asset.port,
         coalesce(target.agent_id, asset.agent_id) agent_id,
         target.host_id,
         target.id managed_target_id,
         target.site_asset_id,
         upper(target.framework_type) framework_type,
         site.site_name,
         site.binding_information,
         site.metadata site_metadata,
         certificate.cert_path,
         certificate.key_path,
         coalesce(
           asset.metadata->'deploymentStrategy'->'agent'->>'certificateFormatId',
           (select format.id from pg_certificate_version_formats format
            where format.certificate_version_id is null
              and ((upper(target.framework_type) = 'IIS' and format.format = 'pfx')
                or (upper(target.framework_type) = 'NGINX' and format.format = 'pem'))
            order by format.created_at desc limit 1)
         ) certificate_format_id,
         plugin.id plugin_version_id
  from pg_service_assets asset
  join pg_application_asset_targets asset_target
    on asset_target.tenant_id = asset.tenant_id
   and asset_target.application_asset_id = asset.id
   and asset_target.deleted_at is null
  join pg_managed_targets target
    on target.tenant_id = asset.tenant_id
   and target.id = asset_target.managed_target_id
   and target.deleted_at is null
  join pg_site_assets site
    on site.tenant_id = asset.tenant_id
   and site.id = target.site_asset_id
   and site.deleted_at is null
  left join pg_certificate_bindings certificate
    on certificate.tenant_id = asset.tenant_id
   and certificate.managed_target_id = target.id
   and certificate.deleted_at is null
  join unified_plugin_versions plugin
    on plugin.tenant_id = asset.tenant_id
   and plugin.runtime = 'AGENT_ATOMIC'
   and plugin.status = 'ENABLED'
   and plugin.plugin_id = case upper(target.framework_type)
     when 'IIS' then 'builtin.windows.iis.pfx'
     when 'NGINX' then 'builtin.linux.nginx.pem'
   end
  where asset.asset_kind = 'APPLICATION'
    and asset.deleted_at is null
    and coalesce(target.agent_id, asset.agent_id) is not null
    and upper(target.framework_type) in ('IIS', 'NGINX')
), inserted_agent_bindings as (
  insert into unified_plugin_bindings (
    id, tenant_id, plugin_version_id, mode, variable_bindings, secret_bindings,
    certificate_artifact_bindings, connection_bindings, managed_context, status, version, created_at, updated_at
  )
  select 'plgb_cutover_' || substr(md5(asset.tenant_id || ':agent:' || asset.application_asset_id), 1, 24),
         asset.tenant_id,
         asset.plugin_version_id,
         'MANAGED',
         case asset.framework_type
           when 'IIS' then jsonb_build_object(
             'siteName', asset.site_name,
             'bindingInformation', asset.binding_information,
             'appPoolName', asset.site_metadata->>'appPool',
             'verifyHost', asset.address,
             'verifyPort', asset.port
           )
           else jsonb_build_object(
             'certificatePath', asset.cert_path,
             'privateKeyPath', asset.key_path,
             'nginxProgram', '/usr/sbin/nginx',
             'serviceName', 'nginx',
             'verifyHost', asset.address,
             'verifyPort', asset.port
           )
         end,
         '{}'::jsonb,
         case asset.framework_type
           when 'IIS' then jsonb_build_object(
             'certificate', jsonb_build_object(
               'certificateFormatId', asset.certificate_format_id,
               'outputBindings', jsonb_build_object('bundle', 'bundle')
             )
           )
           else jsonb_build_object(
             'certificate', jsonb_build_object(
               'certificateFormatId', asset.certificate_format_id,
               'outputBindings', jsonb_build_object('certificatePem', 'public')
             ),
             'privateKey', jsonb_build_object(
               'certificateFormatId', asset.certificate_format_id,
               'outputBindings', jsonb_build_object('privateKeyPem', 'private')
             )
           )
         end,
         '{}'::jsonb,
         jsonb_build_object(
           'hostId', asset.host_id,
           'agentId', asset.agent_id,
           'managedTargetId', asset.managed_target_id,
           'siteAssetId', asset.site_asset_id
         ),
         'ACTIVE', 1, now(), now()
  from agent_assets asset
  where asset.certificate_format_id is not null
  on conflict (id) do update set
    plugin_version_id = excluded.plugin_version_id,
    variable_bindings = excluded.variable_bindings,
    certificate_artifact_bindings = excluded.certificate_artifact_bindings,
    managed_context = excluded.managed_context,
    status = 'ACTIVE',
    updated_at = excluded.updated_at,
    version = unified_plugin_bindings.version + 1
  returning id
)
insert into plugin_capability_assignments (
  id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id,
  plugin_binding_id, precedence, status, created_at, updated_at
)
select 'capa_cutover_' || substr(md5(asset.tenant_id || ':agent:' || asset.application_asset_id), 1, 24),
       asset.tenant_id, 'APPLICATION_ASSET', asset.application_asset_id, 'certificate.deploy',
       asset.plugin_version_id,
       'plgb_cutover_' || substr(md5(asset.tenant_id || ':agent:' || asset.application_asset_id), 1, 24),
       'ASSET_OVERRIDE', 'ACTIVE', now(), now()
from agent_assets asset
where asset.certificate_format_id is not null
on conflict (tenant_id, owner_type, owner_id, capability_key) do update set
  plugin_version_id = excluded.plugin_version_id,
  plugin_binding_id = excluded.plugin_binding_id,
  precedence = excluded.precedence,
  status = 'ACTIVE',
  updated_at = excluded.updated_at;

with agent_strategy_updates as (
  select asset.id application_asset_id,
         asset.tenant_id,
         binding.id plugin_binding_id,
         binding.managed_context->>'agentId' agent_id,
         binding.managed_context->>'managedTargetId' managed_target_id,
         binding.managed_context->>'siteAssetId' site_asset_id,
         coalesce(
           binding.certificate_artifact_bindings->'certificate'->>'certificateFormatId',
           binding.certificate_artifact_bindings->'privateKey'->>'certificateFormatId'
         ) certificate_format_id
  from pg_service_assets asset
  join unified_plugin_bindings binding
    on binding.tenant_id = asset.tenant_id
   and binding.id = 'plgb_cutover_' || substr(md5(asset.tenant_id || ':agent:' || asset.id), 1, 24)
  where asset.asset_kind = 'APPLICATION'
    and asset.deleted_at is null
)
update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy}',
      jsonb_build_object(
        'type', 'AGENT',
        'agent', jsonb_build_object(
          'mode', 'PLUGIN',
          'pluginBindingId', candidate.plugin_binding_id,
          'agentId', candidate.agent_id,
          'managedTargetId', candidate.managed_target_id,
          'siteAssetId', candidate.site_asset_id,
          'certificateFormatId', candidate.certificate_format_id
        ),
        'compatibilityMode', 'UNIFIED',
        'updatedAt', to_jsonb(now())
      ),
      true
    ),
    updated_at = now(),
    version = asset.version + 1
from agent_strategy_updates candidate
where asset.tenant_id = candidate.tenant_id
  and asset.id = candidate.application_asset_id;

-- 删除旧 Agent Package/Mount 活动目录数据；历史执行快照不受影响。
delete from pg_documents where namespace = 'plugins:agent-packages';
delete from pg_documents
where namespace = 'plugins:catalog-activations'
  and payload->>'catalogType' = 'AGENT_DEPLOYMENT';
drop table if exists agent_plugin_mounts;
