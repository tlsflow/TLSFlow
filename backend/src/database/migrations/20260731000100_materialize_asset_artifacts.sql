-- Spec 033.6：为已选择证书格式但缺少输入的应用资产物化标准 Artifact Binding。
-- 插件资源是唯一契约来源，迁移不按插件 ID、厂商或产品类型分派。

create table if not exists deployment_input_artifact_binding_migration_backups (
  plugin_binding_id text primary key references unified_plugin_bindings(id),
  tenant_id text not null,
  original_input_bindings jsonb not null,
  original_version integer not null,
  backed_up_at timestamptz not null default now()
);

insert into deployment_input_artifact_binding_migration_backups (
  plugin_binding_id,
  tenant_id,
  original_input_bindings,
  original_version
)
select distinct binding.id,
       binding.tenant_id,
       binding.input_bindings,
       binding.version
from plugin_capability_assignments assignment
join unified_plugin_bindings binding
  on binding.id = assignment.plugin_binding_id
 and binding.tenant_id = assignment.tenant_id
join pg_service_assets asset
  on asset.id = assignment.owner_id
 and asset.tenant_id = assignment.tenant_id
 and asset.deleted_at is null
where assignment.owner_type = 'APPLICATION_ASSET'
  and assignment.status = 'ACTIVE'
  and binding.status = 'ACTIVE'
  and nullif(trim(asset.metadata->'deploymentStrategy'->'managedTarget'->>'certificateFormatId'), '') is not null
  and binding.input_bindings->'artifacts' = '{}'::jsonb
on conflict (plugin_binding_id) do nothing;

with candidates as (
  select binding.id binding_id,
         asset.metadata->'deploymentStrategy'->'managedTarget'->>'certificateFormatId' certificate_format_id,
         resource.resource_content::jsonb->'inputContract' input_contract
  from plugin_capability_assignments assignment
  join unified_plugin_bindings binding
    on binding.id = assignment.plugin_binding_id
   and binding.tenant_id = assignment.tenant_id
   and binding.plugin_version_id = assignment.plugin_version_id
   and binding.status = 'ACTIVE'
  join pg_service_assets asset
    on asset.id = assignment.owner_id
   and asset.tenant_id = assignment.tenant_id
   and asset.deleted_at is null
  join unified_plugin_versions plugin_version
    on plugin_version.id = assignment.plugin_version_id
   and plugin_version.tenant_id = assignment.tenant_id
  join unified_plugin_resources resource
    on resource.plugin_version_id = plugin_version.id
   and resource.resource_path = case plugin_version.runtime
     when 'AGENT_ATOMIC' then plugin_version.manifest->'resources'->'agentRecipes'->>assignment.capability_key
     when 'WORKFLOW_DSL' then plugin_version.manifest->'resources'->'workflows'->>assignment.capability_key
     else null
   end
  where assignment.owner_type = 'APPLICATION_ASSET'
    and assignment.status = 'ACTIVE'
    and nullif(trim(asset.metadata->'deploymentStrategy'->'managedTarget'->>'certificateFormatId'), '') is not null
    and binding.input_bindings->'artifacts' = '{}'::jsonb
), artifact_bindings as (
  select candidate.binding_id,
         jsonb_object_agg(
           artifact.key,
           jsonb_build_object(
             'certificateFormatId', candidate.certificate_format_id,
             'outputBindings', outputs.output_bindings
           )
         ) artifacts
  from candidates candidate
  cross join lateral jsonb_each(coalesce(candidate.input_contract->'artifacts', '{}'::jsonb)) artifact
  cross join lateral (
    select jsonb_object_agg(
      output.key,
      case lower(trim(coalesce(output.value->>'role', '')))
        when 'public_certificate' then 'leafPem'
        when 'private_key' then 'privateKeyPem'
        when 'certificate_chain' then 'orderedChainPem'
        when 'fingerprint_sha256' then 'fingerprintSha256'
        when 'pkcs12_bundle' then 'pfxBase64'
        when 'pkcs12_password' then 'pfxPassword'
        else trim(output.key)
      end
    ) output_bindings
    from jsonb_each(coalesce(artifact.value->'artifactContract'->'outputs', '{}'::jsonb)) output
  ) outputs
  where artifact.value->>'kind' = 'certificate'
    and coalesce((artifact.value->>'required')::boolean, false)
    and outputs.output_bindings is not null
  group by candidate.binding_id, candidate.certificate_format_id
)
update unified_plugin_bindings binding
set input_bindings = jsonb_set(binding.input_bindings, '{artifacts}', artifact_bindings.artifacts, true),
    version = binding.version + 1,
    updated_at = now()
from artifact_bindings
where binding.id = artifact_bindings.binding_id
  and binding.input_bindings->'artifacts' = '{}'::jsonb;
