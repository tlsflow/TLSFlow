update unified_plugin_bindings binding
set managed_context = jsonb_build_object(
      'hostId', target.device_id,
      'managedTargetId', target.id
    ),
    updated_at = now(),
    version = binding.version + 1
from plugin_capability_assignments assignment
join pg_application_asset_targets relation
  on relation.tenant_id = assignment.tenant_id
 and relation.application_asset_id = assignment.owner_id
 and relation.deleted_at is null
join pg_managed_targets target
  on target.tenant_id = relation.tenant_id
 and target.id = relation.managed_target_id
 and target.deleted_at is null
 and target.status = 'ACTIVE'
where binding.tenant_id = assignment.tenant_id
  and binding.id = assignment.plugin_binding_id
  and binding.mode = 'MANAGED'
  and binding.status = 'ACTIVE'
  and assignment.owner_type = 'APPLICATION_ASSET'
  and assignment.capability_key = 'certificate.deploy'
  and assignment.status = 'ACTIVE'
  and (
    binding.managed_context->>'hostId' is distinct from target.device_id
    or binding.managed_context->>'managedTargetId' is distinct from target.id
  );

update unified_plugin_bindings binding
set managed_context = jsonb_build_object(
      'hostId', target.device_id,
      'managedTargetId', target.id
    ),
    updated_at = now(),
    version = binding.version + 1
from plugin_capability_assignments assignment
join pg_managed_targets target
  on target.tenant_id = assignment.tenant_id
 and target.id = assignment.owner_id
 and target.deleted_at is null
 and target.status = 'ACTIVE'
where binding.tenant_id = assignment.tenant_id
  and binding.id = assignment.plugin_binding_id
  and binding.mode = 'MANAGED'
  and binding.status = 'ACTIVE'
  and assignment.owner_type = 'MANAGED_TARGET'
  and assignment.capability_key = 'certificate.deploy'
  and assignment.status = 'ACTIVE'
  and (
    binding.managed_context->>'hostId' is distinct from target.device_id
    or binding.managed_context->>'managedTargetId' is distinct from target.id
  );

update unified_plugin_bindings binding
set managed_context = jsonb_build_object('hostId', assignment.owner_id),
    updated_at = now(),
    version = binding.version + 1
from plugin_capability_assignments assignment
join pg_hosts host
  on host.tenant_id = assignment.tenant_id
 and host.id = assignment.owner_id
 and host.deleted_at is null
where binding.tenant_id = assignment.tenant_id
  and binding.id = assignment.plugin_binding_id
  and binding.mode = 'MANAGED'
  and binding.status = 'ACTIVE'
  and assignment.owner_type = 'DEVICE'
  and assignment.capability_key = 'certificate.deploy'
  and assignment.status = 'ACTIVE'
  and (
    binding.managed_context->>'hostId' is distinct from assignment.owner_id
    or binding.managed_context ? 'managedTargetId'
  );
