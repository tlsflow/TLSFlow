create table if not exists object_permission_groups (
  id text primary key,
  tenant_id text not null,
  code text not null,
  name text not null,
  source text not null,
  external_ref text,
  enabled boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, code),
  unique (tenant_id, source, external_ref)
);

create table if not exists object_permission_group_members (
  id text primary key,
  group_id text not null references object_permission_groups(id),
  user_id text not null,
  source text not null,
  created_at timestamptz not null,
  unique (group_id, user_id)
);

create table if not exists object_permission_object_types (
  id text primary key,
  code text not null unique,
  name text not null,
  table_name text not null,
  tenant_field text not null,
  owner_fields jsonb,
  parent_types jsonb,
  supported_actions jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists object_permission_object_sets (
  id text primary key,
  tenant_id text not null,
  name text not null,
  kind text not null,
  object_types jsonb not null,
  conditions jsonb,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists object_permission_object_set_members (
  id text primary key,
  object_set_id text not null references object_permission_object_sets(id),
  object_type text not null,
  object_id text not null,
  added_by text not null,
  created_at timestamptz not null,
  unique (object_set_id, object_type, object_id)
);

create table if not exists object_permission_role_bindings (
  id text primary key,
  tenant_id text not null,
  principal_type text not null,
  principal_id text not null,
  role_id text not null,
  object_set_id text not null references object_permission_object_sets(id),
  effect text not null,
  enabled boolean not null default true,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists object_permission_access_grants (
  id text primary key,
  role_id text not null,
  object_set_id text not null references object_permission_object_sets(id),
  access_level text not null,
  effect text not null,
  constraints jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (role_id, object_set_id, access_level, effect)
);

create index if not exists idx_obj_perm_groups_tenant on object_permission_groups(tenant_id, enabled);
create index if not exists idx_obj_perm_members_user on object_permission_group_members(user_id);
create index if not exists idx_obj_perm_sets_tenant on object_permission_object_sets(tenant_id, status);
create index if not exists idx_obj_perm_members_object on object_permission_object_set_members(object_type, object_id);
create index if not exists idx_obj_perm_bindings_principal on object_permission_role_bindings(principal_type, principal_id, tenant_id, enabled);
create index if not exists idx_obj_perm_grants_role_set on object_permission_access_grants(role_id, object_set_id, access_level, effect);
