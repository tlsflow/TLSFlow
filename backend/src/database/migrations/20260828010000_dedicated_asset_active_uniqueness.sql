-- 003.6：专属证书资产只对活动记录施加应用唯一约束，历史归档资产必须保留且不能阻塞新域名版本。
-- 历史迁移不可变；本迁移仅调整新增索引的条件。
drop index if exists uq_pg_certificate_assets_tenant_application;
create unique index if not exists uq_pg_certificate_assets_tenant_application
  on pg_certificate_assets (tenant_id, application_asset_id)
  where status = 'active' and application_asset_id is not null;
