-- 迁移目的：把风险 SLA 默认策略里的零值租户归属归一化到 default 根租户 UUID。
-- 背景：20260721000300 为默认策略写入了历史零值 UUID，占用了启用多租户前检查的 blocker。
-- 约束：
--   1. 只处理 risk_sla_policies 中的历史零值 UUID，不猜测其他租户文本。
--   2. 保持策略主键、版本和时间戳不变。
--   3. default 根租户不存在时直接失败，不能静默跳过。

do $$
declare
  default_tenant_id text;
begin
  select id::text
    into default_tenant_id
    from tenants
   where code = 'default'
     and deleted_at is null;

  if default_tenant_id is null then
    raise exception '默认租户不存在，无法归一化 risk_sla_policies';
  end if;

  update risk_sla_policies
     set tenant_id = default_tenant_id
   where tenant_id = '00000000-0000-0000-0000-000000000000';
end
$$;
