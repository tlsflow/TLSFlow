-- 001.6：保存每个租户/Agent 的当前能力快照指针。
-- 这里只保存历史事实的 ID 和时间，不复制完整 JSONB；历史事实仍在 pg_documents。
create table if not exists pg_agent_capability_snapshot_current (
  tenant_id text not null,
  agent_id text not null,
  latest_snapshot_id text not null,
  latest_reported_at timestamptz not null,
  latest_full_web_snapshot_id text,
  latest_full_web_reported_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, agent_id),
  constraint pg_agent_snapshot_current_full_web_pair_check
    check ((latest_full_web_snapshot_id is null) = (latest_full_web_reported_at is null))
);

create index if not exists idx_pg_agent_snapshot_current_latest_full_web
  on pg_agent_capability_snapshot_current (tenant_id, latest_full_web_reported_at desc)
  where latest_full_web_snapshot_id is not null;
