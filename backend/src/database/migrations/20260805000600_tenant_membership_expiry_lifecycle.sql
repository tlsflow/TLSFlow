-- 迁移目的：把已过有效期的成员关系从 ACTIVE 归档为 EXPIRED，解除重新加入时的唯一约束阻塞。
-- 向后兼容：不修改历史租户或业务对象；REVOKED 与 EXPIRED 保留不同审计语义。
-- 设计边界：数据库不能在部分索引谓词中使用动态 now()，因此由成员生命周期服务在写入/查询前推进过期状态。

alter table tenant_memberships
  add column if not exists expired_at timestamptz;

alter table tenant_memberships
  drop constraint if exists tenant_memberships_status_check;

alter table tenant_memberships
  drop constraint if exists ck_tenant_memberships_revocation;

alter table tenant_memberships
  add constraint tenant_memberships_status_check
  check (status in ('ACTIVE', 'REVOKED', 'EXPIRED'));

alter table tenant_memberships
  add constraint ck_tenant_memberships_revocation
  check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null and expired_at is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null and expired_at is null)
    or (status = 'EXPIRED' and expired_at is not null and revoked_at is null and revoked_by is null)
  );

update tenant_memberships
   set status = 'EXPIRED',
       expired_at = effective_until,
       updated_at = now(),
       version = version + 1
 where status = 'ACTIVE'
   and effective_until is not null
   and effective_until <= now();

drop index if exists uq_tenant_memberships_active_subject_tenant;
create unique index uq_tenant_memberships_active_subject_tenant
  on tenant_memberships (subject_type, subject_id, tenant_id)
  where status = 'ACTIVE';

create index idx_tenant_memberships_expiry
  on tenant_memberships (status, effective_until)
  where status = 'ACTIVE' and effective_until is not null;
