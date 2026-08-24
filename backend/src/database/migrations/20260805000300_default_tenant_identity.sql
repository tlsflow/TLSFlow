-- 迁移目的：确保默认单租户模式拥有唯一、可解析的 default 租户记录。
-- 向后兼容：已有 code=default 的租户记录保持原主键和业务数据不变。
-- 设计边界：本迁移只建立逻辑编码到 UUID 的事实源，不开启层级多租户，也不修改历史业务对象归属。

insert into tenants (name, code, status)
select '默认租户', 'default', 'ACTIVE'
where not exists (
  select 1
  from tenants
  where code = 'default'
);
