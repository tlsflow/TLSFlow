-- 迁移目的：建立集团/分子公司租户层级和用户租户成员关系。
-- 向后兼容：保留既有 tenants.id 及所有历史业务对象的 tenant_id，不批量改写业务数据。
-- 设计边界：parent_id 是未来扩展的数据结构；首期数据库和领域服务只开放 GROUP -> COMPANY。

alter table tenants
  add column if not exists tenant_type varchar(16);

alter table tenants
  add column if not exists parent_id uuid;

-- 现有租户没有可证明的父子关系，按独立根租户保留；default 明确升级为 GROUP。
-- 这只补充组织模型字段，不改变任何业务对象的 tenant_id。
update tenants
   set tenant_type = 'GROUP'
 where tenant_type is null;

alter table tenants
  alter column tenant_type set not null;

alter table tenants
  add constraint ck_tenants_tenant_type
  check (tenant_type in ('GROUP', 'COMPANY'));

alter table tenants
  add constraint fk_tenants_parent
  foreign key (parent_id) references tenants(id);

alter table tenants
  add constraint ck_tenants_parent_not_self
  check (parent_id is null or parent_id <> id);

alter table tenants
  add constraint ck_tenants_first_level_shape
  check (
    (tenant_type = 'GROUP' and parent_id is null)
    or (tenant_type = 'COMPANY' and parent_id is not null)
  );

create or replace function validate_tenant_hierarchy()
returns trigger
language plpgsql
as $$
declare
  parent_type varchar(16);
  parent_status varchar(32);
  ancestor_id uuid;
  visited_ids uuid[] := array[new.id];
begin
  if new.status = 'SUSPENDED'
     and exists (
       select 1
         from tenants
        where parent_id = new.id
          and status = 'ACTIVE'
     ) then
    raise exception '存在有效子公司时不能停用父租户' using errcode = '23514';
  end if;

  if new.parent_id is null then
    return new;
  end if;

  select tenant_type, status
    into parent_type, parent_status
    from tenants
   where id = new.parent_id;

  if parent_type is null then
    raise exception '租户父节点不存在' using errcode = '23503';
  end if;

  if new.tenant_type <> 'COMPANY' or parent_type <> 'GROUP' then
    raise exception '首期只允许 GROUP -> COMPANY 租户关系' using errcode = '23514';
  end if;

  if parent_status <> 'ACTIVE' then
    raise exception '租户父节点未启用' using errcode = '23514';
  end if;

  ancestor_id := new.parent_id;
  while ancestor_id is not null loop
    if ancestor_id = any(visited_ids) then
      raise exception '租户父子关系不能形成循环' using errcode = '23514';
    end if;

    visited_ids := array_append(visited_ids, ancestor_id);
    select parent_id
      into ancestor_id
      from tenants
     where id = ancestor_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_validate_tenant_hierarchy on tenants;
create constraint trigger trg_validate_tenant_hierarchy
after insert or update of tenant_type, parent_id, status on tenants
deferrable initially immediate
for each row
execute function validate_tenant_hierarchy();

create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  subject_type varchar(32) not null
    check (subject_type in ('user', 'group', 'external_group')),
  subject_id varchar(128) not null,
  tenant_id uuid not null references tenants(id),
  membership_type varchar(32) not null
    check (membership_type in ('owner', 'admin', 'operator', 'auditor', 'member')),
  status varchar(16) not null default 'ACTIVE'
    check (status in ('ACTIVE', 'REVOKED')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by varchar(128),
  updated_by varchar(128),
  revoked_at timestamptz,
  revoked_by varchar(128),
  version integer not null default 1 check (version > 0),
  constraint ck_tenant_memberships_effective_range
    check (effective_until is null or effective_until > effective_from),
  constraint ck_tenant_memberships_revocation
    check (
      (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
      or (status = 'REVOKED' and revoked_at is not null)
    )
);

create unique index uq_tenant_memberships_active_subject_tenant
  on tenant_memberships (subject_type, subject_id, tenant_id)
  where status = 'ACTIVE';

create index idx_tenant_memberships_subject_status
  on tenant_memberships (subject_type, subject_id, status, effective_from);

create index idx_tenant_memberships_tenant_status
  on tenant_memberships (tenant_id, status, effective_from);

create index idx_tenants_parent
  on tenants (parent_id);

-- 兼容现有内置管理员的组织事实；不改变其历史业务对象归属，也不代表已启用多租户访问。
insert into tenant_memberships (
  subject_type, subject_id, tenant_id, membership_type, status, created_by
)
select 'user', 'user_admin', id, 'owner', 'ACTIVE', 'system_migration'
  from tenants
 where code = 'default'
on conflict (subject_type, subject_id, tenant_id) where status = 'ACTIVE' do nothing;
