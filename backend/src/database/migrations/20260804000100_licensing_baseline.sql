-- 授权模块使用 pg_documents 保存版本化 JSON 文档。
-- 本迁移只增加按命名空间查询的索引，不修改任何历史迁移。
create index if not exists idx_pg_documents_licensing_namespace_updated
  on pg_documents (namespace, updated_at desc)
  where namespace like 'licensing.%';
