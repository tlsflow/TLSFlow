-- 统一 Plugin、Asset、Application 的显式产品分类；旧 category/asset_kind 保持原语义。
alter table public.pg_service_assets add column if not exists product_category varchar(64);
alter table public.pg_service_assets drop constraint if exists ck_pg_service_assets_product_category;
alter table public.pg_service_assets add constraint ck_pg_service_assets_product_category
  check (product_category is null or product_category = any (array['WEB_SITE','APPLICATION_MIDDLEWARE','NETWORK_GATEWAY','CLOUD_PLATFORM','CA_ISSUANCE']));

-- 只回填历史 metadata 中已经明确声明的分类，不从 productFamily/tag 猜测，且不覆盖已有值。
update public.pg_service_assets
set product_category = metadata ->> 'productCategory'
where product_category is null
  and metadata ->> 'productCategory' = any (array['WEB_SITE','APPLICATION_MIDDLEWARE','NETWORK_GATEWAY','CLOUD_PLATFORM','CA_ISSUANCE']);
create index if not exists idx_pg_service_assets_product_category
  on public.pg_service_assets (tenant_id, product_category, status) where deleted_at is null;
