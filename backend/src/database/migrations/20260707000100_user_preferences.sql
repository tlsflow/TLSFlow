-- 迁移目的：为当前用户主题和语言偏好提供后端持久化基础。
-- 向后兼容：不修改历史迁移，不改已有用户数据；偏好字段随 security.users JSON 文档增量写入。
-- 说明：当前安全用户使用 pg_documents 的 security.users 命名空间保存，偏好位于 payload.preferences。

create table if not exists pg_documents (
  namespace varchar(128) not null,
  document_id varchar(128) not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, document_id)
);

create index if not exists idx_pg_documents_namespace_updated
  on pg_documents (namespace, updated_at desc);

create index if not exists idx_pg_documents_security_users_preferences
  on pg_documents ((payload -> 'preferences'))
  where namespace = 'security.users';
