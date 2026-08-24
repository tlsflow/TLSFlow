-- 历史应用资产的 Plugin Binding 可能仍指向旧插件版本，或只保留了旧输入字段。
-- 本迁移以当前 ManagedTarget/Device 的能力指派为版本来源，以当前插件 Contract
-- 和 onboarding/application-asset 配方为输入来源；无法安全推导的值只进入审计，不伪造。

create table if not exists deployment_input_binding_repair_backups (
  plugin_binding_id text primary key,
  tenant_id text not null,
  application_asset_id text not null,
  capability_key text not null,
  original_plugin_version_id text not null,
  original_input_bindings jsonb not null,
  original_managed_context jsonb,
  original_version integer not null,
  backed_up_at timestamptz not null default now()
);

create table if not exists deployment_input_binding_repairs (
  tenant_id text not null,
  application_asset_id text not null,
  capability_key text not null,
  plugin_binding_id text not null,
  previous_plugin_version_id text not null,
  current_plugin_version_id text not null,
  status text not null check (status in ('REPAIRED', 'UNRESOLVED')),
  issues jsonb not null default '{}'::jsonb,
  repaired_at timestamptz not null default now(),
  primary key (tenant_id, application_asset_id, capability_key)
);

create or replace function gcac_20260822000100_repair_input_bindings(
  bindings jsonb,
  contract jsonb,
  onboarding_variables jsonb,
  certificate_format_id text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := jsonb_build_object(
    'apiVersion', 'gcac.input-bindings/v1',
    'variables', '{}'::jsonb,
    'connections', '{}'::jsonb,
    'credentials', '{}'::jsonb,
    'artifacts', '{}'::jsonb
  );
  entry record;
  output_entry record;
  definition jsonb;
  output_bindings jsonb;
  format_id text;
begin
  if jsonb_typeof(bindings) <> 'object' then bindings := '{}'::jsonb; end if;
  if jsonb_typeof(contract) <> 'object' then return result; end if;

  -- 变量只保留当前 Contract 允许资产覆盖的槽位。
  for entry in select * from jsonb_each(coalesce(bindings->'variables', '{}'::jsonb)) loop
    definition := contract->'variables'->entry.key;
    if definition is not null
       and coalesce(definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(definition->>'configurationMode', '') <> 'runtime' then
      result := jsonb_set(result, '{variables}', result->'variables' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;

  -- 必填变量只接受插件配方明确声明的默认值，固定/运行时槽位仍不写入资产层。
  for entry in select * from jsonb_each(coalesce(contract->'variables', '{}'::jsonb)) loop
    definition := entry.value;
    if coalesce(definition->>'required', 'false') = 'true'
       and coalesce(definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(definition->>'configurationMode', '') <> 'runtime'
       and not (result->'variables' ? entry.key)
       and jsonb_typeof(onboarding_variables) = 'object'
       and onboarding_variables ? entry.key then
      result := jsonb_set(result, '{variables}', result->'variables' || jsonb_build_object(entry.key, onboarding_variables->entry.key), true);
    end if;
  end loop;

  -- 连接和凭据仍按当前 Contract 过滤，避免历史槽位继续参与合并。
  for entry in select * from jsonb_each(coalesce(bindings->'connections', '{}'::jsonb)) loop
    if contract->'connections' ? entry.key then
      result := jsonb_set(result, '{connections}', result->'connections' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;
  for entry in select * from jsonb_each(coalesce(bindings->'credentials', '{}'::jsonb)) loop
    if contract->'credentials' ? entry.key then
      result := jsonb_set(result, '{credentials}', result->'credentials' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;

  -- 非证书 Artifact 保留原值；证书 Artifact 由当前 Contract 的输出角色重建映射。
  for entry in select * from jsonb_each(coalesce(bindings->'artifacts', '{}'::jsonb)) loop
    if contract->'artifacts' ? entry.key
       and coalesce((contract->'artifacts'->entry.key->>'kind'), '') <> 'certificate' then
      result := jsonb_set(result, '{artifacts}', result->'artifacts' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;
  for entry in select * from jsonb_each(coalesce(contract->'artifacts', '{}'::jsonb)) loop
    if coalesce(entry.value->>'kind', '') = 'certificate'
       and coalesce(entry.value->>'required', 'false') = 'true' then
      format_id := nullif(trim(coalesce(certificate_format_id, '')), '');
      if format_id is null then format_id := nullif(trim(coalesce(bindings->'artifacts'->entry.key->>'certificateFormatId', '')), ''); end if;
      -- 历史 Contract 可能更换证书槽位名称；从任意旧证书 Artifact 恢复格式 ID，避免因槽位改名丢失证书选择。
      if format_id is null then
        select nullif(trim(legacy_artifact.value->>'certificateFormatId'), '')
        into format_id
        from jsonb_each(coalesce(bindings->'artifacts', '{}'::jsonb)) legacy_artifact
        where jsonb_typeof(legacy_artifact.value) = 'object'
          and nullif(trim(legacy_artifact.value->>'certificateFormatId'), '') is not null
        order by legacy_artifact.key
        limit 1;
      end if;
      output_bindings := '{}'::jsonb;
      for output_entry in select * from jsonb_each(coalesce(entry.value->'artifactContract'->'outputs', '{}'::jsonb)) loop
        output_bindings := output_bindings || jsonb_build_object(
          output_entry.key,
          case lower(trim(coalesce(output_entry.value->>'role', '')))
            when 'public_certificate' then 'leafPem'
            when 'private_key' then 'privateKeyPem'
            when 'certificate_chain' then 'orderedChainPem'
            when 'fingerprint_sha256' then 'fingerprintSha256'
            when 'pkcs12_bundle' then 'pfxBase64'
            when 'pkcs12_password' then 'pfxPassword'
            else trim(output_entry.key)
          end
        );
      end loop;
      if format_id is not null and output_bindings <> '{}'::jsonb then
        result := jsonb_set(result, '{artifacts}', result->'artifacts' || jsonb_build_object(
          entry.key, jsonb_build_object('certificateFormatId', format_id, 'outputBindings', output_bindings)
        ), true);
      end if;
    end if;
  end loop;
  return result;
end;
$$;

create temporary table gcac_20260822000100_candidates on commit drop as
with application_rows as (
  select
    assignment.tenant_id,
    assignment.owner_id application_asset_id,
    assignment.capability_key,
    assignment.plugin_version_id previous_plugin_version_id,
    assignment.plugin_binding_id,
    binding.input_bindings,
    binding.managed_context,
    binding.version binding_version,
    coalesce(
      nullif(asset.metadata #>> '{deploymentStrategy,managedTarget,certificateFormatId}', ''),
      nullif(asset.metadata #>> '{deploymentStrategy,agent,certificateFormatId}', ''),
      nullif(asset.metadata #>> '{deploymentStrategy,workflow,certificateFormatId}', ''),
      nullif(asset.metadata->>'certificateFormatId', ''),
      ''
    ) certificate_format_id,
    target.id current_managed_target_id,
    target.device_id current_host_id,
    case
      when target_binding.id is not null then target_assignment.plugin_version_id
      when device_binding.id is not null then device_assignment.plugin_version_id
      else assignment.plugin_version_id
    end current_plugin_version_id
  from plugin_capability_assignments assignment
  join unified_plugin_bindings binding
    on binding.tenant_id = assignment.tenant_id
   and binding.id = assignment.plugin_binding_id
   and binding.status = 'ACTIVE'
  join pg_service_assets asset
    on asset.tenant_id = assignment.tenant_id
   and asset.id = assignment.owner_id
   and asset.deleted_at is null
  left join pg_application_asset_targets relation
    on relation.tenant_id = assignment.tenant_id
   and relation.application_asset_id = assignment.owner_id
   and relation.deleted_at is null
  left join pg_managed_targets target
    on target.tenant_id = assignment.tenant_id
   and target.id = coalesce(relation.managed_target_id, asset.metadata #>> '{deploymentStrategy,managedTarget,managedTargetId}')
   and target.deleted_at is null
   and target.status = 'ACTIVE'
  left join plugin_capability_assignments target_assignment
    on target_assignment.tenant_id = assignment.tenant_id
   and target_assignment.owner_type = 'MANAGED_TARGET'
   and target_assignment.owner_id = target.id
   and target_assignment.capability_key = assignment.capability_key
   and target_assignment.status = 'ACTIVE'
  left join unified_plugin_bindings target_binding
    on target_binding.tenant_id = target_assignment.tenant_id
   and target_binding.id = target_assignment.plugin_binding_id
   and target_binding.plugin_version_id = target_assignment.plugin_version_id
   and target_binding.status = 'ACTIVE'
  left join plugin_capability_assignments device_assignment
    on device_assignment.tenant_id = assignment.tenant_id
   and device_assignment.owner_type = 'DEVICE'
   and device_assignment.owner_id = target.device_id
   and device_assignment.capability_key = assignment.capability_key
   and device_assignment.status = 'ACTIVE'
  left join unified_plugin_bindings device_binding
    on device_binding.tenant_id = device_assignment.tenant_id
   and device_binding.id = device_assignment.plugin_binding_id
   and device_binding.plugin_version_id = device_assignment.plugin_version_id
   and device_binding.status = 'ACTIVE'
  where assignment.owner_type = 'APPLICATION_ASSET'
    and assignment.status = 'ACTIVE'
), resolved_rows as (
  select distinct on (application_asset_id, capability_key)
    application_rows.*
  from application_rows
  order by application_asset_id, capability_key,
    case when current_plugin_version_id <> previous_plugin_version_id then 0 else 1 end,
    plugin_binding_id
), resources as (
  select
    row.*,
    plugin.manifest,
    contract_resource.resource_content::jsonb as contract_resource,
    onboarding_resource.resource_content::jsonb as onboarding_resource
  from resolved_rows row
  join unified_plugin_versions plugin on plugin.id = row.current_plugin_version_id
  left join unified_plugin_resources contract_resource
    on contract_resource.plugin_version_id = plugin.id
   and contract_resource.resource_path = coalesce(
     plugin.manifest->'resources'->'inputContracts'->>row.capability_key,
     plugin.manifest->'resources'->'agentPlans'->>row.capability_key,
     plugin.manifest->'resources'->'agentRecipes'->>row.capability_key,
     plugin.manifest->'resources'->'workflows'->>row.capability_key
   )
  left join unified_plugin_resources onboarding_resource
    on onboarding_resource.plugin_version_id = plugin.id
   and onboarding_resource.resource_path = plugin.manifest->'resources'->'onboarding'->>'applicationAsset'
), repaired as (
  select resources.*,
    coalesce(contract_resource->'inputContract', contract_resource->'deploymentInputContract', contract_resource) contract,
    coalesce(onboarding_resource->'deploymentDefaults'->'variables', '{}'::jsonb) onboarding_variables
  from resources
)
select repaired.*,
  gcac_20260822000100_repair_input_bindings(
    input_bindings,
    contract,
    onboarding_variables,
    nullif(trim(certificate_format_id), '')
  ) repaired_input_bindings
from repaired;

insert into deployment_input_binding_repair_backups (
  plugin_binding_id, tenant_id, application_asset_id, capability_key,
  original_plugin_version_id, original_input_bindings, original_managed_context, original_version
)
select plugin_binding_id, tenant_id, application_asset_id, capability_key,
  previous_plugin_version_id, input_bindings, managed_context, binding_version
from gcac_20260822000100_candidates
where previous_plugin_version_id <> current_plugin_version_id
   or input_bindings is distinct from repaired_input_bindings
   or managed_context is distinct from case
     when current_managed_target_id is not null then jsonb_build_object(
       'hostId', current_host_id,
       'managedTargetId', current_managed_target_id
     )
     else managed_context
   end
on conflict (plugin_binding_id) do nothing;

update unified_plugin_bindings binding
set plugin_version_id = candidate.current_plugin_version_id,
    input_bindings = candidate.repaired_input_bindings,
    managed_context = case
      when candidate.current_managed_target_id is not null then jsonb_build_object(
        'hostId', candidate.current_host_id,
        'managedTargetId', candidate.current_managed_target_id
      )
      else binding.managed_context
    end,
    version = binding.version + 1,
    updated_at = now()
from gcac_20260822000100_candidates candidate
where binding.id = candidate.plugin_binding_id
  and (binding.plugin_version_id <> candidate.current_plugin_version_id
    or binding.input_bindings is distinct from candidate.repaired_input_bindings
    or binding.managed_context is distinct from case
      when candidate.current_managed_target_id is not null then jsonb_build_object(
        'hostId', candidate.current_host_id,
        'managedTargetId', candidate.current_managed_target_id
      )
      else binding.managed_context
    end);

update plugin_capability_assignments assignment
set plugin_version_id = candidate.current_plugin_version_id,
    updated_at = now()
from gcac_20260822000100_candidates candidate
where assignment.tenant_id = candidate.tenant_id
  and assignment.owner_type = 'APPLICATION_ASSET'
  and assignment.owner_id = candidate.application_asset_id
  and assignment.capability_key = candidate.capability_key
  and assignment.plugin_binding_id = candidate.plugin_binding_id
  and assignment.status = 'ACTIVE'
  and assignment.plugin_version_id <> candidate.current_plugin_version_id;

with issue_rows as (
  select candidate.*,
    coalesce((select jsonb_agg(variable.key order by variable.key)
      from jsonb_each(coalesce(candidate.contract->'variables', '{}'::jsonb)) variable
      where variable.value->>'required' = 'true'
        and coalesce(variable.value->>'bindingPolicy', '') <> 'fixed'
        and coalesce(variable.value->>'configurationMode', '') <> 'runtime'
        and not (candidate.repaired_input_bindings->'variables' ? variable.key)), '[]'::jsonb) missing_variables,
    coalesce((select jsonb_agg(artifact.key order by artifact.key)
      from jsonb_each(coalesce(candidate.contract->'artifacts', '{}'::jsonb)) artifact
      where artifact.value->>'required' = 'true'
        and not (candidate.repaired_input_bindings->'artifacts' ? artifact.key)), '[]'::jsonb) missing_artifacts
  from gcac_20260822000100_candidates candidate
), classified as (
  select issue_rows.*,
    jsonb_build_object(
      'missingVariables', missing_variables,
      'missingArtifacts', missing_artifacts,
      'contractAvailable', contract is not null
    ) issues
  from issue_rows
)
insert into deployment_input_binding_repairs (
  tenant_id, application_asset_id, capability_key, plugin_binding_id,
  previous_plugin_version_id, current_plugin_version_id, status, issues
)
select tenant_id, application_asset_id, capability_key, plugin_binding_id,
  previous_plugin_version_id, current_plugin_version_id,
  case when jsonb_array_length(missing_variables) = 0
         and jsonb_array_length(missing_artifacts) = 0
         and contract is not null
    then 'REPAIRED' else 'UNRESOLVED' end,
  issues
from classified
on conflict (tenant_id, application_asset_id, capability_key) do update set
  plugin_binding_id = excluded.plugin_binding_id,
  previous_plugin_version_id = excluded.previous_plugin_version_id,
  current_plugin_version_id = excluded.current_plugin_version_id,
  status = excluded.status,
  issues = excluded.issues,
  repaired_at = now();

drop function gcac_20260822000100_repair_input_bindings(jsonb, jsonb, jsonb, text);
