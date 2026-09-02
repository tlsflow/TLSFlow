-- 撤销错误的 Asset/Application 产品分类扩散；Plugin Manifest/Catalog 分类保持不变。
drop index if exists public.idx_pg_service_assets_product_category;
alter table public.pg_service_assets drop constraint if exists ck_pg_service_assets_product_category;
alter table public.pg_service_assets drop column if exists product_category;
