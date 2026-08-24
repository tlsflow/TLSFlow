-- Spec 033.6：清理迁移前遗留在 ApplicationAsset 覆盖层中的旧输入字段。
-- 只按插件资源声明的 inputContract 投影，不按厂商、插件 ID 或变量名分派。

create table if not exists deployment_input_binding_sanitization_backups (
  plugin_binding_id text primary key references unified_plugin_bindings(id),
  tenant_id text not null,
  original_input_bindings jsonb not null,
  original_version integer not null,
  sanitized_input_bindings jsonb not null,
  backed_up_at timestamptz not null default now()
);

create or replace function gcac_spec0336_sanitize_application_input_bindings(
  bindings jsonb,
  contract jsonb
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
  field_name text;
  field_definition jsonb;
  connection_definition jsonb;
  connection_value jsonb;
  connection_result jsonb;
begin
  if jsonb_typeof(bindings) <> 'object' or jsonb_typeof(contract) <> 'object' then
    return result;
  end if;

  for entry in select * from jsonb_each(coalesce(bindings->'variables', '{}'::jsonb)) loop
    field_definition := contract->'variables'->entry.key;
    if field_definition is not null
       and coalesce(field_definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(field_definition->>'configurationMode', '') <> 'runtime' then
      result := jsonb_set(result, '{variables}', result->'variables' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;

  for entry in select * from jsonb_each(coalesce(bindings->'connections', '{}'::jsonb)) loop
    connection_definition := contract->'connections'->entry.key;
    connection_value := entry.value;
    connection_result := '{}'::jsonb;
    if connection_definition is null or jsonb_typeof(connection_value) <> 'object' then
      continue;
    end if;

    foreach field_name in array array['host', 'port', 'username'] loop
      field_definition := connection_definition->field_name;
      if field_definition is not null
         and connection_value ? field_name
         and coalesce(field_definition->>'bindingPolicy', '') <> 'fixed'
         and coalesce(field_definition->>'configurationMode', '') <> 'runtime' then
        connection_result := jsonb_set(connection_result, array[field_name], connection_value->field_name, true);
      end if;
    end loop;

    field_definition := connection_definition->'tls'->'verifyPeer';
    if field_definition is not null
       and jsonb_typeof(connection_value->'tls') = 'object'
       and (connection_value->'tls') ? 'verifyPeer'
       and coalesce(field_definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(field_definition->>'configurationMode', '') <> 'runtime' then
      connection_result := jsonb_set(connection_result, '{tls,verifyPeer}', connection_value->'tls'->'verifyPeer', true);
    end if;

    field_definition := connection_definition->'tls'->'serverName';
    if field_definition is not null
       and jsonb_typeof(connection_value->'tls') = 'object'
       and (connection_value->'tls') ? 'serverName'
       and coalesce(field_definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(field_definition->>'configurationMode', '') <> 'runtime' then
      connection_result := jsonb_set(connection_result, '{tls,serverName}', connection_value->'tls'->'serverName', true);
    end if;

    field_definition := connection_definition->'hostKey'->'expectedFingerprint';
    if field_definition is not null
       and jsonb_typeof(connection_value->'hostKey') = 'object'
       and (connection_value->'hostKey') ? 'expectedFingerprint'
       and coalesce(field_definition->>'bindingPolicy', '') <> 'fixed'
       and coalesce(field_definition->>'configurationMode', '') <> 'runtime' then
      connection_result := jsonb_set(connection_result, '{hostKey,expectedFingerprint}', connection_value->'hostKey'->'expectedFingerprint', true);
    end if;

    if connection_result <> '{}'::jsonb then
      result := jsonb_set(result, '{connections}', result->'connections' || jsonb_build_object(entry.key, connection_result), true);
    end if;
  end loop;

  for entry in select * from jsonb_each(coalesce(bindings->'credentials', '{}'::jsonb)) loop
    if contract->'credentials' ? entry.key then
      result := jsonb_set(result, '{credentials}', result->'credentials' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;

  for entry in select * from jsonb_each(coalesce(bindings->'artifacts', '{}'::jsonb)) loop
    if contract->'artifacts' ? entry.key then
      result := jsonb_set(result, '{artifacts}', result->'artifacts' || jsonb_build_object(entry.key, entry.value), true);
    end if;
  end loop;

  return result;
end;
$$;

with candidates as (
  select distinct on (binding.id)
    binding.id as binding_id,
    binding.tenant_id,
    binding.input_bindings,
    binding.version,
    resource.resource_content::jsonb->'inputContract' as input_contract
  from plugin_capability_assignments assignment
  join unified_plugin_bindings binding
    on binding.id = assignment.plugin_binding_id
   and binding.tenant_id = assignment.tenant_id
   and binding.plugin_version_id = assignment.plugin_version_id
   and binding.status = 'ACTIVE'
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
    and resource.resource_content::jsonb ? 'inputContract'
  order by binding.id, assignment.capability_key
), sanitized as (
  select *, gcac_spec0336_sanitize_application_input_bindings(input_bindings, input_contract) as sanitized_input_bindings
  from candidates
)
insert into deployment_input_binding_sanitization_backups (
  plugin_binding_id,
  tenant_id,
  original_input_bindings,
  original_version,
  sanitized_input_bindings
)
select binding_id, tenant_id, input_bindings, version, sanitized_input_bindings
from sanitized
where input_bindings is distinct from sanitized_input_bindings
on conflict (plugin_binding_id) do nothing;

with candidates as (
  select distinct on (binding.id)
    binding.id as binding_id,
    binding.input_bindings,
    resource.resource_content::jsonb->'inputContract' as input_contract
  from plugin_capability_assignments assignment
  join unified_plugin_bindings binding
    on binding.id = assignment.plugin_binding_id
   and binding.tenant_id = assignment.tenant_id
   and binding.plugin_version_id = assignment.plugin_version_id
   and binding.status = 'ACTIVE'
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
    and resource.resource_content::jsonb ? 'inputContract'
  order by binding.id, assignment.capability_key
), sanitized as (
  select binding_id, input_bindings, gcac_spec0336_sanitize_application_input_bindings(input_bindings, input_contract) as sanitized_input_bindings
  from candidates
)
update unified_plugin_bindings binding
set input_bindings = sanitized.sanitized_input_bindings,
    version = binding.version + 1,
    updated_at = now()
from sanitized
where binding.id = sanitized.binding_id
  and binding.input_bindings is distinct from sanitized.sanitized_input_bindings;

drop function gcac_spec0336_sanitize_application_input_bindings(jsonb, jsonb);
