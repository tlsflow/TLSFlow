-- 标准云服务插件能力指派使用 SERVICE_ASSET 所有者。
-- 历史迁移不可变；通过递增迁移补齐现行所有者枚举。
alter table public.plugin_capability_assignments
  drop constraint if exists plugin_capability_assignments_owner_type_check;

alter table public.plugin_capability_assignments
  add constraint plugin_capability_assignments_owner_type_check
  check ((owner_type)::text = any (array[
    'DEVICE'::varchar,
    'MANAGED_TARGET'::varchar,
    'APPLICATION_ASSET'::varchar,
    'SERVICE_ASSET'::varchar,
    'CLOUD_ACCOUNT_ASSET'::varchar
  ]));
