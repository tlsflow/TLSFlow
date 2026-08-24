-- Spec 033.6：将 PluginBinding 与 WorkflowExecutionBinding 硬切到统一 InputBindingsV1。

alter table unified_plugin_bindings
  add column input_bindings jsonb;

update unified_plugin_bindings
set input_bindings = jsonb_build_object(
  'apiVersion', 'gcac.input-bindings/v1',
  'variables', coalesce(variable_bindings, '{}'::jsonb),
  'connections', coalesce(connection_bindings, '{}'::jsonb),
  'credentials', coalesce(credential_bindings, '{}'::jsonb),
  'artifacts', coalesce(certificate_artifact_bindings, '{}'::jsonb)
);

create function gcac_spec0336_jsonb_deep_merge(base jsonb, override_value jsonb)
returns jsonb
language sql
immutable
strict
as $$
  select case
    when jsonb_typeof(base) <> 'object' or jsonb_typeof(override_value) <> 'object' then override_value
    else coalesce((
      select jsonb_object_agg(key, value)
      from (
        select coalesce(base_entry.key, override_entry.key) key,
               case
                 when base_entry.value is null then override_entry.value
                 when override_entry.value is null then base_entry.value
                 when jsonb_typeof(base_entry.value) = 'object' and jsonb_typeof(override_entry.value) = 'object'
                   then gcac_spec0336_jsonb_deep_merge(base_entry.value, override_entry.value)
                 else override_entry.value
               end value
        from jsonb_each(base) base_entry
        full join jsonb_each(override_value) override_entry using (key)
      ) merged
    ), '{}'::jsonb)
  end
$$;

with application_layers as (
  select application_assignment.plugin_binding_id application_binding_id,
         application_assignment.plugin_version_id,
         application_binding.input_bindings application_input_bindings,
         target_binding.input_bindings target_input_bindings,
         device_binding.input_bindings device_input_bindings,
         row_number() over (
           partition by application_assignment.plugin_binding_id
           order by application_assignment.capability_key
         ) layer_order
  from plugin_capability_assignments application_assignment
  join unified_plugin_bindings application_binding
    on application_binding.tenant_id = application_assignment.tenant_id
   and application_binding.id = application_assignment.plugin_binding_id
   and application_binding.plugin_version_id = application_assignment.plugin_version_id
   and application_binding.status = 'ACTIVE'
  join pg_application_asset_targets relation
    on relation.tenant_id = application_assignment.tenant_id
   and relation.application_asset_id = application_assignment.owner_id
   and relation.deleted_at is null
  join pg_managed_targets target
    on target.tenant_id = relation.tenant_id
   and target.id = relation.managed_target_id
   and target.deleted_at is null
  left join plugin_capability_assignments target_assignment
    on target_assignment.tenant_id = application_assignment.tenant_id
   and target_assignment.owner_type = 'MANAGED_TARGET'
   and target_assignment.owner_id = target.id
   and target_assignment.capability_key = application_assignment.capability_key
   and target_assignment.plugin_version_id = application_assignment.plugin_version_id
   and target_assignment.status = 'ACTIVE'
  left join unified_plugin_bindings target_binding
    on target_binding.tenant_id = target_assignment.tenant_id
   and target_binding.id = target_assignment.plugin_binding_id
   and target_binding.plugin_version_id = application_assignment.plugin_version_id
   and target_binding.status = 'ACTIVE'
  left join plugin_capability_assignments device_assignment
    on device_assignment.tenant_id = application_assignment.tenant_id
   and device_assignment.owner_type = 'DEVICE'
   and device_assignment.owner_id = target.device_id
   and device_assignment.capability_key = application_assignment.capability_key
   and device_assignment.plugin_version_id = application_assignment.plugin_version_id
   and device_assignment.status = 'ACTIVE'
  left join unified_plugin_bindings device_binding
    on device_binding.tenant_id = device_assignment.tenant_id
   and device_binding.id = device_assignment.plugin_binding_id
   and device_binding.plugin_version_id = application_assignment.plugin_version_id
   and device_binding.status = 'ACTIVE'
  where application_assignment.owner_type = 'APPLICATION_ASSET'
    and application_assignment.status = 'ACTIVE'
), materialized as (
  select application_binding_id,
         gcac_spec0336_jsonb_deep_merge(
           gcac_spec0336_jsonb_deep_merge(
             coalesce(device_input_bindings, jsonb_build_object('apiVersion','gcac.input-bindings/v1','variables','{}'::jsonb,'connections','{}'::jsonb,'credentials','{}'::jsonb,'artifacts','{}'::jsonb)),
             coalesce(target_input_bindings, '{}'::jsonb)
           ),
           application_input_bindings
         ) input_bindings
  from application_layers
  where layer_order = 1
)
update unified_plugin_bindings binding
set input_bindings = materialized.input_bindings,
    updated_at = now(),
    version = binding.version + 1
from materialized
where binding.id = materialized.application_binding_id
  and binding.input_bindings is distinct from materialized.input_bindings;

drop function gcac_spec0336_jsonb_deep_merge(jsonb, jsonb);

alter table unified_plugin_bindings
  alter column input_bindings set not null,
  add constraint ck_unified_plugin_bindings_input_bindings_v1 check (
    input_bindings->>'apiVersion' = 'gcac.input-bindings/v1'
    and jsonb_typeof(input_bindings->'variables') = 'object'
    and jsonb_typeof(input_bindings->'connections') = 'object'
    and jsonb_typeof(input_bindings->'credentials') = 'object'
    and jsonb_typeof(input_bindings->'artifacts') = 'object'
  );

alter table unified_plugin_bindings
  drop column variable_bindings,
  drop column credential_bindings,
  drop column secret_bindings,
  drop column certificate_artifact_bindings,
  drop column connection_bindings;

alter table workflow_execution_bindings
  add column input_bindings jsonb;

update workflow_execution_bindings
set input_bindings = jsonb_build_object(
  'apiVersion', 'gcac.input-bindings/v1',
  'variables', coalesce(variable_bindings, '{}'::jsonb),
  'connections', coalesce(connection_bindings, '{}'::jsonb),
  'credentials', coalesce(credential_bindings, '{}'::jsonb),
  'artifacts', coalesce(certificate_artifact_bindings, '{}'::jsonb)
);

alter table workflow_execution_bindings
  alter column input_bindings set not null,
  add constraint ck_workflow_execution_bindings_input_bindings_v1 check (
    input_bindings->>'apiVersion' = 'gcac.input-bindings/v1'
    and jsonb_typeof(input_bindings->'variables') = 'object'
    and jsonb_typeof(input_bindings->'connections') = 'object'
    and jsonb_typeof(input_bindings->'credentials') = 'object'
    and jsonb_typeof(input_bindings->'artifacts') = 'object'
  );

alter table workflow_execution_bindings
  drop column connection_bindings,
  drop column variable_bindings,
  drop column credential_bindings,
  drop column certificate_artifact_bindings;
