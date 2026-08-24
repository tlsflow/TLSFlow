-- ACME HTTP-01 短期验证材料共享存储。
-- token 只保存摘要，公开路由按摘要查询，避免把 token 原文作为数据库索引内容。

create table if not exists pg_acme_http01_presentations (
  token_sha256 char(64) primary key,
  tenant_id text not null,
  identifier text not null,
  key_authorization text not null,
  presentation_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_acme_http01_presentation_id
  on pg_acme_http01_presentations (tenant_id, presentation_id);

create index if not exists idx_pg_acme_http01_presentations_expiry
  on pg_acme_http01_presentations (expires_at);
