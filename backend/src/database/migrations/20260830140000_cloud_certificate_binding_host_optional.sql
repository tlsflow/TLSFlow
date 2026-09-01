-- 云服务证书绑定由 ServiceAsset 和 ManagedTarget 负责定位，不应伪造 Host。
-- 历史设备绑定仍继续要求 host_id；仅取消列级 NOT NULL，由业务关系保证设备路径提供 Host。
alter table public.pg_certificate_bindings
  alter column host_id drop not null;
