-- 清理历史噪音审计：Secret 解密健康检查成功记录不是长期审计事件。
-- 失败、拒绝和真实业务用途的 Secret 读取仍然保留。
create table if not exists pg_documents (
  namespace varchar(128) not null,
  document_id varchar(128) not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, document_id)
);

create index if not exists idx_pg_documents_namespace_updated
  on pg_documents (namespace, updated_at desc);

delete from pg_documents
 where namespace = 'security.audit_logs'
   and payload ->> 'eventType' = 'secret.used'
   and payload ->> 'result' = 'success'
   and payload #>> '{detail,purpose}' = 'secret.health_check';
