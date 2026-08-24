-- 006.3：为资产写入和统一任务提供可过期、可重放的持久化幂等记录。
-- 记录与业务写入必须在同一事务中提交；事务回滚时不会留下“已处理”假象。
create table if not exists idempotency_records (
  id text primary key,
  tenant_id text not null,
  action_type text not null,
  resource_type text not null,
  resource_id text not null,
  idempotency_key text not null,
  request_hash text not null,
  status_code integer not null check (status_code between 100 and 599),
  response_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, action_type, resource_type, resource_id, idempotency_key)
);

create index if not exists idx_idempotency_records_expiry
  on idempotency_records (expires_at);

create index if not exists idx_idempotency_records_lookup
  on idempotency_records (tenant_id, action_type, resource_type, resource_id, idempotency_key);
