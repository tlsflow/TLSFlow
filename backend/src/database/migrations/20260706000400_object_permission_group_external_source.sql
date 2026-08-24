alter table object_permission_groups
  add column if not exists external_source_id text;

create index if not exists idx_obj_perm_groups_external_source
  on object_permission_groups(tenant_id, external_source_id, external_ref);
