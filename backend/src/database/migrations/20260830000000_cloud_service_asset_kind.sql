-- 云服务是统一资产中心中的 ServiceAsset，不属于设备型资产。
-- 历史迁移不可变；通过递增迁移放开 CLOUD_SERVICE 枚举值。
alter table public.pg_service_assets
  drop constraint if exists ck_pg_service_assets_asset_kind;

alter table public.pg_service_assets
  add constraint ck_pg_service_assets_asset_kind
  check ((asset_kind)::text = any (array['APPLICATION'::varchar, 'DEVICE'::varchar, 'CLOUD_SERVICE'::varchar]));
