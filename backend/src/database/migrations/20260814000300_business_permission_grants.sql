-- 业务授权保存原始合同和解析摘要；技术对象授权仍保留在原有命名空间。
create table if not exists pg_business_permission_grants (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  principal_type varchar(32) not null,
  principal_id varchar(128) not null,
  role_id varchar(128) not null,
  domain varchar(32) not null,
  level varchar(32) not null,
  root_object_type varchar(128) not null,
  root_object_id varchar(128),
  root_scope jsonb,
  effect varchar(16) not null default 'allow',
  status varchar(16) not null default 'active',
  resolver_version varchar(64) not null,
  related_resource_version varchar(128) not null,
  expanded_resource_types jsonb not null default '[]'::jsonb,
  expanded_actions jsonb not null default '[]'::jsonb,
  created_by varchar(128) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  version integer not null default 1,
  constraint ck_business_permission_domain check (domain in ('certificate', 'application', 'audit', 'settings')),
  constraint ck_business_permission_level check (level in ('user', 'manager')),
  constraint ck_business_permission_effect check (effect in ('allow', 'deny')),
  constraint ck_business_permission_status check (status in ('active', 'revoked')),
  constraint ck_business_permission_principal check (principal_type in ('user', 'group', 'external_group')),
  constraint ck_business_permission_tenant check (tenant_id <> '*')
);

create unique index if not exists uq_business_permission_active_grant
  on pg_business_permission_grants (tenant_id, principal_type, principal_id, role_id, domain, level, root_object_type, root_object_id, effect)
  where status = 'active';

create index if not exists idx_business_permission_subject
  on pg_business_permission_grants (tenant_id, principal_type, principal_id, status);

create index if not exists idx_business_permission_root
  on pg_business_permission_grants (tenant_id, domain, root_object_type, root_object_id, status);

create table if not exists pg_business_permission_relations (
  id varchar(512) primary key,
  tenant_id varchar(128) not null,
  root_domain varchar(32) not null,
  root_object_type varchar(128) not null,
  root_object_id varchar(128) not null,
  related_object_type varchar(128) not null,
  related_object_id varchar(128) not null,
  relation varchar(128) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_business_permission_relation_tenant check (tenant_id <> '*'),
  constraint ck_business_permission_relation_domain check (root_domain in ('certificate', 'application', 'audit', 'settings'))
);

create index if not exists idx_business_permission_relations_root
  on pg_business_permission_relations (tenant_id, root_domain, root_object_type, root_object_id);
